// 003 T047 – US4 AS1–4, AS6, FR-023…025, SC-009, Clarifications Q1: tra cứu việc hỏng qua khung nhìn hỗ
// trợ có kiểm toán; yêu cầu chạy lại một thao tác; publish bị từ chối; cô lập tenant trên dead_jobs.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { z } from 'zod';
import { setActiveDatabase } from '../../src/core/db/database';
import { systemTx, tenantTx } from '../../src/core/db/transaction';
import {
  defineJobType,
  enqueue,
  getDeadJob,
  PermanentJobError,
  registerJobHandler,
  requestDeadJobRetry,
  searchDeadJobs,
} from '../../src/modules/queue';
import { deadJobs } from '../../src/modules/queue/internal/db/schema';
import { processDeadJobRetries } from '../../src/modules/queue/internal/dead-jobs';
import { startTestWorkers, type TestWorkers } from '../support/queue-test-kit';
import {
  asOwner,
  createAccount,
  describeDb,
  jobById,
  jobs,
  makeDatabase,
  resetQueues,
  resetQueueSettings,
  setQueueSettings,
  waitFor,
  withAccount,
  type TestDatabase,
} from './helpers/queue-db';

const P = z.strictObject({ mediaId: z.uuid() });
const mediaJob = defineJobType({
  name: 'sandbox.dead_media',
  queue: 'media',
  scope: 'tenant',
  version: 1,
  payload: P,
});
const systemJob = defineJobType({
  name: 'sandbox.dead_system',
  queue: 'media',
  scope: 'system',
  version: 1,
  payload: P,
});
const publishJob = defineJobType({
  name: 'sandbox.dead_publish',
  queue: 'publish',
  scope: 'tenant',
  version: 1,
  payload: P,
  allowGenericRetry: false,
});
for (const def of [mediaJob, systemJob, publishJob]) {
  registerJobHandler(def, async () => {
    throw new PermanentJobError('GONE');
  });
}

const actor = { staffId: 'staff-007' };
const audit = (action: string) =>
  asOwner(
    async (c) =>
      (
        await c.query<{
          account_id: string | null;
          actor_id: string;
          keyword_type: string | null;
          reason: string | null;
          metadata: Record<string, unknown> | null;
        }>(
          'SELECT account_id::text, actor_id, keyword_type, reason, metadata FROM infra.audit_log WHERE action = $1 ORDER BY occurred_at',
          [action],
        )
      ).rows,
  );

