// Bộ xử lý `queue.smoke_ping` (008 FR-032): đánh dấu dòng kiểm tra khói đã được Worker xử lý và ghi phiên bản
// của Worker. Cập nhật có điều kiện (`processed_at IS NULL`) → chạy lại an toàn, `worker_version` không bị
// ghi đè (hiến pháp V).
import { sql } from 'drizzle-orm';
import { systemTx } from '../../../../core/db/transaction';

/** Phiên bản của tiến trình Worker (cùng nguồn với cấu hình `APP_VERSION`). */
const workerVersion = (): string => {
  const value = process.env.APP_VERSION?.trim();
  return value === undefined || value === '' ? '0.0.0-dev' : value;
};

/** Trả `true` khi lượt này là lượt đánh dấu đầu tiên. */
export async function markSmokePingProcessed(pingId: string): Promise<boolean> {
  return systemTx(async (db) => {
    const result = await db.execute(
      sql`UPDATE infra.smoke_pings
             SET processed_at = now(), worker_version = ${workerVersion()}
           WHERE id = ${pingId} AND processed_at IS NULL`,
    );
    return (result.rowCount ?? 0) > 0;
  });
}
