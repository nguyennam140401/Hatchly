import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { currentAccountId } from '../../src/core/db';
import { AiError, type AiRequest } from '../../src/modules/ai_gateway';
import { minCallEstimate } from '../../src/modules/ai_gateway/internal/estimate';
import { DbPriceSource } from '../../src/modules/ai_gateway/internal/prices/db-price-source';
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

// T033 (US2, FR-012, FR-033) – chọn bậc theo ngưỡng mềm trên kho THẬT (pnpm test:db), qua Cổng AI.
// Viết TRƯỚC mã T034/T035: ca nào đỏ trước khi backend-dev xong thì ghi rõ ở từng ca. Ngưỡng mềm 2.000.000 và trần
// 4.000.000 micro-USD là mặc định của dòng ngân sách (đã chụp vào dòng); bên gọi không chọn được mô hình.

const CAP = 4_000_000;
const SOFT = 2_000_000;
const textReq = (task: 'post_generation' | 'topic_suggestion'): AiRequest => ({
  task,
  prompt: { system: 'Bạn là trợ lý viết bài.', delta: 'Viết bài khai trương quán cà phê.' },
  maxOutputTokens: 400,
});
const labelReq = (task: 'image_labeling' | 'video_labeling'): AiRequest => ({
  task,
  prompt: { system: 'Gán nhãn.', delta: 'Mô tả ảnh.' },
  maxOutputTokens: 200,
  images: [{ url: 'https://example.invalid/a.jpg', bytes: 1_000 }],
});

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