describeDb('US4 – việc hỏng: tra cứu và chạy lại', () => {
  let worker: TestDatabase;
  let api: TestDatabase;
  let workers: TestWorkers;
  let a: string;
  let b: string;
  const dead: Record<'a' | 'b' | 'sys' | 'pub', { id: string; jobId: string; traceId: string }> =
    {} as never;

  beforeAll(async () => {
    api = makeDatabase({ unit: 'api' });
    worker = makeDatabase({ unit: 'worker' });
    a = await createAccount();
    b = await createAccount();
    await resetQueues();
    await setQueueSettings('media', { poll_interval_ms: 200 });
    await setQueueSettings('publish', { poll_interval_ms: 200 });
    workers = await startTestWorkers(1, { queues: ['media', 'publish'] });
    const made = {
      a: await withAccount(a, () =>
        tenantTx(() => enqueue(mediaJob, { mediaId: crypto.randomUUID() })),
      ),
      b: await withAccount(b, () =>
        tenantTx(() => enqueue(mediaJob, { mediaId: crypto.randomUUID() })),
      ),
      sys: await systemTx(() => enqueue(systemJob, { mediaId: crypto.randomUUID() })),
      pub: await withAccount(a, () =>
        tenantTx(() => enqueue(publishJob, { mediaId: crypto.randomUUID() })),
      ),
    };
    await waitFor(
      async () => (await asOwner((c) => c.query('SELECT 1 FROM infra.dead_jobs'))).rowCount === 4,
      30_000,
      100,
      '4 việc hỏng',
    );
    // Dừng Worker: việc chạy lại sau này phải đứng yên ở `created` để kiểm "còn hiệu lực".
    await workers.stop();
    const rows = await asOwner(
      async (c) =>
        (
          await c.query<{ id: string; original_job_id: string; trace_id: string }>(
            'SELECT id::text, original_job_id::text, trace_id FROM infra.dead_jobs',
          )
        ).rows,
    );
    for (const key of ['a', 'b', 'sys', 'pub'] as const) {
      const row = rows.find((r) => r.original_job_id === made[key].jobId)!;
      dead[key] = { id: row.id, jobId: made[key].jobId, traceId: row.trace_id };
    }
  });
  afterAll(async () => {
    await resetQueueSettings();
    await api.close();
    await worker.close();
  });

  it('searchDeadJobs lọc theo hàng chờ/loại/tài khoản/trạng thái; không trả payload/last_error; kiểm toán loại bộ lọc', async () => {
    setActiveDatabase(api.service);
    const media = await searchDeadJobs(actor, { queue: 'media' });
    expect(media.map((r) => r.id).sort()).toEqual([dead.a.id, dead.b.id, dead.sys.id].sort());
    for (const row of media) {
      expect(Object.keys(row).sort()).toEqual(
        [
          'accountId',
          'attempts',
          'cause',
          'failedAt',
          'id',
          'jobType',
          'queue',
          'retriedAt',
          'retryStatus',
        ].sort(),
      );
    }
    expect((await searchDeadJobs(actor, { accountId: a })).map((r) => r.id).sort()).toEqual(
      [dead.a.id, dead.pub.id].sort(),
    );
    expect(await searchDeadJobs(actor, { jobType: 'sandbox.dead_publish' })).toHaveLength(1);
    expect(await searchDeadJobs(actor, { retryStatus: 'requested' })).toHaveLength(0);
    expect(await searchDeadJobs(actor, { failedFrom: new Date(Date.now() + 60_000) })).toHaveLength(
      0,
    );
    const page1 = await searchDeadJobs(actor, { limit: 2 });
    const page2 = await searchDeadJobs(actor, { limit: 2, after: page1[1]!.id });
    expect([...page1, ...page2].map((r) => r.id).sort()).toEqual(
      Object.values(dead)
        .map((d) => d.id)
        .sort(),
    );
    const searches = await audit('support.search');
    expect(searches.length).toBeGreaterThanOrEqual(7);
    expect(
      searches.every((s) => s.keyword_type === 'dead_job_filter' && s.actor_id === 'staff-007'),
    ).toBe(true);
  });

  it('getDeadJob: lý do < 5 ký tự → lỗi; đủ → chi tiết của A (có payload, lỗi đã lược) + kiểm toán view_account', async () => {
    setActiveDatabase(api.service);
    await expect(getDeadJob(actor, a, dead.a.id, 'abc')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    const detail = await getDeadJob(actor, a, dead.a.id, 'khách hỏi lỗi tệp');
    expect(detail).toMatchObject({
      id: dead.a.id,
      accountId: a,
      originalJobId: dead.a.jobId,
      cause: 'PERMANENT_ERROR',
      genericRetryAllowed: true,
      lastError: { code: 'GONE' },
    });
    expect(detail!.payload).toHaveProperty('mediaId');
    // Việc của B không lộ qua tài khoản A.
    expect(await getDeadJob(actor, a, dead.b.id, 'khách hỏi lỗi tệp')).toBeNull();
    const views = await audit('support.view_account');
    expect(views.at(-1)).toMatchObject({ account_id: a, reason: 'khách hỏi lỗi tệp' });
    // Việc hệ thống: xem qua khung nhìn tra cứu (không có dữ liệu việc).
    const sys = await getDeadJob(actor, null, dead.sys.id, 'kiểm tra việc hệ thống');
    expect(sys).toMatchObject({ id: dead.sys.id, accountId: null, payload: null });
  });

  it('requestDeadJobRetry → requested + kiểm toán; Worker thực hiện → việc mới cùng loại/dữ liệu/khóa, retriedFrom, kiểm toán dead_job.retried', async () => {
    setActiveDatabase(api.service);
    expect(await requestDeadJobRetry(actor, dead.a.id, 'khách đã sửa tệp')).toBe('requested');
    expect((await audit('dead_job.retry_requested')).at(-1)).toMatchObject({
      account_id: a,
      actor_id: 'staff-007',
      reason: 'khách đã sửa tệp',
      metadata: { dead_job_id: dead.a.id },
    });
    // Yêu cầu trùng khi còn đang chờ → từ chối, không ghi thêm trạng thái.
    expect(await requestDeadJobRetry(actor, dead.a.id, 'bấm hai lần')).toBe(
      'rejected_already_active',
    );

    setActiveDatabase(worker.service);
    const runtime = (await startTestWorkers(1, { queues: [], enabled: false })).runtimes[0]!;
    try {
      expect(await processDeadJobRetries(runtime)).toEqual({ retried: 1, rejected: 0 });
    } finally {
      await runtime.stop();
    }
    const row = (
      await asOwner((c) =>
        c.query<{
          retry_status: string;
          new_job_id: string;
          retried_at: Date | null;
          dedupe_key: string;
        }>(
          'SELECT retry_status, new_job_id::text, retried_at, dedupe_key FROM infra.dead_jobs WHERE id = $1',
          [dead.a.id],
        ),
      )
    ).rows[0]!;
    expect(row.retry_status).toBe('retried');
    expect(row.retried_at).not.toBeNull();
    const fresh = (await jobById(row.new_job_id))!;
    expect(fresh).toMatchObject({
      name: 'media',
      state: 'created',
      retry_count: 0,
      group_id: a,
      singleton_key: row.dedupe_key,
    });
    expect(fresh.data.type).toBe('sandbox.dead_media');
    expect(fresh.data.retriedFrom).toEqual({ deadJobId: dead.a.id, traceId: dead.a.traceId });
    expect(fresh.data.traceId).not.toBe(dead.a.traceId);
    expect((await audit('dead_job.retried')).at(-1)).toMatchObject({
      account_id: a,
      metadata: { dead_job_id: dead.a.id, new_job_id: row.new_job_id },
    });

    // Yêu cầu lần 2 khi việc mới còn hiệu lực → rejected_already_active, không thêm việc.
    setActiveDatabase(api.service);
    const before = (await jobs()).length;
    expect(await requestDeadJobRetry(actor, dead.a.id, 'lại lần nữa')).toBe(
      'rejected_already_active',
    );
    expect((await jobs()).length).toBe(before);
  });

  it('việc hỏng loại publish → rejected_not_allowed + kiểm toán dead_job.retry_rejected (Q1)', async () => {
    setActiveDatabase(api.service);
    expect(await requestDeadJobRetry(actor, dead.pub.id, 'khách muốn đăng lại')).toBe(
      'rejected_not_allowed',
    );
    expect((await audit('dead_job.retry_rejected')).at(-1)).toMatchObject({
      metadata: { dead_job_id: dead.pub.id, why: 'not_allowed' },
    });
    expect(await requestDeadJobRetry(actor, crypto.randomUUID(), 'không tồn tại')).toBe(
      'not_found',
    );
  });

  it('tenantTx của A không thấy việc hỏng của B (RLS trên infra.dead_jobs)', async () => {
    setActiveDatabase(worker.service);
    const seen = await withAccount(a, () =>
      tenantTx((db) => db.select({ id: deadJobs.id }).from(deadJobs)),
    );
    expect(seen.map((r) => r.id).sort()).toEqual([dead.a.id, dead.pub.id].sort());
    const bFromA = await withAccount(a, () =>
      tenantTx((db) =>
        db.update(deadJobs).set({ attempts: 99 }).where(eq(deadJobs.id, dead.b.id)).returning(),
      ),
    );
    expect(bFromA).toHaveLength(0);
    // systemTx không tenant chỉ thấy việc hỏng của việc hệ thống.
    const sys = await systemTx((db) => db.select({ id: deadJobs.id }).from(deadJobs));
    expect(sys.map((r) => r.id)).toEqual([dead.sys.id]);
  });
});
