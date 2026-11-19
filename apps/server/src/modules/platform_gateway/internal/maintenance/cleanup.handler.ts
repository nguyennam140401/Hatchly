import { sql } from 'drizzle-orm';
import { systemTx } from '../../../../core';

// Việc `cleanup_connect_data` (010 T063, contracts/jobs-and-notifications.md 1.3): xóa HẲN trạng thái OAuth và phiên chọn Page đã
// dùng hoặc hết hạn > 1 giờ – kể cả mã quyền đã mã hóa của ứng viên không được chọn. Việc hệ thống ⇒ gọi hàm SECURITY DEFINER
// `purge_connect_data` (chỉ trả số dòng đã xóa). Theo lô ≤ 1000 dòng/lần; lặp tới khi hết lô đầy (có trần vòng lặp để không
// chiếm khóa việc quá lâu – phần còn lại do lần chạy kế tiếp). Idempotent.

const BATCH = 1000;
const MAX_ROUNDS = 20;

export async function runCleanupConnectData(
  opts: { now?: Date } = {},
): Promise<{ deleted: number }> {
  const now = opts.now ?? new Date();
  let deleted = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const n = await systemTx(
      async (db) => {
        const r = await db.execute<{ purge_connect_data: number }>(
          sql`SELECT platform_gateway.purge_connect_data(${BATCH}::int, ${now.toISOString()}::timestamptz) AS purge_connect_data`,
        );
        return r.rows[0]?.purge_connect_data ?? 0;
      },
      { tenant: 'none' },
    );
    deleted += n;
    if (n < BATCH) break;
  }
  return { deleted };
}
