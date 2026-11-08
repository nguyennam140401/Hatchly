// 003 T034 – US2 AS8, FR-004/005, SC-003: hàng chờ media đầy việc dài không làm chậm việc publish đến giờ.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { z } from 'zod';
import { tenantTx } from '../../src/core/db/transaction';
import { defineJobType, enqueue, enqueueMany, registerJobHandler } from '../../src/modules/queue';
import { startTestWorkers, type TestWorkers } from '../support/queue-test-kit';
import {
  createAccount,
  describeDb,
  makeDatabase,
  resetQueues,
  resetQueueSettings,
  setQueueSettings,
  waitFor,
  withAccount,
  type TestDatabase,
} from './helpers/queue-db';

const P = z.strictObject({ refId: z.uuid() });
const longMedia = defineJobType({
  name: 'sandbox.media_long',
  queue: 'media',
  scope: 'tenant',
  version: 1,
  payload: P,
});
const quickPublish = defineJobType({
  name: 'sandbox.publish_quick',
  queue: 'publish',
  scope: 'tenant',
  version: 1,
  payload: P,
  allowGenericRetry: false,
});

let mediaRunning = 0;
const publishStarted = new Map<string, number>();
registerJobHandler(longMedia, async (_p, ctx) => {
  mediaRunning++;
  // Việc "dài" 60 giây – dừng sớm khi bộ chạy tắt.
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 60_000);
    ctx.signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });
  mediaRunning--;
});
registerJobHandler(quickPublish, async ({ refId }) => {
  publishStarted.set(refId, Date.now());
});

describeDb('SC-003 – ưu tiên publish khi media đầy', () => {
  let database: TestDatabase;
  let workers: TestWorkers;

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 10 });
    await resetQueues();
    // media: 2 chỗ/bản × 2 bản, mỗi tenant tối đa 2 → đầy cả 4 chỗ bằng 2 tài khoản.
    await setQueueSettings('media', { max_per_tenant: 2, poll_interval_ms: 1000 });
    await setQueueSettings('publish', { poll_interval_ms: 1000 });
    workers = await startTestWorkers(2, { queues: ['media', 'publish'], shutdownTimeoutMs: 1000 });
  });
  afterAll(async () => {
    for (const r of workers.runtimes) r.abortAll('shutdown');
    await workers.stop();
    await resetQueueSettings();
    await database.close();
  });

  it('media đầy (4 việc 60 giây đang chạy + 20 chờ) → publish đến giờ bắt đầu ≤ 30 giây (thực tế ≤ 2 giây)', async () => {
    const accounts = [await createAccount(), await createAccount()];
    for (const account of accounts) {
      await withAccount(account, () =>
        tenantTx(() =>
          enqueueMany(
            longMedia,
            Array.from({ length: 12 }, () => ({ payload: { refId: crypto.randomUUID() } })),
          ),
        ),
      );
    }
    await waitFor(() => mediaRunning === 4, 20_000, 50, 'media đầy');

    const refId = crypto.randomUUID();
    const sentAt = Date.now();
    await withAccount(accounts[0], () => tenantTx(() => enqueue(quickPublish, { refId })));
    await waitFor(() => publishStarted.has(refId), 30_000, 20, 'publish bắt đầu');
    const latency = publishStarted.get(refId)! - sentAt;
    expect(latency).toBeLessThanOrEqual(30_000);
    expect(latency).toBeLessThanOrEqual(2_500);
    expect(mediaRunning).toBe(4);
  });
});
