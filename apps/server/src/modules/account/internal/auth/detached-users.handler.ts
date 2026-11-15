import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { systemTx, tenantTx } from '../../../../core';
import { runInAccountScope } from '../../../../core/auth/account-scope';
import { authTx } from '../../../../core/db/auth-tx';
import { purgeAccountJobs } from '../../../queue';
import { enqueueMailNotice } from '../../jobs';
import { users } from '../db/schema';
import { writeAuthAudit } from './audit';
import { recordDetachedPurged } from './auth-metrics';

// Việc định kỳ `account.detached_users` (009, research R18, FR-028a) – mỗi giờ, Worker.
// (1) Báo trước: người ở tài khoản chờ đủ (retention − notice) ngày → đặt `deletion_notice_sent_at` bằng
//     cập nhật có điều kiện + tạo việc thư trong CÙNG giao dịch (khóa chống trùng theo mốc bị gỡ).
// (2) Xóa: đủ `retention` ngày VÀ thư đã gửi đủ `notice` ngày → `purge_detached_account` kiểm lại điều
//     kiện ngay trong câu lệnh xóa (người vừa nhận tài khoản / tham gia lại không bị xóa).
// Chạy lại hai lần cho cùng kết quả. Mỗi lần xử lý tối đa `batch` người mỗi loại; phần còn lại lần sau.

export const DETACHED_BATCH = 200;

/** Ném để hoàn tác giao dịch xóa khi hàm CSDL báo tài khoản không còn đủ điều kiện. */
class NotEligible extends Error {}

export interface DetachedUsersResult {
  noticed: number;
  purged: number;
}

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type Due = { account_id: string; user_id: string };

function due(kind: 'notice' | 'purge', limit: number, retention: number, notice: number) {
  return systemTx(
    async (db) => {
      const result = await db.execute<Due>(sql`
        SELECT account_id, user_id
          FROM account.detached_users_due(${kind}, ${limit}::int, ${retention}::int, ${notice}::int)`);
      return result.rows;
    },
    { tenant: 'none' },
  );
}

export async function runDetachedUsers(config: {
  retentionDays: number;
  noticeDays: number;
  batch?: number;
  onPurged?: () => void;
}): Promise<DetachedUsersResult> {
  const limit = config.batch ?? DETACHED_BATCH;
  let noticed = 0;
  let purged = 0;

  for (const row of await due('notice', limit, config.retentionDays, config.noticeDays)) {
    const sent = await runInAccountScope(row.account_id, () =>
      tenantTx(async (db) => {
        const updated = await db
          .update(users)
          .set({ deletion_notice_sent_at: sql`now()` })
          .where(
            and(
              eq(users.id, row.user_id),
              isNull(users.deletion_notice_sent_at),
              isNotNull(users.detached_at),
            ),
          )
          .returning({ detachedAt: users.detached_at });
        const detachedAt = updated[0]?.detachedAt;
        if (detachedAt == null) return false;
        await enqueueMailNotice(db, {
          template: 'detached_deletion_notice',
          userId: row.user_id,
          dedupeKey: `account.notice:deletion:${row.user_id}:${detachedAt.toISOString()}`,
        });
        return true;
      }),
    );
    if (sent) noticed += 1;
  }

  for (const row of await due('purge', limit, config.retentionDays, config.noticeDays)) {
    // Một giao dịch trong ngữ cảnh tài khoản chờ: xóa việc còn lại của tài khoản (vd thư báo trước chưa
    // gửi – queue.md mục 7) RỒI xóa tài khoản. Hàm kiểm lại điều kiện; không đủ (người vừa nhận tài
    // khoản / tham gia lại) → hoàn tác cả việc xóa việc, không mất việc nào của tài khoản đã thành thật.
    const removed = await runInAccountScope(row.account_id, () =>
      systemTx(
        async (db) => {
          await purgeAccountJobs();
          const result = await db.execute<{ purged: boolean }>(sql`
            SELECT account.purge_detached_account(
              ${row.account_id}::uuid, ${config.retentionDays}::int, ${config.noticeDays}::int
            ) AS purged`);
          if (result.rows[0]?.purged !== true) throw new NotEligible();
          return true;
        },
        { tenant: 'from-context' },
      ),
    ).catch((err: unknown) => {
      // Không đủ điều kiện, hoặc tài khoản đã bị bản Worker khác xóa trước → bỏ qua.
      if (err instanceof NotEligible) return false;
      if ((err as { code?: unknown } | null)?.code === 'TENANT_NOT_FOUND') return false;
      throw err;
    });
    if (!removed) continue;
    purged += 1;
    recordDetachedPurged();
    config.onPurged?.();
    // Kiểm toán không gắn tài khoản (đã xóa) và không có dữ liệu cá nhân – chỉ mã người dùng.
    await authTx((db) =>
      writeAuthAudit(db, {
        actorType: 'system',
        actorId: 'account.detached_users',
        accountId: null,
        action: 'account.user.purged',
        reason: `user:${row.user_id}`,
      }),
    );
  }
  return { noticed, purged };
}
