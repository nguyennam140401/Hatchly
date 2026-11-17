import { sql } from 'drizzle-orm';
import { systemTx } from '../../../core';
import { enqueueForAccount } from '../../queue';
import { cleanupDedupeKey, cleanupMedia } from '../jobs';

// Việc định kỳ `media.sweep` (014 R7, mỗi giờ + `full` mỗi Chủ nhật): việc HỆ THỐNG – không thuộc tài khoản nào nên KHÔNG đọc
// được bảng có RLS. Chỉ gọi hàm `media.list_cleanup_accounts` (SECURITY DEFINER, chỉ trả MÃ TÀI KHOẢN, quyền cho `system`) để biết
// tài khoản nào cần dọn, rồi tạo `media.cleanup` THEO TỪNG TÀI KHOẢN (khóa chống trùng `media_cleanup:{acc}:{scope}`).
// Chạy lại hai lần cho cùng kết quả: việc cùng khóa chỉ tồn tại một.

export const SWEEP_LIMIT = 500;

export interface SweepResult {
  stale: number;
  full: number;
}

async function accountsFor(
  kind: 'stale_sessions' | 'pending_purge' | 'full',
  cutoff: Date,
): Promise<string[]> {
  return systemTx(
    async (db) => {
      const r = await db.execute<{ list_cleanup_accounts: string }>(
        sql`SELECT * FROM media.list_cleanup_accounts(${kind}, ${cutoff.toISOString()}::timestamptz, ${SWEEP_LIMIT}::int)`,
      );
      return r.rows.map((row) => row.list_cleanup_accounts);
    },
    { tenant: 'none' },
  );
}

async function createFor(accountIds: Iterable<string>, scope: 'stale' | 'full'): Promise<number> {
  let created = 0;
  for (const accountId of accountIds) {
    const { status } = await enqueueForAccount(
      accountId,
      cleanupMedia,
      { scope },
      { dedupeKey: cleanupDedupeKey(accountId, scope) },
    );
    if (status === 'created') created += 1;
  }
  return created;
}

/** `now` tiêm được để kiểm thử; `weekly` = chạy cả quét tuần (mặc định: Chủ nhật 00:xx UTC). */
export async function runMediaSweep(
  opts: { now?: Date; weekly?: boolean } = {},
): Promise<SweepResult> {
  const now = opts.now ?? new Date();
  // Quét tuần: Chủ nhật, lượt chạy 00:xx UTC (lịch chạy mỗi giờ ⇒ đúng một lần mỗi tuần).
  const weekly = opts.weekly ?? (now.getUTCDay() === 0 && now.getUTCHours() === 0);

  // Phiên quá hạn + media đã xóa mềm còn tệp: cùng một việc dọn `stale` cho tài khoản.
  const stale = new Set([
    ...(await accountsFor('stale_sessions', now)),
    ...(await accountsFor('pending_purge', new Date(now.getTime() - 3_600_000))),
  ]);
  const result: SweepResult = { stale: await createFor(stale, 'stale'), full: 0 };
  if (weekly) result.full = await createFor(await accountsFor('full', now), 'full');
  return result;
}
