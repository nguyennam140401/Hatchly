import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { currentAccountId, systemTx, tenantTx } from '../../src/core/db';
import { AiError, type AiRequest } from '../../src/modules/ai_gateway';
import {
  actualTokensCost,
  estimateTokens,
  MIN_CALL_INPUT_TOKENS,
  MIN_CALL_OUTPUT_TOKENS,
  minCallEstimate,
} from '../../src/modules/ai_gateway/internal/estimate';
import { tokensOf } from '../../src/modules/ai_gateway/internal/fake/fake-provider';
import { AiGatewayService } from '../../src/modules/ai_gateway/internal/gateway.service';
import { DbPriceSource } from '../../src/modules/ai_gateway/internal/prices/db-price-source';
import type { PriceEntry } from '../../src/modules/ai_gateway/internal/prices/price-book';
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
import { makeAiHarness, makeDbStore, type AiHarness } from '../contracts/ai/harness';

// Vòng 2 (reviews/us1-round2-us2.md): CAO-1 (minEstimate là lời gọi nhỏ nhất THỰC TẾ, giá seed thật),
// TB-1 (getUsage khi không có mốc chu kỳ), TB-2 (lượt dự phòng dùng mô hình/giá tuyến rank 2),
// TB-3 (assertNoOuterTx ở Cổng, kể cả kho giả). Chạy `pnpm test:db`.

const req = (): AiRequest => ({
  task: 'post_generation',
  prompt: { system: 'Bạn là trợ lý viết bài.', delta: 'Viết bài khai trương quán cà phê.' },
  maxOutputTokens: 400,
});

const toEntry = (
  tier: PriceEntry['modelTier'],
  p: NonNullable<Awaited<ReturnType<DbPriceSource['priceFor']>>>,
): PriceEntry => ({
  modelTier: tier,
  modelId: p.modelId,
  provider: p.provider,
  inputPerMTokMicroUsd: p.inputPerMTokMicroUsd ?? 0,
  outputPerMTokMicroUsd: p.outputPerMTokMicroUsd ?? 0,
  cachedInputPerMTokMicroUsd: p.cachedInputPerMTokMicroUsd ?? 0,
  effectiveFrom: p.effectiveFrom,
});

/** Tuyến + giá THẬT (dữ liệu khởi đầu 0030) của một bậc theo thứ tự `rank` (0 chính, 1 dự phòng). */
async function routePrice(tier: 'default' | 'cheap_vision', index: number) {
  const task = tier === 'default' ? 'post_generation' : 'image_labeling';
  const route = (await new RouteBook({ ttlMs: 0 }).attemptsFor(task, tier))[index];
  if (route === undefined) throw new Error(`Thiếu tuyến ${tier} #${index}`);
  const price = await new DbPriceSource({ ttlMs: 0 }).priceFor(
    route.provider,
    route.modelId,
    'token',
  );
  if (price === null) throw new Error(`Thiếu giá ${tier} #${index}`);
  return { route, price: toEntry(tier, price) };
}

