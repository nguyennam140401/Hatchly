import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  AUTH_CONFIG,
  tenantTx,
  uuidV7,
  type AuthConfig,
  type CustomerActor,
  type Db,
  type Resolved,
  type SessionResolver,
  type StaffActor,
} from '../../../../core';
import { runInAccountScope } from '../../../../core/auth/account-scope';
import { userAgentSummary } from '../../../../core/auth/client-ip';
import { SessionCache } from '../../../../core/auth/session-cache';
import { authTx } from '../../../../core/db/auth-tx';
import { loginIdentities, sessions, type SessionRevokeReason } from '../db/schema';
import { writeAuthAudit } from './audit';
import { normalizeEmail } from './email';
import { accountUnavailable, invalidCredentials, LoginThrottledError } from './errors';
import { PasswordHasher } from './password/password-hasher';
import { normalizePassword } from './password/password-policy';
import { StaffService } from './staff.service';
import { ThrottleService } from './throttle.service';
import { hashToken, newToken } from './tokens';

// Phiên khách hàng (FR-010, FR-011, R3): tạo/thu hồi phiên, đăng nhập bằng mật khẩu, và cài đặt
// `SessionResolver` cho AccessGuard (đảo phụ thuộc – contracts/authz-api.md mục 4).

const DAY_MS = 86_400_000;
/** Chỉ ghi lại last_seen_at khi đã cũ hơn 1 giờ (không ghi CSDL ở mọi yêu cầu). */
const CUSTOMER_TOUCH_AFTER = '1 hour';

export interface IssuedSession {
  sessionId: string;
  token: string;
  absoluteExpiresAt: Date;
}

export interface RequestMeta {
  ip: string;
  userAgent: string | undefined;
}

// `type` (không `interface`): db.execute<T> đòi T gán được cho Record<string, unknown>.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type LookupRow = {
  user_id: string;
  account_id: string;
  display_name: string;
  password_hash: string | null;
  user_status: string;
  member_status: string | null;
  account_status: string;
  email_verified_at: Date | null;
};

/** Tra email qua hàm SECURITY DEFINER (authTx). */
export async function lookupEmail(emailNormalized: string): Promise<LookupRow | undefined> {
  return authTx(async (db) => {
    const result = await db.execute<LookupRow>(
      sql`SELECT * FROM account.auth_lookup_email(${emailNormalized})`,
    );
    return result.rows[0];
  });
}

