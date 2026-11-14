// 008 T068 – R22: loại việc chưa khai báo ở phía xử lý (vd quay về bản cũ) được TRẢ LẠI hàng chờ với giờ chạy
// lùi ~5 phút, KHÔNG tính lượt, KHÔNG vào infra.dead_jobs, có cảnh báo `queue.unknown_job_type`.
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import { systemTx } from '../../src/core/db/transaction';
import { defineJobType, enqueue } from '../../src/modules/queue';
import { startTestProducer, startTestWorkers, type TestWorkers } from '../support/queue-test-kit';
import {
  asOwner,
  describeDb,
  jobById,
  makeDatabase,
  resetQueues,
  resetQueueSettings,
  setQueueSettings,
  waitFor,
  type TestDatabase,
} from './helpers/queue-db';

const futureJob = defineJobType({
  name: 'sandbox.future_job',
  queue: 'notify',
  scope: 'system',
  version: 1,
  payload: z.strictObject({ refId: z.uuid() }),
});

const deadCount = () =>
  asOwner(async (c) =>
    Number(
      (await c.query<{ n: string }>('SELECT count(*)::text AS n FROM infra.dead_jobs')).rows[0]!.n,
    ),
  );

describeDb('R22 – loại việc chưa khai báo', () => {
  let database: TestDatabase;
  let workers: TestWorkers;
  let stopProducer: () => Promise<void>;

  beforeAll(async () => {
    database = makeDatabase();
    stopProducer = await startTestProducer();
    await setQueueSettings('notify', { poll_interval_ms: 200 });
    workers = await startTestWorkers(1, { queues: ['notify'] });
  });
  afterAll(async () => {
    await workers.stop();
    await stopProducer();
    await resetQueueSettings();
    await database.close();
  });
  beforeEach(resetQueues);

  it('việc loại lạ còn trong hàng chờ, giờ chạy lùi ~5 phút, không tính lượt, không chôn, có cảnh báo', async () => {
    // Tạo việc với giờ chạy sau 3 giây để kịp đổi tên loại trước khi Worker lấy.
    const { jobId } = await systemTx(() =>
      enqueue(futureJob, { refId: crypto.randomUUID() }, { runAfter: new Date(Date.now() + 3000) }),
    );
    // Giả lập bản mới đã tạo việc dạng mà bản này không biết: đổi tên loại trong phong bì.
    await asOwner((c) =>
      c.query(
        `UPDATE pgboss.job_common SET data = jsonb_set(data, '{type}', '"sandbox.from_newer_release"')
          WHERE id = $1::uuid AND state = 'created'`,
        [jobId],
      ),
    );
    await waitFor(
      () => workers.logs.of('queue.unknown_job_type').length >= 1,
      30_000,
      100,
      'cảnh báo loại việc lạ',
    );
    await waitFor(
      async () => (await jobById(jobId))?.state === 'retry',
      10_000,
      50,
      'trả lại hàng chờ',
    );

    const job = (await jobById(jobId))!;
    const now = await asOwner(async (c) =>
      (await c.query<{ t: Date }>('SELECT now() AS t')).rows[0]!.t.getTime(),
    );
    const inSeconds = (job.start_after.getTime() - now) / 1000;
    expect(inSeconds).toBeGreaterThan(290);
    expect(inSeconds).toBeLessThanOrEqual(300.5);
    expect(job.retry_count).toBe(0);
    expect(await deadCount()).toBe(0);
    expect(workers.logs.of('queue.unknown_job_type')[0]).toMatchObject({
      job_type: 'sandbox.from_newer_release',
      queue: 'notify',
    });
  });
});
