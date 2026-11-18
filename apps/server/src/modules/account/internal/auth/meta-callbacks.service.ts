import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { DataDeletionStatusResponse } from '@app/shared/auth';
import { and, eq, sql } from 'drizzle-orm';
import {
  AUTH_CONFIG,
  OAUTH_CONFIG,
  tenantTx,
  uuidV7,
  type AuthConfig,
  type OAuthConfig,
} from '../../../../core';
import { runInAccountScope } from '../../../../core/auth/account-scope';
import { authTx } from '../../../../core/db/auth-tx';
import { enqueueMailNotice } from '../../jobs';
import { loginIdentities, metaDeletionRequests } from '../db/schema';
import { writeAuthAudit } from './audit';
import { notFound, socialError } from './errors';
import { hmacKey } from './tokens';

// Thông báo "gỡ ứng dụng" / "yêu cầu xóa dữ liệu" của Meta (009, FR-009a, research R15).
// Định dạng `signed_request` theo tài liệu Meta ("Data Deletion Request Callback", "Deauthorize
// Callback"): `<chữ ký base64url>.<tải base64url>`, chữ ký = HMAC-SHA256(tải base64url, App Secret),
// tải là JSON có `algorithm: "HMAC-SHA256"` và `user_id` (mã người dùng theo ứng dụng).
// Phạm vi: CHỈ gỡ cách đăng nhập Facebook của người tương ứng. Không xóa người dùng hay dữ liệu tài
// khoản (đó là luồng xóa tài khoản – FR-14). Chạy lại an toàn: thông báo lặp nhận lại cùng mã xác nhận,
// bước gỡ luôn chạy lại (còn danh tính thì gỡ, không còn thì không làm gì và không gửi thư lần hai).

export type MetaCallbackKind = 'deauthorize' | 'data_deletion';

