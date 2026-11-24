import { afterAll, beforeAll, expect, it } from 'vitest';
import { currentAccountId } from '../../src/core/db/transaction';
import type { LedgerDraft } from '../../src/modules/ai_gateway/internal/budget/budget-store';
import { makeOnCrossed } from '../../src/modules/ai_gateway/ai_gateway.module';
import { QueueEmitter } from '../../src/modules/notifications/internal/emit';
import { makeAiHarness, type AiHarness } from '../contracts/ai/harness';
import { createAccount, describeDb, makeDatabase, type TestDatabase } from '../db/helpers/db';
import { jobs } from '../queue/helpers/queue-db';
import { startTestProducer } from '../support/queue-test-kit';

// 015 US6 (T055; FR-029, FR-030, nguyên tắc IV) trên kho THẬT: mốc 80% và 100% phát đúng MỘT thông báo cho mỗi
// (tài khoản, cycleStart); cờ bật bằng UPDATE … WHERE notified_x = false; thông báo tạo TRONG giao dịch quyết toán.
// Quyết định đã chốt: 100% theo số ĐÃ QUYẾT TOÁN (used + minEstimate >= cap), không tính giữ chỗ của lượt khác.
// Đỏ tạm tới khi T056 chỉ khi rà soát `makeOnCrossed`/settle làm đổi hành vi; hiện kỳ vọng xanh (mã US1 đã có).

const draft: LedgerDraft = {
  task: 'post_generation',
  modelTier: 'default',
  modelId: 'm',
  provider: 'p',
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  traceId: null,
};
const META = { task: 'post_generation', modelTier: 'default' } as const;

