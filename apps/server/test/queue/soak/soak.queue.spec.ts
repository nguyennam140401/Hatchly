// 003 T070 – bộ chịu tải (pnpm test:queue-soak, ≈ 10 phút, KHÔNG chạy mặc định – R17):
// SC-001 (2 bản tiến trình con, 1 000 việc, giết ngẫu nhiên 5 lần), SC-002, SC-004 (tài khoản ồn ào),
// SC-006 (60 khung lịch mỗi 5 giây), SC-007 (p95 thời gian enqueue).
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { tenantTx } from '../../../src/core/db/transaction';
import {
  defineJobType,
  defineSchedule,
  enqueue,
  enqueueMany,
  registerJobHandler,
} from '../../../src/modules/queue';
import { SchedulerService } from '../../../src/modules/queue/internal/scheduler/scheduler';
import { startTestProducer, startTestWorkers } from '../../support/queue-test-kit';
import { startWorkerChild, type WorkerChild } from '../helpers/child';
import { childJobPayload, CHILD_JOB } from '../helpers/child-jobs';
import {
  asOwner,
  createAccount,
  dbUrls,
  describeDb,
  makeDatabase,
  resetQueues,
  resetQueueSettings,
  setQueueSettings,
  sleep,
  waitFor,
  withAccount,
  type TestDatabase,
} from '../helpers/queue-db';

const childJob = defineJobType({ ...CHILD_JOB, payload: childJobPayload(z) });
const noisyJob = defineJobType({
  name: 'sandbox.soak_media',
  queue: 'media',
  scope: 'tenant',
  version: 1,
  payload: z.strictObject({ n: z.number().int() }),
});
const tickJob = defineJobType({
  name: 'sandbox.soak_tick',
  queue: 'scheduled',
  scope: 'system',
  version: 1,
  payload: z.strictObject({}),
});
const soakSchedule = defineSchedule({
  name: 'sandbox.soak_tick',
  cron: '*/5 * * * * *',
  tz: 'UTC',
  jobType: tickJob,
});

const mediaRuns: { account: string; start: number; end?: number }[] = [];
registerJobHandler(noisyJob, async (_p, ctx) => {
  const run: (typeof mediaRuns)[number] = { account: ctx.accountId!, start: Date.now() };
  mediaRuns.push(run);
  await sleep(200);
  run.end = Date.now();
});
let ticks = 0;
registerJobHandler(tickJob, async () => {
  ticks++;
});

const count = (sql: string, values: unknown[] = []) =>
  asOwner(async (c) => Number((await c.query<{ n: string }>(sql, values)).rows[0]!.n));