describeDb('Cổng AI thật – bậc mô hình theo ngưỡng mềm (US2)', () => {
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

  /** Ước tính nhỏ nhất theo ĐÚNG nguồn mà `getUsage()` ở chế độ db dùng: giá `cheap_vision` trong CSDL (015). */
  const gatewayMinEstimate = () => minEstimateFromDb();

  const providerCalls = () => h.bundle.primary.calls.length + h.bundle.fallback.calls.length;

  describe('post_generation / topic_suggestion: 1,99 / 2,00 / 2,01 USD', () => {
    const cases = [
      { label: '1,99 USD', used: 1_990_000, tier: 'default' },
      { label: '2,00 USD (đúng ngưỡng)', used: 2_000_000, tier: 'cheap' },
      { label: '2,01 USD', used: 2_010_000, tier: 'cheap' },
    ] as const;
    for (const task of ['post_generation', 'topic_suggestion'] as const) {
      for (const c of cases) {
        it(`${task} ở ${c.label} → ${c.tier}`, async () => {
          const accountId = await h.newAccount();
          await h.inAccount(accountId, async () => {
            await h.fake.setBudget({ used: c.used, reserved: 0 });
            const r = await h.gateway().generate(textReq(task));
            expect(r.modelTier).toBe(c.tier);
            const [entry] = await h.fake.ledger();
            expect(entry?.modelTier).toBe(c.tier);
          });
        });
      }
    }

    it('giữ chỗ của lượt khác cũng tính vào ngưỡng (used 1,5 + reserved 0,5 USD → cheap)', async () => {
      const accountId = await h.newAccount();
      await h.inAccount(accountId, async () => {
        await h.fake.setBudget({ used: 1_500_000, reserved: 500_000 });
        expect((await h.gateway().generate(textReq('post_generation'))).modelTier).toBe('cheap');
      });
    });

    it('FR-012: lời gọi đẩy tổng qua 2 USD vẫn chạy bậc mặc định; lời gọi SAU mới rẻ', async () => {
      const accountId = await h.newAccount();
      await h.inAccount(accountId, async () => {
        await h.fake.setBudget({ used: SOFT - 1, reserved: 0 });
        const first = await h.gateway().generate(textReq('post_generation'));
        expect(first.modelTier).toBe('default');
        const after = await h.fake.getBudget();
        // Lời gọi đã đẩy tổng qua ngưỡng mềm (chi phí thực >= 1 micro-USD).
        expect(after.used).toBeGreaterThanOrEqual(SOFT);
        expect(after.used).toBeLessThan(CAP);
        const second = await h.gateway().generate(textReq('post_generation'));
        expect(second.modelTier).toBe('cheap');
        const state = (await h.gateway().getUsage()).state;
        expect(state).toBe('cheap_model');
      });
    });
  });

  describe('bậc cố định theo loại việc', () => {
    it('image_labeling / video_labeling luôn cheap_vision, kể cả dưới và trên ngưỡng mềm', async () => {
      for (const used of [0, 2_500_000]) {
        const accountId = await h.newAccount();
        await h.inAccount(accountId, async () => {
          await h.fake.setBudget({ used, reserved: 0 });
          expect((await h.gateway().generate(labelReq('image_labeling'))).modelTier).toBe(
            'cheap_vision',
          );
          expect((await h.gateway().generate(labelReq('video_labeling'))).modelTier).toBe(
            'cheap_vision',
          );
        });
      }
    });

    it('xu hướng (trend_summary, ngân sách hệ thống) luôn cheap', async () => {
      await h.inSystem(async () => {
        const store = h.bundle.store;
        await store.setSystemBudget({ used: 0, reserved: 0, cap: 2_000_000 });
        const r = await h.gateway().system.generate({
          task: 'trend_summary',
          prompt: { system: 'Tóm tắt xu hướng.', delta: 'Tuần này.' },
          maxOutputTokens: 200,
          industryId: '01900000-0000-7000-8000-000000000001',
        });
        expect(r.modelTier).toBe('cheap');
        await store.reset();
      });
    });
  });

  describe('trạng thái blocked: used + reserved >= cap − minCallEstimate', () => {
    it('ĐÚNG biên là blocked; dưới biên 1 thì cheap_model; trên trần 4 USD không có số tiền trong kết quả', async () => {
      const accountId = await h.newAccount();
      await h.inAccount(accountId, async () => {
        const minEst = await gatewayMinEstimate();
        expect(minEst).toBeGreaterThan(0);
        await h.fake.setBudget({ used: CAP - minEst - 1, reserved: 0 });
        expect((await h.gateway().getUsage()).state).toBe('cheap_model');
        await h.fake.setBudget({ used: CAP - minEst, reserved: 0 });
        const usage = await h.gateway().getUsage();
        expect(usage.state).toBe('blocked');
        // Chỉ phần trăm trên trần, không có số tiền (hiến chương III).
        expect(Object.keys(usage).sort()).toEqual(['nextCycleStartsAt', 'percent', 'state']);
      });
    });

    it('giữ chỗ cũng được tính: used + reserved == cap − minEstimate → blocked', async () => {
      const accountId = await h.newAccount();
      await h.inAccount(accountId, async () => {
        const minEst = await gatewayMinEstimate();
        await h.fake.setBudget({ used: 1_000_000, reserved: CAP - 1_000_000 - minEst });
        expect((await h.gateway().getUsage()).state).toBe('blocked');
        await h.fake.setBudget({ used: 1_000_000, reserved: CAP - 1_000_000 - minEst - 1 });
        expect((await h.gateway().getUsage()).state).not.toBe('blocked');
      });
    });
  });

  describe('T035: mô hình rẻ cũng không đủ ngân sách còn lại', () => {
    // ĐỎ TẠM nếu T035 chưa xong: phải từ chối AI_BUDGET_EXHAUSTED, không gọi nhà cung cấp, không để lại giữ chỗ.
    it('còn 1 micro-USD (đã quá ngưỡng mềm, bậc cheap): AI_BUDGET_EXHAUSTED, không gọi nhà cung cấp, reserved = 0', async () => {
      const accountId = await h.newAccount();
      await h.inAccount(accountId, async () => {
        await h.fake.setBudget({ used: CAP - 1, reserved: 0 });
        const before = providerCalls();
        const err = await h
          .gateway()
          .generate(textReq('post_generation'))
          .catch((e: unknown) => e as AiError);
        expect((err as AiError).code).toBe('AI_BUDGET_EXHAUSTED');
        expect(providerCalls()).toBe(before);
        expect(await h.fake.getBudget()).toMatchObject({ used: CAP - 1, reserved: 0 });
        expect(await h.fake.reservations()).toHaveLength(0);
        // Trần cứng: tổng chi không vượt 4 USD, và các lời gọi nhãn cũng bị chặn như hết hạn mức.
        const labelErr = await h
          .gateway()
          .generate(labelReq('image_labeling'))
          .catch((e: unknown) => e as AiError);
        expect((labelErr as AiError).code).toBe('AI_BUDGET_EXHAUSTED');
        expect(providerCalls()).toBe(before);
      });
      const rows = await asOwner(
        async (c) =>
          (
            await c.query('SELECT 1 FROM ai_gateway.ai_reservations WHERE account_id = $1', [
              accountId,
            ])
          ).rowCount,
      );
      expect(rows).toBe(0);
    });

    it('đã blocked (used = cap − minEstimate): lời gọi có ước tính > phần còn lại bị chặn, vẫn không gọi nhà cung cấp', async () => {
      const accountId = await h.newAccount();
      await h.inAccount(accountId, async () => {
        const minEst = await minEstimateFromDb();
        await h.fake.setBudget({ used: CAP - minEst, reserved: 0 });
        expect((await h.gateway().getUsage()).state).toBe('blocked');
        const before = providerCalls();
        // minEstimate là lời gọi nhỏ nhất THỰC TẾ (1000 vào + 500 ra): yêu cầu lớn hơn thế (8192 token ra) luôn có
        // ước tính > phần còn lại (= minEst) nên bị chặn; yêu cầu nhỏ hơn ước tính nhỏ nhất thì không nằm trong ca này.
        const big = (task: 'post_generation' | 'topic_suggestion'): AiRequest => ({
          ...textReq(task),
          maxOutputTokens: 8192,
        });
        for (const req of [big('post_generation'), big('topic_suggestion')]) {
          const err = await h
            .gateway()
            .generate(req)
            .catch((e: unknown) => e as AiError);
          expect((err as AiError).code).toBe('AI_BUDGET_EXHAUSTED');
        }
        expect(providerCalls()).toBe(before);
        expect((await h.fake.getBudget()).reserved).toBe(0);
      });
    });

    it('cheap_vision: chưa blocked (còn minEstimate + 1) nhưng không đủ ước tính → AI_BUDGET_EXHAUSTED, không gọi nhà cung cấp', async () => {
      const accountId = await h.newAccount();
      await h.inAccount(accountId, async () => {
        const minEst = await minEstimateFromDb();
        await h.fake.setBudget({ used: CAP - minEst - 1, reserved: 0 });
        expect((await h.gateway().getUsage()).state).not.toBe('blocked');
        const before = providerCalls();
        const err = await h
          .gateway()
          .generate({ ...labelReq('image_labeling'), maxOutputTokens: 4000 })
          .catch((e: unknown) => e as AiError);
        // Ước tính của 1 ảnh (800 token vào + 4000 ra) lớn hơn hẳn phần còn lại (minEstimate + 1 ≈ 3,6 nghìn micro-USD).
        expect((err as AiError).code).toBe('AI_BUDGET_EXHAUSTED');
        expect(providerCalls()).toBe(before);
        expect(await h.fake.reservations()).toHaveLength(0);
        expect((await h.fake.getBudget()).reserved).toBe(0);
      });
    });

    it('hệ thống (trend_summary, bậc cheap): ngân sách hệ thống không đủ → AI_SYSTEM_BUDGET_EXHAUSTED, không gọi nhà cung cấp', async () => {
      await h.inSystem(async () => {
        const store = h.bundle.store;
        await store.setSystemBudget({ used: 2_000_000 - 1, reserved: 0, cap: 2_000_000 });
        const before = providerCalls();
        try {
          const err = await h
            .gateway()
            .system.generate({
              task: 'trend_summary',
              prompt: { system: 'Tóm tắt xu hướng.', delta: 'Tuần này.' },
              maxOutputTokens: 200,
              industryId: '01900000-0000-7000-8000-000000000001',
            })
            .catch((e: unknown) => e as AiError);
          expect((err as AiError).code).toBe('AI_SYSTEM_BUDGET_EXHAUSTED');
          expect(providerCalls()).toBe(before);
          expect(await store.reservations()).toHaveLength(0);
        } finally {
          await store.reset();
        }
      });
    });
  });
});
