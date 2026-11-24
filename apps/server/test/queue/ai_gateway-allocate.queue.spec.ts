// T059 (015 US7, FR-033, R-11, contracts/jobs-and-alerts.md mục 1): việc `ai_gateway.allocate_trend_cost` – hàng chờ `trends`,
// phạm vi system, khóa chống trùng `ai_alloc:{weekStart}:{industryId}`; Worker thật chia đều chi phí xu hướng của ngành/tuần cho
// tài khoản cùng ngành, chạy lại / chạy đồng thời không nhân đôi. Viết TRƯỚC mã (T061): thất bại cho tới khi có việc này
// (hợp đồng giả định ở test/ai_gateway/helpers/allocation-kit.ts).
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { systemTx, tenantTx } from '../../src/core/db/transaction';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import type { IndustryAccountsSource } from '../../src/modules/ai_gateway';
import { enqueue } from '../../src/modules/queue';
import {
  allocationJob,
  allocationRows,
  bulkAccounts,
  cleanupAllocations,
  makeIndustrySource,
  registerAllocationHandler,
  seedSystemLedger,
  sharesOf,
  sum,
} from '../ai_gateway/helpers/allocation-kit';
import { expectIdempotent, startTestProducer, startTestWorkers } from '../support/queue-test-kit';
import {
  createAccount,
  describeDb,
  jobs,
  makeDatabase,
  resetQueues,
  withAccount,
  type TestDatabase,
} from './helpers/queue-db';

const WEEK = '2035-03-05';
const keyOf = (week: string, industryId: string) => `ai_alloc:${week}:${industryId}`;
const detail = (code: string): unknown => expect.objectContaining({ detail: code });

