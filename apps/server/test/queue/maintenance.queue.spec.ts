// 003 T056 – US5 AS5–6, FR-029: dọn việc hỏng / khung lịch > 90 ngày; phân vùng audit_log tạo trước 2
// tháng, bỏ phân vùng > 12 tháng; việc xong > 30 ngày do pg-boss dọn (deleteAfterSeconds).
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runCleanup, runPartitions } from '../../src/modules/queue/internal/maintenance';
import {
  asOwner,
  createAccount,
  describeDb,
  makeDatabase,
  type TestDatabase,
} from './helpers/queue-db';

async function insertDead(accountId: string | null, daysAgo: number): Promise<string> {
  const id = crypto.randomUUID();
  await asOwner((c) =>
    c.query(
      `INSERT INTO infra.dead_jobs (id, account_id, original_job_id, queue, job_type, payload_version, payload,
         dedupe_key, cause, last_error, attempts, job_created_at, failed_at, trace_id, generic_retry_allowed)
       VALUES ($1, $2, gen_random_uuid(), 'media', 'sandbox.x', 1, '{}', 'k', 'RETRIES_EXHAUSTED',
         '{"name":"Error","message":"x"}', 1, now(), now() - make_interval(days => $3), 't', true)`,
      [id, accountId, daysAgo],
    ),
  );
  return id;
}

const partitions = () =>
  asOwner(async (c) =>
    (
      await c.query<{ name: string }>(
        `SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
          JOIN pg_class p ON p.oid = i.inhparent WHERE p.relname = 'audit_log' ORDER BY 1`,
      )
    ).rows.map((r) => r.name),
  );

const monthName = (offset: number) => {
  const d = new Date();
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
  return `audit_log_y${m.getUTCFullYear()}m${String(m.getUTCMonth() + 1).padStart(2, '0')}`;
};

async function createPartition(offset: number): Promise<void> {
  const d = new Date();
  const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
  const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset + 1, 1));
  await asOwner((c) =>
    c.query(
      `CREATE TABLE IF NOT EXISTS infra.${monthName(offset)} PARTITION OF infra.audit_log
         FOR VALUES FROM ('${from.toISOString()}') TO ('${to.toISOString()}')`,
    ),
  );
}

describeDb('US5 – việc định kỳ nội bộ: dọn dẹp, phân vùng', () => {
  let database: TestDatabase;
  let a: string;

  beforeAll(async () => {
    database = makeDatabase();
    a = await createAccount();
  });
  afterAll(async () => {
    await database.close();
  });

  it('queue.cleanup: xóa việc hỏng > 90 ngày (giữ 89 ngày) mọi tài khoản + việc hệ thống; khung lịch > 90 ngày', async () => {
    const old = [await insertDead(a, 91), await insertDead(null, 120)];
    const keep = [await insertDead(a, 89), await insertDead(null, 1)];
    await asOwner((c) =>
      c.query(
        `INSERT INTO infra.schedule_slots (name, slot, slot_at, status, late_seconds) VALUES
           ('sandbox.old', 'cũ', now() - interval '91 days', 'enqueued', 0),
           ('sandbox.old', 'mới', now() - interval '89 days', 'enqueued', 0)`,
      ),
    );
    const r = await runCleanup();
    expect(r.deadJobs).toBeGreaterThanOrEqual(2);
    expect(r.slots).toBeGreaterThanOrEqual(1);
    const left = await asOwner(async (c) =>
      (await c.query<{ id: string }>('SELECT id::text FROM infra.dead_jobs')).rows.map((x) => x.id),
    );
    for (const id of old) expect(left).not.toContain(id);
    for (const id of keep) expect(left).toContain(id);
    const slots = await asOwner(
      async (c) =>
        (
          await c.query<{ slot: string }>(
            "SELECT slot FROM infra.schedule_slots WHERE name = 'sandbox.old'",
          )
        ).rows,
    );
    expect(slots.map((s) => s.slot)).toEqual(['mới']);
  });

  it('queue.partitions: tạo phân vùng tháng kế tiếp và tháng sau đó; chạy lại không lỗi; bỏ > 12 tháng, giữ 12 tháng', async () => {
    await createPartition(-14);
    await createPartition(-13);
    await createPartition(-12);
    await createPartition(-11);
    const first = await runPartitions();
    expect(first).toEqual([{ table: 'infra.audit_log', dropped: 2 }]);
    const names = await partitions();
    for (const offset of [0, 1, 2]) expect(names).toContain(monthName(offset));
    expect(names).not.toContain(monthName(-14));
    expect(names).not.toContain(monthName(-13));
    expect(names).toContain(monthName(-12));
    expect(names).toContain(monthName(-11));
    // Chạy lại: idempotent.
    expect(await runPartitions()).toEqual([{ table: 'infra.audit_log', dropped: 0 }]);
    expect(await partitions()).toEqual(names);
  });

  it('6 hàng chờ có deleteAfterSeconds = 30 ngày (việc xong do pg-boss dọn)', async () => {
    const rows = await asOwner(
      async (c) =>
        (
          await c.query<{ name: string; deletion_seconds: number; policy: string }>(
            'SELECT name, deletion_seconds, policy FROM pgboss.queue ORDER BY name',
          )
        ).rows,
    );
    expect(rows.map((r) => r.name)).toEqual([
      'ai_batch',
      'media',
      'notify',
      'publish',
      'scheduled',
      'trends',
    ]);
    expect(rows.every((r) => r.deletion_seconds === 2_592_000 && r.policy === 'exclusive')).toBe(
      true,
    );
  });
});
