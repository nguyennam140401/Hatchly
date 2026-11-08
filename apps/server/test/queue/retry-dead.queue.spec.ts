// 003 T030 – US2 AS3–5, FR-015/016/020, Clarifications Q2: giãn cách thử lại, retryAfter, noRetry,
// PermanentJobError, không có bộ xử lý, dữ liệu sai khuôn lúc xử lý, onFinalFailure.
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import { getExecutionContext } from '../../src/core/context/request-context';
import { tenantTx } from '../../src/core/db/transaction';
import {
  defineJobType,
  enqueue,
  noRetry,
  PermanentJobError,
  registerJobHandler,
  retryAfter,
} from '../../src/modules/queue';
import { startTestWorkers, type TestWorkers } from '../support/queue-test-kit';
import {
  asOwner,
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

interface DeadRow {
  id: string;
  account_id: string | null;
  original_job_id: string;
  cause: string;
  attempts: number;
  job_type: string;
  dedupe_key: string;
  generic_retry_allowed: boolean;
  final_failure_notified: boolean;
  last_error: { name: string; code?: string; message: string };
}
const deadJobs = () =>
  asOwner(async (c) => (await c.query<DeadRow>('SELECT * FROM infra.dead_jobs ORDER BY failed_at')).rows);

const behaviour = new Map<string, 'throw' | 'permanent' | 'no_retry' | 'retry_after_2' | 'ok'>();
const calls = new Map<string, number>();
const finalFailures: { refId: string; accountId: string | undefined; cause: string; attempts: number }[] = [];

const P = z.strictObject({ refId: z.uuid() });
const mediaJob = defineJobType({ name: 'sandbox.media_flaky', queue: 'media', scope: 'tenant', version: 1, payload: P });
const slowRetryJob = defineJobType({
  name: 'sandbox.media_slow_retry',
  queue: 'media',
  scope: 'tenant',
  version: 1,
  payload: P,
  retry: { delaysSeconds: [10] },
});
const publishJob = defineJobType({
  name: 'sandbox.publish_flaky',
  queue: 'publish',
  scope: 'tenant',
  version: 1,
  payload: P,
  allowGenericRetry: false,
});
const orphanJob = defineJobType({
  name: 'sandbox.media_orphan',
  queue: 'media',
  scope: 'tenant',
  version: 1,
  payload: P,
});

const handler = async ({ refId }: { refId: string }) => {
  calls.set(refId, (calls.get(refId) ?? 0) + 1);
  switch (behaviour.get(refId)) {
    case 'throw':
      throw Object.assign(new Error('nền tảng lỗi tạm thời postgres://u:p@h/db'), { code: 'TEMP_DOWN' });
    case 'permanent':
      throw new PermanentJobError('MEDIA_GONE', 'Tệp đã bị xóa');
    case 'no_retry':
      return noRetry('AI_BUDGET_EXHAUSTED');
    case 'retry_after_2':
      return retryAfter(2);
    default:
      return undefined;
  }
};
const onFinalFailure = async ({ refId }: { refId: string }, info: { cause: string; attempts: number }) => {
  finalFailures.push({ refId, accountId: getExecutionContext()?.accountId, cause: info.cause, attempts: info.attempts });
};
registerJobHandler(mediaJob, handler, { onFinalFailure });
registerJobHandler(slowRetryJob, handler);
registerJobHandler(publishJob, handler);
// orphanJob: CỐ Ý không đăng ký bộ xử lý (Q2).

describeDb('US2 – thử lại và việc hỏng', () => {
  let database: TestDatabase;
  let workers: TestWorkers;
  let a: string;

  const send = (def: typeof mediaJob, refId: string) =>
    withAccount(a, () => tenantTx(() => enqueue(def, { refId })));
  /** Giờ CSDL hiện tại tính bằng mili giây. */
  const dbNow = () => asOwner(async (c) => (await c.query<{ t: Date }>('SELECT now() AS t')).rows[0]!.t.getTime());

  beforeAll(async () => {
    database = makeDatabase();
    a = await createAccount();
    await setQueueSettings('media', { retry_delays_seconds: [1, 2, 3], max_retries: 3, poll_interval_ms: 200 });
    await setQueueSettings('publish', { retry_delays_seconds: [7], poll_interval_ms: 200 });
    workers = await startTestWorkers(1, { queues: ['media', 'publish'] });
  });
  afterAll(async () => {
    await workers.stop();
    await resetQueueSettings();
    await database.close();
  });
  beforeEach(async () => {
    await resetQueues();
    behaviour.clear();
    calls.clear();
    finalFailures.length = 0;
  });

  it('lỗi tạm → retry, start_after trong [delay × 0.8, delay × 1.2] (giãn cách theo mảng + ngẫu nhiên)', async () => {
    const refId = crypto.randomUUID();
    behaviour.set(refId, 'throw');
    const { jobId } = await send(slowRetryJob, refId);
    await waitFor(async () => (await jobById(jobId))?.state === 'retry', 20_000, 50, 'chuyển retry');
    const now = await dbNow();
    const job = (await jobById(jobId))!;
    const inSeconds = (job.start_after.getTime() - now) / 1000;
    expect(inSeconds).toBeGreaterThan(10 * 0.8 - 1);
    expect(inSeconds).toBeLessThanOrEqual(10 * 1.2);
    expect(job.retry_count).toBe(0);
    expect(job.output).toMatchObject({ outcome: 'retry', error: { code: 'TEMP_DOWN' } });
    expect(JSON.stringify(job.output)).not.toContain('u:p@h');
  });

  it('retryAfter(2) → thử lại đúng sau ~2 giây (theo bộ xử lý, không theo mảng)', async () => {
    const refId = crypto.randomUUID();
    behaviour.set(refId, 'retry_after_2');
    const { jobId } = await send(slowRetryJob, refId);
    await waitFor(async () => (await jobById(jobId))?.state === 'retry', 20_000, 50, 'chuyển retry');
    const inSeconds = ((await jobById(jobId))!.start_after.getTime() - (await dbNow())) / 1000;
    expect(inSeconds).toBeGreaterThan(0.5);
    expect(inSeconds).toBeLessThanOrEqual(2.1);
  });

  it('hết lượt → đúng 1 dòng việc hỏng RETRIES_EXHAUSTED, việc pg-boss bị xóa, onFinalFailure 1 lần trong ngữ cảnh A', async () => {
    const refId = crypto.randomUUID();
    behaviour.set(refId, 'throw');
    const { jobId } = await send(mediaJob, refId);
    await waitFor(async () => (await deadJobs()).length === 1, 40_000, 100, 'chôn việc');
    await waitFor(() => finalFailures.length === 1, 5000);
    const [dead] = await deadJobs();
    expect(dead).toMatchObject({
      account_id: a,
      original_job_id: jobId,
      cause: 'RETRIES_EXHAUSTED',
      attempts: 4,
      job_type: 'sandbox.media_flaky',
      dedupe_key: `sandbox.media_flaky:${jobId}`,
      generic_retry_allowed: true,
      final_failure_notified: true,
    });
    expect(dead!.last_error).toMatchObject({ code: 'TEMP_DOWN' });
    expect(dead!.last_error.message).not.toContain('u:p@h');
    expect(calls.get(refId)).toBe(4);
    expect(await jobById(jobId)).toBeUndefined();
    expect(finalFailures).toEqual([{ refId, accountId: a, cause: 'RETRIES_EXHAUSTED', attempts: 4 }]);
  });

  it('PermanentJobError → chôn ngay PERMANENT_ERROR (1 lượt)', async () => {
    const refId = crypto.randomUUID();
    behaviour.set(refId, 'permanent');
    await send(mediaJob, refId);
    await waitFor(async () => (await deadJobs()).length === 1, 20_000, 50, 'chôn việc');
    expect((await deadJobs())[0]).toMatchObject({ cause: 'PERMANENT_ERROR', attempts: 1 });
    expect((await deadJobs())[0]!.last_error).toMatchObject({ code: 'MEDIA_GONE' });
    expect(calls.get(refId)).toBe(1);
  });

  it('noRetry → completed, output.outcome = no_retry, không có việc hỏng', async () => {
    const refId = crypto.randomUUID();
    behaviour.set(refId, 'no_retry');
    const { jobId } = await send(mediaJob, refId);
    await waitFor(async () => (await jobById(jobId))?.state === 'completed', 20_000, 50, 'hoàn tất');
    expect((await jobById(jobId))!.output).toEqual({ outcome: 'no_retry', reason: 'AI_BUDGET_EXHAUSTED' });
    expect(await deadJobs()).toHaveLength(0);
  });

  it("hàng chờ retry_mode = 'handler' (publish): lỗi thường → retry_delays_seconds[1], không ngẫu nhiên", async () => {
    const refId = crypto.randomUUID();
    behaviour.set(refId, 'throw');
    const { jobId } = await send(publishJob, refId);
    await waitFor(async () => (await jobById(jobId))?.state === 'retry', 20_000, 50, 'chuyển retry');
    const inSeconds = ((await jobById(jobId))!.start_after.getTime() - (await dbNow())) / 1000;
    expect(inSeconds).toBeGreaterThan(5.5);
    expect(inSeconds).toBeLessThanOrEqual(7.05);
    expect((await jobById(jobId))!.priority).toBe(10);
  });

  it('loại việc không có bộ xử lý → tính lượt, hết lượt → NO_HANDLER (Q2)', async () => {
    const { jobId } = await send(orphanJob, crypto.randomUUID());
    await waitFor(async () => (await deadJobs()).length === 1, 40_000, 100, 'chôn việc');
    expect((await deadJobs())[0]).toMatchObject({ original_job_id: jobId, cause: 'NO_HANDLER', attempts: 4 });
  });

  it('dữ liệu sai khuôn lúc xử lý → lỗi tạm, hết lượt → PAYLOAD_INVALID', async () => {
    const refId = crypto.randomUUID();
    const { jobId } = await send(mediaJob, refId);
    // Giả lập dữ liệu cũ/hỏng: sửa thẳng trong bảng (bằng owner).
    await asOwner((c) =>
      c.query(
        `UPDATE pgboss.job_common SET data = jsonb_set(data, '{payload}', '{"refId": 42}'::jsonb) WHERE id = $1`,
        [jobId],
      ),
    );
    await waitFor(async () => (await deadJobs()).length === 1, 40_000, 100, 'chôn việc');
    expect((await deadJobs())[0]).toMatchObject({ cause: 'PAYLOAD_INVALID', attempts: 4 });
    expect(calls.get(refId)).toBeUndefined();
  });
});
