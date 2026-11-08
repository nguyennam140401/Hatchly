// 003 T031 – SC-002: 2 bản Worker, 500 việc chia 4 hàng chờ → mỗi việc đúng 1 lượt thành công, 0 khoảng
// chồng lấn cho cùng jobId. Hai bản chạy trong cùng tiến trình nên bảng đo là bộ nhớ dùng chung.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { z } from 'zod';
import { tenantTx } from '../../src/core/db/transaction';
import {
  defineJobType,
  enqueueMany,
  registerJobHandler,
  type JobTypeDefinition,
} from '../../src/modules/queue';
import { startTestWorkers, type TestWorkers } from '../support/queue-test-kit';
import {
  createAccount,
  describeDb,
  jobs,
  makeDatabase,
  resetQueues,
  resetQueueSettings,
  setQueueSettings,
  sleep,
  withAccount,
  type TestDatabase,
} from './helpers/queue-db';

const P = z.strictObject({ n: z.number().int() });
const types = (['publish', 'ai_batch', 'notify', 'media'] as const).map((queue) =>
  defineJobType({
    name: `sandbox.count_${queue}`,
    queue,
    scope: 'tenant',
    version: 1,
    payload: P,
    ...(queue === 'publish' ? { allowGenericRetry: false } : {}),
  }),
);

const runs = new Map<string, { start: number; end: number }[]>();
for (const def of types) {
  registerJobHandler(def, async (_payload, ctx) => {
    const start = performance.now();
    await sleep(Math.floor(Math.random() * 15));
    const list = runs.get(ctx.jobId) ?? [];
    list.push({ start, end: performance.now() });
    runs.set(ctx.jobId, list);
  });
}

describeDb('SC-002 – không chạy trùng trên 2 bản', () => {
  let database: TestDatabase;
  let workers: TestWorkers;

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 20 });
    await resetQueues();
    for (const q of ['publish', 'ai_batch', 'notify', 'media']) {
      await setQueueSettings(q, { poll_interval_ms: 200 });
    }
    workers = await startTestWorkers(2, { queues: ['publish', 'ai_batch', 'notify', 'media'] });
  });
  afterAll(async () => {
    await workers.stop();
    await resetQueueSettings();
    await database.close();
  });

  it('500 việc → 500 lượt thành công, mỗi việc 1 lượt, không chồng lấn', async () => {
    const accounts = await Promise.all(Array.from({ length: 10 }, () => createAccount()));
    const ids: string[] = [];
    let n = 0;
    for (const [i, def] of types.entries()) {
      for (let batch = 0; batch < 5; batch++) {
        const account = accounts[(i * 5 + batch) % accounts.length]!;
        const r = await withAccount(account, () =>
          tenantTx(() =>
            enqueueMany(
              def as JobTypeDefinition<{ n: number }>,
              Array.from({ length: 25 }, () => ({ payload: { n: n++ } })),
            ),
          ),
        );
        ids.push(...r.jobIds);
      }
    }
    expect(ids).toHaveLength(500);
    await workers.drain(120_000);

    expect(runs.size).toBe(500);
    for (const id of ids) {
      const list = runs.get(id) ?? [];
      expect(list, `việc ${id}`).toHaveLength(1);
    }
    const all = await jobs();
    expect(all.filter((j) => j.state === 'completed')).toHaveLength(500);
    // Đúng 500 dòng nhật ký kết thúc trên cả hai bản – không lượt thừa nào.
    const finished = workers.logs.of('queue.job_finished');
    expect(finished).toHaveLength(500);
  });
});
