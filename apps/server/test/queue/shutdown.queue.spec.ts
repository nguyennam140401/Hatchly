// 003 T033 – US2 AS7, FR-018, SC-008: tắt có kiểm soát. Lệnh dừng (mô phỏng SIGTERM qua IPC – Windows
// không bắt được SIGTERM) → ngừng lấy việc mới ngay; việc ngắn xong rồi thoát mã 0; việc dài → hủy
// AbortSignal, thoát mã 1 trong ≤ 35 giây, việc KHÔNG bị đánh dấu xong và được trả lại sau heartbeat.
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import { tenantTx } from '../../src/core/db/transaction';
import { defineJobType, enqueue } from '../../src/modules/queue';
import { startTestProducer } from '../support/queue-test-kit';
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
  sleep,
  waitFor,
  withAccount,
  type TestDatabase,
} from './helpers/queue-db';

const longJob = defineJobType({ ...CHILD_JOB, payload: childJobPayload(z) });

describeDb('US2 – tắt có kiểm soát', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  let a: string;

  beforeAll(async () => {
    database = makeDatabase();
    stopProducer = await startTestProducer();
    a = await createAccount();
    await setQueueSettings('ai_batch', {
      heartbeat_seconds: 10,
      retry_delays_seconds: [1],
      poll_interval_ms: 200,
    });
  });
  afterAll(async () => {
    await stopProducer();
    await resetQueueSettings();
    await database.close();
  });
  beforeEach(resetQueues);

  const send = (durationMs: number) =>
    withAccount(a, () => tenantTx(() => enqueue(longJob, { durationMs })));

  it('việc 5 giây đang chạy → ngừng lấy việc mới, chờ xong, thoát mã 0', async () => {
    const child = startWorkerChild();
    await child.waitFor('ready', 60_000);
    const { jobId } = await send(5_000);
    await child.waitFor('started', 20_000);

    const stoppedAt = Date.now();
    child.stop();
    await child.waitFor('stopping', 5000);
    // Việc mới tạo sau lệnh dừng KHÔNG được lấy.
    const { jobId: later } = await send(100);
    const exit = await child.exited;
    expect(exit.code).toBe(0);
    expect(exit.at - stoppedAt).toBeLessThan(15_000);
    expect(child.messages.some((m) => m.event === 'handler_done' && m.jobId === jobId)).toBe(true);
    expect((await jobById(jobId))?.state).toBe('completed');
    expect((await jobById(later))?.state).toBe('created');
    expect(child.messages.filter((m) => m.event === 'started')).toHaveLength(1);
  });

  it('việc 60 giây → hủy AbortSignal, thoát mã 1 trong ≤ 35 giây; việc chưa xong, được trả lại sau heartbeat', async () => {
    const child = startWorkerChild({ SHUTDOWN_TIMEOUT_MS: '30000' });
    await child.waitFor('ready', 60_000);
    const { jobId } = await send(60_000);
    await child.waitFor('started', 20_000);

    const stoppedAt = Date.now();
    child.stop();
    const aborted = await child.waitFor('aborted', 35_000);
    expect(aborted).toMatchObject({ jobId });
    expect(String(aborted.reason)).toContain('shutdown');
    const exit = await child.exited;
    expect(exit.code).toBe(1);
    expect(exit.at - stoppedAt).toBeLessThanOrEqual(35_000);

    // Không bao giờ ghi "xong" khi chưa chạy xong.
    const state = (await jobById(jobId))?.state;
    expect(state).not.toBe('completed');
    // Giám sát của một bản khác trả việc về hàng chờ sau heartbeat (10 giây).
    const watcher = startWorkerChild();
    await watcher.waitFor('ready', 60_000);
    await waitFor(
      () => watcher.messages.some((m) => m.event === 'started' && m.jobId === jobId),
      40_000,
      200,
      'trả lại việc',
    );
    expect(watcher.messages.find((m) => m.event === 'started' && m.jobId === jobId)).toMatchObject({
      attempt: 2,
    });
    watcher.kill();
    await watcher.exited;
    await sleep(100);
  });
});
