import { Inject, Injectable } from '@nestjs/common';
import type { LoginMethod, LoginMethodsResponse } from '@app/shared/auth';
import { and, eq, sql } from 'drizzle-orm';
import {
  OAUTH_CONFIG,
  tenantTx,
  uuidV7,
  type CustomerActor,
  type Db,
  type OAuthConfig,
} from '../../../../core';
import { userAgentSummary } from '../../../../core/auth/client-ip';
import { enqueueMailNotice } from '../../jobs';
import { loginIdentities, sessions, users } from '../db/schema';
import { writeAuthAudit, type AuthAuditAction } from './audit';
import { issueToken } from './email-verification.service';
import { invalidCredentials, LoginThrottledError, notFound, socialError } from './errors';
import { MailDispatcher } from './mail/dispatch';
import { PasswordHasher } from './password/password-hasher';
import { normalizePassword } from './password/password-policy';
import type { RequestMeta } from './session.service';
import { ThrottleService } from './throttle.service';

// Cách đăng nhập của tôi (009 – US5, research R11, R13). Chạy trong tenantTx của phiên – dùng được cho
// chủ, cộng tác viên và người ở tài khoản chờ. Thao tác nhạy cảm (liên kết, gỡ, tạo mật khẩu) đòi
// phiên "mới xác nhận": coalesce(reauthenticated_at, created_at) trong 10 phút – đọc DÒNG PHIÊN trong
// giao dịch, không qua bộ nhớ đệm. Luôn còn ít nhất một cách đăng nhập: khóa dòng + đếm rồi mới xóa.

export const METHOD_KINDS = ['password', 'google', 'facebook'] as const;
export type MethodKind = (typeof METHOD_KINDS)[number];

const SET_PASSWORD_TTL_MS = 30 * 60_000;

@Injectable()
export class LoginMethodsService {
  constructor(
    @Inject(OAUTH_CONFIG) private readonly config: OAuthConfig,
    @Inject(ThrottleService) private readonly throttle: ThrottleService,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(MailDispatcher) private readonly mail: MailDispatcher,
  ) {}

  private audit(
    db: Db,
    action: AuthAuditAction,
    actor: CustomerActor,
    meta: RequestMeta,
    provider?: 'google' | 'facebook',
  ): Promise<void> {
    return writeAuthAudit(db, {
      actorType: 'user',
      actorId: actor.userId,
      accountId: actor.accountId,
      action,
      ip: meta.ip,
      uaFamily: userAgentSummary(meta.userAgent),
      provider,
    });
  }

