import { Inject, Injectable, Logger } from '@nestjs/common';
import type { MeResponse, OAuthPendingResponse } from '@app/shared/auth';
import { and, eq, sql } from 'drizzle-orm';
import {
  accounts,
  AUTH_CONFIG,
  getExecutionContext,
  OAUTH_CONFIG,
  tenantTx,
  uuidV7,
  type AuthConfig,
  type CustomerActor,
  type Db,
  type OAuthConfig,
} from '../../../../../core';
import { runInAccountScope } from '../../../../../core/auth/account-scope';
import { userAgentSummary } from '../../../../../core/auth/client-ip';
import { authTx } from '../../../../../core/db/auth-tx';
import { DbQueryError } from '../../../../../core/db/errors';
import { enqueueMailNotice } from '../../../jobs';
import { loginIdentities, memberships, sessions, users } from '../../db/schema';
import { writeAuthAudit, type AuthAuditAction, type OAuthFailureReason } from '../audit';
import { markCallbackFailed, recordOAuth, withCallbackOutcome } from '../auth-metrics';
import { normalizeEmail } from '../email';
import {
  emailInvalid,
  invalidCredentials,
  isSocialErrorCode,
  LoginThrottledError,
  oauthTokenInvalid,
  rateLimited,
  socialError,
  socialErrorView,
  type SocialErrorCode,
} from '../errors';
import { InvitationsService, inviteEmailMatches } from '../invitations.service';
import { LoginMethodsService } from '../login-methods.service';
import { MailDispatcher } from '../mail/dispatch';
import { loadMe, loadMeInTx } from '../me';
import { PasswordHasher } from '../password/password-hasher';
import { normalizePassword } from '../password/password-policy';
import {
  lookupEmail,
  SessionService,
  type IssuedSession,
  type RequestMeta,
} from '../session.service';
import { ThrottleService } from '../throttle.service';
import {
  classifyCallbackError,
  IDENTITY_PROVIDERS,
  ProviderError,
  type IdentityProviders,
  type ProviderName,
  type ProviderProfile,
} from './identity-provider';
import {
  OAuthFlowService,
  SIGNUP_MAIL_TTL_MS,
  stageTtlMs,
  TERMINAL_STAGES,
  type FlowRow,
} from './oauth-flow.service';

// Vòng đăng nhập qua Google/Facebook (009 – US1, US2, US5, nhánh nhà cung cấp của lời mời).
// Nguyên tắc: (1) đường quay về KHÔNG BAO GIỜ trả lỗi – mọi kết quả ghi vào lượt rồi web đọc bằng
// `GET /auth/oauth/pending`; (2) email trùng người dùng đã có thì KHÔNG tự gộp (nguyên tắc VII, FR-010):
// phải xác nhận bằng mật khẩu hoặc liên kết gửi tới email đó; (3) nhánh email TỰ NHẬP trả lời giống
// hệt nhau dù email đã có người dùng hay chưa (research R4); (4) mã quyền của nhà cung cấp không rời
// `IdentityProvider.exchange`.

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type IdentityLookup = {
  user_id: string;
  account_id: string;
  user_status: string;
  member_status: string | null;
  account_status: string;
  email_verified_at: Date | null;
};

type RegisterOutcome = 'created' | 'email_taken' | 'identity_taken';

/** Ném để hoàn tác `authTx` đang mở, mang theo kết quả của hàm CSDL. */
class Rollback extends Error {
  constructor(readonly outcome: string) {
    super(`ROLLBACK:${outcome}`);
  }
}

export interface SignedIn {
  me: MeResponse;
  session: IssuedSession;
}

function usable(row: {
  user_status: string;
  member_status: string | null;
  account_status: string;
}) {
  return (
    row.user_status === 'active' &&
    row.member_status === 'active' &&
    row.account_status !== 'deleting'
  );
}

