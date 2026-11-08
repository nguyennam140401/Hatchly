// 003 T019 – US1: tạo việc trong cùng giao dịch (FR-007/008/009/013, SC-005).
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import { getExecutionContext } from '../../src/core/context/request-context';
import { systemTx, tenantTx } from '../../src/core/db/transaction';
import { defineJobType, enqueue, enqueueMany } from '../../src/modules/queue';
import { tenantNotes } from '../db/sandbox/schema';
import { startTestProducer } from '../support/queue-test-kit';
import {
  countByAccount,
  createAccount,
  describeDb,
  jobs,
  makeDatabase,
  resetQueues,
  withAccount,
  type TestDatabase,
} from './helpers/queue-db';

const noteJob = defineJobType({
  name: 'sandbox.note_created',
  queue: 'notify',
  scope: 'tenant',
  version: 1,
  payload: z.strictObject({ noteId: z.uuid() }),
});
const sysJob = defineJobType({
  name: 'sandbox.system_tick',
  queue: 'scheduled',
  scope: 'system',
  version: 1,
  payload: z.strictObject({}),
});

const detail = (code: string) => expect.objectContaining({ detail: code });

describeDb('US1 – tạo việc trong giao dịch', () => {
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
  beforeEach(resetQueues);

  it('hoàn tác (ném trong fn) → không dòng nghiệp vụ, không việc – lặp 200 lần (SC-005)', async () => {
    for (let i = 0; i < 200; i++) {
      await expect(
        withAccount(a, () =>
          tenantTx(async (db) => {
            const [note] = await db
              .insert(tenantNotes)
              .values({ account_id: a, title: `t${i}` })
              .returning();
            await enqueue(noteJob, { noteId: note!.id });
            throw new Error('hoàn tác');
          }),
        ),
      ).rejects.toThrow('hoàn tác');
    }
    expect(await jobs()).toHaveLength(0);
    expect((await countByAccount('sandbox.tenant_notes'))[a] ?? 0).toBe(0);
  });

  it('xác nhận → việc ở đúng hàng chờ, data.accountId = A = group_id, traceId của ngữ cảnh', async () => {
    let traceId = '';
    const result = await withAccount(a, () =>
      tenantTx(async (db) => {
        traceId = getExecutionContext()!.traceId;
        const [note] = await db.insert(tenantNotes).values({ account_id: a, title: 'ok' }).returning();
        return enqueue(noteJob, { noteId: note!.id });
      }),
    );
    expect(result.status).toBe('created');
    const [job] = await jobs();
    expect(job).toMatchObject({
      id: result.jobId,
      name: 'notify',
      state: 'created',
      group_id: a,
      priority: 0,
    });
    expect(job!.data).toMatchObject({ type: 'sandbox.note_created', v: 1, accountId: a, traceId });
    expect(job!.singleton_key).toBe(`sandbox.note_created:${result.jobId}`);
  });

  it('ngoài giao dịch → QUEUE_TX_REQUIRED', async () => {
    await expect(
      withAccount(a, () => enqueue(noteJob, { noteId: crypto.randomUUID() })),
    ).rejects.toEqual(detail('QUEUE_TX_REQUIRED'));
  });

  it('loại tenant trong systemTx không tenant → QUEUE_TENANT_CONTEXT_REQUIRED', async () => {
    await expect(
      systemTx(() => enqueue(noteJob, { noteId: crypto.randomUUID() })),
    ).rejects.toEqual(detail('QUEUE_TENANT_CONTEXT_REQUIRED'));
  });

  it('loại system trong tenantTx → QUEUE_SYSTEM_CONTEXT_REQUIRED; trong systemTx → không nhóm', async () => {
    await expect(withAccount(a, () => tenantTx(() => enqueue(sysJob, {})))).rejects.toEqual(
      detail('QUEUE_SYSTEM_CONTEXT_REQUIRED'),
    );
    const r = await systemTx(() => enqueue(sysJob, {}));
    expect(r.status).toBe('created');
    const [job] = await jobs();
    expect(job).toMatchObject({ name: 'scheduled', group_id: null });
    expect(job!.data.accountId).toBeNull();
  });

  it('loại tenant trong systemTx from-context → việc mang tài khoản của ngữ cảnh', async () => {
    await withAccount(a, () =>
      systemTx(() => enqueue(noteJob, { noteId: crypto.randomUUID() }), { tenant: 'from-context' }),
    );
    expect((await jobs())[0]).toMatchObject({ group_id: a });
  });

  it('enqueueMany 10 việc rồi hoàn tác → 0; xác nhận → 10 việc một lô', async () => {
    const items = () => Array.from({ length: 10 }, () => ({ payload: { noteId: crypto.randomUUID() } }));
    await expect(
      withAccount(a, () =>
        tenantTx(async () => {
          await enqueueMany(noteJob, items());
          throw new Error('hoàn tác');
        }),
      ),
    ).rejects.toThrow('hoàn tác');
    expect(await jobs()).toHaveLength(0);
    const r = await withAccount(a, () => tenantTx(() => enqueueMany(noteJob, items())));
    expect(r.jobIds).toHaveLength(10);
    expect((await jobs()).map((j) => j.id).sort()).toEqual([...r.jobIds].sort());
  });

  it('enqueueMany trùng khóa trong lô / khóa đã có việc hiệu lực → QUEUE_DUPLICATE_IN_BATCH, 0 việc mới', async () => {
    const id = crypto.randomUUID();
    await expect(
      withAccount(a, () =>
        tenantTx(() =>
          enqueueMany(noteJob, [
            { payload: { noteId: id }, opts: { dedupeKey: `note:${id}` } },
            { payload: { noteId: id }, opts: { dedupeKey: `note:${id}` } },
          ]),
        ),
      ),
    ).rejects.toEqual(detail('QUEUE_DUPLICATE_IN_BATCH'));
    expect(await jobs()).toHaveLength(0);

    await withAccount(a, () =>
      tenantTx(() => enqueue(noteJob, { noteId: id }, { dedupeKey: `note:${id}` })),
    );
    await expect(
      withAccount(a, () =>
        tenantTx(() =>
          enqueueMany(noteJob, [
            { payload: { noteId: crypto.randomUUID() } },
            { payload: { noteId: id }, opts: { dedupeKey: `note:${id}` } },
          ]),
        ),
      ),
    ).rejects.toEqual(detail('QUEUE_DUPLICATE_IN_BATCH'));
    expect(await jobs()).toHaveLength(1);
  });

  it('enqueueMany > 100 việc → QUEUE_BATCH_TOO_LARGE', async () => {
    const items = Array.from({ length: 101 }, () => ({ payload: { noteId: crypto.randomUUID() } }));
    await expect(withAccount(a, () => tenantTx(() => enqueueMany(noteJob, items)))).rejects.toEqual(
      detail('QUEUE_BATCH_TOO_LARGE'),
    );
  });
});
