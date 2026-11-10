// 003 T062 – US6 AS1, FR-031: chỉ số theo hàng chờ qua OpenTelemetry API, không nhãn account_id/job_id.
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { z } from 'zod';
import { tenantTx } from '../../src/core/db/transaction';
import {
  defineJobType,
  enqueue,
  PermanentJobError,
  registerJobHandler,
} from '../../src/modules/queue';
import { startTestWorkers, type TestWorkers } from '../support/queue-test-kit';
import {
  asOwner,
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

const P = z.strictObject({ mode: z.enum(['ok', 'retry', 'dead']) });
const mediaJob = defineJobType({
  name: 'sandbox.metric_media',
  queue: 'media',
  scope: 'tenant',
  version: 1,
  payload: P,
});
const publishJob = defineJobType({
  name: 'sandbox.metric_publish',
  queue: 'publish',
  scope: 'tenant',
  version: 1,
  payload: P,
  allowGenericRetry: false,
});
registerJobHandler(mediaJob, async ({ mode }) => {
  if (mode === 'retry') throw new Error('tạm thời');
  if (mode === 'dead') throw new PermanentJobError('HỎNG');
});

interface Point {
  name: string;
  attributes: Record<string, unknown>;
  value: unknown;
}

function points(rm: ResourceMetrics): Point[] {
  const out: Point[] = [];
  for (const scope of rm.scopeMetrics) {
    for (const metric of scope.metrics) {
      for (const dp of metric.dataPoints as {
        attributes: Record<string, unknown>;
        value: unknown;
      }[]) {
        out.push({ name: metric.descriptor.name, attributes: dp.attributes, value: dp.value });
      }
    }
  }
  return out;
}

describeDb('US6 – chỉ số hàng chờ', () => {
  let database: TestDatabase;
  let workers: TestWorkers;
  let reader: PeriodicExportingMetricReader;
  let a: string;

  beforeAll(async () => {
    database = makeDatabase();
    a = await createAccount();
    await resetQueues();
    await setQueueSettings('media', { poll_interval_ms: 200, retry_delays_seconds: [3600] });
    reader = new PeriodicExportingMetricReader({
      exporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
      exportIntervalMillis: 3_600_000,
    });
    const provider = new MeterProvider({ readers: [reader] });
    // Chỉ chạy media – publish không có Worker để đo tuổi chờ.
    workers = await startTestWorkers(1, { queues: ['media'], meterProvider: provider });
  });
  afterAll(async () => {
    await workers.stop();
    await resetQueueSettings();
    await database.close();
  });

  it('sau việc thành công / lỗi / hỏng → đủ chỉ số, nhãn queue, không nhãn account_id/job_id/dedupe_key', async () => {
    for (const mode of ['ok', 'retry', 'dead'] as const) {
      await withAccount(a, () => tenantTx(() => enqueue(mediaJob, { mode })));
    }
    // publish đến giờ từ 6 phút trước, không có Worker publish.
    await withAccount(a, () =>
      tenantTx(() =>
        enqueue(publishJob, { mode: 'ok' }, { runAfter: new Date(Date.now() - 6 * 60_000) }),
      ),
    );
    await waitFor(
      () => workers.logs.of('queue.job_finished').length >= 3,
      20_000,
      50,
      '3 lượt kết thúc',
    );
    await waitFor(
      async () => (await asOwner((c) => c.query('SELECT 1 FROM infra.dead_jobs'))).rowCount === 1,
      10_000,
    );
    await workers.runtimes[0]!.refreshMetricsNow();
    const { resourceMetrics } = await reader.collect();
    const all = points(resourceMetrics);
    const names = new Set(all.map((p) => p.name));
    for (const name of [
      'queue.jobs.waiting',
      'queue.jobs.oldest_wait_seconds',
      'queue.job.duration',
      'queue.jobs.finished',
      'queue.dead_jobs.created',
      'queue.dead_jobs.last_24h',
      'queue.workers.live',
    ]) {
      expect(names, name).toContain(name);
    }
    for (const p of all) {
      for (const banned of ['account_id', 'accountId', 'job_id', 'jobId', 'dedupe_key']) {
        expect(p.attributes, `${p.name} có nhãn ${banned}`).not.toHaveProperty(banned);
      }
      if (p.name !== 'queue.workers.live' && p.name !== 'queue.settings.invalid') {
        expect(p.attributes).toHaveProperty('queue');
      }
    }
    const finished = all.filter(
      (p) => p.name === 'queue.jobs.finished' && p.attributes.queue === 'media',
    );
    expect(finished.map((p) => p.attributes.outcome).sort()).toEqual([
      'completed',
      'dead',
      'retry',
    ]);
    expect(all.find((p) => p.name === 'queue.dead_jobs.created')?.attributes).toMatchObject({
      queue: 'media',
      job_type: 'sandbox.metric_media',
      cause: 'PERMANENT_ERROR',
    });
    expect(
      all.find((p) => p.name === 'queue.dead_jobs.last_24h' && p.attributes.queue === 'media')
        ?.value,
    ).toBe(1);
    expect(all.find((p) => p.name === 'queue.workers.live')?.value).toBe(1);
    const oldest = all.find(
      (p) => p.name === 'queue.jobs.oldest_wait_seconds' && p.attributes.queue === 'publish',
    );
    expect(Number(oldest?.value)).toBeGreaterThan(300);
    expect(
      all.find((p) => p.name === 'queue.jobs.waiting' && p.attributes.queue === 'publish')?.value,
    ).toBe(1);
  });
});