describeDb('Việc ai_gateway.allocate_trend_cost (015 US7)', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  const industries = new Map<string, string[]>();
  const base = makeIndustrySource(industries);
  let failNext = false;
  const source: IndustryAccountsSource = {
    listAccountIds: (industryId, page) => {
      if (failNext) {
        failNext = false;
        return Promise.reject(new Error('nguồn tài khoản tạm lỗi'));
      }
      return base.source.listAccountIds(industryId, page);
    },
  };
  const used: string[] = [];

  async function industry(n: number, cost: number) {
    const industryId = uuidV7();
    used.push(industryId);
    const accounts = await bulkAccounts(n);
    industries.set(industryId, accounts);
    const ledgerId = await seedSystemLedger({ weekStart: WEEK, industryId, cost });
    return { industryId, accounts, ledgerId };
  }

  beforeAll(async () => {
    database = makeDatabase({ unit: 'worker', poolMax: 10 });
    stopProducer = await startTestProducer();
    await registerAllocationHandler(source);
  });
  afterAll(async () => {
    await cleanupAllocations(used);
    await stopProducer();
    await database.close();
  });
  beforeEach(async () => {
    failNext = false;
    await resetQueues();
  });

  it('loại việc: hàng chờ trends, phạm vi system, payload chặt chỉ gồm tuần + ngành (không nhận mã tài khoản)', () => {
    const job = allocationJob();
    expect(job.name).toBe('ai_gateway.allocate_trend_cost');
    expect(job.queue).toBe('trends');
    expect(job.scope).toBe('system');
    const ok = { weekStart: WEEK, industryId: uuidV7() };
    expect(job.payload.safeParse(ok).success).toBe(true);
    expect(job.payload.safeParse({ ...ok, accountId: uuidV7() }).success).toBe(false);
    expect(job.payload.safeParse({ ...ok, weekStart: 'tuần-này' }).success).toBe(false);
    expect(job.payload.safeParse({ ...ok, industryId: 'khong-phai-uuid' }).success).toBe(false);
    expect(job.payload.safeParse({ weekStart: WEEK }).success).toBe(false);
  });

  it('tạo việc ở ngữ cảnh hệ thống: khóa ai_alloc:{tuần}:{ngành} chống trùng, ngành khác tạo việc riêng; ngữ cảnh tài khoản bị từ chối', async () => {
    const job = allocationJob();
    const [i1, i2] = [uuidV7(), uuidV7()];
    const payload = { weekStart: WEEK, industryId: i1 };
    const first = await systemTx(() => enqueue(job, payload, { dedupeKey: keyOf(WEEK, i1) }));
    expect(first.status).toBe('created');
    const again = await systemTx(() => enqueue(job, payload, { dedupeKey: keyOf(WEEK, i1) }));
    expect(again).toEqual({
      status: 'exists',
      jobId: (first as { jobId: string }).jobId,
      state: 'pending',
    });
    const other = await systemTx(() =>
      enqueue(job, { weekStart: WEEK, industryId: i2 }, { dedupeKey: keyOf(WEEK, i2) }),
    );
    expect(other.status).toBe('created');

    const rows = await jobs("name = 'trends'");
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.data).toMatchObject({ type: 'ai_gateway.allocate_trend_cost', accountId: null });
      expect(r.group_id).toBeNull();
    }
    const a = await createAccount();
    await expect(
      withAccount(a, () => tenantTx(() => enqueue(job, { weekStart: WEEK, industryId: i1 }))),
    ).rejects.toEqual(detail('QUEUE_SYSTEM_CONTEXT_REQUIRED'));
  });

  it('Worker thật xử lý việc trên hàng chờ trends: chia đều theo ngành, tổng = chi phí, việc hoàn tất', async () => {
    const { industryId, accounts, ledgerId } = await industry(3, 10_000);
    await systemTx(() =>
      enqueue(
        allocationJob(),
        { weekStart: WEEK, industryId },
        { dedupeKey: keyOf(WEEK, industryId) },
      ),
    );
    const workers = await startTestWorkers(1, { queues: ['trends'] });
    try {
      await workers.drain();
    } finally {
      await workers.stop();
    }
    const rows = await allocationRows(WEEK, industryId);
    expect(rows).toHaveLength(3);
    const shares = sharesOf(rows, ledgerId, accounts);
    expect(shares).toEqual([3_334, 3_333, 3_333]); // dư 1 → mã nhỏ nhất
    expect(sum(shares)).toBe(10_000);
    const [row] = await jobs("name = 'trends'");
    expect(row!.state).toBe('completed');
  });

  it('hai Worker, hai việc cùng nội dung (khóa khác) chạy đồng thời → vẫn đúng một bộ dòng, không nhân đôi, tổng = chi phí', async () => {
    const { industryId, accounts, ledgerId } = await industry(40, 40_000 + 11);
    for (const suffix of ['a', 'b']) {
      await systemTx(() =>
        enqueue(
          allocationJob(),
          { weekStart: WEEK, industryId },
          { dedupeKey: `${keyOf(WEEK, industryId)}:${suffix}` },
        ),
      );
    }
    const workers = await startTestWorkers(2, { queues: ['trends'] });
    try {
      await workers.drain();
    } finally {
      await workers.stop();
    }
    const rows = await allocationRows(WEEK, industryId);
    expect(rows).toHaveLength(40);
    const shares = sharesOf(rows, ledgerId, accounts);
    expect(sum(shares)).toBe(40_011);
    expect(shares.slice(0, 11).every((s) => s === 1_001)).toBe(true);
    expect(shares.slice(11).every((s) => s === 1_000)).toBe(true);
  });

  it('chạy lại hai lần sau khi Worker đã xử lý: ảnh chụp các dòng phân bổ không đổi', async () => {
    const { industryId } = await industry(5, 12_347);
    await expectIdempotent(
      allocationJob(),
      { weekStart: WEEK, industryId },
      { snapshot: () => allocationRows(WEEK, industryId) },
    );
    expect(await allocationRows(WEEK, industryId)).toHaveLength(5);
  });

  it('nguồn tài khoản lỗi tạm → việc vào chờ thử lại, KHÔNG ghi dòng nào; lần sau chạy đủ và đúng tổng', async () => {
    const { industryId, accounts, ledgerId } = await industry(4, 8_000);
    failNext = true;
    await systemTx(() =>
      enqueue(
        allocationJob(),
        { weekStart: WEEK, industryId },
        { dedupeKey: keyOf(WEEK, industryId) },
      ),
    );
    const workers = await startTestWorkers(1, { queues: ['trends'] });
    try {
      await workers.drain();
    } finally {
      await workers.stop();
    }
    expect(await allocationRows(WEEK, industryId)).toEqual([]);
    const [row] = await jobs("name = 'trends'");
    expect(row!.state).toBe('retry');

    // Lần thử lại (ở đây chạy trực tiếp): nguồn đã ổn → đủ dòng, tổng = chi phí.
    await expectIdempotent(
      allocationJob(),
      { weekStart: WEEK, industryId },
      { snapshot: () => allocationRows(WEEK, industryId) },
    );
    expect(sum(sharesOf(await allocationRows(WEEK, industryId), ledgerId, accounts))).toBe(8_000);
  });
});
