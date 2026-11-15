import { sql } from 'drizzle-orm';
import { systemTx, tenantTx } from '../../../../core';
import { runInAccountScope } from '../../../../core/auth/account-scope';
import { authTx } from '../../../../core/db/auth-tx';
import { writeAuthAudit } from './audit';

// Việc định kỳ `account.auth_housekeeping` (009, contracts/module-api.md mục 4) – mỗi 10 phút, Worker.
// Chạy lại an toàn: `auth_housekeeping()` chỉ trả lời mời VỪA chuyển `expired` trong lần gọi đó (lần
// sau trả rỗng) nên kiểm toán không ghi trùng; các câu xóa đều theo điều kiện thời gian.

export interface HousekeepingResult {
  expiredInvitations: number;
  deletedFlows: number;
  deletedMetaRequests: number;
}

export async function runAuthHousekeeping(): Promise<HousekeepingResult> {
  const expired = await systemTx(
    async (db) => {
      const result = await db.execute<{ account_id: string; invitation_id: string }>(
        sql`SELECT account_id, invitation_id FROM account.auth_housekeeping()`,
      );
      return result.rows;
    },
    { tenant: 'none' },
  );
  for (const row of expired) {
    // Kiểm toán trong ngữ cảnh tài khoản của lời mời (RLS). Không có dữ liệu cá nhân.
    await runInAccountScope(row.account_id, () =>
      tenantTx((db) =>
        writeAuthAudit(db, {
          actorType: 'system',
          actorId: 'account.auth_housekeeping',
          accountId: row.account_id,
          action: 'account.invitation.expired',
        }),
      ),
    );
  }
  // Bảng dùng chung (không tenant): lượt đã kết thúc hoặc quá hạn > 24 giờ; yêu cầu của Meta > 12 tháng.
  const deleted = await authTx(async (db) => {
    const flows = await db.execute(sql`
      DELETE FROM account.oauth_flows
       WHERE COALESCE(closed_at, expires_at) < now() - interval '24 hours'`);
    const meta = await db.execute(sql`
      DELETE FROM account.meta_deletion_requests
       WHERE received_at < now() - interval '12 months'`);
    return { flows: flows.rowCount ?? 0, meta: meta.rowCount ?? 0 };
  });
  return {
    expiredInvitations: expired.length,
    deletedFlows: deleted.flows,
    deletedMetaRequests: deleted.meta,
  };
}
