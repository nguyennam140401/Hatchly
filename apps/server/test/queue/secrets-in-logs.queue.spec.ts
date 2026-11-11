// 003 T069 – SC-011, hiến pháp VII: nhật ký của lớp hàng chờ + infra.dead_jobs.last_error KHÔNG chứa chuỗi
// kết nối, mã Bearer, access_token, mật khẩu, payload đầy đủ hay trường bị cấm.
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

const SECRET_CONN = 'postgres://u:SuperSecretPw@db.internal:5432/app';
const BEARER = 'Bearer abcDEF123.ghiJKL456-mno';
const TOKEN = 'access_token=EAAGm0PX4ZCpsBA1234567890abcdef';
const PASSWORD = 'password=hunter2xyz';
const MARKER = 987654321;

const P = z.strictObject({ attemptId: z.uuid(), retryBudget: z.number().int() });
const leaky = defineJobType({
  name: 'sandbox.leaky',
  queue: 'notify',
  scope: 'tenant',
  version: 1,
  payload: P,
});
const leakyFatal = defineJobType({
  name: 'sandbox.leaky_fatal',
  queue: 'notify',
  scope: 'tenant',
  version: 1,
  payload: P,
});
registerJobHandler(leaky, async () => {
  throw Object.assign(
    new Error(`gọi nền tảng lỗi: ${SECRET_CONN} ${BEARER} ?${TOKEN}&x=1 ${PASSWORD}`),
    {
      code: 'UPSTREAM',
    },
  );
});
registerJobHandler(leakyFatal, async () => {
  throw new PermanentJobError('FATAL', `hỏng hẳn ${SECRET_CONN} ${BEARER} ${TOKEN} ${PASSWORD}`);
});

describeDb('SC-011 – không lộ bí mật trong nhật ký / việc hỏng', () => {
  let database: TestDatabase;
  let workers: TestWorkers;
  let a: string;

  beforeAll(async () => {
    database = makeDatabase();
    a = await createAccount();
    await resetQueues();
    await setQueueSettings('notify', {
      poll_interval_ms: 200,
      retry_delays_seconds: [1],
      max_retries: 1,
    });
    workers = await startTestWorkers(1, { queues: ['notify'] });
  });
  afterAll(async () => {
    await workers.stop();
    await resetQueueSettings();
    await database.close();
  });

  it('lỗi chứa chuỗi kết nối / Bearer / access_token / mật khẩu → nhật ký và last_error đã lược', async () => {
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    await withAccount(a, () =>
      tenantTx(() => enqueue(leaky, { attemptId: ids[0]!, retryBudget: MARKER })),
    );
    await withAccount(a, () =>
      tenantTx(() => enqueue(leakyFatal, { attemptId: ids[1]!, retryBudget: MARKER })),
    );
    await waitFor(
      async () => (await asOwner((c) => c.query('SELECT 1 FROM infra.dead_jobs'))).rowCount === 2,
      30_000,
      100,
      '2 việc hỏng',
    );
    const lastErrors = await asOwner(
      async (c) =>
        (await c.query<{ last_error: unknown }>('SELECT last_error FROM infra.dead_jobs')).rows,
    );
    const haystack = JSON.stringify(workers.logs.entries) + JSON.stringify(lastErrors);
    for (const leaked of [
      'SuperSecretPw',
      'u:SuperSecretPw@db.internal',
      'abcDEF123.ghiJKL456-mno',
      'EAAGm0PX4ZCpsBA1234567890abcdef',
      'hunter2xyz',
      'postgres://',
    ]) {
      expect(haystack, leaked).not.toContain(leaked);
    }
    // Payload đầy đủ không bao giờ vào nhật ký – chỉ trường *Id (payload_ref).
    expect(JSON.stringify(workers.logs.entries)).not.toContain(String(MARKER));
    const finished = workers.logs.of('queue.job_finished');
    expect(finished.length).toBeGreaterThanOrEqual(3);
    for (const line of finished) {
      expect(Object.keys(line.payload_ref as object)).toEqual(['attemptId']);
      expect(line).not.toHaveProperty('payload');
    }
    expect(haystack).toContain('[đã che]');
  });
});
