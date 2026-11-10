import { Inject, Injectable } from '@nestjs/common';
import type { MeResponse } from '@app/shared/auth';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { tenantTx, uuidV7, type CustomerActor, type Db } from '../../../../core';
import { runInAccountScope } from '../../../../core/auth/account-scope';
import { userAgentSummary } from '../../../../core/auth/client-ip';
import { authTx } from '../../../../core/db/auth-tx';
import { DbQueryError } from '../../../../core/db/errors';
import { authTokens, users } from '../db/schema';
import { writeAuthAudit } from './audit';
import { normalizeEmail } from './email';
import { emailAlreadyVerified, emailInvalid, rateLimited, tokenInvalid } from './errors';
import { MailDispatcher } from './mail/dispatch';
import { loadMeInTx } from './me';
import {
  lookupEmail,
  SessionService,
  type IssuedSession,
  type RequestMeta,
} from './session.service';
import { ThrottleService } from './throttle.service';
import { hashToken, newToken } from './tokens';

// Xác minh email, gửi lại thư, sửa email khi chưa xác minh (FR-008, FR-008a, FR-008b, R8).
// Mã một lần chỉ lưu SHA-256; tiêu thụ bằng UPDATE có điều kiện → dùng hai lần không bao giờ thành
// công cả hai. Mã mới cùng mục đích vô hiệu mã cũ trong cùng giao dịch.

const VERIFY_TTL_MS = 24 * 3_600_000;

// `type` (không `interface`): db.execute<T> đòi T gán được cho Record<string, unknown>.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type FoundToken = {
  token_id: string;
  account_id: string;
  user_id: string;
  email_normalized: string;
};

/** Tra mã một lần còn hiệu lực qua hàm SECURITY DEFINER (không tiêu thụ). */
export async function findToken(
  token: string,
  purpose: 'verify_email' | 'reset_password',
): Promise<FoundToken | undefined> {
  return authTx(async (db) => {
    const result = await db.execute<FoundToken>(
      sql`SELECT * FROM account.auth_find_token(${hashToken(token)}, ${purpose})`,
    );
    return result.rows[0];
  });
}

/** Tiêu thụ mã: UPDATE có điều kiện trong tenantTx; 0 dòng → false. */
export async function consumeToken(db: Db, tokenId: string): Promise<boolean> {
  const rows = await db
    .update(authTokens)
    .set({ used_at: sql`now()` })
    .where(
      and(
        eq(authTokens.id, tokenId),
        isNull(authTokens.used_at),
        gt(authTokens.expires_at, sql`now()`),
      ),
    )
    .returning({ id: authTokens.id });
  return rows.length === 1;
}

/** Vô hiệu mọi mã còn hiệu lực cùng mục đích của người dùng rồi tạo mã mới. Trả mã gốc. */
export async function issueToken(
  db: Db,
  input: {
    accountId: string;
    userId: string;
    purpose: 'verify_email' | 'reset_password';
    emailNormalized: string;
    ttlMs: number;
  },
): Promise<string> {
  await db
    .update(authTokens)
    .set({ used_at: sql`now()` })
    .where(
      and(
        eq(authTokens.user_id, input.userId),
        eq(authTokens.purpose, input.purpose),
        isNull(authTokens.used_at),
      ),
    );
  const token = newToken();
  await db.insert(authTokens).values({
    id: uuidV7(),
    account_id: input.accountId,
    user_id: input.userId,
    purpose: input.purpose,
    token_hash: hashToken(token),
    email_normalized: input.emailNormalized,
    expires_at: new Date(Date.now() + input.ttlMs),
  });
  return token;
}