function fromBase64Url(value: string): Buffer | null {
  if (value === '' || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  return Buffer.from(value, 'base64url');
}

/**
 * Kiểm chữ ký và đọc `user_id`. Trả null khi không hợp lệ (thiếu dấu chấm, base64url/JSON hỏng,
 * thuật toán khác HMAC-SHA256, sai chữ ký, thiếu `user_id`). So sánh hằng thời gian; độ dài khác nhau
 * không ném lỗi. Hàm thuần – chỉ dùng `node:crypto` (nguyên tắc VII).
 */
export function parseSignedRequest(raw: unknown, appSecret: string): { userId: string } | null {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  const dot = raw.indexOf('.');
  if (dot <= 0 || dot !== raw.lastIndexOf('.')) return null;
  const encodedSignature = raw.slice(0, dot);
  const encodedPayload = raw.slice(dot + 1);
  const signature = fromBase64Url(encodedSignature);
  const payloadBytes = fromBase64Url(encodedPayload);
  if (signature === null || payloadBytes === null) return null;
  const expected = createHmac('sha256', appSecret).update(encodedPayload, 'utf8').digest();
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(payloadBytes.toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null) return null;
  const { algorithm, user_id: userId } = payload as Record<string, unknown>;
  if (typeof algorithm !== 'string' || algorithm.toUpperCase() !== 'HMAC-SHA256') return null;
  if (typeof userId !== 'string' || userId === '' || userId.length > 200) return null;
  return { userId };
}

@Injectable()
export class MetaCallbacksService {
  constructor(
    @Inject(AUTH_CONFIG) private readonly auth: AuthConfig,
    @Inject(OAUTH_CONFIG) private readonly config: OAuthConfig,
  ) {}

  /** 400 `SIGNED_REQUEST_INVALID` khi chữ ký sai hoặc ứng dụng chưa có App Secret. */
  verify(raw: unknown): { userId: string } {
    const secret = this.config.facebook?.appSecret;
    const parsed = secret === undefined ? null : parseSignedRequest(raw, secret);
    if (parsed === null) throw socialError('SIGNED_REQUEST_INVALID');
    return parsed;
  }

  /** Ghi nhận thông báo và gỡ cách đăng nhập Facebook (nếu còn). Trả mã xác nhận. */
  async handle(kind: MetaCallbackKind, facebookUserId: string): Promise<{ code: string }> {
    // Chỉ lưu HMAC của mã người dùng Facebook – nhận ra thông báo lặp mà không giữ mã rõ.
    const subjectHmac = hmacKey(this.auth.throttleSecret, `meta_${kind}`, facebookUserId);
    const { code, identity } = await authTx(async (db) => {
      const inserted = await db
        .insert(metaDeletionRequests)
        .values({
          id: uuidV7(),
          confirmation_code: randomBytes(16).toString('base64url'),
          kind,
          subject_hmac: subjectHmac,
          status: 'no_data',
        })
        .onConflictDoUpdate({
          target: [metaDeletionRequests.kind, metaDeletionRequests.subject_hmac],
          set: { received_at: sql`now()` },
        })
        .returning({ code: metaDeletionRequests.confirmation_code });
      const found = await db.execute<{ user_id: string; account_id: string }>(
        sql`SELECT user_id, account_id FROM account.auth_lookup_identity('facebook', ${facebookUserId})`,
      );
      const row = inserted[0];
      if (row === undefined) throw new Error('META_REQUEST_NOT_RECORDED');
      return { code: row.code, identity: found.rows[0] };
    });
    if (identity === undefined) return { code };

    const removed = await runInAccountScope(identity.account_id, () =>
      tenantTx(async (db) => {
        // Ngoại lệ có chủ đích của "còn ít nhất một cách đăng nhập" (FR-016): nhà cung cấp yêu cầu gỡ.
        const deleted = await db
          .delete(loginIdentities)
          .where(
            and(
              eq(loginIdentities.user_id, identity.user_id),
              eq(loginIdentities.provider, 'facebook'),
              eq(loginIdentities.provider_subject, facebookUserId),
            ),
          )
          .returning({ id: loginIdentities.id });
        if (deleted.length === 0) return false;
        // Thư chỉ được tạo trong giao dịch THẬT SỰ xóa được dòng → thông báo lặp không gửi trùng.
        await enqueueMailNotice(db, {
          template: 'identity_removed_by_provider',
          userId: identity.user_id,
          provider: 'facebook',
          dedupeKey: `account.notice:removed_by_provider:${deleted[0]?.id ?? uuidV7()}`,
        });
        await writeAuthAudit(db, {
          actorType: 'system',
          actorId: 'meta',
          accountId: identity.account_id,
          action: 'auth.identity.unlinked_by_provider',
          reason: kind,
          provider: 'facebook',
        });
        return true;
      }),
    );
    if (removed) {
      await authTx(async (db) => {
        await db
          .update(metaDeletionRequests)
          .set({ status: 'completed' })
          .where(
            and(
              eq(metaDeletionRequests.kind, kind),
              eq(metaDeletionRequests.subject_hmac, subjectHmac),
            ),
          );
      });
    }
    return { code };
  }

  /** Địa chỉ trang trạng thái công khai trả cho Meta. */
  statusUrl(code: string): string {
    return `${this.auth.webBaseUrl}/data-deletion/${code}`;
  }

  /** `GET /public/data-deletion/:code` – không có dữ liệu cá nhân. */
  async status(code: string): Promise<DataDeletionStatusResponse> {
    const row = await authTx(async (db) => {
      const rows = await db
        .select({
          status: metaDeletionRequests.status,
          receivedAt: metaDeletionRequests.received_at,
        })
        .from(metaDeletionRequests)
        .where(eq(metaDeletionRequests.confirmation_code, code))
        .limit(1);
      return rows[0];
    });
    if (row === undefined) throw notFound();
    return { status: row.status, receivedAt: row.receivedAt.toISOString() };
  }
}
