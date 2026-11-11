// 003 T044 – US3 AS1–4, FR-021/022, SC-004: số việc đang chạy của một tài khoản trên một hàng chờ ≤ N
// tính trên MỌI bản Worker; tài khoản khác không phải chờ; việc hệ thống không bị tính.
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import { systemTx, tenantTx } from '../../src/core/db/transaction';
import { defineJobType, enqueue, enqueueMany, registerJobHandler } from '../../src/modules/queue';
import { startTestWorkers, type TestWorkers } from '../support/queue-test-kit';
import {
  createAccount,
  dbUrls,
  describeDb,
  makeDatabase,
  resetQueues,
  resetQueueSettings,
  setQueueSettings,
  sleep,
  withAccount,
  type TestDatabase,
} from './helpers/queue-db';

const P = z.strictObject({ n: z.number().int() });
const mediaJob = defineJobType({
  name: 'sandbox.limit_media',
  queue: 'media',
  scope: 'tenant',
  version: 1,
  payload: P,
});
const aiJob = defineJobType({
  name: 'sandbox.limit_ai',
  queue: 'ai_batch',
  scope: 'tenant',
  version: 1,
  payload: P,
});
const notifyJob = defineJobType({
  name: 'sandbox.limit_notify',
  queue: 'notify',
  scope: 'tenant',
  version: 1,
  payload: P,
});
const mediaSystem = defineJobType({
  name: 'sandbox.limit_media_system',
  queue: 'media',
  scope: 'system',
  version: 1,
  payload: P,
});

/** Thời điểm bắt đầu / kết thúc theo tài khoản (bảng đo trong bộ nhớ – hai bản cùng tiến trình). */
const events: { account: string | null; type: string; start: number; end?: number }[] = [];
let holdMs = 500;
for (const def of [mediaJob, aiJob, notifyJob, mediaSystem]) {
  registerJobHandler(def, async (_p, ctx) => {
    const e: (typeof events)[number] = {
      account: ctx.accountId,
      type: def.name,
      start: Date.now(),
    };
    events.push(e);
    await sleep(holdMs);
    e.end = Date.now();
  });
}

/** Lấy mẫu số việc `active` theo tài khoản mỗi 50 ms (bằng vai trò system – thấy mọi việc). */
async function sample(queue: string, untilMs: number): Promise<Map<string | null, number>> {
  const max = new Map<string | null, number>();
  const c = new Client({ connectionString: dbUrls.system });
  await c.connect();
  try {
    const deadline = Date.now() + untilMs;
    while (Date.now() < deadline) {
      const r = await c.query<{ group_id: string | null; n: string }>(
        `SELECT group_id, count(*)::text AS n FROM pgboss.job_common
          WHERE name = $1 AND state = 'active' GROUP BY 1`,
        [queue],
      );
      for (const row of r.rows)
        max.set(row.group_id, Math.max(max.get(row.group_id) ?? 0, Number(row.n)));
      await sleep(50);
    }
  } finally {
    await c.end();
  }
  return max;
}

describeDb('US3 – giới hạn đồng thời theo tenant trên 2 bản', () => {
  let database: TestDatabase;
  let workers: TestWorkers;
  let a: string;
  let b: string;

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 20 });
    a = await createAccount();
    b = await createAccount();
    // media: 2 chỗ/bản, tối đa 1/tenant; ai_batch: tối đa 3/tenant; notify: không giới hạn tenant.
    await setQueueSettings('media', {
      concurrency_per_worker: 2,
      max_per_tenant: 1,
      poll_interval_ms: 200,
    });
    await setQueueSettings('ai_batch', {
      concurrency_per_worker: 5,
      max_per_tenant: 3,
      poll_interval_ms: 200,
    });
    await setQueueSettings('notify', { concurrency_per_worker: 5, poll_interval_ms: 200 });
    workers = await startTestWorkers(2, { queues: ['media', 'ai_batch', 'notify'] });
  });
  afterAll(async () => {
    await workers.stop();
    await resetQueueSettings();
    await database.close();
  });
  beforeEach(async () => {
    await resetQueues();
    events.length = 0;
    holdMs = 500;
  });

  const many = (account: string, def: typeof mediaJob, n: number) =>
    withAccount(account, () =>
      tenantTx(() =>
        enqueueMany(
          def,
          Array.from({ length: n }, (_, i) => ({ payload: { n: i } })),
        ),
      ),
    );

  it('media (1/tenant): A 20 việc, B 2 việc → A luôn ≤ 1 đang chạy; B bắt đầu trước khi A xong việc thứ 3', async () => {
    await many(a, mediaJob, 20);
    await many(b, mediaJob, 2);
    const max = await sample('media', 4000);
    expect(max.get(a)).toBe(1);
    expect(max.get(b) ?? 0).toBeLessThanOrEqual(1);
    const aEnds = events
      .filter((e) => e.account === a && e.end !== undefined)
      .map((e) => e.end!)
      .sort();
    const bFirst = Math.min(...events.filter((e) => e.account === b).map((e) => e.start));
    expect(aEnds.length).toBeGreaterThanOrEqual(3);
    expect(bFirst).toBeLessThan(aEnds[2]!);
  });

  it('ai_batch (3/tenant): A ≤ 3 đang chạy trên 2 bản', async () => {
    await many(a, aiJob, 20);
    const max = await sample('ai_batch', 3000);
    expect(max.get(a)).toBe(3);
  });

  it('notify (không giới hạn tenant): A chạy được 10 việc đồng thời trên 2 bản (5 + 5)', async () => {
    holdMs = 1500;
    await many(a, notifyJob, 12);
    const max = await sample('notify', 2500);
    expect(max.get(a)).toBe(10);
  });

  it('việc hệ thống trên media không bị chặn khi A đạt giới hạn', async () => {
    holdMs = 1500;
    await many(a, mediaJob, 6);
    await sleep(600); // A đã giữ chỗ duy nhất của mình
    await systemTx(() => enqueue(mediaSystem, { n: 1 }));
    const max = await sample('media', 1500);
    expect(max.get(a)).toBe(1);
    expect(max.get(null)).toBe(1);
  });
});
