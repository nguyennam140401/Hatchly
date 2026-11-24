import { sql } from 'drizzle-orm';
import { systemTx } from '../../../core';

// Số tài khoản đang hoạt động (status = 'active', chưa xóa) – mẫu số của cảnh báo `ai.threshold_ratio_high` (015 US8, T066).
// Số tổng hợp toàn hệ thống: bảng `account.accounts` có RLS nên đọc qua hàm SECURITY DEFINER hẹp `account.count_active_accounts()`
// (chỉ trả MỘT con số, không lộ dòng nào), cấp cho vai trò `system` (Worker). Không cache (đếm lại mỗi lần gọi).

export async function countActiveAccounts(): Promise<number> {
  const row = await systemTx(
    async (db) =>
      (await db.execute<{ n: string | number }>(sql`SELECT account.count_active_accounts() AS n`))
        .rows[0],
    { tenant: 'none' },
  );
  return Number(row?.n ?? 0);
}