@Injectable()
export class SessionService implements SessionResolver {
  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(SessionCache) private readonly cache: SessionCache,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(ThrottleService) private readonly throttle: ThrottleService,
    @Inject(StaffService) private readonly staff: StaffService,
  ) {}

  // ----- SessionResolver -----

  async resolveCustomer(tokenHash: Buffer): Promise<Resolved<CustomerActor> | null> {
    const idle = `${this.config.sessionIdleDays} days`;
    const row = await authTx(async (db) => {
      const result = await db.execute<{
        session_id: string;
        user_id: string;
        account_id: string;
        role: 'owner' | 'collaborator';
        email_verified: boolean;
        absolute_expires_at: Date | string;
        detached: boolean;
      }>(
        // Bản 2 (009, R20): thêm cột `detached`; hàm cũ giữ cho bản API cũ khi phát hành.
        sql`SELECT * FROM account.auth_resolve_session_v2(${tokenHash}, ${CUSTOMER_TOUCH_AFTER}::interval, ${idle}::interval)`,
      );
      return result.rows[0];
    });
    if (row === undefined) return null;
    return {
      actor: {
        kind: 'user',
        userId: row.user_id,
        accountId: row.account_id,
        role: row.role,
        emailVerified: row.email_verified,
        sessionId: row.session_id,
        detached: row.detached,
      },
      absoluteExpiresAt: new Date(row.absolute_expires_at),
    };
  }

  resolveStaff(tokenHash: Buffer): Promise<Resolved<StaffActor> | null> {
    return this.staff.resolveStaff(tokenHash);
  }

  // ----- Tạo / thu hồi phiên (bên trong tenantTx của tài khoản) -----

  /** Tạo phiên mới trong giao dịch tenant `db` đang mở. */
  async insertSession(
    db: Db,
    input: {
      accountId: string;
      userId: string;
      userAgent: string | undefined;
      /**
       * 009 (research R11): phiên cấp do XOAY VÒNG (nhận tài khoản, tham gia lại qua lời mời) mang mốc
       * xác nhận danh tính của phiên cũ – xoay phiên không phải là xác thực lại.
       */
      reauthenticatedAt?: Date | undefined;
    },
  ): Promise<IssuedSession> {
    const token = newToken();
    const now = Date.now();
    const id = uuidV7();
    const absoluteExpiresAt = new Date(now + this.config.sessionAbsoluteDays * DAY_MS);
    await db.insert(sessions).values({
      id,
      account_id: input.accountId,
      user_id: input.userId,
      token_hash: hashToken(token),
      last_seen_at: new Date(now),
      idle_expires_at: new Date(now + this.config.sessionIdleDays * DAY_MS),
      absolute_expires_at: absoluteExpiresAt,
      user_agent_summary: userAgentSummary(input.userAgent),
      ...(input.reauthenticatedAt !== undefined
        ? { reauthenticated_at: input.reauthenticatedAt }
        : {}),
    });
    return { sessionId: id, token, absoluteExpiresAt };
  }

  /** Tạo phiên trong phạm vi tài khoản đã xác minh (mở tenantTx riêng). */
  createCustomerSession(input: {
    accountId: string;
    userId: string;
    userAgent: string | undefined;
    reauthenticatedAt?: Date | undefined;
  }): Promise<IssuedSession> {
    return runInAccountScope(input.accountId, () =>
      tenantTx((db) => this.insertSession(db, input)),
    );
  }

  /** Thu hồi một phiên (cập nhật có điều kiện); bỏ mục bộ nhớ đệm trên bản này. */
  async revokeSession(
    db: Db,
    sessionId: string,
    reason: SessionRevokeReason,
    tokenHash?: Buffer,
  ): Promise<void> {
    await db
      .update(sessions)
      .set({ revoked_at: sql`now()`, revoke_reason: reason })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revoked_at)));
    if (tokenHash !== undefined) this.cache.evict(tokenHash);
    this.cache.evictWhere((a) => a.sessionId === sessionId);
  }

  /** Thu hồi mọi phiên của người dùng (trừ `exceptSessionId`). */
  async revokeAllForUser(
    db: Db,
    userId: string,
    reason: SessionRevokeReason,
    options: { exceptSessionId?: string | undefined } = {},
  ): Promise<void> {
    const conditions = [eq(sessions.user_id, userId), isNull(sessions.revoked_at)];
    if (options.exceptSessionId !== undefined) {
      conditions.push(ne(sessions.id, options.exceptSessionId));
    }
    await db
      .update(sessions)
      .set({ revoked_at: sql`now()`, revoke_reason: reason })
      .where(and(...conditions));
    this.cache.evictWhere(
      (a) => a.kind === 'user' && a.userId === userId && a.sessionId !== options.exceptSessionId,
    );
  }

  /** Bỏ mọi mục bộ nhớ đệm phiên của người dùng trên bản API này (phiên đã bị hàm CSDL xóa). */
  evictUser(userId: string): void {
    this.cache.evictWhere((a) => a.kind === 'user' && a.userId === userId);
  }

  // ----- Đăng nhập bằng mật khẩu (FR-006, FR-007, R2, R6) -----

  async loginWithPassword(input: {
    email: string;
    password: string;
    meta: RequestMeta;
  }): Promise<{ session: IssuedSession; userId: string; accountId: string }> {
    const normalized = normalizeEmail(input.email);
    const emailKey = normalized?.emailNormalized ?? input.email.trim().toLowerCase();
    const audit = (
      action: 'auth.login.failed' | 'auth.login.throttled',
      reason: string,
      who?: LookupRow,
    ) =>
      authTx((db) =>
        writeAuthAudit(db, {
          actorType: who === undefined ? 'anonymous' : 'user',
          actorId: who?.user_id ?? 'anonymous',
          accountId: who?.account_id ?? null,
          action,
          ip: input.meta.ip,
          uaFamily: userAgentSummary(input.meta.userAgent),
          reason,
        }),
      );

    // Bị chặn → KHÔNG chạy kiểm tra mật khẩu (kẻ tấn công không dò tiếp được).
    const [byEmail, byIp] = await Promise.all([
      this.throttle.check('login_email', emailKey),
      this.throttle.check('login_ip', input.meta.ip),
    ]);
    if (byEmail.blocked || byIp.blocked) {
      await audit('auth.login.throttled', byEmail.blocked ? 'blocked_email' : 'blocked_ip');
      throw new LoginThrottledError(Math.max(byEmail.retryAfterSeconds, byIp.retryAfterSeconds));
    }

    const password = normalizePassword(input.password);
    const found = normalized === null ? undefined : await lookupEmail(emailKey);
    const fail = async (reason: string, who?: LookupRow): Promise<never> => {
      await Promise.all([
        this.throttle.hit('login_email', emailKey),
        this.throttle.hit('login_ip', input.meta.ip),
      ]);
      await audit('auth.login.failed', reason, who);
      throw invalidCredentials();
    };

    if (found?.password_hash == null) {
      // Cân thời gian: vẫn chạy verify trên băm giả (SC-006).
      await this.hasher.verifyDummy(password);
      return fail(found === undefined ? 'unknown_email' : 'no_password_identity', found);
    }
    const ok = await this.hasher.verify(found.password_hash, password);
    if (!ok) return fail('bad_password', found);

    // Chỉ báo "không dùng được" SAU khi mật khẩu đúng (không lộ trạng thái cho người đoán).
    if (
      found.user_status !== 'active' ||
      found.member_status !== 'active' ||
      found.account_status === 'deleting'
    ) {
      throw accountUnavailable(
        found.account_status === 'deleting' ? 'account_deleting' : 'user_disabled',
      );
    }

    await this.throttle.reset('login_email', emailKey);
    const passwordHash = found.password_hash;
    const session = await runInAccountScope(found.account_id, () =>
      tenantTx(async (db) => {
        const update: { last_used_at: ReturnType<typeof sql>; password_hash?: string } = {
          last_used_at: sql`now()`,
        };
        if (this.hasher.needsRehash(passwordHash)) {
          update.password_hash = await this.hasher.hash(password);
        }
        await db
          .update(loginIdentities)
          .set(update)
          .where(
            and(
              eq(loginIdentities.user_id, found.user_id),
              eq(loginIdentities.provider, 'password'),
            ),
          );
        const issued = await this.insertSession(db, {
          accountId: found.account_id,
          userId: found.user_id,
          userAgent: input.meta.userAgent,
        });
        await writeAuthAudit(db, {
          actorType: 'user',
          actorId: found.user_id,
          accountId: found.account_id,
          action: 'auth.login.succeeded',
          ip: input.meta.ip,
          uaFamily: userAgentSummary(input.meta.userAgent),
        });
        return issued;
      }),
    );
    return { session, userId: found.user_id, accountId: found.account_id };
  }
}
