// 005 T015 (research R9a): enqueueRegistered – tạo việc theo TÊN loại việc đã đăng ký, trong giao dịch.
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import { tenantTx } from '../../src/core/db/transaction';
import { defineJobType } from '../../src/modules/queue';
import { enqueueRegistered } from '../../src/modules/queue/enqueue-registered';
import { queueErrorCode } from '../../src/modules/queue/internal/errors';
import { startTestProducer } from '../support/queue-test-kit';
import {
  createAccount,
  describeDb,
  jobs,
  makeDatabase,
  resetQueues,
  withAccount,
  type TestDatabase,
} from './helpers/queue-db';

defineJobType({
  name: 'sandbox.registered_notice',
  queue: 'notify',
  scope: 'tenant',
  version: 1,
  payload: z.strictObject({ refId: z.uuid() }),
});

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  return p.then(
    () => undefined,
    (err: unknown) => queueErrorCode(err),
  );
}

describeDb('enqueueRegistered (005 R9a)', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  let a: string;

  beforeAll(async () => {
    database = makeDatabase();
    stopProducer = await startTestProducer();
    a = await createAccount();
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });
  beforeEach(async () => {
    await resetQueues();
  });

  it('loại việc đã đăng ký → tạo việc trong giao dịch, mang tài khoản của giao dịch', async () => {
    const refId = crypto.randomUUID();
    const r = await withAccount(a, () =>
      tenantTx((tx) => enqueueRegistered(tx, 'sandbox.registered_notice', { refId })),
    );
    expect(r.status).toBe('created');
    const rows = await jobs("data->>'type' = 'sandbox.registered_notice'");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('notify');
    expect(rows[0]?.data.accountId).toBe(a);
    expect(rows[0]?.data.payload).toEqual({ refId });
  });

  it('giao dịch hủy → không có việc', async () => {
    await withAccount(a, () =>
      tenantTx(async (tx) => {
        await enqueueRegistered(tx, 'sandbox.registered_notice', { refId: crypto.randomUUID() });
        throw new Error('hủy');
      }),
    ).catch(() => undefined);
    expect(await jobs("data->>'type' = 'sandbox.registered_notice'")).toHaveLength(0);
  });

  it('chưa đăng ký → QUEUE_JOB_TYPE_UNKNOWN', async () => {
    expect(
      await codeOf(
        withAccount(a, () =>
          tenantTx((tx) => enqueueRegistered(tx, 'sandbox.not_registered', { refId: 'x' })),
        ),
      ),
    ).toBe('QUEUE_JOB_TYPE_UNKNOWN');
  });

  it('dữ liệu sai khuôn → QUEUE_PAYLOAD_INVALID', async () => {
    expect(
      await codeOf(
        withAccount(a, () =>
          tenantTx((tx) =>
            enqueueRegistered(tx, 'sandbox.registered_notice', { refId: 'không-phải-uuid' }),
          ),
        ),
      ),
    ).toBe('QUEUE_PAYLOAD_INVALID');
    expect(
      await codeOf(
        withAccount(a, () =>
          tenantTx((tx) =>
            enqueueRegistered(tx, 'sandbox.registered_notice', {
              refId: crypto.randomUUID(),
              extra: 1,
            }),
          ),
        ),
      ),
    ).toBe('QUEUE_PAYLOAD_INVALID');
  });

  it('ngoài giao dịch hoặc tx không phải giao dịch đang mở → QUEUE_TX_REQUIRED', async () => {
    let stale: Parameters<typeof enqueueRegistered>[0] | undefined;
    await withAccount(a, () =>
      tenantTx(async (tx) => {
        stale = tx;
      }),
    );
    expect(
      await codeOf(
        withAccount(a, () =>
          enqueueRegistered(stale!, 'sandbox.registered_notice', { refId: crypto.randomUUID() }),
        ),
      ),
    ).toBe('QUEUE_TX_REQUIRED');
    expect(
      await codeOf(
        withAccount(a, () =>
          tenantTx(() =>
            enqueueRegistered(stale!, 'sandbox.registered_notice', {
              refId: crypto.randomUUID(),
            }),
          ),
        ),
      ),
    ).toBe('QUEUE_TX_REQUIRED');
  });
});
