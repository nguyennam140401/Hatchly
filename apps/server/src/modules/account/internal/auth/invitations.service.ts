import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  InvitationPreviewResponse,
  InvitationView,
  MembersResponse,
  MeResponse,
  MyInvitationsResponse,
} from '@app/shared/auth';
import { and, asc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import {
  ACCOUNT_LABEL_RESOLVER,
  AUTH_CONFIG,
  OAUTH_CONFIG,
  tenantTx,
  uuidV7,
  type AccountLabelResolver,
  type AuthConfig,
  type CustomerActor,
  type Db,
  type OAuthConfig,
} from '../../../../core';
import { runInAccountScope, runInInvitingAccountScope } from '../../../../core/auth/account-scope';
import { userAgentSummary } from '../../../../core/auth/client-ip';
import { authTx } from '../../../../core/db/auth-tx';
import { enqueueMailNotice } from '../../jobs';
import { invitations, memberships, sessions, users } from '../db/schema';
import { writeAuthAudit, type AuthAuditAction } from './audit';
import { normalizeEmail } from './email';
import {
  emailInvalid,
  notFound,
  rateLimited,
  seatsFull,
  socialError,
  type SocialErrorCode,
} from './errors';
import { MailDispatcher } from './mail/dispatch';
import { loadMe, loadMeInTx } from './me';
import { PasswordHasher } from './password/password-hasher';
import { SessionService, type IssuedSession, type RequestMeta } from './session.service';
import { assertStrongPassword } from './staff.service';
import { ThrottleService } from './throttle.service';
import { hashToken, newToken } from './tokens';

// Lời mời cộng tác viên (009 – US3, US4; research R9, R10). Phía chủ chạy trong tenantTx của phiên
// (RLS: mã lời mời của tài khoản khác trông như không tồn tại). Phía người được mời đi qua hàm
// SECURITY DEFINER vì chưa biết tenant. Chỗ: ghế vai trò `active` ∪ ghế lời mời `pending` ⊆ {1, 2},
// đổi ghế luôn dưới khóa `account.seats:{account_id}`.

const DAY_MS = 86_400_000;
const SEATS = [1, 2] as const;

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type FoundInvitation = {
  invitation_id: string;
  account_id: string;
  email: string;
  email_normalized: string;
  account_label: string | null;
  inviter_display_name: string | null;
  expires_at: Date | string;
  existing_user_state: 'none' | 'detached' | 'member';
};

export type AcceptOutcome =
  | 'accepted'
  | 'invalid'
  | 'email_in_use'
  | 'identity_taken'
  | 'seat_taken'
  | 'email_mismatch'
  | 'not_eligible';

class Rollback extends Error {
  constructor(readonly outcome: AcceptOutcome) {
    super(`ROLLBACK:${outcome}`);
  }
}

/**
 * Quy tắc email của lời mời khi chấp nhận bằng Google/Facebook (research R10). Hàm thuần.
 * Nhà cung cấp trả email: phải trùng email được mời sau chuẩn hóa – khác thì từ chối dù đã xác minh
 * hay chưa. Không trả email (Facebook): nhận – người mở liên kết đã chứng minh cầm hộp thư được mời.
 */
export function inviteEmailMatches(
  providerEmail: string | null,
  invitedEmailNormalized: string,
): boolean {
  if (providerEmail === null) return true;
  return normalizeEmail(providerEmail)?.emailNormalized === invitedEmailNormalized;
}

/** Khóa ghế của tài khoản – cùng biểu thức với các hàm CSDL (migration 0016). */
export function lockSeats(db: Db, accountId: string): Promise<unknown> {
  return db.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended('account.seats:' || ${accountId}::uuid::text, 0))`,
  );
}

function fallbackLabel(inviterName: string | null | undefined): string {
  return `tài khoản của ${inviterName ?? 'chủ tài khoản'}`;
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

@Injectable()
export class InvitationsService {
  constructor(
    @Inject(AUTH_CONFIG) private readonly auth: AuthConfig,
    @Inject(OAUTH_CONFIG) private readonly config: OAuthConfig,
    @Inject(ThrottleService) private readonly throttle: ThrottleService,
    @Inject(MailDispatcher) private readonly mail: MailDispatcher,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Optional()
    @Inject(ACCOUNT_LABEL_RESOLVER)
    private readonly labels?: AccountLabelResolver,
  ) {}

  /** Kết quả của hàm chấp nhận → mã lỗi cho người dùng. */
  static resultCode(outcome: Exclude<AcceptOutcome, 'accepted'>): SocialErrorCode {
    switch (outcome) {
      case 'invalid':
        return 'INVITE_INVALID';
      case 'email_in_use':
        return 'INVITE_EMAIL_IN_USE';
      case 'identity_taken':
        return 'IDENTITY_IN_USE';
      case 'seat_taken':
        return 'SEATS_FULL';
      case 'email_mismatch':
        return 'INVITE_EMAIL_MISMATCH';
      case 'not_eligible':
        return 'ALREADY_IN_ACCOUNT';
    }
  }

  private audit(
    db: Db,
    action: AuthAuditAction,
    who: { userId: string; accountId: string },
    meta: RequestMeta,
  ): Promise<void> {
    return writeAuthAudit(db, {
      actorType: 'user',
      actorId: who.userId,
      accountId: who.accountId,
      action,
      ip: meta.ip,
      uaFamily: userAgentSummary(meta.userAgent),
    });
  }

  // ===== Phía chủ tài khoản (tenantTx của phiên) =====

  private view(row: {
    id: string;
    email: string;
    last_sent_at: Date;
    expires_at: Date;
  }): InvitationView {
    return {
      id: row.id,
      email: row.email,
      sentAt: row.last_sent_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
    };
  }

  /** `GET /members`: chủ, cộng tác viên đang hoạt động, lời mời đang chờ, số chỗ. */
  list(): Promise<MembersResponse> {
    return tenantTx(async (db) => {
      const members = await db
        .select({
          userId: users.id,
          displayName: users.display_name,
          email: users.email,
          role: memberships.role,
          joinedAt: memberships.created_at,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.user_id))
        .where(eq(memberships.status, 'active'))
        .orderBy(asc(memberships.seat));
      const pending = await db
        .select()
        .from(invitations)
        .where(and(eq(invitations.status, 'pending'), gt(invitations.expires_at, sql`now()`)))
        .orderBy(asc(invitations.seat));
      const owner = members.find((m) => m.role === 'owner');
      if (owner === undefined) throw notFound();
      const collaborators = members.filter((m) => m.role === 'collaborator');
      return {
        owner: { userId: owner.userId, displayName: owner.displayName, email: owner.email },
        collaborators: collaborators.map((m) => ({
          userId: m.userId,
          displayName: m.displayName,
          email: m.email,
          joinedAt: m.joinedAt.toISOString(),
        })),
        invitations: pending.map((row) => this.view(row)),
        seats: { used: collaborators.length + pending.length, total: SEATS.length },
      };
    });
  }

  private sendInvite(
    row: { email: string; expires_at: Date; account_label: string | null },
    inviterName: string,
    token: string,
  ): void {
    this.mail.sendAfterCommit('inviteMember', row.email, {
      token,
      inviterName,
      accountLabel: row.account_label ?? fallbackLabel(inviterName),
      date: row.expires_at,
    });
  }

  /**
   * `POST /members/invitations`. Email đang có lời mời chờ → coi là "Gửi lại" (`created: false`).
   * KHÔNG tra email có người dùng hay chưa: phản hồi giống nhau trong mọi trường hợp (FR-023).
   */
  async invite(
    actor: CustomerActor,
    emailInput: string,
    meta: RequestMeta,
  ): Promise<{ view: InvitationView; created: boolean }> {
    const email = normalizeEmail(emailInput);
    if (email === null) throw emailInvalid();
    const before = await tenantTx(async (db) => {
      const me = await db
        .select({ emailNormalized: users.email_normalized })
        .from(users)
        .where(eq(users.id, actor.userId))
        .limit(1);
      const existing = await db
        .select({ id: invitations.id })
        .from(invitations)
        .where(
          and(
            eq(invitations.email_normalized, email.emailNormalized),
            eq(invitations.status, 'pending'),
            gt(invitations.expires_at, sql`now()`),
          ),
        )
        .limit(1);
      return { self: me[0]?.emailNormalized === email.emailNormalized, pendingId: existing[0]?.id };
    });
    if (before.self) throw socialError('INVITE_SELF');
    if (before.pendingId !== undefined) {
      return { view: await this.resend(actor, before.pendingId, meta), created: false };
    }
    // Bộ đếm nằm ngoài giao dịch tenant (bảng dùng chung, authTx).
    if (!(await this.throttle.consume('mail_invite', email.emailNormalized))) throw rateLimited();
    if (!(await this.throttle.consume('invite_account', actor.accountId))) throw rateLimited();

    const token = newToken();
    const ttl = this.config.inviteTtlDays * DAY_MS;
    const result = await tenantTx(async (db) => {
      await lockSeats(db, actor.accountId);
      // Dọn tại chỗ: lời mời quá hạn trả chỗ ngay, không chờ việc định kỳ.
      await db
        .update(invitations)
        .set({ status: 'expired', closed_at: sql`now()` })
        .where(and(eq(invitations.status, 'pending'), lte(invitations.expires_at, sql`now()`)));
      const taken = await db
        .select({ seat: memberships.seat })
        .from(memberships)
        .where(eq(memberships.status, 'active'));
      const pending = await db
        .select({ seat: invitations.seat, emailNormalized: invitations.email_normalized })
        .from(invitations)
        .where(eq(invitations.status, 'pending'));
      const inviter = await db
        .select({ name: users.display_name })
        .from(users)
        .where(eq(users.id, actor.userId))
        .limit(1);
      const inviterName = inviter[0]?.name ?? '';
      const now = new Date();
      const values = {
        token_hash: hashToken(token),
        last_sent_at: now,
        expires_at: new Date(now.getTime() + ttl),
      };
      if (pending.some((p) => p.emailNormalized === email.emailNormalized)) {
        // Hai yêu cầu mời cùng email chen nhau: cái sau thành "Gửi lại".
        const rows = await db
          .update(invitations)
          .set(values)
          .where(
            and(
              eq(invitations.email_normalized, email.emailNormalized),
              eq(invitations.status, 'pending'),
            ),
          )
          .returning();
        const row = rows[0];
        if (row === undefined) throw notFound();
        await this.audit(db, 'account.invitation.resent', actor, meta);
        return { row, inviterName, created: false };
      }
      const used = new Set([...taken.map((t) => t.seat), ...pending.map((p) => p.seat)]);
      const seat = SEATS.find((s) => !used.has(s));
      if (seat === undefined) throw seatsFull();
      const label = (await this.labels?.currentAccountLabel()) ?? fallbackLabel(inviterName);
      const rows = await db
        .insert(invitations)
        .values({
          id: uuidV7(),
          account_id: actor.accountId,
          email: email.email,
          email_normalized: email.emailNormalized,
          invited_by_user_id: actor.userId,
          role: 'collaborator',
          seat,
          status: 'pending',
          account_label: label.slice(0, 120),
          ...values,
        })
        .returning();
      const row = rows[0];
      if (row === undefined) throw notFound();
      await this.audit(db, 'account.invitation.sent', actor, meta);
      return { row, inviterName, created: true };
    });
    this.sendInvite(result.row, result.inviterName, token);
    return { view: this.view(result.row), created: result.created };
  }

  /** `POST /members/invitations/:id/resend`: mã mới, hạn tính lại; mã cũ hết hiệu lực. */
  async resend(actor: CustomerActor, id: string, meta: RequestMeta): Promise<InvitationView> {
    const current = await tenantTx(async (db) => {
      const rows = await db
        .select({ emailNormalized: invitations.email_normalized })
        .from(invitations)
        .where(and(eq(invitations.id, id), eq(invitations.status, 'pending')))
        .limit(1);
      return rows[0];
    });
    if (current === undefined) throw notFound();
    if (!(await this.throttle.consume('mail_invite', current.emailNormalized))) throw rateLimited();
    const token = newToken();
    const now = new Date();
    const result = await tenantTx(async (db) => {
      const rows = await db
        .update(invitations)
        .set({
          token_hash: hashToken(token),
          last_sent_at: now,
          expires_at: new Date(now.getTime() + this.config.inviteTtlDays * DAY_MS),
        })
        .where(
          and(
            eq(invitations.id, id),
            eq(invitations.status, 'pending'),
            gt(invitations.expires_at, sql`now()`),
          ),
        )
        .returning();
      const row = rows[0];
      if (row === undefined) throw notFound();
      const inviter = await db
        .select({ name: users.display_name })
        .from(users)
        .where(eq(users.id, actor.userId))
        .limit(1);
      await this.audit(db, 'account.invitation.resent', actor, meta);
      return { row, inviterName: inviter[0]?.name ?? '' };
    });
    this.sendInvite(result.row, result.inviterName, token);
    return this.view(result.row);
  }

  /** `DELETE /members/invitations/:id`: trả chỗ ngay, mã hết hiệu lực. */
  async cancel(actor: CustomerActor, id: string, meta: RequestMeta): Promise<void> {
    await tenantTx(async (db) => {
      await lockSeats(db, actor.accountId);
      const rows = await db
        .update(invitations)
        .set({ status: 'cancelled', closed_at: sql`now()` })
        .where(and(eq(invitations.id, id), eq(invitations.status, 'pending')))
        .returning({ id: invitations.id });
      if (rows.length === 0) throw notFound();
      await this.audit(db, 'account.invitation.cancelled', actor, meta);
    });
  }

  // ===== Phía người được mời =====

  /** Tra lời mời theo mã trong liên kết (chỉ `pending`, chưa quá hạn, tài khoản còn dùng được). */
  findByToken(token: string): Promise<FoundInvitation | undefined> {
    return authTx(async (db) => {
      const result = await db.execute<FoundInvitation>(
        sql`SELECT * FROM account.auth_find_invitation(${hashToken(token)})`,
      );
      return result.rows[0];
    });
  }

  private invitationAccount(invitationId: string): Promise<string | undefined> {
    return authTx(async (db) => {
      const result = await db.execute<{ account_id: string | null }>(
        sql`SELECT account.auth_invitation_account(${invitationId}::uuid) AS account_id`,
      );
      return result.rows[0]?.account_id ?? undefined;
    });
  }

  /** Lời mời của một lượt đăng nhập qua nhà cung cấp (`purpose: 'invite'`) – đọc lại ở đường quay về. */
  async loadForFlow(invitationId: string): Promise<
    | {
        accountId: string;
        invitationId: string;
        email: string;
        emailNormalized: string;
        tokenHash: Buffer;
      }
    | undefined
  > {
    const accountId = await this.invitationAccount(invitationId);
    if (accountId === undefined) return undefined;
    return runInAccountScope(accountId, () =>
      tenantTx(async (db) => {
        const rows = await db
          .select()
          .from(invitations)
          .where(and(eq(invitations.id, invitationId), eq(invitations.status, 'pending')))
          .limit(1);
        const row = rows[0];
        return row === undefined
          ? undefined
          : {
              accountId,
              invitationId,
              email: row.email,
              emailNormalized: row.email_normalized,
              tokenHash: row.token_hash,
            };
      }),
    );
  }

  /**
   * Yêu cầu CÓ phiên hợp lệ mà lại đi đường "người mới": đang thuộc một tài khoản → ALREADY_IN_ACCOUNT;
   * ở tài khoản chờ với email khác email được mời → INVITE_EMAIL_MISMATCH. Không bao giờ tạo người dùng
   * mới đè lên phiên đang có (email trùng thì web dùng `accept-existing`).
   */
  async assertSessionMayAccept(
    actor: CustomerActor | null,
    invitedEmailNormalized: string | undefined,
  ): Promise<void> {
    if (actor === null) return;
    if (!actor.detached) throw socialError('ALREADY_IN_ACCOUNT');
    if (invitedEmailNormalized === undefined) return;
    const mine = await this.ownEmail(actor);
    if (mine?.emailNormalized !== invitedEmailNormalized) {
      throw socialError('INVITE_EMAIL_MISMATCH');
    }
  }

  private ownEmail(
    actor: CustomerActor,
  ): Promise<{ emailNormalized: string; verified: boolean } | undefined> {
    return runInAccountScope(actor.accountId, () =>
      tenantTx(async (db) => {
        const rows = await db
          .select({ emailNormalized: users.email_normalized, verifiedAt: users.email_verified_at })
          .from(users)
          .where(eq(users.id, actor.userId))
          .limit(1);
        const row = rows[0];
        return row === undefined
          ? undefined
          : { emailNormalized: row.emailNormalized, verified: row.verifiedAt !== null };
      }),
    );
  }

  /** `POST /invitations/preview`. */
  async preview(token: string): Promise<InvitationPreviewResponse> {
    const found = await this.findByToken(token);
    if (found === undefined) throw socialError('INVITE_INVALID');
    const mode = ({ none: 'new_user', detached: 'login_required', member: 'in_use' } as const)[
      found.existing_user_state
    ];
    return {
      accountLabel: found.account_label ?? fallbackLabel(found.inviter_display_name),
      inviterName: found.inviter_display_name ?? 'Chủ tài khoản',
      email: found.email,
      expiresAt: iso(found.expires_at),
      mode,
    };
  }

  /** Kiểm toán + thư báo chủ – trong CÙNG giao dịch với việc chấp nhận. */
  private async afterAccepted(
    db: Db,
    input: { accountId: string; invitationId: string; userId: string; meta: RequestMeta },
  ): Promise<void> {
    await this.audit(
      db,
      'account.invitation.accepted',
      { userId: input.userId, accountId: input.accountId },
      input.meta,
    );
    const owner = await db
      .select({ userId: memberships.user_id })
      .from(memberships)
      .where(and(eq(memberships.role, 'owner'), eq(memberships.status, 'active')))
      .limit(1);
    const ownerId = owner[0]?.userId;
    if (ownerId !== undefined) {
      await enqueueMailNotice(db, {
        template: 'invite_accepted',
        userId: ownerId,
        subjectUserId: input.userId,
        dedupeKey: `account.notice:invite_accepted:${input.invitationId}`,
      });
    }
  }

  /**
   * Chấp nhận lời mời – người MỚI, bằng mật khẩu hoặc danh tính nhà cung cấp. Mở ngữ cảnh tài khoản
   * mời TRƯỚC rồi gọi hàm bên trong giao dịch đó; kết quả khác `accepted` → hoàn tác toàn bộ.
   */
  async acceptNew(input: {
    accountId: string;
    invitationId: string;
    tokenHash: Buffer;
    displayName: string;
    passwordHash: string | null;
    identity: {
      provider: 'google' | 'facebook';
      subject: string;
      email: string | null;
      displayName: string | null;
    } | null;
    meta: RequestMeta;
  }): Promise<
    { outcome: 'accepted'; userId: string } | { outcome: Exclude<AcceptOutcome, 'accepted'> }
  > {
    const userId = uuidV7();
    const id = input.identity;
    try {
      await runInAccountScope(input.accountId, () =>
        tenantTx(async (db) => {
          const result = await db.execute<{ outcome: AcceptOutcome }>(sql`
            SELECT account.auth_accept_invitation_new(
              ${input.invitationId}::uuid, ${input.tokenHash}, ${userId}::uuid, ${uuidV7()}::uuid,
              ${uuidV7()}::uuid, ${input.displayName.trim().slice(0, 80)}, ${input.passwordHash},
              ${id?.provider ?? null}, ${id?.subject ?? null}, ${id?.email ?? null},
              ${id?.displayName ?? null}, ${this.auth.termsVersion}
            ) AS outcome`);
          const outcome = result.rows[0]?.outcome ?? 'invalid';
          if (outcome !== 'accepted') throw new Rollback(outcome);
          await this.afterAccepted(db, { ...input, userId });
        }),
      );
    } catch (err) {
      if (err instanceof Rollback && err.outcome !== 'accepted') return { outcome: err.outcome };
      throw err;
    }
    return { outcome: 'accepted', userId };
  }

  /** `POST /invitations/accept` – đặt tên + mật khẩu. Phiên chỉ được cấp SAU khi giao dịch xác nhận. */
  async acceptWithPassword(
    input: { token: string; displayName: string; password: string },
    actor: CustomerActor | null,
    meta: RequestMeta,
  ): Promise<{ me: MeResponse; session: IssuedSession }> {
    const found = await this.findByToken(input.token);
    await this.assertSessionMayAccept(actor, found?.email_normalized);
    if (found === undefined) throw socialError('INVITE_INVALID');
    const password = assertStrongPassword('password', input.password, found.email_normalized);
    const passwordHash = await this.hasher.hash(password);
    const accepted = await this.acceptNew({
      accountId: found.account_id,
      invitationId: found.invitation_id,
      tokenHash: hashToken(input.token),
      displayName: input.displayName,
      passwordHash,
      identity: null,
      meta,
    });
    if (accepted.outcome !== 'accepted') {
      throw socialError(InvitationsService.resultCode(accepted.outcome));
    }
    const session = await this.sessions.createCustomerSession({
      accountId: found.account_id,
      userId: accepted.userId,
      userAgent: meta.userAgent,
    });
    const me = await loadMe(found.account_id, accepted.userId);
    if (me === null) throw socialError('INVITE_INVALID');
    return { me, session };
  }

  /** `GET /invitations/mine`: chỉ cho người ở tài khoản chờ, theo email ĐÃ XÁC MINH của phiên. */
  async mine(actor: CustomerActor): Promise<MyInvitationsResponse> {
    if (!actor.detached) return { invitations: [] };
    const own = await this.ownEmail(actor);
    if (!own?.verified) return { invitations: [] };
    const rows = await authTx(async (db) => {
      const result = await db.execute<{
        invitation_id: string;
        account_label: string | null;
        inviter_display_name: string | null;
        expires_at: Date | string;
      }>(sql`SELECT * FROM account.auth_pending_invitations_for_email(${own.emailNormalized})`);
      return result.rows;
    });
    return {
      invitations: rows.map((r) => ({
        id: r.invitation_id,
        accountLabel: r.account_label ?? fallbackLabel(r.inviter_display_name),
        inviterName: r.inviter_display_name ?? 'Chủ tài khoản',
        expiresAt: iso(r.expires_at),
      })),
    };
  }

  /**
   * `POST /invitations/accept-existing`: người ở tài khoản chờ được CHUYỂN sang tài khoản mời (mã
   * người dùng không đổi). Việc có được tham gia hay không do hàm CSDL quyết định trong chính giao
   * dịch đó. Phiên mới mang mốc xác nhận danh tính của phiên cũ – xoay phiên không phải xác thực lại.
   */
  async acceptExisting(
    actor: CustomerActor,
    body: { token: string } | { invitationId: string },
    meta: RequestMeta,
  ): Promise<{ me: MeResponse; session: IssuedSession }> {
    if (!actor.detached) throw socialError('ALREADY_IN_ACCOUNT');
    let invitationId: string;
    let accountId: string | undefined;
    if ('token' in body) {
      const found = await this.findByToken(body.token);
      if (found === undefined) throw socialError('INVITE_INVALID');
      invitationId = found.invitation_id;
      accountId = found.account_id;
    } else {
      invitationId = body.invitationId;
      accountId = await this.invitationAccount(invitationId);
    }
    if (accountId === undefined) throw socialError('INVITE_INVALID');
    const target = accountId;

    // Đọc mốc xác nhận danh tính TRƯỚC khi gọi hàm (hàm xóa phiên cũ).
    const mark = await tenantTx(async (db) => {
      const rows = await db
        .select({ at: sql<Date>`COALESCE(${sessions.reauthenticated_at}, ${sessions.created_at})` })
        .from(sessions)
        .where(eq(sessions.id, actor.sessionId))
        .limit(1);
      return rows[0]?.at;
    });

    try {
      const result = await runInInvitingAccountScope(target, () =>
        tenantTx(async (db) => {
          const called = await db.execute<{ outcome: AcceptOutcome }>(sql`
            SELECT account.auth_accept_invitation_existing(
              ${invitationId}::uuid, ${actor.userId}::uuid
            ) AS outcome`);
          const outcome = called.rows[0]?.outcome ?? 'invalid';
          if (outcome !== 'accepted') throw new Rollback(outcome);
          await this.afterAccepted(db, {
            accountId: target,
            invitationId,
            userId: actor.userId,
            meta,
          });
          const session = await this.sessions.insertSession(db, {
            accountId: target,
            userId: actor.userId,
            userAgent: meta.userAgent,
            reauthenticatedAt: mark === undefined ? undefined : new Date(mark),
          });
          const me = await loadMeInTx(db, actor.userId);
          if (me === null) throw new Rollback('invalid');
          return { me, session };
        }),
      );
      // Phiên cũ đã bị hàm xóa – bỏ mục bộ nhớ đệm trên bản API này (bản khác hết hạn ≤ 60 giây).
      this.sessions.evictUser(actor.userId);
      return result;
    } catch (err) {
      if (err instanceof Rollback && err.outcome !== 'accepted') {
        throw socialError(InvitationsService.resultCode(err.outcome));
      }
      throw err;
    }
  }

  /** Dùng cho dữ liệu mẫu/kiểm thử: ghế đang bị lời mời `pending` giữ (trong giao dịch tenant `db`). */
  static async pendingSeats(db: Db): Promise<number[]> {
    const rows = await db
      .select({ seat: invitations.seat })
      .from(invitations)
      .where(and(inArray(invitations.status, ['pending']), gt(invitations.expires_at, sql`now()`)));
    return rows.map((r) => r.seat);
  }
}
