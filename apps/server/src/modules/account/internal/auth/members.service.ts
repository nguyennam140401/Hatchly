import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { tenantTx, uuidV7, type Db } from '../../../../core';
import { runInAccountScope } from '../../../../core/auth/account-scope';
import { DbQueryError } from '../../../../core/db/errors';
import { loginIdentities, memberships, users } from '../db/schema';
import { writeAuthAudit } from './audit';
import { normalizeEmail } from './email';
import { emailInvalid, ownerRequired, seatsFull } from './errors';
import { PasswordHasher } from './password/password-hasher';
import { SessionService } from './session.service';
import { assertStrongPassword } from './staff.service';

// Thành viên của tài khoản (FR-003, FR-004, R5): đúng 1 chủ (ghế 0), tối đa 2 cộng tác viên (ghế 1, 2)
// – CSDL bảo đảm bằng chỉ mục duy nhất (account_id, seat) WHERE status = 'active'. Chuyển trạng thái
// bằng cập nhật có điều kiện; mỗi chuyển đổi ghi kiểm toán và thu hồi mọi phiên của người đó.
// `accountId` luôn là tài khoản ĐÃ XÁC MINH của người gọi (không từ đầu vào người dùng).

export interface AddMemberInput {
  accountId: string;
  displayName: string;
  email: string;
  /** Mật khẩu ban đầu (dữ liệu mẫu, kiểm thử); không có → chưa đăng nhập bằng mật khẩu được. */
  password?: string | undefined;
  /** Đánh dấu email đã xác nhận (dữ liệu mẫu, kiểm thử). */
  emailVerified?: boolean | undefined;
  addedByUserId: string;
}

export type MemberTransition = 'removed' | 'disabled' | 'active';

@Injectable()
export class MembersService {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
  ) {}

  /** Thêm cộng tác viên vào ghế trống nhỏ nhất; trùng ghế thử lại một lần rồi SEATS_FULL. */
  async addMember(input: AddMemberInput): Promise<{ userId: string; seat: number }> {
    const email = normalizeEmail(input.email);
    if (email === null) throw emailInvalid();
    const passwordHash =
      input.password === undefined
        ? null
        : await this.hasher.hash(
            assertStrongPassword('password', input.password, email.emailNormalized),
          );
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await runInAccountScope(input.accountId, () =>
          tenantTx((db) => this.insertMember(db, input, email, passwordHash)),
        );
      } catch (err) {
        const seatTaken =
          err instanceof DbQueryError &&
          err.code === '23505' &&
          err.constraint === 'memberships_account_seat_active_key';
        if (!seatTaken) throw err;
      }
    }
    throw seatsFull();
  }

  private async insertMember(
    db: Db,
    input: AddMemberInput,
    email: { email: string; emailNormalized: string },
    passwordHash: string | null,
  ): Promise<{ userId: string; seat: number }> {
    const taken = await db
      .select({ seat: memberships.seat })
      .from(memberships)
      .where(eq(memberships.status, 'active'));
    const used = new Set(taken.map((r) => r.seat));
    const seat = [1, 2].find((s) => !used.has(s));
    if (seat === undefined) throw seatsFull();
    const userId = uuidV7();
    await db.insert(users).values({
      id: userId,
      account_id: input.accountId,
      display_name: input.displayName.trim(),
      email: email.email,
      email_normalized: email.emailNormalized,
      email_verified_at: input.emailVerified === true ? new Date() : null,
      status: 'active',
      terms_version: 'invited',
      terms_accepted_at: new Date(),
    });
    if (passwordHash !== null) {
      await db.insert(loginIdentities).values({
        account_id: input.accountId,
        user_id: userId,
        provider: 'password',
        provider_subject: userId,
        password_hash: passwordHash,
      });
    }
    await db.insert(memberships).values({
      account_id: input.accountId,
      user_id: userId,
      role: 'collaborator',
      seat,
      status: 'active',
      added_by_user_id: input.addedByUserId,
    });
    await writeAuthAudit(db, {
      actorType: 'user',
      actorId: input.addedByUserId,
      accountId: input.accountId,
      action: 'account.member.added',
    });
    return { userId, seat };
  }

  /** Gỡ cộng tác viên (`active|disabled → removed`). Chủ → OWNER_REQUIRED. */
  removeMember(input: { accountId: string; userId: string; byUserId: string }): Promise<void> {
    return this.transition(input, ['active', 'disabled'], 'removed');
  }

  /** Khóa cộng tác viên (`active → disabled`). */
  disableMember(input: { accountId: string; userId: string; byUserId: string }): Promise<void> {
    return this.transition(input, ['active'], 'disabled');
  }

  /** Mở khóa (`disabled → active`) – vẫn chịu giới hạn ghế. */
  enableMember(input: { accountId: string; userId: string; byUserId: string }): Promise<void> {
    return this.transition(input, ['disabled'], 'active');
  }

  private async transition(
    input: { accountId: string; userId: string; byUserId: string },
    from: ('active' | 'disabled' | 'removed')[],
    to: MemberTransition,
  ): Promise<void> {
    await runInAccountScope(input.accountId, () =>
      tenantTx(async (db) => {
        const rows = await db
          .select({ role: memberships.role })
          .from(memberships)
          .where(eq(memberships.user_id, input.userId))
          .limit(1);
        const member = rows[0];
        if (member === undefined) return;
        if (member.role === 'owner') throw ownerRequired();
        const updated = await db
          .update(memberships)
          .set({ status: to })
          .where(and(eq(memberships.user_id, input.userId), inArray(memberships.status, from)))
          .returning({ id: memberships.id });
        if (updated.length === 0) return;
        await writeAuthAudit(db, {
          actorType: 'user',
          actorId: input.byUserId,
          accountId: input.accountId,
          action:
            to === 'removed'
              ? 'account.member.removed'
              : to === 'disabled'
                ? 'account.member.disabled'
                : 'account.member.enabled',
        });
        if (to !== 'active') {
          await this.sessions.revokeAllForUser(
            db,
            input.userId,
            to === 'removed' ? 'member_removed' : 'user_disabled',
          );
        }
      }),
    );
  }
}
