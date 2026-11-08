// 003 T048 – FR-037, Clarifications Q3: xóa mọi việc + việc hỏng của MỘT tài khoản; việc đang chạy bị hủy
// ở nhịp heartbeat kế tiếp, không thử lại, không vào việc hỏng; idempotent; kiểm toán chỉ có số lượng.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { z } from 'zod';
import { systemTx, tenantTx } from '../../src/core/db/transaction';
import {
  defineJobType,
  enqueue,
  PermanentJobError,
  purgeAccountJobs,
  registerJobHandler,
} from '../../src/modules/queue';
import { startTestWorkers, type TestWorkers } from '../support/queue-test-kit';
import {
  asOwner,
  createAccount,
  describeDb,
  jobs,
  makeDatabase,
  resetQueues,
  resetQueueSettings,
  setQueueSettings,
  sleep,
  waitFor,
  withAccount,
  type TestDatabase,
} from './helpers/queue-db';

const P = z.strictObject({ refId: z.uuid(), mode: z.enum(['hold', 'fail']) });
const job = defineJobType({
  name: 'sandbox.purge_probe',
  queue: 'notify',
  scope: 'tenant',
  version: 1,
  payload: P,
});
const running = new Map<string, { aborted: boolean }>();
registerJobHandler(job, async ({ refId, mode }, ctx) => {
  if (mode === 'fail') throw new PermanentJobError('X');
  const state = { aborted: false };
  running.set(refId, state);
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 60_000);
    ctx.signal.addEventListener('abort', () => {
      state.aborted = true;
      clearTimeout(t);
      resolve();
    });
  });
});

const deadCount = (account: string) =>
  asOwner(async (c) =>
    Number(
      (
        await c.query<{ n: string }>(
          'SELECT count(*)::text AS n FROM infra.dead_jobs WHERE account_id = $1',
          [account],
        )
      ).rows[0]!.n,
    ),
  );

describeDb('FR-037 – xóa mọi việc của tài khoản', () => {
  let database: TestDatabase;
  let workers: TestWorkers;
  let a: string;
  let b: string;
  let holdA = '';

  beforeAll(async () => {
    database = makeDatabase();
    a = await createAccount();
    b = await createAccount();
    await resetQueues();
    await setQueueSettings('notify', { poll_interval_ms: 200 });
    workers = await startTestWorkers(1, { queues: ['notify'], heartbeatEveryMs: 300 });
    for (const account of [a, b]) {
      const send = (mode: 'hold' | 'fail', refId = crypto.randomUUID(), runAfter?: Date) =>
        withAccount(account, () =>
          tenantTx(() => enqueue(job, { refId, mode }, runAfter ? { runAfter } : {})),
        );
      // Việc hỏng + việc đang chạy + việc chờ (tương lai) cho mỗi tài khoản.
      await send('fail');
      const refId = crypto.randomUUID();
      if (account === a) holdA = refId;
      await send('hold', refId);
      await send('hold', crypto.randomUUID(), new Date(Date.now() + 3_600_000));
    }
    await waitFor(() => running.size === 2, 20_000, 50, 'hai việc đang chạy');
    await waitFor(async () => (await deadCount(a)) === 1 && (await deadCount(b)) === 1, 20_000);
    // Thêm việc chờ thử lại + đã xong cho mỗi tài khoản (bằng owner).
    await asOwner(async (c) => {
      for (const account of [a, b]) {
        for (const state of ['retry', 'completed']) {
          await c.query(
            `INSERT INTO pgboss.job_common (id, name, data, state, group_id, singleton_key, policy, start_after)
             VALUES (gen_random_uuid(), 'notify', '{"type":"sandbox.purge_probe","v":1,"payload":{}}', $1::pgboss.job_state, $2, $3, 'exclusive', now() + interval '1 hour')`,
            [state, account, `x:${crypto.randomUUID()}`],
          );
        }
      }
    });
  });
  afterAll(async () => {
    for (const r of workers.runtimes) r.abortAll('shutdown');
    await workers.stop();
    await resetQueueSettings();
    await database.close();
  });

  it('purgeAccountJobs() của A → mọi việc + việc hỏng của A mất, của B nguyên; việc đang chạy của A bị hủy, không thử lại', async () => {
    const before = await jobs('group_id = $1', [b]);
    expect(before.length).toBe(4);
    const r = await withAccount(a, () =>
      systemTx(() => purgeAccountJobs(), { tenant: 'from-context' }),
    );
    expect(r).toEqual({ jobs: 4, deadJobs: 1 });
    expect(await jobs('group_id = $1', [a])).toHaveLength(0);
    expect(await deadCount(a)).toBe(0);
    expect((await jobs('group_id = $1', [b])).map((j) => j.state).sort()).toEqual(
      before.map((j) => j.state).sort(),
    );
    expect(await deadCount(b)).toBe(1);

    // Heartbeat kế tiếp báo 0 dòng → bộ xử lý bị hủy; không ghi kết quả, không thử lại, không việc hỏng.
    await waitFor(
      () => running.get(holdA)?.aborted === true,
      10_000,
      50,
      'hủy việc đang chạy của A',
    );
    await sleep(1000);
    expect(await jobs('group_id = $1', [a])).toHaveLength(0);
    expect(await deadCount(a)).toBe(0);
    expect(workers.logs.of('queue.job_aborted').some((e) => e.account_id === a)).toBe(true);
    expect(running.get([...running.keys()].find((k) => k !== holdA)!)?.aborted).toBe(false);
  });

  it('gọi lại → 0, 0 (idempotent); kiểm toán queue.account_jobs_purged chỉ có số lượng', async () => {
    const again = await withAccount(a, () =>
      systemTx(() => purgeAccountJobs(), { tenant: 'from-context' }),
    );
    expect(again).toEqual({ jobs: 0, deadJobs: 0 });
    const rows = await asOwner(
      async (c) =>
        (
          await c.query<{ account_id: string; metadata: Record<string, unknown> }>(
            "SELECT account_id::text, metadata FROM infra.audit_log WHERE action = 'queue.account_jobs_purged' ORDER BY occurred_at",
          )
        ).rows,
    );
    expect(rows.map((x) => x.metadata)).toEqual([
      { jobs: 4, dead_jobs: 1 },
      { jobs: 0, dead_jobs: 0 },
    ]);
    expect(rows.every((x) => x.account_id === a)).toBe(true);
  });

  it('ngoài systemTx from-context → QUEUE_SYSTEM_TENANT_CONTEXT_REQUIRED', async () => {
    const code = expect.objectContaining({ detail: 'QUEUE_SYSTEM_TENANT_CONTEXT_REQUIRED' });
    await expect(purgeAccountJobs()).rejects.toEqual(code);
    await expect(systemTx(() => purgeAccountJobs())).rejects.toEqual(code);
    await expect(withAccount(a, () => tenantTx(() => purgeAccountJobs()))).rejects.toEqual(code);
  });
});
