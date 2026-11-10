import { Inject, Injectable } from '@nestjs/common';
import type { MeResponse } from '@app/shared/auth';
import { and, eq, sql } from 'drizzle-orm';
import { tenantTx, type CustomerActor } from '../../../../core';
import { runInAccountScope } from '../../../../core/auth/account-scope';
import { userAgentSummary } from '../../../../core/auth/client-ip';
import { loginIdentities, users } from '../db/schema';
import { writeAuthAudit } from './audit';
import { normalizeEmail } from './email';
import { consumeToken, findToken, issueToken } from './email-verification.service';
import { invalidCredentials, LoginThrottledError, rateLimited, tokenInvalid } from './errors';
import { MailDispatcher } from './mail/dispatch';
import { loadMeInTx } from './me';
import { PasswordHasher } from './password/password-hasher';
import { normalizePassword } from './password/password-policy';
import {
  lookupEmail,
  SessionService,
  type IssuedSession,
  type RequestMeta,
} from './session.service';
import { assertStrongPassword } from './staff.service';
import { ThrottleService } from './throttle.service';

// Quên mật khẩu, đặt lại, đổi mật khẩu (FR-009, US5). Phản hồi "quên mật khẩu" luôn như nhau; liên kết
// dùng một lần, 30 phút, 3 thư/giờ/email. Đặt lại/đổi → thu hồi phiên, gửi thư "mật khẩu vừa đổi".

const RESET_TTL_MS = 30 * 60_000;

@Injectable()
export class PasswordResetService {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(ThrottleService) private readonly throttle: ThrottleService,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(MailDispatcher) private readonly mail: MailDispatcher,
  ) {}

  async forgot(emailInput: string, meta: RequestMeta): Promise<{ status: 'check_email' }> {
    if (!(await this.throttle.consume('register_ip', `forgot:${meta.ip}`))) throw rateLimited();
    const email = normalizeEmail(emailInput);
    const found = email === null ? undefined : await lookupEmail(email.emailNormalized);
    if (email === null || found?.password_hash == null) return { status: 'check_email' };
    if (!(await this.throttle.consume('mail_reset', email.emailNormalized))) {
      return { status: 'check_email' };
    }
    const token = await runInAccountScope(found.account_id, () =>
      tenantTx((db) =>
        issueToken(db, {
          accountId: found.account_id,
          userId: found.user_id,
          purpose: 'reset_password',
          emailNormalized: email.emailNormalized,
          ttlMs: RESET_TTL_MS,
        }),
      ),
    );
    this.mail.sendAfterCommit('resetPassword', email.email, {
      displayName: found.display_name,
      token,
      userId: found.user_id,
    });
    return { status: 'check_email' };
  }

  async reset(
    token: string,
    newPassword: string,
    meta: RequestMeta,
  ): Promise<{ me: MeResponse; session: IssuedSession }> {
    const found = await findToken(token, 'reset_password');
    if (found === undefined) throw tokenInvalid('reset_password');
    const normalized = assertStrongPassword('newPassword', newPassword, found.email_normalized);
    const passwordHash = await this.hasher.hash(normalized);
    const result = await runInAccountScope(found.account_id, () =>
      tenantTx(async (db) => {
        if (!(await consumeToken(db, found.token_id))) throw tokenInvalid('reset_password');
        await db
          .update(loginIdentities)
          .set({ password_hash: passwordHash })
          .where(
            and(
              eq(loginIdentities.user_id, found.user_id),
              eq(loginIdentities.provider, 'password'),
            ),
          );
        await db
          .update(users)
          .set({ password_changed_at: sql`now()` })
          .where(eq(users.id, found.user_id));
        await this.sessions.revokeAllForUser(db, found.user_id, 'password_reset');
        const session = await this.sessions.insertSession(db, {
          accountId: found.account_id,
          userId: found.user_id,
          userAgent: meta.userAgent,
        });
        await writeAuthAudit(db, {
          actorType: 'user',
          actorId: found.user_id,
          accountId: found.account_id,
          action: 'auth.password.reset',
          ip: meta.ip,
          uaFamily: userAgentSummary(meta.userAgent),
        });
        const me = await loadMeInTx(db, found.user_id);
        if (me === null) throw tokenInvalid('reset_password');
        return { me, session };
      }),
    );
    await this.throttle.reset('login_email', found.email_normalized);
    this.mail.sendAfterCommit('passwordChanged', result.me.user.email, {
      displayName: result.me.user.displayName,
      userId: found.user_id,
    });
    return result;
  }

  /** Đổi mật khẩu khi biết mật khẩu hiện tại; phiên khác bị thu hồi, phiên hiện tại được cấp mã mới. */
  async change(
    actor: CustomerActor,
    currentTokenHash: Buffer,
    currentPassword: string,
    newPassword: string,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const user = await runInAccountScope(actor.accountId, () =>
      tenantTx(async (db) => {
        const rows = await db
          .select({
            email: users.email,
            emailNormalized: users.email_normalized,
            name: users.display_name,
            hash: loginIdentities.password_hash,
          })
          .from(users)
          .innerJoin(
            loginIdentities,
            and(eq(loginIdentities.user_id, users.id), eq(loginIdentities.provider, 'password')),
          )
          .where(eq(users.id, actor.userId))
          .limit(1);
        return rows[0];
      }),
    );
    if (user?.hash == null) throw invalidCredentials('currentPassword');
    const throttled = await this.throttle.check('login_email', user.emailNormalized);
    if (throttled.blocked) throw new LoginThrottledError(throttled.retryAfterSeconds);
    if (!(await this.hasher.verify(user.hash, normalizePassword(currentPassword)))) {
      await this.throttle.hit('login_email', user.emailNormalized);
      throw invalidCredentials('currentPassword');
    }
    const normalized = assertStrongPassword('newPassword', newPassword, user.emailNormalized);
    const passwordHash = await this.hasher.hash(normalized);
    const session = await runInAccountScope(actor.accountId, () =>
      tenantTx(async (db) => {
        await db
          .update(loginIdentities)
          .set({ password_hash: passwordHash })
          .where(
            and(
              eq(loginIdentities.user_id, actor.userId),
              eq(loginIdentities.provider, 'password'),
            ),
          );
        await db
          .update(users)
          .set({ password_changed_at: sql`now()` })
          .where(eq(users.id, actor.userId));
        await this.sessions.revokeAllForUser(db, actor.userId, 'password_changed', {
          exceptSessionId: actor.sessionId,
        });
        // Phiên hiện tại: thu hồi và cấp mã mới (chống cố định phiên).
        await this.sessions.revokeSession(
          db,
          actor.sessionId,
          'password_changed',
          currentTokenHash,
        );
        const issued = await this.sessions.insertSession(db, {
          accountId: actor.accountId,
          userId: actor.userId,
          userAgent: meta.userAgent,
        });
        await writeAuthAudit(db, {
          actorType: 'user',
          actorId: actor.userId,
          accountId: actor.accountId,
          action: 'auth.password.changed',
          ip: meta.ip,
          uaFamily: userAgentSummary(meta.userAgent),
        });
        return issued;
      }),
    );
    this.mail.sendAfterCommit('passwordChanged', user.email, {
      displayName: user.name,
      userId: actor.userId,
    });
    return session;
  }
}
