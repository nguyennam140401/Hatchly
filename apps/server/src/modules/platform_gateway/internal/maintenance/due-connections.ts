import { sql } from 'drizzle-orm';
import { systemTx } from '../../../../core';
import { enqueueForAccount } from '../../../queue';
import { checkConnection, checkDedupeKey } from './jobs';

// Việc `channel_maintenance` (010 T059, contracts/jobs-and-notifications.md 1.1): việc HỆ THỐNG – không thuộc tài khoản nào
// nên KHÔNG đọc được bảng có RLS. Chỉ gọi hàm `platform_gateway.list_due_connections` (SECURITY DEFINER, chỉ trả
// `(account_id, connection_id)` – không mã quyền/tên/bản mã) rồi tạo `check_connection` THEO TỪNG TÀI KHOẢN (khóa chống
// trùng theo ngày). Còn dư so với `batchLimit` ⇒ lần quét kế tiếp (không mất việc). Chạy lại hai lần ⇒ cùng kết quả.

export interface MaintenanceResult {
  /** Số kết nối đến hạn tìm thấy (≤ batchLimit). */
  due: number;
  /** Số việc `check_connection` MỚI tạo (việc cùng khóa chỉ tồn tại một). */
  created: number;
}

export async function runChannelMaintenance(opts: {
  now?: Date;
  batchLimit?: number;
}): Promise<MaintenanceResult> {
  const now = opts.now ?? new Date();
  const batchLimit = opts.batchLimit ?? 500;
  const rows = await systemTx(
    async (db) => {
      const r = await db.execute<{ account_id: string; connection_id: string }>(
        sql`SELECT account_id, connection_id
              FROM platform_gateway.list_due_connections(${batchLimit}::int, ${now.toISOString()}::timestamptz)`,
      );
      return r.rows;
    },
    { tenant: 'none' },
  );
  let created = 0;
  for (const row of rows) {
    const { status } = await enqueueForAccount(
      row.account_id,
      checkConnection,
      { connectionId: row.connection_id },
      { dedupeKey: checkDedupeKey(row.connection_id, now) },
    );
    if (status === 'created') created += 1;
  }
  return { due: rows.length, created };
}
