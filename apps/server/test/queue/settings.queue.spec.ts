// 003 T063 – US6 AS3, FR-006, SC-010: thông số trong infra.queue_settings có hiệu lực ở lần đọc kế tiếp,
// không khởi động lại; CHECK chặn giá trị sai; quy tắc liên cột (Zod) sai → giữ giá trị cũ + cảnh báo.
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { z } from 'zod';
import { tenantTx } from '../../src/core/db/transaction';
import { defineJobType, enqueueMany, registerJobHandler } from '../../src/modules/queue';
import { startTestWorkers, type TestWorkers } from '../support/queue-test-kit';
import {
  asOwner,
  createAccount,
  describeDb,
  makeDatabase,
  resetQueues,
  resetQueueSettings,
  setQueueSettings,
  sleep,
  waitFor,
  withAccount,
  type TestDatabase,
} from './helpers/queue-db';

const aiJob = defineJobType({
  name: 'sandbox.settings_ai',
  queue: 'ai_batch',
  scope: 'tenant',
  version: 1,
  payload: z.strictObject({ n: z.number().int() }),
});
let concurrent = 0;
let maxConcurrent = 0;
registerJobHandler(aiJob, async () => {
  concurrent++;
  maxConcurrent = Math.max(maxConcurrent, concurrent);
  await sleep(400);
  concurrent--;
});

describeDb('US6 – thông số hàng chờ không cần phát hành', () => {
  let database: TestDatabase;
  let workers: TestWorkers;
  let reader: PeriodicExportingMetricReader;
  let accounts: string[];

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 10 });
    await resetQueues();
    accounts = [await createAccount(), await createAccount(), await createAccount()];
    await setQueueSettings('ai_batch', {
      concurrency_per_worker: 5,
      max_per_tenant: 3,
      poll_interval_ms: 200,
    });
    reader = new PeriodicExportingMetricReader({
      exporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
      exportIntervalMillis: 3_600_000,
    });
    workers = await startTestWorkers(1, {
      queues: ['ai_batch'],
      settingsRefreshMs: 1000,
      meterProvider: new MeterProvider({ readers: [reader] }),
    });
  });
  afterAll(async () => {
    await workers.stop();
    await resetQueueSettings();
    await database.close();
  });

  const burst = async () => {
    for (const account of accounts) {
      await withAccount(account, () =>
        tenantTx(() =>
          enqueueMany(
            aiJob,
            Array.from({ length: 3 }, (_, n) => ({ payload: { n } })),
          ),
        ),
      );
    }
  };

  it('đối chứng: 5 chỗ/bản → chạy song song > 1', async () => {
    maxConcurrent = 0;
    await burst();
    await workers.drain(30_000);
    expect(maxConcurrent).toBeGreaterThan(1);
  });

  it('UPDATE concurrency_per_worker = 1 → sau ≤ 2 giây chỉ 1 việc cùng lúc, không khởi động lại', async () => {
    await setQueueSettings('ai_batch', { concurrency_per_worker: 1 });
    await waitFor(
      () => workers.runtimes[0]!.settings.get('ai_batch').concurrencyPerWorker === 1,
      2500,
      50,
      'áp dụng thông số',
    );
    maxConcurrent = 0;
    await burst();
    await workers.drain(30_000);
    expect(maxConcurrent).toBe(1);
    expect(workers.logs.of('queue.settings_applied').some((e) => e.queue === 'ai_batch')).toBe(
      true,
    );
  });

  it('đổi lock_seconds → pgboss.queue.expire_seconds mới (updateQueue)', async () => {
    await setQueueSettings('ai_batch', { lock_seconds: 240 });
    await waitFor(
      async () =>
        (
          await asOwner((c) =>
            c.query<{ expire_seconds: number }>(
              "SELECT expire_seconds FROM pgboss.queue WHERE name = 'ai_batch'",
            ),
          )
        ).rows[0]!.expire_seconds === 240,
      5000,
      100,
      'expire_seconds = 240',
    );
  });

  it('giá trị vi phạm CHECK → CSDL từ chối', async () => {
    await expect(setQueueSettings('ai_batch', { concurrency_per_worker: 0 })).rejects.toMatchObject(
      {
        code: '23514',
      },
    );
    await expect(setQueueSettings('ai_batch', { heartbeat_seconds: 5 })).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('qua CHECK nhưng sai quy tắc Zod (heartbeat × 2 > lock) → giữ giá trị cũ + queue.settings_invalid + bộ đếm', async () => {
    const before = workers.runtimes[0]!.settings.get('ai_batch');
    await setQueueSettings('ai_batch', { lock_seconds: 50, heartbeat_seconds: 30 });
    await waitFor(() => workers.logs.of('queue.settings_invalid').length > 0, 3000, 50, 'cảnh báo');
    expect(workers.logs.of('queue.settings_invalid')[0]).toMatchObject({ queue: 'ai_batch' });
    expect(workers.runtimes[0]!.settings.get('ai_batch')).toEqual(before);
    const { resourceMetrics } = await reader.collect();
    const counter = resourceMetrics.scopeMetrics
      .flatMap((s) => s.metrics)
      .find((m) => m.descriptor.name === 'queue.settings.invalid');
    expect(counter?.dataPoints[0]?.value).toBeGreaterThanOrEqual(1);
  });
});