describeDb('Cổng AI – thông báo ngưỡng 80% / 100% (US6, kho thật)', () => {
  let database: TestDatabase;
  let h: AiHarness;
  let stopProducer: () => Promise<void>;
  const emitter = new QueueEmitter();
  const hooks = { onCrossed: makeOnCrossed(emitter) };

  /** Việc thông báo của tài khoản trong ngữ cảnh theo loại (+ chu kỳ nếu nêu). */
  async function events(type: 'ai_usage_80' | 'ai_usage_100', cycle?: string): Promise<number> {
    const rows = await jobs(
      "data->>'type' = 'notifications.deliver' AND data->>'accountId' = $1 AND data->'payload'->'event'->>'type' = $2" +
        (cycle === undefined ? '' : " AND data->'payload'->'event'->'refs'->>'cycleStart' = $3"),
      cycle === undefined ? [currentAccountId(), type] : [currentAccountId(), type, cycle],
    );
    return rows.length;
  }

  beforeAll(async () => {
    database = makeDatabase({ unit: 'worker', poolMax: 10 });
    stopProducer = await startTestProducer();
    h = await makeAiHarness('db', () => createAccount(), {
      onCrossed: makeOnCrossed(emitter),
      count: (type) => events(type),
    });
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });

  const inFreshAccount = async <T>(fn: (id: string) => Promise<T>): Promise<T> => {
    const id = await createAccount();
    return h.inAccount(id, () => fn(id));
  };

  async function hold(est: number): Promise<string> {
    const store = h.bundle.store;
    const key = { scope: 'account' as const, cycleStart: await store.currentCycleStart() };
    const r = await store.reserve(key, est, META);
    if (!r.ok) throw new Error('giữ chỗ bị từ chối trong ca kiểm thử');
    await store.markCalling(r.reservationId);
    return r.reservationId;
  }

  it('mốc 80%: đúng một thông báo; quyết toán thêm trên 80% không phát lại; cờ notified_80 = true', async () => {
    await inFreshAccount(async () => {
      await h.fake.setBudget({ used: 3_100_000 });
      const cycle = await h.bundle.store.currentCycleStart();
      const a = await hold(1_000);
      const r1 = await h.bundle.store.settle(a, 150_000, draft, hooks); // 3 250 000 = 81%
      expect(r1.crossed).toEqual([80]);
      const b = await hold(1_000);
      const r2 = await h.bundle.store.settle(b, 1_000, draft, hooks);
      expect(r2.crossed).toEqual([]);
      expect(await events('ai_usage_80', cycle)).toBe(1);
      expect(await events('ai_usage_100')).toBe(0);
      expect(await h.fake.getBudget()).toMatchObject({ notified80: true, notified100: false });
    });
  });

  it('thử lại quyết toán cùng giữ chỗ (đã settled) → không phát trùng, không cộng thêm, một dòng sổ', async () => {
    await inFreshAccount(async () => {
      await h.fake.setBudget({ used: 3_100_000 });
      const a = await hold(1_000);
      await h.bundle.store.settle(a, 150_000, draft, hooks);
      const used = (await h.fake.getBudget()).used;
      const again = await h.bundle.store.settle(a, 150_000, draft, hooks);
      expect(again.crossed).toEqual([]);
      expect(await events('ai_usage_80')).toBe(1);
      expect((await h.fake.getBudget()).used).toBe(used);
      expect(await h.fake.ledger()).toHaveLength(1);
    });
  });

  it('vượt cả 80% và 100% trong một lần quyết toán → mỗi mốc đúng một thông báo', async () => {
    await inFreshAccount(async () => {
      await h.fake.setBudget({ used: 3_000_000 });
      const a = await hold(1_000);
      const r = await h.bundle.store.settle(a, 1_200_000, draft, hooks); // kẹp trần → used = cap
      expect([...r.crossed].sort()).toEqual([100, 80]);
      expect(await events('ai_usage_80')).toBe(1);
      expect(await events('ai_usage_100')).toBe(1);
      expect(await h.fake.getBudget()).toMatchObject({
        used: 4_000_000,
        notified80: true,
        notified100: true,
      });
    });
  });

  it('mốc 100% theo số ĐÃ quyết toán: giữ chỗ của lượt khác không làm báo sớm; used + minEstimate >= cap mới báo', async () => {
    await inFreshAccount(async () => {
      const store = h.bundle.store;
      const min = await store.minCallEstimateMicro!();
      expect(min).toBeGreaterThan(0);
      // used sát biên: còn đúng min + 1 000 micro-USD tới trần.
      await h.fake.setBudget({ used: 4_000_000 - min - 1_000 });
      const a = await hold(10);
      const other = await hold(min); // giữ chỗ của lượt khác: used + reserved vượt cap − min nhưng KHÔNG phải đã quyết toán
      const r1 = await store.settle(a, 10, draft, hooks);
      expect(r1.crossed).not.toContain(100);
      expect(await events('ai_usage_100')).toBe(0);
      // Lượt kia trả giữ chỗ → vẫn chưa báo 100%.
      await store.release(other);
      expect(await events('ai_usage_100')).toBe(0);
      // Biên: used sau quyết toán = cap − min − 1 → CHƯA; thêm 1 micro-USD → used + min = cap → BÁO.
      const c = await hold(10);
      const r2 = await store.settle(c, 989, draft, hooks); // used = cap − min − 1_000 + 10 + 989 = cap − min − 1
      expect(r2.crossed).not.toContain(100);
      const d = await hold(10);
      const r3 = await store.settle(d, 1, draft, hooks); // used + min = cap
      expect(r3.crossed).toContain(100);
      expect(await events('ai_usage_100')).toBe(1);
      expect((await h.fake.getBudget()).notified100).toBe(true);
    });
  });

  it('chu kỳ mới phát lại được: dòng chu kỳ cũ đã báo 80/100 không chặn thông báo của chu kỳ hiện hành', async () => {
    await inFreshAccount(async () => {
      const past = await h.db!.seedExhaustedPastCycle();
      const current = await h.bundle.store.currentCycleStart();
      expect(current).not.toBe(past);
      await h.fake.setBudget({ used: 3_100_000 });
      const a = await hold(1_000);
      const r = await h.bundle.store.settle(a, 150_000, draft, hooks);
      expect(r.crossed).toEqual([80]);
      expect(await events('ai_usage_80', current)).toBe(1);
      expect(await events('ai_usage_80', past)).toBe(0);
    });
  });

  it('thông báo tạo TRONG giao dịch quyết toán: emit ném → hoàn tác cờ, sổ, giữ chỗ và việc thông báo; thử lại → đúng một', async () => {
    await inFreshAccount(async () => {
      await h.fake.setBudget({ used: 3_100_000 });
      const a = await hold(1_000);
      const failing = {
        onCrossed: async (...args: Parameters<typeof hooks.onCrossed>) => {
          await hooks.onCrossed(...args); // việc thông báo đã INSERT trên cùng giao dịch…
          throw new Error('emit lỗi sau khi tạo việc');
        },
      };
      await expect(h.bundle.store.settle(a, 150_000, draft, failing)).rejects.toThrow('emit lỗi');
      // …nên hoàn tác hết: không việc, cờ vẫn false, chưa trừ ngân sách, chưa có sổ, giữ chỗ còn `calling`.
      expect(await events('ai_usage_80')).toBe(0);
      expect(await h.fake.getBudget()).toMatchObject({ used: 3_100_000, notified80: false });
      expect((await h.fake.getBudget()).reserved).toBeGreaterThan(0);
      expect(await h.fake.ledger()).toEqual([]);
      expect((await h.fake.reservations()).map((r) => r.state)).toEqual(['calling']);
      // Quyết toán lại bằng hook thật → đúng một thông báo, đúng một dòng sổ.
      const r = await h.bundle.store.settle(a, 150_000, draft, hooks);
      expect(r.crossed).toEqual([80]);
      expect(await events('ai_usage_80')).toBe(1);
      expect(await h.fake.ledger()).toHaveLength(1);
    });
  });

  it('hai tài khoản cùng chu kỳ: mỗi tài khoản có thông báo riêng (khóa chống trùng gắn mã tài khoản)', async () => {
    const counts: number[] = [];
    for (let i = 0; i < 2; i++) {
      await inFreshAccount(async () => {
        await h.fake.setBudget({ used: 3_100_000, cycleStart: undefined });
        const a = await hold(1_000);
        await h.bundle.store.settle(a, 150_000, draft, hooks);
        counts.push(await events('ai_usage_80'));
      });
    }
    expect(counts).toEqual([1, 1]);
  });
});
