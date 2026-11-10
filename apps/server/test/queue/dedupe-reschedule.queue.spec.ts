// 003 T020 – US1 AS3–5, FR-010/011: khóa chống trùng, runAfter, hủy / đổi giờ việc chưa chạy.
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import { tenantTx } from '../../src/core/db/transaction';
import {
  cancelJob,
  defineJobType,
  enqueue,
  registerJobHandler,
  rescheduleJob,
} from '../../src/modules/queue';
import { startTestProducer, startTestWorkers } from '../support/queue-test-kit';
import {
  asOwner,
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

const publishJob = defineJobType({
  name: 'sandbox.publish_attempt',
  queue: 'publish',
  scope: 'tenant',
  version: 1,
  payload: z.strictObject({ attemptId: z.uuid() }),
  allowGenericRetry: false,
});
const ran: string[] = [];
registerJobHandler(publishJob, async ({ attemptId }) => {
  ran.push(attemptId);
});

describeDb('US1 – khóa chống trùng, hủy, đổi giờ', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  let a: string;
  let b: string;

  beforeAll(async () => {
    database = makeDatabase();
    stopProducer = await startTestProducer();
    a = await createAccount();
    b = await createAccount();
    await setQueueSettings('publish', { poll_interval_ms: 200 });
  });
  afterAll(async () => {
    await stopProducer();
    await resetQueueSettings();
    await database.close();
  });
  beforeEach(async () => {
    await resetQueues();
    ran.length = 0;
  });

  const inA = <T>(fn: () => Promise<T>) => withAccount(a, () => tenantTx(fn));
  const setState = (id: string, state: string) =>
    asOwner((c) =>
      c.query(`UPDATE pgboss.job_common SET state = $2::pgboss.job_state WHERE id = $1`, [
        id,
        state,
      ]),
    );

  it('hai lần enqueue cùng dedupeKey → lần 2 { exists, jobId của lần 1, pending }', async () => {
    const attemptId = crypto.randomUUID();
    const key = `publish:${attemptId}`;
    const first = await inA(() => enqueue(publishJob, { attemptId }, { dedupeKey: key }));
    const second = await inA(() => enqueue(publishJob, { attemptId }, { dedupeKey: key }));
    expect(first.status).toBe('created');
    expect(second).toEqual({ status: 'exists', jobId: first.jobId, state: 'pending' });
    await setState(first.jobId, 'retry');
    expect(await inA(() => enqueue(publishJob, { attemptId }, { dedupeKey: key }))).toEqual({
      status: 'exists',
      jobId: first.jobId,
      state: 'retry_wait',
    });
    await setState(first.jobId, 'active');
    expect(await inA(() => enqueue(publishJob, { attemptId }, { dedupeKey: key }))).toEqual({
      status: 'exists',
      jobId: first.jobId,
      state: 'running',
    });
  });

  it('khóa trùng với việc đã completed → tạo việc mới được', async () => {
    const attemptId = crypto.randomUUID();
    const key = `publish:${attemptId}`;
    const first = await inA(() => enqueue(publishJob, { attemptId }, { dedupeKey: key }));
    await setState(first.jobId, 'completed');
    const again = await inA(() => enqueue(publishJob, { attemptId }, { dedupeKey: key }));
    expect(again.status).toBe('created');
    expect(again.jobId).not.toBe(first.jobId);
  });

  it('runAfter +1 giờ → Worker không lấy trong 5 giây', async () => {
    const attemptId = crypto.randomUUID();
    const r = await inA(() =>
      enqueue(publishJob, { attemptId }, { runAfter: new Date(Date.now() + 3_600_000) }),
    );
    const workers = await startTestWorkers(1, { queues: ['publish'] });
    try {
      await sleep(5000);
      expect(ran).toHaveLength(0);
      expect((await jobById(r.jobId))?.state).toBe('created');
      // Đối chứng: việc đến giờ được lấy ngay.
      const now = crypto.randomUUID();
      await inA(() => enqueue(publishJob, { attemptId: now }));
      await waitFor(() => ran.includes(now), 10_000, 50, 'việc đến giờ chạy');
    } finally {
      await workers.stop();
    }
  });

  it('cancelJob / rescheduleJob theo jobId và theo { queue, dedupeKey } khi chờ → thành công', async () => {
    const id1 = crypto.randomUUID();
    const j1 = await inA(() =>
      enqueue(publishJob, { attemptId: id1 }, { dedupeKey: `publish:${id1}` }),
    );
    const at = new Date(Date.now() + 7_200_000);
    expect(await inA(() => rescheduleJob({ jobId: j1.jobId }, at))).toEqual({
      status: 'rescheduled',
      jobId: j1.jobId,
    });
    expect(Math.abs((await jobById(j1.jobId))!.start_after.getTime() - at.getTime())).toBeLessThan(
      1000,
    );
    expect(await inA(() => cancelJob({ queue: 'publish', dedupeKey: `publish:${id1}` }))).toEqual({
      status: 'cancelled',
      jobId: j1.jobId,
    });
    expect((await jobById(j1.jobId))?.state).toBe('cancelled');

    const id2 = crypto.randomUUID();
    const j2 = await inA(() =>
      enqueue(publishJob, { attemptId: id2 }, { dedupeKey: `publish:${id2}` }),
    );
    await setState(j2.jobId, 'retry');
    expect(
      await inA(() => rescheduleJob({ queue: 'publish', dedupeKey: `publish:${id2}` }, at)),
    ).toEqual({ status: 'rescheduled', jobId: j2.jobId });
    expect(await inA(() => cancelJob({ jobId: j2.jobId }))).toEqual({
      status: 'cancelled',
      jobId: j2.jobId,
    });
  });

  it('hủy / đổi giờ trong giao dịch bị hoàn tác → việc không đổi', async () => {
    const id = crypto.randomUUID();
    const j = await inA(() => enqueue(publishJob, { attemptId: id }));
    const before = (await jobById(j.jobId))!;
    await expect(
      inA(async () => {
        await rescheduleJob({ jobId: j.jobId }, new Date(Date.now() + 9_000_000));
        await cancelJob({ jobId: j.jobId });
        throw new Error('hoàn tác');
      }),
    ).rejects.toThrow('hoàn tác');
    const after = (await jobById(j.jobId))!;
    expect(after.state).toBe('created');
    expect(after.start_after.getTime()).toBe(before.start_after.getTime());
  });

  it('việc đã active / completed → not_pending + trạng thái; việc của B nhìn từ A → not_found', async () => {
    const id = crypto.randomUUID();
    const j = await inA(() => enqueue(publishJob, { attemptId: id }));
    await setState(j.jobId, 'active');
    expect(await inA(() => cancelJob({ jobId: j.jobId }))).toEqual({
      status: 'not_pending',
      jobId: j.jobId,
      state: 'running',
    });
    await setState(j.jobId, 'completed');
    expect(await inA(() => rescheduleJob({ jobId: j.jobId }, new Date()))).toEqual({
      status: 'not_pending',
      jobId: j.jobId,
      state: 'completed',
    });

    const idB = crypto.randomUUID();
    const jb = await withAccount(b, () =>
      tenantTx(() => enqueue(publishJob, { attemptId: idB }, { dedupeKey: `publish:${idB}` })),
    );
    expect(await inA(() => cancelJob({ jobId: jb.jobId }))).toEqual({ status: 'not_found' });
    expect(await inA(() => cancelJob({ queue: 'publish', dedupeKey: `publish:${idB}` }))).toEqual({
      status: 'not_found',
    });
    expect((await jobById(jb.jobId))?.state).toBe('created');
    expect(await inA(() => cancelJob({ jobId: 'không-phải-uuid' }))).toEqual({
      status: 'not_found',
    });
  });
});