@Injectable()
export class EmailVerificationService {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(ThrottleService) private readonly throttle: ThrottleService,
    @Inject(MailDispatcher) private readonly mail: MailDispatcher,
  ) {}

  /** Mở liên kết xác minh → email đã xác nhận + được đăng nhập bằng phiên MỚI. */
  async verify(
    token: string,
    meta: RequestMeta,
    current: { actor: CustomerActor; tokenHash: Buffer } | null,
  ): Promise<{ me: MeResponse; session: IssuedSession }> {
    const found = await findToken(token, 'verify_email');
    if (found === undefined) throw tokenInvalid('verify_email');
    return runInAccountScope(found.account_id, () =>
      tenantTx(async (db) => {
        if (!(await consumeToken(db, found.token_id))) throw tokenInvalid('verify_email');
        // Chỉ xác nhận khi mã áp dụng cho email HIỆN TẠI (email đã đổi thì mã cũ vô dụng).
        await db
          .update(users)
          .set({ email_verified_at: sql`COALESCE(email_verified_at, now())` })
          .where(
            and(eq(users.id, found.user_id), eq(users.email_normalized, found.email_normalized)),
          );
        if (current?.actor.userId === found.user_id) {
          await this.sessions.revokeSession(
            db,
            current.actor.sessionId,
            'email_verified',
            current.tokenHash,
          );
        }
        const session = await this.sessions.insertSession(db, {
          accountId: found.account_id,
          userId: found.user_id,
          userAgent: meta.userAgent,
        });
        await writeAuthAudit(db, {
          actorType: 'user',
          actorId: found.user_id,
          accountId: found.account_id,
          action: 'auth.email.verified',
          ip: meta.ip,
          uaFamily: userAgentSummary(meta.userAgent),
        });
        const me = await loadMeInTx(db, found.user_id);
        if (me === null) throw tokenInvalid('verify_email');
        return { me, session };
      }),
    );
  }

  /**
   * Gửi lại thư xác minh. Phản hồi LUÔN như nhau (email không tồn tại, đã xác minh, hay đã chạm
   * 3 thư/giờ). Đã đăng nhập (chưa xác minh) thì dùng email của phiên.
   */
  async resend(
    input: { email?: string | undefined },
    actor: CustomerActor | null,
    meta: RequestMeta,
  ): Promise<{ status: 'check_email' }> {
    if (!(await this.throttle.consume('register_ip', `resend:${meta.ip}`))) throw rateLimited();
    let target:
      | { accountId: string; userId: string; email: string; emailNormalized: string; name: string }
      | undefined;
    if (actor !== null) {
      target = await runInAccountScope(actor.accountId, () =>
        tenantTx(async (db) => {
          const rows = await db.select().from(users).where(eq(users.id, actor.userId)).limit(1);
          const u = rows[0];
          // Không có người dùng, hoặc email đã xác nhận → không gửi lại.
          return (u?.email_verified_at ?? null) !== null || u === undefined
            ? undefined
            : {
                accountId: u.account_id,
                userId: u.id,
                email: u.email,
                emailNormalized: u.email_normalized,
                name: u.display_name,
              };
        }),
      );
    } else if (input.email !== undefined) {
      const email = normalizeEmail(input.email);
      const found = email === null ? undefined : await lookupEmail(email.emailNormalized);
      if (email !== null && found?.email_verified_at === null) {
        target = {
          accountId: found.account_id,
          userId: found.user_id,
          email: email.email,
          emailNormalized: email.emailNormalized,
          name: found.display_name,
        };
      }
    }
    if (target === undefined) return { status: 'check_email' };
    if (!(await this.throttle.consume('mail_verify', target.emailNormalized))) {
      return { status: 'check_email' };
    }
    const t = target;
    const token = await runInAccountScope(t.accountId, () =>
      tenantTx((db) =>
        issueToken(db, {
          accountId: t.accountId,
          userId: t.userId,
          purpose: 'verify_email',
          emailNormalized: t.emailNormalized,
          ttlMs: VERIFY_TTL_MS,
        }),
      ),
    );
    this.mail.sendAfterCommit('verifyEmail', t.email, {
      displayName: t.name,
      token,
      userId: t.userId,
    });
    return { status: 'check_email' };
  }

  /**
   * Sửa email đăng ký khi CHƯA xác minh. Email mới đã có người dùng → phản hồi như thành công, gửi
   * thư "email đã có tài khoản" tới email đó, không đổi gì (không lộ email đã đăng ký).
   */
  async changeEmail(
    actor: CustomerActor,
    newEmail: string,
    meta: RequestMeta,
  ): Promise<{ status: 'check_email' }> {
    const email = normalizeEmail(newEmail);
    if (email === null) throw emailInvalid();
    const user = await runInAccountScope(actor.accountId, () =>
      tenantTx(async (db) => {
        const rows = await db.select().from(users).where(eq(users.id, actor.userId)).limit(1);
        return rows[0];
      }),
    );
    if (user === undefined) throw emailInvalid();
    if (user.email_verified_at !== null) throw emailAlreadyVerified();
    if (!(await this.throttle.consume('mail_verify', email.emailNormalized))) {
      return { status: 'check_email' };
    }

    const sendTaken = () => {
      this.mail.sendAfterCommit('emailAlreadyRegistered', email.email, { userId: null });
      return { status: 'check_email' as const };
    };
    if (email.emailNormalized !== user.email_normalized) {
      const existing = await lookupEmail(email.emailNormalized);
      if (existing !== undefined) return sendTaken();
    }

    let token: string;
    try {
      token = await runInAccountScope(actor.accountId, () =>
        tenantTx(async (db) => {
          await db
            .update(users)
            .set({ email: email.email, email_normalized: email.emailNormalized })
            .where(and(eq(users.id, actor.userId), isNull(users.email_verified_at)));
          const issued = await issueToken(db, {
            accountId: actor.accountId,
            userId: actor.userId,
            purpose: 'verify_email',
            emailNormalized: email.emailNormalized,
            ttlMs: VERIFY_TTL_MS,
          });
          await writeAuthAudit(db, {
            actorType: 'user',
            actorId: actor.userId,
            accountId: actor.accountId,
            action: 'auth.email.changed',
            ip: meta.ip,
            uaFamily: userAgentSummary(meta.userAgent),
          });
          return issued;
        }),
      );
    } catch (err) {
      // Hai người cùng lúc lấy cùng email → xử lý như email đã có.
      if (err instanceof DbQueryError && err.constraint === 'users_email_normalized_key') {
        return sendTaken();
      }
      throw err;
    }
    this.mail.sendAfterCommit('verifyEmail', email.email, {
      displayName: user.display_name,
      token,
      userId: actor.userId,
    });
    return { status: 'check_email' };
  }
}
