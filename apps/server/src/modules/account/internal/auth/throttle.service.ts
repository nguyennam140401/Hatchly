import { Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AUTH_CONFIG, OAUTH_CONFIG, type AuthConfig, type OAuthConfig } from '../../../../core';
import { authTx } from '../../../../core/db/auth-tx';
import type { ThrottleKind } from '../db/schema';
import { hmacKey } from './tokens';

// Bộ đếm chống dò và giới hạn gửi thư (FR-007, FR-008, R6) trong bảng dùng chung account.auth_throttle.
// Mỗi lần đếm là MỘT câu INSERT … ON CONFLICT DO UPDATE … RETURNING nguyên tử → đúng ngưỡng trên mọi
// bản API (SC-006). Hết cửa sổ (và hết chặn) thì đặt lại. Khóa là HMAC – không có email/IP dạng rõ.

interface Limit {
  max: number;
  windowMinutes: number;
  /** Chặn bao lâu khi chạm ngưỡng (đăng nhập); null = chỉ đếm (thư, đăng ký). */
  blockMinutes: number | null;
}

export interface ThrottleState {
  blocked: boolean;
  retryAfterSeconds: number;
}

@Injectable()
export class ThrottleService {
  private readonly limits: Record<ThrottleKind, Limit>;

  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Optional() @Inject(OAUTH_CONFIG) oauth?: OAuthConfig,
  ) {
    const block = config.loginBlockMinutes;
    const window = config.loginWindowMinutes;
    this.limits = {
      login_email: {
        max: config.loginMaxFailuresPerEmail,
        windowMinutes: window,
        blockMinutes: block,
      },
      login_ip: { max: config.loginMaxFailuresPerIp, windowMinutes: window, blockMinutes: block },
      mail_reset: { max: 3, windowMinutes: 60, blockMinutes: null },
      mail_verify: { max: 3, windowMinutes: 60, blockMinutes: null },
      register_ip: { max: 20, windowMinutes: 60, blockMinutes: null },
      // 009 (data-model mục 5). Khóa: email được mời · mã tài khoản · email đích · địa chỉ mạng.
      mail_invite: { max: 3, windowMinutes: 60, blockMinutes: null },
      invite_account: {
        max: oauth?.inviteMaxPerAccountPerDay ?? 10,
        windowMinutes: 24 * 60,
        blockMinutes: null,
      },
      // Dùng chung cho thư xác nhận liên kết và thư hoàn tất đăng ký.
      mail_link_confirm: { max: 3, windowMinutes: 60, blockMinutes: null },
      oauth_start_ip: { max: 30, windowMinutes: 60, blockMinutes: null },
    };
  }

  private key(kind: ThrottleKind, value: string): Buffer {
    return hmacKey(this.config.throttleSecret, kind, value);
  }

  /** Tăng bộ đếm; trả số lần trong cửa sổ hiện tại. Chạm ngưỡng (đăng nhập) → đặt blocked_until. */
  async hit(kind: ThrottleKind, value: string): Promise<number> {
    const limit = this.limits[kind];
    const window = `${limit.windowMinutes} minutes`;
    const block = limit.blockMinutes === null ? null : `${limit.blockMinutes} minutes`;
    const keyHash = this.key(kind, value);
    // Điều kiện "đã hết cửa sổ và hết chặn" trên dòng hiện có.
    const expired = sql`(t.window_start + ${window}::interval <= now()
      AND (t.blocked_until IS NULL OR t.blocked_until <= now()))`;
    const rows = await authTx(async (db) => {
      const result = await db.execute<{ count: number | string }>(sql`
        INSERT INTO account.auth_throttle AS t (kind, key_hash, window_start, count, blocked_until)
        VALUES (${kind}, ${keyHash}, now(), 1,
                CASE WHEN ${block}::interval IS NOT NULL AND 1 >= ${limit.max}
                     THEN now() + ${block}::interval END)
        ON CONFLICT (kind, key_hash) DO UPDATE SET
          window_start = CASE WHEN ${expired} THEN now() ELSE t.window_start END,
          count = CASE WHEN ${expired} THEN 1 ELSE t.count + 1 END,
          blocked_until = CASE
            WHEN ${block}::interval IS NULL THEN NULL
            WHEN (CASE WHEN ${expired} THEN 1 ELSE t.count + 1 END) >= ${limit.max}
              THEN GREATEST(COALESCE(t.blocked_until, now()), now() + ${block}::interval)
            WHEN ${expired} THEN NULL
            ELSE t.blocked_until END
        RETURNING count`);
      return result.rows;
    });
    return Number(rows[0]?.count ?? 0);
  }

  /** Đếm một lần dùng có giới hạn (thư, đăng ký); true khi còn trong ngưỡng. */
  async consume(kind: ThrottleKind, value: string): Promise<boolean> {
    return (await this.hit(kind, value)) <= this.limits[kind].max;
  }

  /** Đang bị chặn? (đăng nhập – kiểm TRƯỚC khi chạy kiểm tra mật khẩu). */
  async check(kind: ThrottleKind, value: string): Promise<ThrottleState> {
    const keyHash = this.key(kind, value);
    const rows = await authTx(async (db) => {
      const result = await db.execute<{ retry: number | string }>(sql`
        SELECT CEIL(EXTRACT(EPOCH FROM (blocked_until - now())))::int AS retry
          FROM account.auth_throttle
         WHERE kind = ${kind} AND key_hash = ${keyHash} AND blocked_until > now()`);
      return result.rows;
    });
    const retry = rows[0]?.retry;
    return retry === undefined
      ? { blocked: false, retryAfterSeconds: 0 }
      : { blocked: true, retryAfterSeconds: Math.max(1, Number(retry)) };
  }

  /** Xóa bộ đếm (đăng nhập thành công xóa `login_email`). */
  async reset(kind: ThrottleKind, value: string): Promise<void> {
    const keyHash = this.key(kind, value);
    await authTx(async (db) => {
      await db.execute(
        sql`DELETE FROM account.auth_throttle WHERE kind = ${kind} AND key_hash = ${keyHash}`,
      );
    });
  }
}
