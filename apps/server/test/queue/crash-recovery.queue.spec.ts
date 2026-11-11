// 003 T032 – US2 AS6, FR-017, SC-001 (thu nhỏ): Worker bị SIGKILL giữa việc → sau ≤ heartbeat + 60 giây
// việc được bản khác chạy lại, retry_count tăng 1; lượt cũ không ghi được kết quả.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { z } from 'zod';
import { tenantTx } from '../../src/core/db/transaction';
import { defineJobType, enqueue, registerJobHandler } from '../../src/modules/queue';
import { startTestProducer, startTestWorkers, type TestWorkers } from '../support/queue-test-kit';
import { startWorkerChild } from './helpers/child';
import { childJobPayload, CHILD_JOB } from './helpers/child-jobs';
import {
  createAccount,
  describeDb,
  jobById,
  makeDatabase,
  resetQueues,
  resetQueueSettings,
  setQueueSettings,
  waitFor,
  withAccount,
  type TestDatabase,
} from './helpers/queue-db';

const longJob = defineJobType({ ...CHILD_JOB, payload: childJobPayload(z) });
const reruns: { jobId: string; attempt: number }[] = [];
registerJobHandler(longJob, async (_p, ctx) => {
  reruns.push({ jobId: ctx.jobId, attempt: ctx.attempt });
});

describeDb('US2 – Worker chết giữa chừng', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  let workers: TestWorkers | undefined;
  let a: string;

  beforeAll(async () => {
    database = makeDatabase();
    stopProducer = await startTestProducer();
    a = await createAccount();
    await resetQueues();
    // Heartbeat tối thiểu 10 giây; thử lại ngay (1 giây) sau khi monitor trả việc.
    await setQueueSettings('ai_batch', {
      heartbeat_seconds: 10,
      retry_delays_seconds: [1],
      poll_interval_ms: 200,
    });
  });
  afterAll(async () => {
    await workers?.stop();
    await stopProducer();
    await resetQueueSettings();
    await database.close();
  });

  it('SIGKILL khi đang chạy → monitor trả việc sau heartbeat, bản khác chạy lại (retry_count + 1)', async () => {
    const child = startWorkerChild();
    await child.waitFor('ready', 60_000);
    const { jobId } = await withAccount(a, () =>
      tenantTx(() => enqueue(longJob, { durationMs: 120_000 })),
    );
    const started = await child.waitFor('started', 30_000);
    expect(started).toMatchObject({ jobId, attempt: 1 });

    child.kill();
    const exit = await child.exited;
    expect(exit.signal ?? exit.code).toBeTruthy();
    const killedAt = exit.at;

    // "Bản trong tiến trình chính" bật SAU khi bản con chết – không thể giành việc trước.
    workers = await startTestWorkers(1, { queues: ['ai_batch'] });
    await waitFor(() => reruns.some((r) => r.jobId === jobId), 75_000, 100, 'chạy lại');
    const recoveredIn = Date.now() - killedAt;
    expect(recoveredIn).toBeLessThanOrEqual((10 + 60) * 1000);
    expect(reruns.find((r) => r.jobId === jobId)).toEqual({ jobId, attempt: 2 });

    await waitFor(async () => (await jobById(jobId))?.state === 'completed', 10_000);
    const job = (await jobById(jobId))!;
    expect(job.retry_count).toBe(1);
    // Không có lượt nào khác: đúng một lần chạy lại thành công.
    expect(reruns.filter((r) => r.jobId === jobId)).toHaveLength(1);
  });
});
