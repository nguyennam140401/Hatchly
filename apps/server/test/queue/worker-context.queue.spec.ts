// 003 T029 – US2 AS1–2, FR-014, FR-033: bộ xử lý chạy đúng ngữ cảnh tenant / hệ thống; nhật ký đủ trường.
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import { getExecutionContext } from '../../src/core/context/request-context';
import { systemTx, tenantTx } from '../../src/core/db/transaction';
import { defineJobType, enqueue, registerJobHandler } from '../../src/modules/queue';
import { tenantNotes } from '../db/sandbox/schema';
import { startTestWorkers, type TestWorkers } from '../support/queue-test-kit';
import {
  createAccount,
  describeDb,
  makeDatabase,
  resetQueues,
  seedNotes,
  waitFor,
  withAccount,
  type TestDatabase,
} from './helpers/queue-db';

interface Seen {
  accountId: string | undefined;
  traceId: string | undefined;
  noteAccounts?: string[];
  tenantTxError?: string;
}
const seen = new Map<string, Seen>();

const readNotes = defineJobType({
  name: 'sandbox.read_notes',
  queue: 'notify',
  scope: 'tenant',
  version: 1,
  payload: z.strictObject({ probeId: z.uuid() }),
});
const systemProbe = defineJobType({
  name: 'sandbox.system_probe',
  queue: 'notify',
  scope: 'system',
  version: 1,
  payload: z.strictObject({ probeId: z.uuid() }),
});

registerJobHandler(readNotes, async ({ probeId }) => {
  const ctx = getExecutionContext();
  const rows = await tenantTx((db) => db.select().from(tenantNotes));
  seen.set(probeId, {
    accountId: ctx?.accountId,
    traceId: ctx?.traceId,
    noteAccounts: [...new Set(rows.map((r) => r.account_id))],
  });
});
registerJobHandler(systemProbe, async ({ probeId }) => {
  const ctx = getExecutionContext();
  let tenantTxError: string | undefined;
  try {
    await tenantTx(async () => undefined);
  } catch (err) {
    tenantTxError = (err as { code?: string }).code;
  }
  seen.set(probeId, {
    accountId: ctx?.accountId,
    traceId: ctx?.traceId,
    ...(tenantTxError !== undefined ? { tenantTxError } : {}),
  });
});

describeDb('US2 – ngữ cảnh khi xử lý việc', () => {
  let database: TestDatabase;
  let workers: TestWorkers;
  let a: string;
  let b: string;

  beforeAll(async () => {
    database = makeDatabase();
    a = await createAccount();
    b = await createAccount();
    await seedNotes(a, 2);
    await seedNotes(b, 3);
    workers = await startTestWorkers(1, { queues: ['notify'] });
  });
  afterAll(async () => {
    await workers.stop();
    await database.close();
  });
  beforeEach(async () => {
    await resetQueues();
    seen.clear();
    workers.logs.entries.length = 0;
  });

  it('việc tenant A: tenantTx chỉ thấy dòng của A, ngữ cảnh có accountId A + traceId của việc', async () => {
    const probeId = crypto.randomUUID();
    let traceId = '';
    const r = await withAccount(a, () =>
      tenantTx(async () => {
        traceId = getExecutionContext()!.traceId;
        return enqueue(readNotes, { probeId });
      }),
    );
    await waitFor(() => seen.has(probeId), 20_000, 50, 'bộ xử lý chạy');
    expect(seen.get(probeId)).toEqual({ accountId: a, traceId, noteAccounts: [a] });

    await waitFor(() => workers.logs.of('queue.job_finished').length > 0, 5000);
    const [line] = workers.logs.of('queue.job_finished');
    expect(line).toMatchObject({
      trace_id: traceId,
      account_id: a,
      queue: 'notify',
      job_type: 'sandbox.read_notes',
      job_id: r.jobId,
      attempt: 1,
      outcome: 'completed',
      payload_ref: { probeId },
    });
    expect(typeof line!.duration_ms).toBe('number');
    expect(typeof line!.wait_ms).toBe('number');
  });

  it('việc hệ thống: không có accountId; tenantTx → TENANT_CONTEXT_MISSING', async () => {
    const probeId = crypto.randomUUID();
    await systemTx(() => enqueue(systemProbe, { probeId }));
    await waitFor(() => seen.has(probeId), 20_000, 50, 'bộ xử lý chạy');
    const s = seen.get(probeId)!;
    expect(s.accountId).toBeUndefined();
    expect(typeof s.traceId).toBe('string');
    expect(s.tenantTxError).toBe('TENANT_CONTEXT_MISSING');
    await waitFor(() => workers.logs.of('queue.job_finished').length > 0, 5000);
    expect(workers.logs.of('queue.job_finished')[0]).toMatchObject({
      account_id: null,
      job_type: 'sandbox.system_probe',
      outcome: 'completed',
    });
  });
});
