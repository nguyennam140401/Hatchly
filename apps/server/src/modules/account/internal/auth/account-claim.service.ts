import { Inject, Injectable } from '@nestjs/common';
import type { MeResponse } from '@app/shared/auth';
import { and, eq, sql } from 'drizzle-orm';
import {
  accounts,
  AUTH_CONFIG,
  tenantTx,
  type AuthConfig,
  type CustomerActor,
} from '../../../../core';
import { userAgentSummary } from '../../../../core/auth/client-ip';
import { sessions, users } from '../db/schema';
import { writeAuthAudit } from './audit';
import { socialError } from './errors';
import { loadMeInTx } from './me';
import { SessionService, type IssuedSession, type RequestMeta } from './session.service';

// Người ở tài khoản chờ tự tạo tài khoản kinh doanh của riêng mình (009 – US4, research R7): tài khoản
// chờ `unclaimed` của chính họ thành `active`, họ là chủ. Mọi bước trong MỘT giao dịch tenant của phiên;
// vai trò `app` có quyền UPDATE trên account.accounts trong tenant của mình (RLS) nên không cần hàm CSDL.

@Injectable()
export class AccountClaimService {
  constructor(
    @Inject(AUTH_CONFIG) private readonly auth: AuthConfig,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  /**
   * `POST /account/claim`. Phiên hiện tại bị thu hồi (`account_claimed`) và cấp phiên mới mang mốc xác
   * nhận danh tính của phiên cũ – xoay phiên không làm mới xác nhận danh tính (research R11).
   */
  async claim(
    actor: CustomerActor,
    sessionTokenHash: Buffer | undefined,
    meta: RequestMeta,
  ): Promise<{ me: MeResponse; session: IssuedSession }> {
    if (!actor.detached) throw socialError('ALREADY_IN_ACCOUNT');
    return tenantTx(async (db) => {
      // Cập nhật có điều kiện: gọi hai lần chỉ một lần đổi được trạng thái.
      const claimed = await db
        .update(accounts)
        .set({ status: 'active' })
        .where(and(eq(accounts.id, actor.accountId), eq(accounts.status, 'unclaimed')))
        .returning({ id: accounts.id });
      if (claimed.length === 0) throw socialError('ALREADY_IN_ACCOUNT');
      await db
        .update(users)
        .set({
          detached_at: null,
          deletion_notice_sent_at: null,
          terms_version: this.auth.termsVersion,
          terms_accepted_at: sql`now()`,
        })
        .where(eq(users.id, actor.userId));
      const marks = await db
        .select({ at: sql<Date>`COALESCE(${sessions.reauthenticated_at}, ${sessions.created_at})` })
        .from(sessions)
        .where(eq(sessions.id, actor.sessionId))
        .limit(1);
      const mark = marks[0]?.at;
      await this.sessions.revokeSession(db, actor.sessionId, 'account_claimed', sessionTokenHash);
      const session = await this.sessions.insertSession(db, {
        accountId: actor.accountId,
        userId: actor.userId,
        userAgent: meta.userAgent,
        reauthenticatedAt: mark === undefined ? undefined : new Date(mark),
      });
      await writeAuthAudit(db, {
        actorType: 'user',
        actorId: actor.userId,
        accountId: actor.accountId,
        action: 'account.claimed',
        ip: meta.ip,
        uaFamily: userAgentSummary(meta.userAgent),
      });
      const me = await loadMeInTx(db, actor.userId);
      if (me === null) throw socialError('ALREADY_IN_ACCOUNT');
      return { me, session };
    });
  }
}
