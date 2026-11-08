// Tiện ích kiểm thử hàng chờ (003, R17): dùng chung CSDL tạm của global-setup 002. Trạng thái việc đọc
// bằng vai trò `owner` (không bị RLS); mã cần kiểm thử chạy bằng `app`/`system` qua lớp thật.
import { asOwner } from '../../db/helpers/db';

export * from '../../db/helpers/db';

export interface JobRow {
  id: string;
  name: string;
  state: string;
  group_id: string | null;
  singleton_key: string | null;
  retry_count: number;
  retry_limit: number;
  priority: number;
  start_after: Date;
  data: {
    type: string;
    v: number;
    accountId: string | null;
    traceId: string;
    payload: Record<string, unknown>;
    retriedFrom?: { deadJobId: string; traceId: string };
  };
  output: Record<string, unknown> | null;
}

/** Mọi việc (mọi trạng thái) của các hàng chờ, sắp theo giờ tạo. */
export async function jobs(where = 'true', values: unknown[] = []): Promise<JobRow[]> {
  return asOwner(async (c) => {
    const r = await c.query<JobRow>(
      `SELECT id::text, name, state::text, group_id, singleton_key, retry_count, retry_limit, priority,
              start_after, data, output
         FROM pgboss.job_common WHERE ${where} ORDER BY created_on, id`,
      values,
    );
    return r.rows;
  });
}

export async function jobById(id: string): Promise<JobRow | undefined> {
  return (await jobs('id = $1::uuid', [id]))[0];
}

/** Xóa mọi việc + việc hỏng + khung lịch (giữa các ca kiểm thử). */
export async function resetQueues(): Promise<void> {
  await asOwner(async (c) => {
    await c.query('DELETE FROM pgboss.job_common');
    await c.query('DELETE FROM pgboss.instance');
    await c.query(
      "DO $$ BEGIN IF to_regclass('infra.dead_jobs') IS NOT NULL THEN DELETE FROM infra.dead_jobs; END IF; END $$",
    );
    await c.query(
      "DO $$ BEGIN IF to_regclass('infra.schedule_slots') IS NOT NULL THEN DELETE FROM infra.schedule_slots; END IF; END $$",
    );
  });
}

/** Đổi thông số một hàng chờ (bằng owner) – kiểm thử thu nhỏ thời gian. */
export async function setQueueSettings(
  queue: string,
  values: Record<string, number | string | number[] | null>,
): Promise<void> {
  const keys = Object.keys(values);
  await asOwner((c) =>
    c.query(
      `UPDATE infra.queue_settings SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now()
        WHERE queue = $1`,
      [queue, ...keys.map((k) => values[k])],
    ),
  );
}

/** Khôi phục thông số khởi tạo của migration 0006. */
export async function resetQueueSettings(): Promise<void> {
  const seed: [string, number, number | null, number, number, string, number, number[], number][] = [
    ['publish', 10, 3, 120, 30, 'handler', 5, [60], 1000],
    ['media', 2, 1, 900, 30, 'schedule', 3, [60, 300, 900], 5000],
    ['ai_batch', 5, 3, 180, 30, 'schedule', 2, [30, 120], 2000],
    ['trends', 2, 1, 600, 30, 'schedule', 3, [3600, 14400], 5000],
    ['notify', 5, null, 60, 30, 'schedule', 5, [30, 60, 120, 300, 600], 2000],
    ['scheduled', 2, null, 600, 30, 'none', 0, [60], 2000],
  ];
  await asOwner(async (c) => {
    for (const [q, conc, mpt, lock, hb, mode, maxr, delays, poll] of seed) {
      await c.query(
        `UPDATE infra.queue_settings SET concurrency_per_worker = $2, max_per_tenant = $3, lock_seconds = $4,
                heartbeat_seconds = $5, retry_mode = $6, max_retries = $7, retry_delays_seconds = $8,
                poll_interval_ms = $9 WHERE queue = $1`,
        [q, conc, mpt, lock, hb, mode, maxr, delays, poll],
      );
    }
  });
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Chờ tới khi `check()` đúng (hoặc hết hạn → ném). */
export async function waitFor(
  check: () => Promise<boolean> | boolean,
  timeoutMs = 30_000,
  stepMs = 100,
  label = 'điều kiện',
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`Hết thời gian chờ ${label}`);
    await sleep(stepMs);
  }
}