  /** Phiên vừa đăng nhập hoặc vừa xác nhận lại trong `REAUTH_WINDOW_MINUTES` phút. */
  async isReauthFresh(db: Db, sessionId: string): Promise<boolean> {
    const window = `${this.config.reauthWindowMinutes} minutes`;
    const rows = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.id, sessionId),
          sql`COALESCE(${sessions.reauthenticated_at}, ${sessions.created_at}) >= now() - ${window}::interval`,
        ),
      )
      .limit(1);
    return rows.length === 1;
  }

  /** 403 `REAUTH_REQUIRED` (hành động `reauth`) khi phiên chưa mới xác nhận. */
  async assertReauthFresh(actor: CustomerActor): Promise<void> {
    const fresh = await tenantTx((db) => this.isReauthFresh(db, actor.sessionId));
    if (!fresh) throw socialError('REAUTH_REQUIRED');
  }

  async hasMethod(actor: CustomerActor, kind: MethodKind): Promise<boolean> {
    return tenantTx(async (db) => {
      const rows = await db
        .select({ id: loginIdentities.id })
        .from(loginIdentities)
        .where(and(eq(loginIdentities.user_id, actor.userId), eq(loginIdentities.provider, kind)))
        .limit(1);
      return rows.length === 1;
    });
  }

  /** `GET /auth/login-methods` – luôn đủ ba dòng. */
  list(actor: CustomerActor): Promise<LoginMethodsResponse> {
    return tenantTx(async (db) => {
      const rows = await db
        .select()
        .from(loginIdentities)
        .where(eq(loginIdentities.user_id, actor.userId));
      const methods: LoginMethod[] = METHOD_KINDS.map((kind) => {
        const row = rows.find((r) => r.provider === kind);
        if (row === undefined) return { kind, linked: false };
        return {
          kind,
          linked: true,
          ...(row.provider_email !== null ? { providerEmail: row.provider_email } : {}),
          ...(row.provider_display_name !== null
            ? { providerDisplayName: row.provider_display_name }
            : {}),
          linkedAt: row.created_at.toISOString(),
        };
      });
      return { methods, reauthFresh: await this.isReauthFresh(db, actor.sessionId) };
    });
  }

  /** `POST /auth/reauth` – mật khẩu sai tính CHUNG bộ đếm `login_email` với đăng nhập (FR-011). */
  async reauthWithPassword(
    actor: CustomerActor,
    password: string,
    meta: RequestMeta,
  ): Promise<void> {
    const user = await tenantTx(async (db) => {
      const rows = await db
        .select({ emailNormalized: users.email_normalized, hash: loginIdentities.password_hash })
        .from(users)
        .leftJoin(
          loginIdentities,
          and(eq(loginIdentities.user_id, users.id), eq(loginIdentities.provider, 'password')),
        )
        .where(eq(users.id, actor.userId))
        .limit(1);
      return rows[0];
    });
    if (user === undefined) throw invalidCredentials();
    const throttled = await this.throttle.check('login_email', user.emailNormalized);
    if (throttled.blocked) throw new LoginThrottledError(throttled.retryAfterSeconds);
    const normalized = normalizePassword(password);
    const ok =
      user.hash == null
        ? (await this.hasher.verifyDummy(normalized), false)
        : await this.hasher.verify(user.hash, normalized);
    if (!ok) {
      await this.throttle.hit('login_email', user.emailNormalized);
      throw invalidCredentials();
    }
    await this.throttle.reset('login_email', user.emailNormalized);
    await tenantTx(async (db) => {
      await db
        .update(sessions)
        .set({ reauthenticated_at: sql`now()` })
        .where(eq(sessions.id, actor.sessionId));
      await this.audit(db, 'auth.reauth', actor, meta);
    });
  }

  /**
   * `DELETE /auth/login-methods/:kind`. Khóa mọi dòng cách đăng nhập của người dùng rồi mới đếm – hai
   * yêu cầu gỡ đồng thời không thể cùng thấy "còn 2" (research R13, SC-009). Phiên hiện có giữ nguyên.
   */
  async remove(actor: CustomerActor, kind: MethodKind, meta: RequestMeta): Promise<void> {
    await tenantTx(async (db) => {
      if (!(await this.isReauthFresh(db, actor.sessionId))) throw socialError('REAUTH_REQUIRED');
      const rows = await db
        .select({ id: loginIdentities.id, provider: loginIdentities.provider })
        .from(loginIdentities)
        .where(eq(loginIdentities.user_id, actor.userId))
        .for('update');
      const target = rows.find((r) => r.provider === kind);
      if (target === undefined) throw notFound();
      if (rows.length < 2) throw socialError('LAST_LOGIN_METHOD');
      await db.delete(loginIdentities).where(eq(loginIdentities.id, target.id));
      await enqueueMailNotice(db, {
        template: 'identity_removed',
        userId: actor.userId,
        provider: kind,
        dedupeKey: `account.notice:identity_removed:${uuidV7()}`,
      });
      await this.audit(
        db,
        'auth.identity.unlinked',
        actor,
        meta,
        kind === 'password' ? undefined : kind,
      );
    });
  }

  /**
   * `POST /auth/login-methods/password/request`: người chỉ dùng Google/Facebook xin thư tạo mật khẩu
   * (mã `reset_password` của 004 tới email của chính họ). Quá 3 thư/giờ vẫn trả như nhau.
   */
  async requestPassword(actor: CustomerActor): Promise<void> {
    await this.assertReauthFresh(actor);
    if (await this.hasMethod(actor, 'password')) {
      throw socialError('LOGIN_METHOD_EXISTS');
    }
    const user = await tenantTx(async (db) => {
      const rows = await db.select().from(users).where(eq(users.id, actor.userId)).limit(1);
      return rows[0];
    });
    if (user === undefined) throw notFound();
    if (!(await this.throttle.consume('mail_reset', user.email_normalized))) return;
    const token = await tenantTx((db) =>
      issueToken(db, {
        accountId: actor.accountId,
        userId: actor.userId,
        purpose: 'reset_password',
        emailNormalized: user.email_normalized,
        ttlMs: SET_PASSWORD_TTL_MS,
      }),
    );
    this.mail.sendAfterCommit('setPassword', user.email, {
      displayName: user.display_name,
      token,
      userId: actor.userId,
    });
  }
}
