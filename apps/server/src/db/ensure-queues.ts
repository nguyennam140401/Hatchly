// Bước hậu-migration (003 data-model mục 2, research R2): tạo 6 hàng chờ pg-boss nếu chưa có và đồng bộ
// thông số từ infra.queue_settings. Chạy bằng vai trò "owner" (cùng chuỗi kết nối với migration).
// IDEMPOTENT – chạy lại bao nhiêu lần cũng cho cùng kết quả.
import { Client } from 'pg';

/** Việc xong/hủy giữ 30 ngày rồi pg-boss tự xóa (FR-029). */
export const DELETE_AFTER_SECONDS = 2_592_000;

interface SettingsRow {
  queue: string;
  lock_seconds: number;
  heartbeat_seconds: number;
  max_retries: number;
  retry_delays_seconds: number[];
}

/** Thuộc tính hàng chờ pg-boss suy từ một dòng thông số (dùng chung với Worker khi thông số đổi). */
export function queueOptionsFrom(row: SettingsRow) {
  return {
    expireInSeconds: row.lock_seconds,
    heartbeatSeconds: row.heartbeat_seconds,
    retryLimit: row.max_retries,
    // Chỉ dùng khi monitor trả việc do Worker chết – bộ chạy tự đặt giờ thử lại (R7).
    retryDelay: row.retry_delays_seconds[0] ?? 60,
    retryBackoff: false,
    deleteAfterSeconds: DELETE_AFTER_SECONDS,
  };
}

export interface EnsureQueuesResult {
  created: string[];
  updated: string[];
}

export async function ensureQueues(ownerUrl: string): Promise<EnsureQueuesResult> {
  const client = new Client({ connectionString: ownerUrl, options: '-c TimeZone=UTC' });
  await client.connect();
  let rows: SettingsRow[];
  try {
    rows = (
      await client.query<SettingsRow>(
        `SELECT queue, lock_seconds, heartbeat_seconds, max_retries, retry_delays_seconds
           FROM infra.queue_settings ORDER BY queue`,
      )
    ).rows;
  } finally {
    await client.end();
  }

  const { PgBoss } = await import('pg-boss');
  const boss = new PgBoss({
    connectionString: ownerUrl,
    schema: 'pgboss',
    max: 2,
    migrate: false,
    createSchema: false,
    supervise: false,
    schedule: false,
    registerInstance: false,
    application_name: 'db-ensure-queues',
    openTelemetry: { enabled: false },
  });
  // pg-boss phát sự kiện 'error' – không có người nghe thì tiến trình sập.
  boss.on('error', () => undefined);
  await boss.start();
  const result: EnsureQueuesResult = { created: [], updated: [] };
  try {
    for (const row of rows) {
      const options = queueOptionsFrom(row);
      const existing = await boss.getQueue(row.queue);
      if (existing === null) {
        await boss.createQueue(row.queue, { ...options, policy: 'exclusive', partition: false });
        result.created.push(row.queue);
      } else {
        await boss.updateQueue(row.queue, options);
        result.updated.push(row.queue);
      }
    }
  } finally {
    await boss.stop({ graceful: false, close: true });
  }
  return result;
}
