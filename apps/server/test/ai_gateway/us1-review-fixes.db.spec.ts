import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { currentAccountId, systemTx, tenantTx } from '../../src/core/db';
import { AiError, type AiRequest } from '../../src/modules/ai_gateway';
import type {
  BudgetStore,
  LedgerDraft,
} from '../../src/modules/ai_gateway/internal/budget/budget-store';
import { weekStart } from '../../src/modules/ai_gateway/internal/budget/system-budget';
import { minCallEstimate } from '../../src/modules/ai_gateway/internal/estimate';
import { AiGatewayService } from '../../src/modules/ai_gateway/internal/gateway.service';
import { DbPriceSource } from '../../src/modules/ai_gateway/internal/prices/db-price-source';
import type { AiProviderAdapter } from '../../src/modules/ai_gateway/internal/providers/provider';
import { RouteBook } from '../../src/modules/ai_gateway/internal/routing/route-book';
import { QueueEmitter } from '../../src/modules/notifications/internal/emit';
import { makeOnCrossed } from '../../src/modules/ai_gateway/ai_gateway.module';
import { jobs } from '../queue/helpers/queue-db';
import { startTestProducer } from '../support/queue-test-kit';
import {
  asOwner,
  createAccount,
  describeDb,
  makeDatabase,
  type TestDatabase,
} from '../db/helpers/db';
import { makeAiHarness, type AiHarness } from '../contracts/ai/harness';

// Ca kiểm thử bổ sung sau rà soát US1 (reviews/us1.md): CAO-1 (cờ 100% theo số ĐÃ QUYẾT TOÁN), TRUNG BÌNH-1 (lượt dự
// phòng ghi đúng tuyến/giá/trace), TRUNG BÌNH-2/3 (markCalling / stream() ném → trả giữ chỗ), TRUNG BÌNH-4 (dọn giữ chỗ
// hệ thống treo), TRUNG BÌNH-5 (không gọi Cổng AI trong tenantTx của bên gọi). Chạy trên kho THẬT (pnpm test:db).
// Tên tệp `.db.spec.ts` để vitest bộ nhớ bỏ qua.

const CAP = 4_000_000;
const META = { task: 'post_generation' as const, modelTier: 'default' as const };
const req = (): AiRequest => ({
  task: 'post_generation',
  prompt: { system: 'Bạn là trợ lý viết bài.', delta: 'Viết bài khai trương quán cà phê.' },
  maxOutputTokens: 400,
});
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

/** Ước tính nhỏ nhất của một lời gọi, tính y như kho thật (giá `cheap_vision` hiện hành từ CSDL). */
async function minEstimateFromDb(): Promise<number> {
  const [first] = await new RouteBook({ ttlMs: 0 }).attemptsFor('image_labeling', 'cheap_vision');
  if (first === undefined) throw new Error('Thiếu tuyến cheap_vision trong dữ liệu khởi đầu');
  const price = await new DbPriceSource({ ttlMs: 0 }).priceFor(
    first.provider,
    first.modelId,
    'token',
  );
  if (price === null) throw new Error('Thiếu giá cheap_vision trong dữ liệu khởi đầu');
  return minCallEstimate({
    modelTier: 'cheap_vision',
    modelId: price.modelId,
    provider: price.provider,
    inputPerMTokMicroUsd: price.inputPerMTokMicroUsd ?? 0,
    outputPerMTokMicroUsd: price.outputPerMTokMicroUsd ?? 0,
    cachedInputPerMTokMicroUsd: price.cachedInputPerMTokMicroUsd ?? 0,
    effectiveFrom: price.effectiveFrom,
  });
}

interface ReservationRow {
  provider: string;
  model_id: string;
  price_id: string;
  trace_id: string | null;
  state: string;
}