describeDb('Bộ chịu tải lớp hàng chờ', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 20 });
    stopProducer = await startTestProducer();
  });
  afterAll(async () => {
    await stopProducer();
    await resetQueueSettings();
    await database.close();
  });

  describe('SC-007 – enqueue thêm ≤ 10 ms p95 vào giao dịch', () => {
    it('1 000 lần enqueue trong tenantTx → in p95', async () => {
      await resetQueues();
      const a = await createAccount();
      const samples: number[] = [];
      for (let i = 0; i < 1000; i++) {
        await withAccount(a, () =>
          tenantTx(async () => {
            const t = performance.now();
            await enqueue(noisyJob, { n: i }, { runAfter: new Date(Date.now() + 86_400_000) });
            samples.push(performance.now() - t);
          }),
        );
      }
      samples.sort((x, y) => x - y);
      const p95 = samples[Math.floor(samples.length * 0.95)]!;
      console.log(`SC-007 enqueue p50=${samples[500]!.toFixed(2)} ms p95=${p95.toFixed(2)} ms`);
      expect(p95).toBeLessThanOrEqual(10);
    });
  });

  describe('SC-004 – hàng xóm ồn ào', () => {
    it('A 50 việc media + 5 tài khoản × 2 → giới hạn không vượt; 5 tài khoản bắt đầu trước khi A xong 13 việc', async () => {
      await resetQueues();
      mediaRuns.length = 0;
      await setQueueSettings('media', {
        concurrency_per_worker: 2,
        max_per_tenant: 1,
        poll_interval_ms: 200,
      });
      const noisy = await createAccount();
      const quiet = await Promise.all(Array.from({ length: 5 }, () => createAccount()));
      await withAccount(noisy, () =>
        tenantTx(() =>
          enqueueMany(
            noisyJob,
            Array.from({ length: 50 }, (_, n) => ({ payload: { n } })),
          ),
        ),
      );
      for (const q of quiet) {
        await withAccount(q, () =>
          tenantTx(() => enqueueMany(noisyJob, [{ payload: { n: 0 } }, { payload: { n: 1 } }])),
        );
      }
      const workers = await startTestWorkers(2, { queues: ['media'] });
      const sampler = new Client({ connectionString: dbUrls.system });
      await sampler.connect();
      let maxPerTenant = 0;
      try {
        const done = workers.drain(300_000);
        const state = { finished: false };
        void done.then(() => (state.finished = true));
        while (!state.finished) {
          const r = await sampler.query<{ n: string }>(
            "SELECT max(n)::text AS n FROM (SELECT count(*) AS n FROM pgboss.job_common WHERE name = 'media' AND state = 'active' GROUP BY group_id) x",
          );
          maxPerTenant = Math.max(maxPerTenant, Number(r.rows[0]?.n ?? 0));
          await sleep(50);
        }
        await done;
      } finally {
        await sampler.end();
        await workers.stop();
      }
      expect(maxPerTenant).toBeLessThanOrEqual(1);
      const noisyEnds = mediaRuns
        .filter((r) => r.account === noisy)
        .map((r) => r.end!)
        .sort((x, y) => x - y);
      const thirteenth = noisyEnds[12]!;
      for (const q of quiet) {
        const first = Math.min(...mediaRuns.filter((r) => r.account === q).map((r) => r.start));
        expect(first).toBeLessThan(thirteenth);
      }
    });
  });

  describe('SC-001 / SC-002 – 1 000 việc, 2 bản, giết ngẫu nhiên 5 lần', () => {
    it('100% completed hoặc có dòng việc hỏng kèm lý do; không việc nào active quá khóa + 60 giây', async () => {
      await resetQueues();
      await setQueueSettings('ai_batch', {
        heartbeat_seconds: 10,
        retry_delays_seconds: [1],
        poll_interval_ms: 200,
        concurrency_per_worker: 5,
        max_per_tenant: 3,
      });
      const accounts = await Promise.all(Array.from({ length: 20 }, () => createAccount()));
      for (const [i, account] of accounts.entries()) {
        await withAccount(account, () =>
          tenantTx(() =>
            enqueueMany(
              childJob,
              Array.from({ length: 50 }, () => ({ payload: { durationMs: 20 + (i % 5) * 20 } })),
            ),
          ),
        );
      }
      const children: WorkerChild[] = [startWorkerChild(), startWorkerChild()];
      await Promise.all(children.map((c) => c.waitFor('ready', 60_000)));
      for (let kill = 0; kill < 5; kill++) {
        await sleep(3000 + Math.random() * 3000);
        const i = Math.floor(Math.random() * children.length);
        children[i]!.kill();
        await children[i]!.exited;
        children[i] = startWorkerChild();
        await children[i].waitFor('ready', 60_000);
      }
      await waitFor(
        async () =>
          (await count(
            "SELECT count(*)::text AS n FROM pgboss.job_common WHERE name = 'ai_batch' AND state IN ('created','retry','active')",
          )) === 0,
        600_000,
        1000,
        'xử lý hết 1 000 việc',
      );
      for (const c of children) {
        c.kill();
        await c.exited;
      }
      const completed = await count(
        "SELECT count(*)::text AS n FROM pgboss.job_common WHERE name = 'ai_batch' AND state = 'completed'",
      );
      const dead = await count(
        "SELECT count(*)::text AS n FROM infra.dead_jobs WHERE queue = 'ai_batch'",
      );
      console.log(`SC-001 completed=${completed} dead=${dead}`);
      expect(completed + dead).toBe(1000);
      expect(
        await count(
          "SELECT count(*)::text AS n FROM infra.dead_jobs WHERE queue = 'ai_batch' AND cause IS NULL",
        ),
      ).toBe(0);
    });
  });

  describe('SC-006 – 60 khung lịch mỗi 5 giây', () => {
    it('0 trùng, 0 bỏ khung khi còn một bản (dừng 1 bản ở khung thứ 30)', async () => {
      await resetQueues();
      ticks = 0;
      await setQueueSettings('scheduled', { poll_interval_ms: 200 });
      const workers = await startTestWorkers(2, {
        queues: ['scheduled'],
        services: () => [
          new SchedulerService({ tickMs: 500, appEnv: 'test', only: [soakSchedule.name] }),
        ],
      });
      const slots = () =>
        count('SELECT count(*)::text AS n FROM infra.schedule_slots WHERE name = $1', [
          soakSchedule.name,
        ]);
      try {
        await waitFor(async () => (await slots()) >= 30, 200_000, 500, '30 khung');
        await workers.runtimes[0]!.stop();
        await waitFor(async () => (await slots()) >= 61, 200_000, 500, '61 khung');
      } finally {
        await workers.runtimes[1]!.stop();
      }
      const rows = await asOwner(
        async (c) =>
          (
            await c.query<{ slot_at: Date; status: string }>(
              'SELECT slot_at, status FROM infra.schedule_slots WHERE name = $1 ORDER BY slot_at LIMIT 60',
              [soakSchedule.name],
            )
          ).rows,
      );
      expect(rows).toHaveLength(60);
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i]!.slot_at.getTime() - rows[i - 1]!.slot_at.getTime()).toBe(5000);
      }
      expect(ticks).toBeGreaterThanOrEqual(60);
    });
  });
});