/** Che email ở bước xác nhận liên kết: `lan@example.vn` → `l***@example.vn`. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

@Injectable()
export class OAuthLoginService {
  private readonly logger = new Logger('OAuth');

  constructor(
    @Inject(AUTH_CONFIG) private readonly auth: AuthConfig,
    @Inject(OAUTH_CONFIG) private readonly config: OAuthConfig,
    @Inject(IDENTITY_PROVIDERS) private readonly providers: IdentityProviders,
    @Inject(OAuthFlowService) private readonly flows: OAuthFlowService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(ThrottleService) private readonly throttle: ThrottleService,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(MailDispatcher) private readonly mail: MailDispatcher,
    @Inject(InvitationsService) private readonly invitations: InvitationsService,
    @Inject(LoginMethodsService) private readonly methods: LoginMethodsService,
  ) {}

  // ----- Bắt đầu -----

  private async beginAt(
    provider: ProviderName,
    input: Omit<Parameters<OAuthFlowService['start']>[0], 'provider' | 'usesPkce'>,
    meta: RequestMeta,
  ): Promise<{ authorizationUrl: string; flowToken: string }> {
    const impl = this.providers.get(provider);
    // Chưa bật (staging/production chưa có khóa) → báo rõ, đăng nhập bằng email vẫn dùng được.
    if (impl === undefined) throw socialError('PROVIDER_UNAVAILABLE', { provider });
    if (!(await this.throttle.consume('oauth_start_ip', meta.ip))) throw rateLimited();
    const flow = await this.flows.start({ ...input, provider, usesPkce: impl.usesPkce });
    try {
      const url = await impl.authorizationUrl({
        state: flow.state,
        codeVerifier: flow.codeVerifier,
      });
      return { authorizationUrl: url.toString(), flowToken: flow.flowToken };
    } catch (err) {
      await this.flows.fail(flow.id, 'PROVIDER_UNAVAILABLE');
      throw socialError('PROVIDER_UNAVAILABLE', {
        provider,
        detail: err instanceof ProviderError ? err.detail : undefined,
      });
    }
  }

  /** `POST /auth/oauth/:provider/start` với `purpose: 'login'`. */
  startLogin(provider: ProviderName, meta: RequestMeta) {
    return this.beginAt(provider, { purpose: 'login' }, meta);
  }

  /**
   * `purpose: 'invite'`: kiểm lời mời và điều khoản TRƯỚC khi sang nhà cung cấp. Yêu cầu có phiên hợp
   * lệ: đang thuộc một tài khoản → ALREADY_IN_ACCOUNT; ở tài khoản chờ với email khác → MISMATCH.
   */
  async startInvite(
    provider: ProviderName,
    invitationToken: string,
    actor: CustomerActor | null,
    meta: RequestMeta,
  ) {
    const invitation = await this.invitations.findByToken(invitationToken);
    await this.invitations.assertSessionMayAccept(actor, invitation?.email_normalized);
    if (invitation === undefined) throw socialError('INVITE_INVALID');
    return this.beginAt(
      provider,
      {
        purpose: 'invite',
        invitationId: invitation.invitation_id,
        termsVersion: this.auth.termsVersion,
      },
      meta,
    );
  }

  /** `POST /auth/login-methods/:provider/start` – liên kết thêm hoặc xác nhận lại danh tính. */
  async startForActor(
    actor: CustomerActor,
    provider: ProviderName,
    purpose: 'link' | 'reauth',
    meta: RequestMeta,
  ) {
    if (purpose === 'link') {
      await this.methods.assertReauthFresh(actor);
      if (await this.methods.hasMethod(actor, provider)) {
        throw socialError('LOGIN_METHOD_EXISTS', { provider });
      }
    }
    return this.beginAt(
      provider,
      { purpose, actorUserId: actor.userId, actorTenantId: actor.accountId },
      meta,
    );
  }

  // ----- Đường quay về -----

  private audit(
    db: Db,
    action: AuthAuditAction,
    meta: RequestMeta,
    who: { userId?: string | undefined; accountId?: string | null | undefined },
    extra: { reason?: string; provider?: ProviderName } = {},
  ): Promise<void> {
    return writeAuthAudit(db, {
      actorType: who.userId === undefined ? 'anonymous' : 'user',
      actorId: who.userId ?? 'anonymous',
      accountId: who.accountId ?? null,
      action,
      ip: meta.ip,
      uaFamily: userAgentSummary(meta.userAgent),
      reason: extra.reason,
      provider: extra.provider,
    });
  }

  /** Đóng lượt ở trạng thái lỗi + kiểm toán `auth.oauth.failed` (chưa biết tenant → authTx). */
  private async failFlow(
    flowId: string | undefined,
    code: SocialErrorCode,
    reason: OAuthFailureReason,
    provider: ProviderName,
    meta: RequestMeta,
    detail?: string,
  ): Promise<void> {
    markCallbackFailed(reason);
    if (flowId !== undefined) await this.flows.fail(flowId, code);
    await authTx((db) => this.audit(db, 'auth.oauth.failed', meta, {}, { reason, provider }));
    this.logger.warn({
      msg: 'auth.oauth.failed',
      event: 'auth.oauth.failed',
      provider,
      reason,
      result: code,
      // Mã gốc của nhà cung cấp – không phải bí mật, giúp hỗ trợ tra cứu.
      detail: detail ?? null,
      trace_id: getExecutionContext()?.traceId ?? null,
    });
  }

  private lookupIdentity(provider: ProviderName, subject: string) {
    return authTx(async (db) => {
      const result = await db.execute<IdentityLookup>(
        sql`SELECT * FROM account.auth_lookup_identity(${provider}, ${subject})`,
      );
      return result.rows[0];
    });
  }

  /**
   * `GET /auth/oauth/:provider/callback`. Không ném: mọi lỗi ghi vào lượt. Trả phiên mới khi danh tính
   * đã liên kết (đăng nhập) hoặc khi chấp nhận lời mời xong.
   */
  async handleCallback(input: {
    provider: ProviderName;
    code: string | undefined;
    state: string | undefined;
    error: string | undefined;
    flowToken: string | undefined;
    actor: CustomerActor | null;
    meta: RequestMeta;
  }): Promise<{ session: IssuedSession | null }> {
    // Đo SC-002 (nhận callback → trả kết quả) và đếm kết quả theo nhà cung cấp (cảnh báo T086).
    const started = process.hrtime.bigint();
    const { value, outcome } = await withCallbackOutcome(() => this.runCallback(input));
    recordOAuth(input.provider, outcome, Number(process.hrtime.bigint() - started) / 1e9);
    return value;
  }

  private async runCallback(input: {
    provider: ProviderName;
    code: string | undefined;
    state: string | undefined;
    error: string | undefined;
    flowToken: string | undefined;
    actor: CustomerActor | null;
    meta: RequestMeta;
  }): Promise<{ session: IssuedSession | null }> {
    const { provider, meta } = input;
    let flowId: string | undefined;
    try {
      const consumed =
        input.flowToken === undefined || input.state === undefined
          ? null
          : await this.flows.consumeCallback(input.flowToken, input.state);
      if (consumed?.flow.provider !== provider) {
        // Không cookie, sai state, lặp lại, quá hạn, sai nhà cung cấp → lượt (nếu có) hỏng luôn.
        const existing =
          input.flowToken === undefined
            ? undefined
            : await this.flows.findByCookie(input.flowToken);
        const expired = existing?.stage === 'started' && existing.expires_at <= new Date();
        await this.failFlow(
          existing?.id,
          'OAUTH_FLOW_INVALID',
          expired ? 'expired' : 'state_mismatch',
          provider,
          meta,
        );
        return { session: null };
      }
      const flow = consumed.flow;
      flowId = flow.id;

      if (input.error !== undefined || input.code === undefined) {
        const kind = input.error === undefined ? 'malformed' : classifyCallbackError(input.error);
        await this.failByKind(flow.id, kind, provider, meta, input.error);
        return { session: null };
      }
      const impl = this.providers.get(provider);
      if (impl === undefined) {
        await this.failByKind(flow.id, 'unavailable', provider, meta, 'driver_off');
        return { session: null };
      }
      let profile: ProviderProfile;
      try {
        profile = await impl.exchange({ code: input.code, codeVerifier: consumed.codeVerifier });
      } catch (err) {
        const kind = err instanceof ProviderError ? err.kind : 'malformed';
        await this.failByKind(
          flow.id,
          kind,
          provider,
          meta,
          err instanceof ProviderError ? err.detail : 'unexpected',
        );
        return { session: null };
      }

      switch (flow.purpose) {
        case 'login':
          return { session: await this.callbackLogin(flow, profile, meta) };
        case 'invite':
          return { session: await this.callbackInvite(flow, profile, meta) };
        case 'link':
          await this.callbackLink(flow, profile, input.actor, meta);
          return { session: null };
        case 'reauth':
          await this.callbackReauth(flow, profile, input.actor, meta);
          return { session: null };
      }
    } catch (err) {
      // Lỗi không lường trước (vd CSDL) – vẫn không để lộ ra đường quay về.
      this.logger.error({
        msg: 'auth.oauth.callback_error',
        event: 'auth.oauth.callback_error',
        provider,
        code: err instanceof DbQueryError ? err.code : err instanceof Error ? err.name : 'UNKNOWN',
        trace_id: getExecutionContext()?.traceId ?? null,
      });
      await this.failFlow(flowId, 'OAUTH_FAILED', 'provider_error', provider, meta).catch(
        () => undefined,
      );
      return { session: null };
    }
  }

  private failByKind(
    flowId: string,
    kind: ProviderError['kind'],
    provider: ProviderName,
    meta: RequestMeta,
    detail?: string,
  ): Promise<void> {
    if (kind === 'cancelled') {
      return this.failFlow(flowId, 'OAUTH_CANCELLED', 'cancelled', provider, meta, detail);
    }
    return this.failFlow(
      flowId,
      kind === 'unavailable' ? 'PROVIDER_UNAVAILABLE' : 'OAUTH_FAILED',
      'provider_error',
      provider,
      meta,
      detail,
    );
  }

  private profilePatch(profile: ProviderProfile) {
    return {
      provider_subject: profile.subject,
      provider_email: profile.email,
      provider_email_verified: profile.emailVerified,
      provider_display_name: profile.displayName,
    };
  }

  private async callbackLogin(
    flow: FlowRow,
    profile: ProviderProfile,
    meta: RequestMeta,
  ): Promise<IssuedSession | null> {
    const provider = profile.provider;
    const linked = await this.lookupIdentity(provider, profile.subject);
    if (linked !== undefined) {
      // Danh tính đã liên kết: vào thẳng. Email phía nhà cung cấp có đổi cũng không ảnh hưởng (FR-006).
      if (!usable(linked)) {
        await this.failFlow(flow.id, 'ACCOUNT_UNAVAILABLE', 'account_unavailable', provider, meta);
        return null;
      }
      if (
        !(await this.flows.transition(flow.id, 'started', 'signed_in', this.profilePatch(profile)))
      ) {
        return null;
      }
      return runInAccountScope(linked.account_id, () =>
        tenantTx(async (db) => {
          await db
            .update(loginIdentities)
            .set({ last_used_at: sql`now()` })
            .where(
              and(
                eq(loginIdentities.user_id, linked.user_id),
                eq(loginIdentities.provider, provider),
              ),
            );
          const session = await this.sessions.insertSession(db, {
            accountId: linked.account_id,
            userId: linked.user_id,
            userAgent: meta.userAgent,
          });
          await this.audit(
            db,
            'auth.oauth.succeeded',
            meta,
            { userId: linked.user_id, accountId: linked.account_id },
            { provider },
          );
          return session;
        }),
      );
    }

    const email =
      profile.email !== null && profile.emailVerified ? normalizeEmail(profile.email) : null;
    if (email === null) {
      // Không có email / email chưa được nhà cung cấp xác minh → người dùng tự nhập và xác minh qua thư.
      await this.flows.transition(
        flow.id,
        'started',
        'needs_email',
        this.profilePatch(profile),
        stageTtlMs('needs_email', this.config) ?? undefined,
      );
      return null;
    }
    // Chỉ tra người dùng KHÁCH HÀNG: email trùng nhân viên nội bộ đi nhánh người mới (US2 kịch bản 8).
    const existing = await lookupEmail(email.emailNormalized);
    if (existing === undefined) {
      await this.flows.transition(
        flow.id,
        'started',
        'needs_signup',
        this.profilePatch(profile),
        stageTtlMs('needs_signup', this.config) ?? undefined,
      );
      return null;
    }
    if (!usable(existing)) {
      await this.failFlow(flow.id, 'ACCOUNT_UNAVAILABLE', 'account_unavailable', provider, meta);
      return null;
    }
    const kinds = await this.methodKinds(existing.account_id, existing.user_id);
    if (kinds.includes(provider)) {
      // Mỗi người dùng tối đa một danh tính mỗi loại (FR-014): không đưa vào xác nhận liên kết.
      await this.flows.fail(flow.id, 'PROVIDER_ACCOUNT_CONFLICT');
      await runInAccountScope(existing.account_id, () =>
        tenantTx((db) =>
          this.audit(
            db,
            'auth.identity.link_denied',
            meta,
            { userId: existing.user_id, accountId: existing.account_id },
            { reason: 'provider_conflict', provider },
          ),
        ),
      );
      return null;
    }
    const moved = await this.flows.transition(
      flow.id,
      'started',
      'needs_link_confirm',
      {
        ...this.profilePatch(profile),
        target_user_id: existing.user_id,
        target_tenant_id: existing.account_id,
        // FR-011: xác nhận bằng mật khẩu chỉ khi có mật khẩu VÀ email của người dùng đã xác minh.
        password_allowed: existing.password_hash !== null && existing.email_verified_at !== null,
      },
      stageTtlMs('needs_link_confirm', this.config) ?? undefined,
    );
    if (moved) {
      await runInAccountScope(existing.account_id, () =>
        tenantTx((db) =>
          this.audit(
            db,
            'auth.identity.link_requested',
            meta,
            { userId: existing.user_id, accountId: existing.account_id },
            { provider },
          ),
        ),
      );
    }
    return null;
  }

  private async callbackInvite(
    flow: FlowRow,
    profile: ProviderProfile,
    meta: RequestMeta,
  ): Promise<IssuedSession | null> {
    const provider = profile.provider;
    const fail = (code: SocialErrorCode) => this.flows.fail(flow.id, code).then(() => null);
    const invitation =
      flow.invitation_id === null
        ? undefined
        : await this.invitations.loadForFlow(flow.invitation_id);
    if (invitation === undefined) return fail('INVITE_INVALID');
    // Lưu email được mời vào lượt để thông điệp lỗi nêu đúng email (người gọi đang cầm mã lời mời).
    const patch = { ...this.profilePatch(profile), claimed_email: invitation.email };
    if (!inviteEmailMatches(profile.email, invitation.emailNormalized)) {
      await this.flows.transition(flow.id, 'started', 'failed', {
        ...patch,
        result_code: 'INVITE_EMAIL_MISMATCH',
      });
      return null;
    }
    const accepted = await this.invitations.acceptNew({
      accountId: invitation.accountId,
      invitationId: invitation.invitationId,
      tokenHash: invitation.tokenHash,
      displayName: profile.displayName ?? invitation.email.split('@')[0] ?? 'Cộng tác viên',
      passwordHash: null,
      identity: {
        provider,
        subject: profile.subject,
        email: profile.email,
        displayName: profile.displayName,
      },
      meta,
    });
    if (accepted.outcome !== 'accepted') {
      return fail(InvitationsService.resultCode(accepted.outcome));
    }
    if (!(await this.flows.transition(flow.id, 'started', 'completed', patch))) return null;
    return this.sessions.createCustomerSession({
      accountId: invitation.accountId,
      userId: accepted.userId,
      userAgent: meta.userAgent,
    });
  }

  private async callbackLink(
    flow: FlowRow,
    profile: ProviderProfile,
    actor: CustomerActor | null,
    meta: RequestMeta,
  ): Promise<void> {
    const provider = profile.provider;
    const fail = (code: SocialErrorCode) => this.flows.fail(flow.id, code);
    const userId = flow.actor_user_id;
    const accountId = flow.target_tenant_id;
    // Phải là đúng người đã bắt đầu, vẫn đang đăng nhập trên trình duyệt này.
    if (userId === null || accountId === null || actor?.userId !== userId) {
      await fail('OAUTH_FLOW_INVALID');
      return;
    }
    const linked = await this.lookupIdentity(provider, profile.subject);
    if (linked !== undefined) {
      // Không chuyển, không gộp (FR-015).
      await fail(linked.user_id === userId ? 'LOGIN_METHOD_EXISTS' : 'IDENTITY_IN_USE');
      return;
    }
    try {
      await runInAccountScope(accountId, () =>
        tenantTx(async (db) => {
          // Không so email (FR-014): email đăng nhập chính của người dùng không đổi.
          await this.insertIdentity(db, { accountId, userId, flowId: flow.id, profile });
          await this.audit(db, 'auth.identity.linked', meta, { userId, accountId }, { provider });
        }),
      );
    } catch (err) {
      const code = this.identityConflict(err);
      if (code === undefined) throw err;
      await fail(code === 'PROVIDER_ACCOUNT_CONFLICT' ? 'LOGIN_METHOD_EXISTS' : code);
      return;
    }
    await this.flows.transition(flow.id, 'started', 'completed', this.profilePatch(profile));
  }

  private async callbackReauth(
    flow: FlowRow,
    profile: ProviderProfile,
    actor: CustomerActor | null,
    meta: RequestMeta,
  ): Promise<void> {
    const provider = profile.provider;
    if (flow.actor_user_id === null || actor?.userId !== flow.actor_user_id) {
      await this.flows.fail(flow.id, 'OAUTH_FLOW_INVALID');
      return;
    }
    const linked = await this.lookupIdentity(provider, profile.subject);
    if (linked?.user_id !== actor.userId) {
      await this.flows.fail(flow.id, 'REAUTH_MISMATCH');
      return;
    }
    await runInAccountScope(actor.accountId, () =>
      tenantTx(async (db) => {
        await db
          .update(sessions)
          .set({ reauthenticated_at: sql`now()` })
          .where(eq(sessions.id, actor.sessionId));
        await this.audit(
          db,
          'auth.reauth',
          meta,
          { userId: actor.userId, accountId: actor.accountId },
          { provider },
        );
      }),
    );
    await this.flows.transition(flow.id, 'started', 'completed', this.profilePatch(profile));
  }

  // ----- Đọc trạng thái lượt -----

  private async liveFlow(flowToken: string | undefined): Promise<FlowRow> {
    const flow = flowToken === undefined ? undefined : await this.flows.findByCookie(flowToken);
    if (flow === undefined || flow.stage === 'started') throw socialError('OAUTH_FLOW_INVALID');
    if (!TERMINAL_STAGES.includes(flow.stage) && flow.expires_at <= new Date()) {
      throw socialError('OAUTH_FLOW_INVALID');
    }
    return flow;
  }

  /** `GET /auth/oauth/pending`. `finished` = lượt đã kết thúc → controller xóa cookie. */
  async pending(
    flowToken: string | undefined,
  ): Promise<{ body: OAuthPendingResponse; finished: boolean }> {
    const flow = await this.liveFlow(flowToken);
    const stage = flow.stage as OAuthPendingResponse['stage'];
    const provider = flow.provider;
    let hint: OAuthPendingResponse['hint'] = null;
    if (
      stage === 'needs_link_confirm' &&
      flow.target_user_id !== null &&
      flow.target_tenant_id !== null
    ) {
      const kinds = await this.methodKinds(flow.target_tenant_id, flow.target_user_id);
      hint = kinds.includes('google')
        ? 'login_with_google'
        : kinds.includes('facebook')
          ? 'login_with_facebook'
          : null;
    }
    const code = flow.result_code;
    const body: OAuthPendingResponse = {
      provider,
      purpose: flow.purpose,
      stage,
      suggestedDisplayName:
        stage === 'needs_signup' || stage === 'needs_email' ? flow.provider_display_name : null,
      suggestedEmail:
        stage === 'needs_signup' || stage === 'needs_email'
          ? flow.provider_email
          : stage === 'needs_link_confirm' && flow.provider_email !== null
            ? maskEmail(flow.provider_email)
            : null,
      emailRequired: stage === 'needs_email',
      methods:
        stage === 'needs_link_confirm'
          ? flow.password_allowed
            ? ['password', 'email']
            : ['email']
          : [],
      hint,
      error:
        stage === 'failed'
          ? socialErrorView(code !== null && isSocialErrorCode(code) ? code : 'OAUTH_FAILED', {
              provider,
              email: flow.claimed_email ?? undefined,
            })
          : null,
    };
    return { body, finished: TERMINAL_STAGES.includes(flow.stage) };
  }

  // ----- Hoàn tất đăng ký (US1) -----

  private async register(
    db: Db,
    flow: FlowRow,
    input: { displayName: string; email: string; emailNormalized: string },
    meta: RequestMeta,
  ): Promise<{ accountId: string; userId: string }> {
    const ids = { account: uuidV7(), user: uuidV7(), identity: uuidV7(), membership: uuidV7() };
    const result = await db.execute<{ outcome: RegisterOutcome }>(sql`
      SELECT account.auth_register_oauth(
        ${ids.account}::uuid, ${ids.user}::uuid, ${ids.identity}::uuid, ${ids.membership}::uuid,
        ${input.displayName}, ${input.email}, ${input.emailNormalized}, true,
        ${flow.provider}, ${flow.provider_subject}, ${flow.provider_email},
        ${flow.provider_display_name}, ${this.auth.termsVersion}
      ) AS outcome`);
    const outcome = result.rows[0]?.outcome;
    if (outcome !== 'created') throw new Rollback(outcome ?? 'unknown');
    await this.audit(
      db,
      'auth.register.oauth',
      meta,
      { userId: ids.user, accountId: ids.account },
      { provider: flow.provider },
    );
    return { accountId: ids.account, userId: ids.user };
  }

  private async signIn(accountId: string, userId: string, meta: RequestMeta): Promise<SignedIn> {
    const session = await this.sessions.createCustomerSession({
      accountId,
      userId,
      userAgent: meta.userAgent,
    });
    const me = await loadMe(accountId, userId);
    if (me === null) throw socialError('OAUTH_FLOW_INVALID');
    return { me, session };
  }

  /**
   * `POST /auth/oauth/signup`. `needs_signup` → tạo tài khoản và đăng nhập ngay (email do nhà cung cấp
   * xác minh). `needs_email` → LUÔN `{ status: 'check_email' }` (research R4).
   */
  async signup(
    flowToken: string | undefined,
    body: { displayName: string; email?: string | undefined },
    meta: RequestMeta,
  ): Promise<{ kind: 'signed_in'; result: SignedIn } | { kind: 'check_email' }> {
    const flow = await this.liveFlow(flowToken);
    if (flow.purpose !== 'login') throw socialError('OAUTH_FLOW_INVALID');
    const displayName = body.displayName.trim();

    if (flow.stage === 'needs_signup') {
      const email = flow.provider_email === null ? null : normalizeEmail(flow.provider_email);
      if (email === null || flow.provider_subject === null) throw socialError('OAUTH_FLOW_INVALID');
      let created: { accountId: string; userId: string };
      try {
        created = await authTx(async (db) => {
          // Giành lượt trước (cập nhật có điều kiện) → hai yêu cầu đồng thời chỉ một cái tạo tài khoản.
          const claimed = await this.flows.transition(flow.id, 'needs_signup', 'completed', {
            display_name: displayName,
            terms_version: this.auth.termsVersion,
            terms_accepted_at: new Date(),
          });
          if (!claimed) throw new Rollback('flow_gone');
          return this.register(db, flow, { displayName, ...email }, meta);
        });
      } catch (err) {
        if (!(err instanceof Rollback)) throw err;
        if (err.outcome === 'identity_taken') {
          await this.flows.fail(flow.id, 'IDENTITY_IN_USE');
          throw socialError('IDENTITY_IN_USE', { provider: flow.provider });
        }
        // `email_taken`: email vừa bị người khác đăng ký trong lúc chờ → bắt đầu lại sẽ đi nhánh xác
        // nhận liên kết. `flow_gone`: lượt đã được dùng/quá hạn.
        await this.flows.fail(flow.id, 'OAUTH_FLOW_INVALID');
        throw socialError('OAUTH_FLOW_INVALID', { detail: err.outcome });
      }
      return {
        kind: 'signed_in',
        result: await this.signIn(created.accountId, created.userId, meta),
      };
    }

    if (flow.stage !== 'needs_email') throw socialError('OAUTH_FLOW_INVALID');
    const email = body.email === undefined ? null : normalizeEmail(body.email);
    if (email === null) throw emailInvalid();
    await this.awaitEmail(flow, displayName, email, meta);
    return { kind: 'check_email' };
  }

  /**
   * Nhánh email tự nhập: mọi trường hợp đều chuyển lượt sang `awaiting_email` và trả lời như nhau –
   * khác nhau chỉ ở thư gửi đi (R4). Trường hợp không được phát mã (người dùng đã có danh tính cùng nhà
   * cung cấp; người dùng bị khóa) ghi `result_code` nội bộ để "Gửi lại" cũng không phát mã.
   */
  private async awaitEmail(
    flow: FlowRow,
    displayName: string,
    email: { email: string; emailNormalized: string },
    meta: RequestMeta,
  ): Promise<void> {
    const provider = flow.provider;
    const existing = await lookupEmail(email.emailNormalized);
    const base = {
      claimed_email: email.email,
      claimed_email_normalized: email.emailNormalized,
      display_name: displayName,
      terms_version: this.auth.termsVersion,
      terms_accepted_at: new Date(),
    };
    const withinLimit = await this.throttle.consume('mail_link_confirm', email.emailNormalized);

    if (existing === undefined) {
      const moved = await this.flows.transition(
        flow.id,
        'needs_email',
        'awaiting_email',
        base,
        SIGNUP_MAIL_TTL_MS,
      );
      if (!moved) throw socialError('OAUTH_FLOW_INVALID');
      if (!withinLimit) return;
      const token = await this.flows.issueMailToken(flow.id, SIGNUP_MAIL_TTL_MS);
      if (token !== null) {
        this.mail.sendAfterCommit('completeSignup', email.email, {
          displayName,
          token,
          method: provider,
        });
      }
      return;
    }

    const ttl = stageTtlMs('awaiting_email', this.config) ?? undefined;
    const target = { target_user_id: existing.user_id, target_tenant_id: existing.account_id };
    if (!usable(existing)) {
      // Người dùng bị khóa / tài khoản đang xóa: không gửi thư nào (FR-008).
      const moved = await this.flows.transition(
        flow.id,
        'needs_email',
        'awaiting_email',
        { ...base, ...target, result_code: 'ACCOUNT_UNAVAILABLE' },
        ttl,
      );
      if (!moved) throw socialError('OAUTH_FLOW_INVALID');
      return;
    }
    const kinds = await this.methodKinds(existing.account_id, existing.user_id);
    if (kinds.includes(provider)) {
      const moved = await this.flows.transition(
        flow.id,
        'needs_email',
        'awaiting_email',
        { ...base, ...target, result_code: 'PROVIDER_ACCOUNT_CONFLICT' },
        ttl,
      );
      if (!moved) throw socialError('OAUTH_FLOW_INVALID');
      await runInAccountScope(existing.account_id, () =>
        tenantTx(async (db) => {
          await this.audit(
            db,
            'auth.identity.link_denied',
            meta,
            { userId: existing.user_id, accountId: existing.account_id },
            { reason: 'provider_conflict', provider },
          );
          // Thư thông tin (không mã) cho người dùng đã có – tính vào ngưỡng `mail_link_confirm`.
          if (withinLimit) {
            await enqueueMailNotice(db, {
              template: 'identity_link_blocked',
              userId: existing.user_id,
              provider,
              dedupeKey: `account.notice:link_blocked:${flow.id}`,
            });
          }
        }),
      );
      return;
    }
    const moved = await this.flows.transition(
      flow.id,
      'needs_email',
      'awaiting_email',
      { ...base, ...target, password_allowed: false },
      ttl,
    );
    if (!moved) throw socialError('OAUTH_FLOW_INVALID');
    await runInAccountScope(existing.account_id, () =>
      tenantTx((db) =>
        this.audit(
          db,
          'auth.identity.link_requested',
          meta,
          { userId: existing.user_id, accountId: existing.account_id },
          { provider },
        ),
      ),
    );
    if (!withinLimit) return;
    const token = await this.flows.issueMailToken(flow.id, ttl ?? SIGNUP_MAIL_TTL_MS);
    if (token !== null) {
      this.mail.sendAfterCommit('confirmIdentityLink', email.email, {
        displayName: existing.display_name,
        token,
        method: provider,
        userId: existing.user_id,
      });
    }
  }

  // ----- Xác nhận liên kết (US2) -----

  private async methodKinds(accountId: string, userId: string): Promise<string[]> {
    return runInAccountScope(accountId, () =>
      tenantTx(async (db) => {
        const rows = await db
          .select({ provider: loginIdentities.provider })
          .from(loginIdentities)
          .where(eq(loginIdentities.user_id, userId));
        return rows.map((r) => r.provider);
      }),
    );
  }

  private identityConflict(
    err: unknown,
  ): 'IDENTITY_IN_USE' | 'PROVIDER_ACCOUNT_CONFLICT' | undefined {
    if (!(err instanceof DbQueryError) || err.code !== '23505') return undefined;
    if (err.constraint === 'login_identities_provider_subject_key') return 'IDENTITY_IN_USE';
    if (err.constraint === 'login_identities_account_user_provider_key') {
      return 'PROVIDER_ACCOUNT_CONFLICT';
    }
    return undefined;
  }

  /** Thêm dòng danh tính + việc thư "vừa thêm cách đăng nhập" trong giao dịch tenant `db`. */
  private async insertIdentity(
    db: Db,
    input: {
      accountId: string;
      userId: string;
      flowId: string;
      profile: Pick<ProviderProfile, 'provider' | 'subject' | 'email' | 'displayName'>;
    },
  ): Promise<void> {
    await db.insert(loginIdentities).values({
      account_id: input.accountId,
      user_id: input.userId,
      provider: input.profile.provider,
      provider_subject: input.profile.subject,
      provider_email: input.profile.email,
      provider_display_name: input.profile.displayName,
    });
    await enqueueMailNotice(db, {
      template: 'identity_added',
      userId: input.userId,
      provider: input.profile.provider,
      dedupeKey: `account.notice:identity_added:${input.flowId}`,
    });
  }

  /**
   * Liên kết danh tính của lượt vào người dùng đích rồi đăng nhập. `viaEmail`: xác nhận qua liên kết
   * trong thư – nếu email của người dùng CHƯA xác minh thì người mở thư mới là chủ thật: xóa mật khẩu
   * cũ, thu hồi mọi phiên, đánh dấu email đã xác minh (data-model mục 6, FR-011).
   */
  private async linkTarget(
    flow: FlowRow,
    from: 'needs_link_confirm' | 'awaiting_email',
    viaEmail: boolean,
    meta: RequestMeta,
    invalid: () => Error,
  ): Promise<SignedIn> {
    const userId = flow.target_user_id;
    const accountId = flow.target_tenant_id;
    const subject = flow.provider_subject;
    if (userId === null || accountId === null || subject === null) throw invalid();
    const provider = flow.provider;
    try {
      return await runInAccountScope(accountId, async () => {
        const state = await tenantTx(async (db) => {
          const rows = await db
            .select({
              userStatus: users.status,
              verifiedAt: users.email_verified_at,
              memberStatus: memberships.status,
              accountStatus: accounts.status,
            })
            .from(users)
            .innerJoin(accounts, eq(accounts.id, users.account_id))
            .leftJoin(memberships, eq(memberships.user_id, users.id))
            .where(eq(users.id, userId))
            .limit(1);
          return rows[0];
        });
        if (
          state === undefined ||
          !usable({
            user_status: state.userStatus,
            member_status: state.memberStatus,
            account_status: state.accountStatus,
          })
        ) {
          throw invalid();
        }
        // Giành lượt bằng cập nhật có điều kiện: mã/lượt dùng hai lần không bao giờ cùng thành công.
        if (!(await this.flows.transition(flow.id, from, 'completed'))) throw invalid();
        return tenantTx(async (db) => {
          await this.insertIdentity(db, {
            accountId,
            userId,
            flowId: flow.id,
            profile: {
              provider,
              subject,
              email: flow.provider_email,
              displayName: flow.provider_display_name,
            },
          });
          if (viaEmail && state.verifiedAt === null) {
            await db
              .delete(loginIdentities)
              .where(
                and(eq(loginIdentities.user_id, userId), eq(loginIdentities.provider, 'password')),
              );
            await this.sessions.revokeAllForUser(db, userId, 'identity_link_reset');
            await db
              .update(users)
              .set({ email_verified_at: sql`now()` })
              .where(eq(users.id, userId));
          }
          const who = { userId, accountId };
          await this.audit(db, 'auth.identity.link_confirmed', meta, who, {
            provider,
            reason: viaEmail ? 'email' : 'password',
          });
          await this.audit(db, 'auth.identity.linked', meta, who, { provider });
          const session = await this.sessions.insertSession(db, {
            accountId,
            userId,
            userAgent: meta.userAgent,
          });
          const me = await loadMeInTx(db, userId);
          if (me === null) throw invalid();
          return { me, session };
        });
      });
    } catch (err) {
      const code = this.identityConflict(err);
      if (code === undefined) throw err;
      // Tranh chấp: danh tính vừa gắn nơi khác / người dùng vừa thêm danh tính cùng loại → 409, không 500.
      throw socialError(code, { provider });
    }
  }

  /** `POST /auth/oauth/link/password` – cùng bộ đếm `login_email` với đăng nhập (FR-011). */
  async linkWithPassword(
    flowToken: string | undefined,
    password: string,
    meta: RequestMeta,
  ): Promise<SignedIn> {
    const flow = await this.liveFlow(flowToken);
    const userId = flow.target_user_id;
    const accountId = flow.target_tenant_id;
    if (
      flow.stage !== 'needs_link_confirm' ||
      !flow.password_allowed ||
      userId === null ||
      accountId === null
    ) {
      throw socialError('OAUTH_FLOW_INVALID');
    }
    const target = await runInAccountScope(accountId, () =>
      tenantTx(async (db) => {
        const rows = await db
          .select({ emailNormalized: users.email_normalized, hash: loginIdentities.password_hash })
          .from(users)
          .innerJoin(
            loginIdentities,
            and(eq(loginIdentities.user_id, users.id), eq(loginIdentities.provider, 'password')),
          )
          .where(eq(users.id, userId))
          .limit(1);
        return rows[0];
      }),
    );
    if (target?.hash == null) throw socialError('OAUTH_FLOW_INVALID');
    const [byEmail, byIp] = await Promise.all([
      this.throttle.check('login_email', target.emailNormalized),
      this.throttle.check('login_ip', meta.ip),
    ]);
    if (byEmail.blocked || byIp.blocked) {
      throw new LoginThrottledError(Math.max(byEmail.retryAfterSeconds, byIp.retryAfterSeconds));
    }
    if (!(await this.hasher.verify(target.hash, normalizePassword(password)))) {
      await Promise.all([
        this.throttle.hit('login_email', target.emailNormalized),
        this.throttle.hit('login_ip', meta.ip),
      ]);
      await runInAccountScope(accountId, () =>
        tenantTx((db) =>
          this.audit(
            db,
            'auth.identity.link_denied',
            meta,
            { userId, accountId },
            { reason: 'bad_password', provider: flow.provider },
          ),
        ),
      );
      throw invalidCredentials();
    }
    await this.throttle.reset('login_email', target.emailNormalized);
    return this.linkTarget(flow, 'needs_link_confirm', false, meta, () =>
      socialError('OAUTH_FLOW_INVALID'),
    );
  }

  /**
   * `POST /auth/oauth/link/send-email` – gửi (hoặc gửi lại) liên kết xác nhận. Luôn 202: quá 3 thư/giờ
   * hay lượt không được phát mã cũng trả như nhau. Mã mới làm mã cũ hết hiệu lực.
   */
  async sendLinkEmail(flowToken: string | undefined): Promise<void> {
    const flow = await this.liveFlow(flowToken);
    if (flow.stage === 'needs_link_confirm') {
      const moved = await this.flows.transition(
        flow.id,
        'needs_link_confirm',
        'awaiting_email',
        {},
        stageTtlMs('awaiting_email', this.config) ?? undefined,
      );
      if (!moved) throw socialError('OAUTH_FLOW_INVALID');
    } else if (flow.stage !== 'awaiting_email') {
      throw socialError('OAUTH_FLOW_INVALID');
    }
    if (flow.result_code !== null) return;

    const { target_user_id: targetUserId, target_tenant_id: targetTenantId } = flow;
    const isLink = targetUserId !== null && targetTenantId !== null;
    let recipient: { email: string; emailNormalized: string; name: string; userId: string | null };
    if (targetUserId !== null && targetTenantId !== null) {
      const userId = targetUserId;
      const found = await runInAccountScope(targetTenantId, () =>
        tenantTx(async (db) => {
          const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
          return rows[0];
        }),
      );
      if (found?.status !== 'active') return;
      recipient = {
        email: found.email,
        emailNormalized: found.email_normalized,
        name: found.display_name,
        userId,
      };
    } else {
      if (flow.claimed_email === null || flow.claimed_email_normalized === null) return;
      recipient = {
        email: flow.claimed_email,
        emailNormalized: flow.claimed_email_normalized,
        name: flow.display_name ?? '',
        userId: null,
      };
    }
    if (!(await this.throttle.consume('mail_link_confirm', recipient.emailNormalized))) return;
    const ttl = isLink
      ? (stageTtlMs('awaiting_email', this.config) ?? SIGNUP_MAIL_TTL_MS)
      : SIGNUP_MAIL_TTL_MS;
    const token = await this.flows.issueMailToken(flow.id, ttl);
    if (token === null) return;
    this.mail.sendAfterCommit(isLink ? 'confirmIdentityLink' : 'completeSignup', recipient.email, {
      displayName: recipient.name,
      token,
      method: flow.provider,
      userId: recipient.userId,
    });
  }

  /**
   * `POST /auth/oauth/confirm` – mở liên kết trong thư (hoàn tất đăng ký hoặc xác nhận liên kết).
   * Không cần cookie của lượt: mở trên thiết bị khác được.
   */
  async confirm(token: string, meta: RequestMeta): Promise<SignedIn> {
    const invalid = () => oauthTokenInvalid();
    const flow = await this.flows.findByMailToken(token);
    if (flow?.purpose !== 'login') throw invalid();
    if (flow.target_user_id !== null) {
      return this.linkTarget(flow, 'awaiting_email', true, meta, invalid);
    }
    const { claimed_email: email, claimed_email_normalized: emailNormalized } = flow;
    if (email === null || emailNormalized === null || flow.provider_subject === null) {
      throw invalid();
    }
    let created: { accountId: string; userId: string };
    try {
      created = await authTx(async (db) => {
        if (!(await this.flows.transition(flow.id, 'awaiting_email', 'completed'))) {
          throw new Rollback('flow_gone');
        }
        return this.register(
          db,
          flow,
          { displayName: flow.display_name ?? email, email, emailNormalized },
          meta,
        );
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
      if (err.outcome !== 'flow_gone') await this.flows.fail(flow.id, 'OAUTH_FLOW_INVALID');
      if (err.outcome === 'identity_taken') {
        throw socialError('IDENTITY_IN_USE', { provider: flow.provider });
      }
      throw invalid();
    }
    return this.signIn(created.accountId, created.userId, meta);
  }
}