describeDb('Cổng AI thật – vòng 2 sau rà soát US1', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  let h: AiHarness;
  let hMem: AiHarness;

  beforeAll(async () => {
    database = makeDatabase({ unit: 'worker', poolMax: 10 });
    stopProducer = await startTestProducer();
    const notify = {
      onCrossed: makeOnCrossed(new QueueEmitter()),
      count: async (type: 'ai_usage_80' | 'ai_usage_100') =>
        (
          await jobs(
            "data->>'type' = 'notifications.deliver' AND data->>'accountId' = $1 AND data->'payload'->'event'->>'type' = $2",
            [currentAccountId(), type],
          )
        ).length,
    };
    h = await makeAiHarness('db', () => createAccount(), notify);
    hMem = await makeAiHarness('memory', () => createAccount(), notify);
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });

  // ----------------------------------------------------------------------------------------------------------
  // CAO-1: giá trị minEstimate với giá seed thật + cờ 100% theo số đã quyết toán.
  // ----------------------------------------------------------------------------------------------------------
  describe('CAO-1: minEstimate là lời gọi nhỏ nhất thực tế (giá seed thật)', () => {
    it('minCallEstimateMicro() = ước tính 1000 vào + 500 ra theo giá cheap_vision rank 1; cỡ hàng nghìn micro-USD', async () => {
      const { price } = await routePrice('cheap_vision', 0);
      const expected = estimateTokens(price, MIN_CALL_INPUT_TOKENS, MIN_CALL_OUTPUT_TOKENS);
      expect(expected).toBe(minCallEstimate(price));
      const fromStore = await h.bundle.store.minCallEstimateMicro?.();
      expect(fromStore).toBe(expected);
      // Không còn là "5 micro-USD" của lời gọi 0 vào + 1 ra.
      expect(expected).toBeGreaterThan(1_000);
      expect(expected).toBeLessThan(50_000);
    });

    it('quyết toán để used = cap − minEstimate: bật notified_100 + ai_usage_100 đúng một lần; dưới biên 1: không', async () => {
      const { price } = await routePrice('cheap_vision', 0);
      const minEst = minCallEstimate(price);
      const CAP = 4_000_000;
      const META = { task: 'post_generation' as const, modelTier: 'default' as const };
      const ledger = {
        task: 'post_generation' as const,
        modelTier: 'default' as const,
        modelId: 'fake-model',
        provider: 'fake',
        inputTokens: 10,
        outputTokens: 20,
        cachedInputTokens: 0,
        traceId: null,
      };
      for (const [below, flag] of [
        [0, true],
        [1, false],
      ] as const) {
        const accountId = await h.newAccount();
        await h.inAccount(accountId, async () => {
          const store = h.bundle.store;
          const cycle = await store.currentCycleStart();
          const key = { scope: 'account' as const, cycleStart: cycle };
          const est = 1_000;
          const usedAfter = CAP - minEst - below;
          await h.fake.setBudget({ used: usedAfter - est, reserved: 0 });
          const r = await store.reserve(key, est, META);
          if (!r.ok) throw new Error('giữ chỗ phải thành công');
          await store.markCalling(r.reservationId);
          await store.settle(r.reservationId, est, ledger, {
            onCrossed: (tx, crossed) => h.notify.onCrossed(tx, crossed, cycle),
          });
          expect(await h.fake.getBudget()).toMatchObject({
            used: usedAfter,
            reserved: 0,
            notified100: flag,
          });
          expect(await h.notify.count('ai_usage_100')).toBe(flag ? 1 : 0);
          expect((await h.gateway().getUsage()).state === 'blocked').toBe(flag);
        });
      }
    });
  });

  // ----------------------------------------------------------------------------------------------------------
  // TB-1: getUsage không ném khi không có mốc chu kỳ.
  // ----------------------------------------------------------------------------------------------------------
  it('getUsage khi getAiCycleAnchor() = null: percent 100, blocked, không ném, không tạo dòng ai_budgets', async () => {
    const accountId = await h.newAccount();
    const noAnchor = await makeDbStore({
      accountApi: { getAiCycleAnchor: () => Promise.resolve(null) },
    });
    const gw = new AiGatewayService({
      store: noAnchor,
      prices: h.bundle.prices,
      primary: h.bundle.primary,
      fallback: h.bundle.fallback,
      providerTimeoutMs: 300,
      firstTokenTimeoutMs: 300,
    });
    const countRows = () =>
      asOwner(
        async (c) =>
          (
            await c.query<{ n: string }>(
              'SELECT count(*)::text AS n FROM ai_gateway.ai_budgets WHERE account_id = $1',
              [accountId],
            )
          ).rows[0]!.n,
      );
    await h.inAccount(accountId, async () => {
      const before = await countRows();
      const t0 = Date.now();
      const usage = await gw.getUsage();
      expect(usage.percent).toBe(100);
      expect(usage.state).toBe('blocked');
      expect(Object.keys(usage).sort()).toEqual(['nextCycleStartsAt', 'percent', 'state']);
      expect(usage.nextCycleStartsAt.getTime()).toBeGreaterThanOrEqual(t0 - 1_000);
      expect(usage.nextCycleStartsAt.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
      expect(await countRows()).toBe(before);
      // Gọi AI thật vẫn bị chặn như hết hạn mức (không đổi hành vi generate).
      const err = await gw.generate(req()).catch((e: unknown) => e as AiError);
      expect((err as AiError).code).toBe('AI_BUDGET_EXHAUSTED');
      expect(await countRows()).toBe(before);
    });
  });

  // ----------------------------------------------------------------------------------------------------------
  // TB-2: lượt dự phòng dùng mô hình/giá tuyến rank 2 cho ước tính, giữ chỗ, lời gọi, quyết toán.
  // ----------------------------------------------------------------------------------------------------------
  it('lượt dự phòng: gọi đúng mã mô hình rank 2; giữ chỗ, ước tính, sổ và chi phí theo giá rank 2 (khác rank 1)', async () => {
    const first = await routePrice('default', 0);
    const second = await routePrice('default', 1);
    expect(second.route.modelId).not.toBe(first.route.modelId);

    const accountId = await h.newAccount();
    const callsBefore = h.bundle.fallback.calls.length;
    const primaryBefore = h.bundle.primary.calls.length;
    const result = await h.inAccount(accountId, async () => {
      await h.fake.script([{ fail: 'error' }], 'primary');
      return h.gateway().generate(req());
    });
    // Nhà cung cấp chính nhận mã mô hình rank 1, dự phòng nhận mã rank 2 (không dùng lại mã của lượt chính).
    expect(h.bundle.primary.calls.slice(primaryBefore).map((c) => c.model)).toEqual([
      first.route.modelId,
    ]);
    expect(h.bundle.fallback.calls.slice(callsBefore).map((c) => c.model)).toEqual([
      second.route.modelId,
    ]);

    const [entry] = await h.inAccount(accountId, () => h.fake.ledger());
    expect(entry?.modelId).toBe(second.route.modelId);
    // Chi phí thực theo GIÁ RANK 2, không phải rank 1.
    const cost2 = actualTokensCost(second.price, result.usage);
    const cost1 = actualTokensCost(first.price, result.usage);
    expect(cost2).not.toBe(cost1);
    expect(entry?.costMicroUsd).toBe(cost2);
    // Ước tính của dòng sổ theo giá rank 2: (đầu vào đếm cục bộ + max đầu ra 400).
    const inTok = tokensOf(`${req().prompt.system}\n${req().prompt.delta}`);
    expect(entry?.estimateMicroUsd).toBe(estimateTokens(second.price, inTok, 400));

    const rows = await asOwner(
      async (c) =>
        (
          await c.query<{ provider: string; model_id: string; state: string }>(
            `SELECT provider, model_id, state FROM ai_gateway.ai_reservations
              WHERE account_id = $1 ORDER BY reserved_at, id`,
            [accountId],
          )
        ).rows,
    );
    expect(rows.map((r) => [r.provider, r.model_id, r.state])).toEqual([
      [first.route.provider, first.route.modelId, 'released'],
      [second.route.provider, second.route.modelId, 'settled'],
    ]);
  });

  // ----------------------------------------------------------------------------------------------------------
  // TB-3: assertNoOuterTx ở tầng Cổng – kho giả (memory) cũng nổ lỗi lập trình.
  // ----------------------------------------------------------------------------------------------------------
  describe('assertNoOuterTx ở Cổng với kho giả (memory)', () => {
    const MESSAGE = /Cổng AI không được gọi bên trong/;

    it('generate / generateStream / transcribe trong tenantTx: ném lỗi lập trình, không gọi nhà cung cấp, không giữ chỗ', async () => {
      const accountId = await hMem.newAccount();
      const calls = () => hMem.bundle.primary.calls.length + hMem.bundle.fallback.calls.length;
      await hMem.inAccount(accountId, async () => {
        const before = calls();
        const gw = hMem.gateway();
        await expect(tenantTx(() => gw.generate(req()))).rejects.toThrow(MESSAGE);
        await expect(tenantTx(() => gw.generateStream(req()).result)).rejects.toThrow(MESSAGE);
        await expect(
          tenantTx(() =>
            gw.transcribe({
              audioUrl: 'https://example.invalid/a.mp3',
              durationSec: 10,
              language: 'vi',
            }),
          ),
        ).rejects.toThrow(MESSAGE);
        expect(calls()).toBe(before);
        expect(await hMem.fake.reservations()).toHaveLength(0);
        // Ngoài giao dịch thì vẫn chạy bình thường.
        expect((await gw.generate(req())).text.length).toBeGreaterThan(0);
      });
    });

    it('system.generate trong systemTx: ném lỗi lập trình', async () => {
      await hMem.inSystem(async () => {
        const before = hMem.bundle.primary.calls.length + hMem.bundle.fallback.calls.length;
        await expect(
          systemTx(
            () =>
              hMem.gateway().system.generate({
                task: 'trend_summary',
                prompt: { system: 'Tóm tắt xu hướng.', delta: 'Tuần này.' },
                maxOutputTokens: 200,
                industryId: '01900000-0000-7000-8000-000000000001',
              }),
            { tenant: 'none' },
          ),
        ).rejects.toThrow(MESSAGE);
        expect(hMem.bundle.primary.calls.length + hMem.bundle.fallback.calls.length).toBe(before);
      });
    });
  });
});