describeDb('Cổng AI thật – sửa sau rà soát US1', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  let h: AiHarness;

  beforeAll(async () => {
    database = makeDatabase({ unit: 'worker', poolMax: 10 });
    stopProducer = await startTestProducer();
    h = await makeAiHarness('db', () => createAccount(), {
      onCrossed: makeOnCrossed(new QueueEmitter()),
      count: async (type) =>
        (
          await jobs(
            "data->>'type' = 'notifications.deliver' AND data->>'accountId' = $1 AND data->'payload'->'event'->>'type' = $2",
            [currentAccountId(), type],
          )
        ).length,
    });
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });

  const reservationRows = (accountId: string) =>
    asOwner(
      async (c) =>
        (
          await c.query<ReservationRow>(
            `SELECT provider, model_id, price_id::text AS price_id, trace_id::text AS trace_id, state
               FROM ai_gateway.ai_reservations WHERE account_id = $1 ORDER BY reserved_at, id`,
            [accountId],
          )
        ).rows,
    );

  /** Cổng AI trên kho thật của harness nhưng với kho/nhà cung cấp do ca kiểm thử thay. */
  const gatewayWith = (over: {
    store?: BudgetStore;
    primary?: AiProviderAdapter;
    fallback?: AiProviderAdapter;
    providerTimeoutMs?: number;
    firstTokenTimeoutMs?: number;
  }) =>
    new AiGatewayService({
      store: over.store ?? h.bundle.store,
      prices: h.bundle.prices,
      primary: over.primary ?? h.bundle.primary,
      fallback: over.fallback ?? h.bundle.fallback,
      providerTimeoutMs: over.providerTimeoutMs ?? 300,
      firstTokenTimeoutMs: over.firstTokenTimeoutMs ?? 300,
    });

  // ----------------------------------------------------------------------------------------------------------
  // 1. CAO-1: cờ 100% theo số đã quyết toán (used + minEstimate >= cap), không tính giữ chỗ của lượt khác.
  //    LƯU Ý: ca (a) có thể ĐỎ TẠM nếu backend-dev chưa xong chuyển sang `isBudgetExhaustedSettled`.
  // ----------------------------------------------------------------------------------------------------------
  describe('1. cờ 100% theo số đã quyết toán', () => {
    it('ĐÚNG biên used + minEstimate == cap (used = cap − minEst < cap): bật notified_100, phát ai_usage_100 đúng một lần; settle thử lại không phát lại', async () => {
      const accountId = await h.newAccount();
      await h.inAccount(accountId, async () => {
        const minEst = await minEstimateFromDb();
        expect(minEst).toBeGreaterThan(0);
        const store = h.bundle.store;
        const cycle = await store.currentCycleStart();
        const key = { scope: 'account' as const, cycleStart: cycle };
        const est = 1_000;
        // Quyết định đã chốt: biên dùng `>=` (cap − used <= minEst). Sau quyết toán used = CAP − minEst: ĐÚNG biên
        // `used + minEst == cap` đã là hết ngân sách (không còn đủ cho lời gọi nhỏ nhất kể cả khi dùng hết phần còn lại).
        const usedAfter = CAP - minEst;
        await h.fake.setBudget({ used: usedAfter - est, reserved: 0 });
        const r = await store.reserve(key, est, META);
        if (!r.ok) throw new Error('giữ chỗ phải thành công');
        await store.markCalling(r.reservationId);
        const hooks = {
          onCrossed: (tx: Parameters<typeof h.notify.onCrossed>[0], crossed: (80 | 100)[]) =>
            h.notify.onCrossed(tx, crossed, cycle),
        };
        const first = await store.settle(r.reservationId, est, ledgerDraft, hooks);
        expect(first.crossed).toContain(100);

        const b = await h.fake.getBudget();
        expect(b.used).toBe(usedAfter);
        expect(b.used).toBeLessThan(b.cap);
        expect(b).toMatchObject({ reserved: 0, notified80: true, notified100: true });
        expect(await h.notify.count('ai_usage_100')).toBe(1);

        // Thử lại quyết toán: giữ chỗ đã đóng → không phát lại, không đổi số.
        const again = await store.settle(r.reservationId, est, ledgerDraft, hooks);
        expect(again.crossed).toEqual([]);
        expect(await h.notify.count('ai_usage_100')).toBe(1);
        expect(await h.fake.getBudget()).toMatchObject({ used: usedAfter, reserved: 0 });
      });
    });

    it('ngay dưới biên (used = cap − minEst − 1, used + minEstimate < cap): chưa bật notified_100, không có ai_usage_100', async () => {
      const accountId = await h.newAccount();
      await h.inAccount(accountId, async () => {
        const minEst = await minEstimateFromDb();
        const store = h.bundle.store;
        const cycle = await store.currentCycleStart();
        const key = { scope: 'account' as const, cycleStart: cycle };
        const est = 1_000;
        const usedAfter = CAP - minEst - 1;
        await h.fake.setBudget({ used: usedAfter - est, reserved: 0 });
        const r = await store.reserve(key, est, META);
        if (!r.ok) throw new Error('giữ chỗ phải thành công');
        await store.markCalling(r.reservationId);
        const hooks = {
          onCrossed: (tx: Parameters<typeof h.notify.onCrossed>[0], crossed: (80 | 100)[]) =>
            h.notify.onCrossed(tx, crossed, cycle),
        };
        const settled = await store.settle(r.reservationId, est, ledgerDraft, hooks);
        expect(settled.crossed).not.toContain(100);
        expect(await h.fake.getBudget()).toMatchObject({
          used: usedAfter,
          reserved: 0,
          notified100: false,
        });
        expect(await h.notify.count('ai_usage_100')).toBe(0);
      });
    });

    it('đối chứng: chỉ blocked tạm do reserved của lượt khác (used + minEstimate < cap) rồi trả giữ chỗ → KHÔNG bật cờ 100%, không có ai_usage_100', async () => {
      const accountId = await h.newAccount();
      await h.inAccount(accountId, async () => {
        const minEst = await minEstimateFromDb();
        const store = h.bundle.store;
        const cycle = await store.currentCycleStart();
        const key = { scope: 'account' as const, cycleStart: cycle };
        const base = 1_000_000;
        await h.fake.setBudget({ used: base, reserved: 0 });

        const a = await store.reserve(key, 100, META);
        if (!a.ok) throw new Error('giữ chỗ A phải thành công');
        // B lấp đầy phần còn lại tới đúng trần → getUsage thấy `blocked` (tính cả giữ chỗ).
        const b = await store.reserve(key, CAP - base - 100, META);
        if (!b.ok) throw new Error('giữ chỗ B phải thành công');
        await store.markCalling(a.reservationId);

        const hooks = {
          onCrossed: (tx: Parameters<typeof h.notify.onCrossed>[0], crossed: (80 | 100)[]) =>
            h.notify.onCrossed(tx, crossed, cycle),
        };
        const settled = await store.settle(a.reservationId, 100, ledgerDraft, hooks);
        expect(settled.crossed).not.toContain(100);
        expect((await h.gateway().getUsage()).state).toBe('blocked');
        // Số đã quyết toán còn xa trần: used + minEst << cap.
        const mid = await h.fake.getBudget();
        expect(mid.used + minEst).toBeLessThan(mid.cap);
        expect(mid.notified100).toBe(false);

        await store.release(b.reservationId);
        const end = await h.fake.getBudget();
        expect(end).toMatchObject({ used: base + 100, reserved: 0, notified100: false });
        expect((await h.gateway().getUsage()).state).not.toBe('blocked');
        expect(await h.notify.count('ai_usage_100')).toBe(0);
      });
    });
  });

  // ----------------------------------------------------------------------------------------------------------
  // 2. TRUNG BÌNH-1: lượt dự phòng ghi tuyến rank 2 + traceId.
  // ----------------------------------------------------------------------------------------------------------
  it('2. lượt dự phòng ghi provider/model_id/price_id của tuyến rank 2 và trace_id khác NULL', async () => {
    const accountId = await h.newAccount();
    await h.inAccount(accountId, async () => {
      await h.fake.script([{ fail: 'error' }], 'primary');
      const result = await h.gateway().generate(req());
      expect(result.text.length).toBeGreaterThan(0);
    });
    const routes = await asOwner(
      async (c) =>
        (
          await c.query<{ rank: number; provider: string; model_id: string; price_id: string }>(
            `SELECT r.rank, r.provider, r.model_id,
                    (SELECT p.id::text FROM ai_gateway.model_prices p
                      WHERE p.provider = r.provider AND p.model_id = r.model_id AND p.unit = 'token'
                        AND p.effective_from <= now()
                      ORDER BY p.effective_from DESC LIMIT 1) AS price_id
               FROM ai_gateway.model_routes r WHERE r.tier = 'default' AND r.rank IN (1, 2)
              ORDER BY r.rank`,
          )
        ).rows,
    );
    expect(routes).toHaveLength(2);
    const rows = await reservationRows(accountId);
    expect(rows.map((r) => r.state)).toEqual(['released', 'settled']);
    expect(rows[0]).toMatchObject({
      provider: routes[0]!.provider,
      model_id: routes[0]!.model_id,
      price_id: routes[0]!.price_id,
    });
    expect(rows[1]).toMatchObject({
      provider: routes[1]!.provider,
      model_id: routes[1]!.model_id,
      price_id: routes[1]!.price_id,
    });
    expect(rows[1]!.provider).not.toBe(rows[0]!.provider);
    expect(rows[0]!.trace_id).not.toBeNull();
    expect(rows[1]!.trace_id).not.toBeNull();
    expect(rows[1]!.trace_id).toBe(rows[0]!.trace_id);
    // Sổ ghi nhà cung cấp THỰC của lượt dự phòng, khớp với dòng giữ chỗ.
    const [entry] = await h.inAccount(accountId, () => h.fake.ledger());
    // 015 T042: nhà cung cấp của TUYẾN rank 2 (không phải nhãn bộ chuyển đổi 'fallback').
    expect(entry?.provider).toBe(routes[1]!.provider);
    expect(entry?.provider).toBe(rows[1]!.provider);
  });

  // ----------------------------------------------------------------------------------------------------------
  // 3. TRUNG BÌNH-2: markCalling ném → trả giữ chỗ ngay, không gọi nhà cung cấp.
  // ----------------------------------------------------------------------------------------------------------
  describe('3. markCalling ném', () => {
    it('generate: giữ chỗ về released, reserved = 0, không gọi nhà cung cấp, ném lại lỗi gốc', async () => {
      const accountId = await h.newAccount();
      const store: BudgetStore = {
        ...h.bundle.store,
        markCalling: () => Promise.reject(new Error('mark-calling-boom')),
      };
      const callsBefore = h.bundle.primary.calls.length + h.bundle.fallback.calls.length;
      await h.inAccount(accountId, async () => {
        await expect(gatewayWith({ store }).generate(req())).rejects.toThrow('mark-calling-boom');
        expect(await h.fake.getBudget()).toMatchObject({ used: 0, reserved: 0 });
      });
      expect((await reservationRows(accountId)).map((r) => r.state)).toEqual(['released']);
      expect(h.bundle.primary.calls.length + h.bundle.fallback.calls.length).toBe(callsBefore);
    });

    it('generateStream: cùng kết quả', async () => {
      const accountId = await h.newAccount();
      const store: BudgetStore = {
        ...h.bundle.store,
        markCalling: () => Promise.reject(new Error('mark-calling-boom')),
      };
      await h.inAccount(accountId, async () => {
        const stream = gatewayWith({ store }).generateStream(req());
        await expect(stream.result).rejects.toThrow('mark-calling-boom');
        expect(await h.fake.getBudget()).toMatchObject({ used: 0, reserved: 0 });
      });
      expect((await reservationRows(accountId)).map((r) => r.state)).toEqual(['released']);
    });
  });

  // ----------------------------------------------------------------------------------------------------------
  // 4. TRUNG BÌNH-3: provider.stream() ném đồng bộ → trả giữ chỗ, không rò bộ hẹn giờ.
  // ----------------------------------------------------------------------------------------------------------
  describe('4. provider.stream() ném đồng bộ', () => {
    const syncThrowing = (base: AiProviderAdapter): AiProviderAdapter => ({
      provider: base.provider,
      countInputTokens: (m, p) => base.countInputTokens(m, p),
      complete: (m, p, o, s) => base.complete(m, p, o, s),
      stream: () => {
        throw new Error('stream-sync-boom');
      },
      transcribe: (m, a, s) => base.transcribe(m, a, s),
    });

    it('cả hai nhà cung cấp ném: AI_PROVIDER_UNAVAILABLE, mọi giữ chỗ released, reserved = 0, hai bộ hẹn giờ đều được xóa', async () => {
      const accountId = await h.newAccount();
      // Độ trễ riêng biệt để nhận ra đúng các bộ hẹn giờ của Cổng (kết nối CSDL cũng dùng setTimeout).
      const FIRST_MS = 7_777;
      const TOTAL_MS = 8_888;
      const created = new Map<unknown, number>();
      const cleared = new Set<unknown>();
      const realSet = globalThis.setTimeout;
      const realClear = globalThis.clearTimeout;
      const setSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
        fn: () => void,
        ms?: number,
        ...rest: unknown[]
      ) => {
        const handle = (realSet as (...a: unknown[]) => unknown)(fn, ms, ...rest);
        if (ms === FIRST_MS || ms === TOTAL_MS) created.set(handle, ms);
        return handle;
      }) as unknown as typeof setTimeout);
      const clearSpy = vi
        .spyOn(globalThis, 'clearTimeout')
        .mockImplementation((handle?: Parameters<typeof clearTimeout>[0]) => {
          cleared.add(handle);
          realClear(handle);
        });
      try {
        await h.inAccount(accountId, async () => {
          const gw = gatewayWith({
            primary: syncThrowing(h.bundle.primary),
            fallback: syncThrowing(h.bundle.fallback),
            providerTimeoutMs: TOTAL_MS,
            firstTokenTimeoutMs: FIRST_MS,
          });
          const stream = gw.generateStream(req());
          const err = await stream.result.catch((e: unknown) => e as AiError);
          expect((err as AiError).code).toBe('AI_PROVIDER_UNAVAILABLE');
          expect(await h.fake.getBudget()).toMatchObject({ used: 0, reserved: 0 });
        });
      } finally {
        setSpy.mockRestore();
        clearSpy.mockRestore();
      }
      expect((await reservationRows(accountId)).map((r) => r.state)).toEqual([
        'released',
        'released',
      ]);
      // Hai lượt × hai bộ hẹn giờ; mỗi bộ đã bị xóa (không rò sau khi lời gọi kết thúc).
      expect(created.size).toBe(4);
      for (const handle of created.keys()) expect(cleared.has(handle)).toBe(true);
    });

    it('chính ném, dự phòng chạy được: giữ chỗ chính released, dự phòng settled', async () => {
      const accountId = await h.newAccount();
      await h.inAccount(accountId, async () => {
        const gw = gatewayWith({ primary: syncThrowing(h.bundle.primary) });
        const stream = gw.generateStream(req());
        const r = await stream.result;
        expect(r.text.length).toBeGreaterThan(0);
        const b = await h.fake.getBudget();
        expect(b.reserved).toBe(0);
        expect(b.used).toBeGreaterThan(0);
      });
      expect((await reservationRows(accountId)).map((r) => r.state)).toEqual([
        'released',
        'settled',
      ]);
    });
  });

  // ----------------------------------------------------------------------------------------------------------
  // 5. TRUNG BÌNH-4: giữ chỗ hệ thống treo được dọn, chạy lại hai lần như một.
  //    Lịch `release_stale_system` ở nhánh real: xem stale-system-schedule.spec.ts (mức đơn vị). Nhánh real của module
  //    còn ném lỗi khởi động tới T049 nên không dựng được Worker thật ở đây → kiểm bằng gọi trực tiếp releaseStale.
  // ----------------------------------------------------------------------------------------------------------
  it('5. releaseStale hệ thống: held → released, calling → quyết toán theo ước tính (unsettled); chạy lần hai không đổi gì', async () => {
    await h.inSystem(async () => {
      const store = h.bundle.store;
      await store.reset();
      await store.setSystemBudget({ used: 0, reserved: 0, cap: 2_000_000 });
      const key = { scope: 'system' as const, weekStart: weekStart() };
      const sysMeta = { task: 'trend_summary' as const, modelTier: 'cheap' as const };
      const held = await store.reserve(key, 1_000, sysMeta);
      const calling = await store.reserve(key, 2_000, sysMeta);
      if (!held.ok || !calling.ok) throw new Error('giữ chỗ hệ thống phải thành công');
      await store.markCalling(calling.reservationId);
      expect((await store.usage(key)).reserved).toBe(3_000);

      // Chưa quá 15 phút → không đụng.
      expect(await store.releaseStale(15 * 60_000)).toEqual({ released: 0, settledAtEstimate: 0 });

      await h.fake.ageReservations(16 * 60_000);
      expect(await store.releaseStale(15 * 60_000)).toEqual({ released: 1, settledAtEstimate: 1 });
      const states = new Map((await h.fake.reservations()).map((r) => [r.id, r.state]));
      expect(states.get(held.reservationId)).toBe('released');
      expect(states.get(calling.reservationId)).toBe('settled');
      expect(await store.usage(key)).toMatchObject({ used: 2_000, reserved: 0 });
      const ledger = await h.fake.ledger();
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({ anomaly: 'unsettled', costMicroUsd: 2_000 });

      // Lần hai: cùng kết quả cuối, không thêm dòng sổ, không cộng lại.
      expect(await store.releaseStale(15 * 60_000)).toEqual({ released: 0, settledAtEstimate: 0 });
      expect(await store.usage(key)).toMatchObject({ used: 2_000, reserved: 0 });
      expect(await h.fake.ledger()).toHaveLength(1);
      await store.reset();
    });
  });

  // 5b. Bộ dọn bắt lỗi từng giữ chỗ: onCrossed ném → ai.settle_failed, quyết toán lại KHÔNG hook, lô không bị chặn.
  it('5b. releaseStale: onCrossed ném → vẫn quyết toán giữ chỗ (không hook), ghi ai.settle_failed, giữ chỗ khác trong lô vẫn được xử lý', async () => {
    const accountId = await h.newAccount();
    await h.inAccount(accountId, async () => {
      const store = h.bundle.store;
      const cycle = await store.currentCycleStart();
      const key = { scope: 'account' as const, cycleStart: cycle };
      // Giữ chỗ 1 làm used vượt 80% → quyết toán chạm mốc → onCrossed được gọi (và ném).
      await h.fake.setBudget({ used: 3_000_000, reserved: 0 });
      const a = await store.reserve(key, 500_000, META);
      const b = await store.reserve(key, 1_000, META);
      if (!a.ok || !b.ok) throw new Error('giữ chỗ phải thành công');
      await store.markCalling(a.reservationId);
      await store.markCalling(b.reservationId);
      await h.fake.ageReservations(16 * 60_000);
      const onCrossed = vi.fn(() => Promise.reject(new Error('hook hỏng bền')));
      const out = await store.releaseStale(15 * 60_000, { onCrossed });
      expect(onCrossed).toHaveBeenCalled();
      expect(out.settledAtEstimate).toBe(2);
      const states = new Map((await h.fake.reservations()).map((r) => [r.id, r.state]));
      expect(states.get(a.reservationId)).toBe('settled');
      expect(states.get(b.reservationId)).toBe('settled');
      expect(await h.fake.getBudget()).toMatchObject({ reserved: 0, used: 3_501_000 });
      expect(await h.fake.ledger()).toHaveLength(2);
      expect(h.logText()).toContain('ai.settle_failed');
    });
  });

  // ----------------------------------------------------------------------------------------------------------
  // 6. TRUNG BÌNH-5: gọi kho trong tenantTx/systemTx của bên gọi → lỗi lập trình rõ ràng.
  // ----------------------------------------------------------------------------------------------------------
  describe('6. không gọi Cổng AI trong giao dịch của bên gọi', () => {
    const MESSAGE = /Cổng AI không được gọi bên trong/;

    it('tài khoản: reserve/markCalling/settle/release trong tenantTx ném lỗi, không đổi ngân sách', async () => {
      const accountId = await h.newAccount();
      await h.inAccount(accountId, async () => {
        const store = h.bundle.store;
        const key = { scope: 'account' as const, cycleStart: await store.currentCycleStart() };
        // Giữ chỗ hợp lệ NGOÀI giao dịch để có mã dùng cho markCalling/settle/release.
        const r = await store.reserve(key, 1_000, META);
        if (!r.ok) throw new Error('giữ chỗ phải thành công');
        const before = await h.fake.getBudget();

        await expect(tenantTx(() => store.reserve(key, 1_000, META))).rejects.toThrow(MESSAGE);
        await expect(tenantTx(() => store.markCalling(r.reservationId))).rejects.toThrow(MESSAGE);
        await expect(
          tenantTx(() => store.settle(r.reservationId, 500, ledgerDraft)),
        ).rejects.toThrow(MESSAGE);
        await expect(tenantTx(() => store.release(r.reservationId))).rejects.toThrow(MESSAGE);

        // Không có gì bị đổi: vẫn đúng một giữ chỗ `held`, ngân sách y nguyên.
        expect(await h.fake.getBudget()).toMatchObject({
          used: before.used,
          reserved: before.reserved,
        });
        expect((await h.fake.reservations()).map((x) => x.state)).toEqual(['held']);
        await store.release(r.reservationId);
        expect(await h.fake.getBudget()).toMatchObject({ reserved: 0 });
      });
    });

    it('hệ thống: reserve trong systemTx ném lỗi', async () => {
      await h.inSystem(async () => {
        const store = h.bundle.store;
        const key = { scope: 'system' as const, weekStart: weekStart() };
        await expect(
          systemTx(() => store.reserve(key, 1_000, { task: 'trend_summary', modelTier: 'cheap' }), {
            tenant: 'none',
          }),
        ).rejects.toThrow(MESSAGE);
      });
    });
  });
});
