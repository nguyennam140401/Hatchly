import { afterAll, beforeAll, expect, it } from 'vitest';
import type {
  BudgetStore,
  LedgerDraft,
} from '../../src/modules/ai_gateway/internal/budget/budget-store';
import { makeDbStore } from '../contracts/ai/harness';
import { startTestProducer } from '../support/queue-test-kit';
import {
  asOwner,
  createAccount,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from '../db/helpers/db';

// 015 (hiến chương III, V): đóng giữ chỗ phải idempotent TRỰC TIẾP ở kho. Sổ `ai_cost_ledger` phân vùng nên KHÔNG có
// UNIQUE theo reservation_id → chỉ có chuyển trạng thái có điều kiện của giữ chỗ chặn ghi sổ hai lần.
// Thêm ca cờ `cycleEnd` (= nextCycleStartsAt của khách) khi chu kỳ bị kẹp (mốc 31, 28/02 → 31/03).
// Tên tệp `.db.spec.ts` để vitest bộ nhớ bỏ qua.

const META = { task: 'post_generation' as const, modelTier: 'default' as const };
const ledgerDraft: LedgerDraft = {
  task: 'post_generation',
  modelTier: 'default',
  modelId: 'fake-model',
  provider: 'fake',
  inputTokens: 10,
  outputTokens: 20,
  cachedInputTokens: 0,
  traceId: null,
};

describeDb('Cổng AI thật – đóng giữ chỗ idempotent và chu kỳ kẹp', () => {
  let database: TestDatabase;
  let store: BudgetStore;
  let stopProducer: () => Promise<void>;

  beforeAll(async () => {
    database = makeDatabase({ unit: 'worker', poolMax: 10 });
    stopProducer = await startTestProducer();
    store = await makeDbStore({
      accountApi: { getAiCycleAnchor: () => Promise.resolve({ anchorDate: '2026-01-31' }) },
    });
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });

  const ledgerCount = (reservationId: string) =>
    asOwner(async (c) =>
      Number(
        (
          await c.query<{ n: string }>(
            'SELECT count(*)::text AS n FROM ai_gateway.ai_cost_ledger WHERE reservation_id = $1',
            [reservationId],
          )
        ).rows[0]!.n,
      ),
    );

  const reserveOne = async (est: number) => {
    const key = { scope: 'account' as const, cycleStart: await store.currentCycleStart() };
    const r = await store.reserve(key, est, META);
    if (!r.ok) throw new Error('giữ chỗ phải thành công');
    return { key, id: r.reservationId };
  };

  it('settle hai lần tuần tự: một dòng sổ, used cộng một lần, reserved về 0, lần hai không đổi gì', async () => {
    const accountId = await createAccount();
    await withAccount(accountId, async () => {
      const { key, id } = await reserveOne(5_000);
      await store.markCalling(id);
      await store.settle(id, 3_000, ledgerDraft);
      const after1 = await store.usage(key);
      expect(after1).toMatchObject({ used: 3_000, reserved: 0 });
      expect(await ledgerCount(id)).toBe(1);

      await store.settle(id, 3_000, ledgerDraft);
      expect(await store.usage(key)).toMatchObject({ used: 3_000, reserved: 0 });
      expect(await ledgerCount(id)).toBe(1);
    });
  });

  it('settle hai lần song song: đúng một dòng sổ, used chỉ cộng một lần, reserved = 0', async () => {
    const accountId = await createAccount();
    await withAccount(accountId, async () => {
      const { key, id } = await reserveOne(5_000);
      await store.markCalling(id);
      await Promise.allSettled([
        store.settle(id, 3_000, ledgerDraft),
        store.settle(id, 3_000, ledgerDraft),
      ]);
      expect(await store.usage(key)).toMatchObject({ used: 3_000, reserved: 0 });
      expect(await ledgerCount(id)).toBe(1);
    });
  });

  it('release hai lần (tuần tự và song song): trả giữ chỗ một lần, không đụng used, không có dòng sổ', async () => {
    const accountId = await createAccount();
    await withAccount(accountId, async () => {
      const { key, id } = await reserveOne(5_000);
      expect((await store.usage(key)).reserved).toBe(5_000);
      await store.release(id);
      await store.release(id);
      expect(await store.usage(key)).toMatchObject({ used: 0, reserved: 0 });

      const second = await reserveOne(7_000);
      await Promise.all([store.release(second.id), store.release(second.id)]);
      expect(await store.usage(key)).toMatchObject({ used: 0, reserved: 0 });
      expect(await ledgerCount(id)).toBe(0);
      expect(await ledgerCount(second.id)).toBe(0);
    });
  });

  it('settle rồi release (và ngược lại): đã đóng thì lệnh sau không đổi gì', async () => {
    const accountId = await createAccount();
    await withAccount(accountId, async () => {
      const a = await reserveOne(4_000);
      await store.markCalling(a.id);
      await store.settle(a.id, 2_000, ledgerDraft);
      await store.release(a.id);
      expect(await store.usage(a.key)).toMatchObject({ used: 2_000, reserved: 0 });

      const b = await reserveOne(4_000);
      await store.release(b.id);
      await store.settle(b.id, 2_000, ledgerDraft).catch(() => undefined);
      expect(await store.usage(b.key)).toMatchObject({ used: 2_000, reserved: 0 });
      expect(await ledgerCount(b.id)).toBe(0);
    });
  });

  it('chu kỳ bị kẹp: mốc 31, chu kỳ bắt đầu 28/02 → cycleEnd 31/03 (cờ nextCycleStartsAt của khách)', async () => {
    const accountId = await createAccount();
    await withAccount(accountId, async () => {
      const snap = await store.usage({ scope: 'account', cycleStart: '2026-02-28' });
      expect(snap.cycleEnd).toBe('2026-03-31');
      // Chu kỳ trước đó kết thúc 28/02 (kẹp), chu kỳ sau 31/03 → 30/04.
      expect((await store.usage({ scope: 'account', cycleStart: '2026-01-31' })).cycleEnd).toBe(
        '2026-02-28',
      );
      expect((await store.usage({ scope: 'account', cycleStart: '2026-03-31' })).cycleEnd).toBe(
        '2026-04-30',
      );
      // Giữ chỗ ở chu kỳ kẹp tạo dòng ngân sách có cycle_end đúng.
      const r = await store.reserve({ scope: 'account', cycleStart: '2026-02-28' }, 1_000, META);
      expect(r.ok).toBe(true);
      const row = await asOwner(
        async (c) =>
          (
            await c.query<{ cycle_start: string; cycle_end: string }>(
              `SELECT to_char(cycle_start,'YYYY-MM-DD') AS cycle_start, to_char(cycle_end,'YYYY-MM-DD') AS cycle_end
               FROM ai_gateway.ai_budgets WHERE account_id = $1`,
              [accountId],
            )
          ).rows[0],
      );
      expect(row).toEqual({ cycle_start: '2026-02-28', cycle_end: '2026-03-31' });
      if (r.ok) await store.release(r.reservationId);
    });
  });
});
