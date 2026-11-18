// Việc định kỳ `publishing.sweep_overdue` (013 R14, FR-032): CHỈ đọc số liệu tổng hợp và phát chỉ số cảnh báo.
// KHÔNG đổi trạng thái, KHÔNG gửi bài – "tự chữa" bằng gửi lại là cách duy nhất để đăng trùng. Số liệu lấy từ hàm
// SECURITY DEFINER chỉ trả bốn con số (không mã tài khoản) nên không vi phạm cô lập tenant.
import { sql } from 'drizzle-orm';
import { systemTx } from '../../../core';
import { publishMetrics, type SweepStats } from './metrics';

export const OVERDUE_AFTER_SEC = 300;

export async function runSweepOverdue(): Promise<SweepStats> {
  const stats = await systemTx(
    async (db) => {
      const r = await db.execute<{
        overdue_scheduled: string;
        retry_wait: string;
        unknown: string;
        needs_check: string;
      }>(sql`SELECT * FROM publishing.sweep_stats(${OVERDUE_AFTER_SEC})`);
      const row = r.rows[0];
      return {
        overdueScheduled: Number(row?.overdue_scheduled ?? 0),
        retryWait: Number(row?.retry_wait ?? 0),
        unknown: Number(row?.unknown ?? 0),
        needsCheck: Number(row?.needs_check ?? 0),
      };
    },
    { tenant: 'none' },
  );
  publishMetrics.recordSweep(stats);
  return stats;
}
