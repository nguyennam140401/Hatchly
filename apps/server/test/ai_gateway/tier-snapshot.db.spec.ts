import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { currentAccountId } from '../../src/core/db';
import type { AiRequest } from '../../src/modules/ai_gateway';
import { makeOnCrossed } from '../../src/modules/ai_gateway/ai_gateway.module';
import {
  DbPriceSource,
  type ModelPriceSource,
  type PriceRecord,
  type PriceUnit,
} from '../../src/modules/ai_gateway/internal/prices/db-price-source';
import { QueueEmitter } from '../../src/modules/notifications/internal/emit';
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

// T034 (US2, FR-011, FR-012) – bậc mô hình và trạng thái theo ngưỡng/trần ĐÃ CHỤP trong dòng `ai_budgets`, không theo
// hằng số 2M/4M. Cộng với: `minEstimate` của `getUsage()` (blocked hiển thị) và cờ `notified_100` cùng một nguồn
// (`store.minCallEstimateMicro()`, giá `cheap_vision` từ CSDL). Giá được đổi bằng nguồn giá bọc (nhân giá đầu ra),
// KHÔNG ghi `model_prices` (bảng chỉ-thêm dùng chung: dòng mới sẽ làm bẩn mọi ca khác).

const textReq: AiRequest = {
  task: 'post_generation',
  prompt: { system: 'Bạn là trợ lý viết bài.', delta: 'Viết bài khai trương quán cà phê.' },
  maxOutputTokens: 400,
};
const labelReq: AiRequest = {
  task: 'image_labeling',
  prompt: { system: 'Gán nhãn.', delta: 'Mô tả ảnh.' },
  maxOutputTokens: 200,
  images: [{ url: 'https://example.invalid/a.jpg', bytes: 1_000 }],
};

/** Nhân giá đầu ra của mọi mô hình token (ttl = 0: không đệm) để mô phỏng "đổi giá cheap_vision trong CSDL". */
class ScaledPriceSource implements ModelPriceSource {
  private readonly base = new DbPriceSource({ ttlMs: 0 });
  constructor(private readonly factor: number) {}
  async priceFor(
    provider: string,
    modelId: string,
    unit: PriceUnit,
    at?: Date,
  ): Promise<PriceRecord | null> {
    const rec = await this.base.priceFor(provider, modelId, unit, at);
    if (rec === null || unit !== 'token' || rec.outputPerMTokMicroUsd === null) return rec;
    return { ...rec, outputPerMTokMicroUsd: rec.outputPerMTokMicroUsd * this.factor };
  }
}

async function makeHarness(factor: number): Promise<AiHarness> {
  return makeAiHarness(
    'db',
    () => createAccount(),
    {
      onCrossed: makeOnCrossed(new QueueEmitter()),
      count: async (type) =>
        (
          await jobs(
            "data->>'type' = 'notifications.deliver' AND data->>'accountId' = $1 AND data->'payload'->'event'->>'type' = $2",
            [currentAccountId(), type],
          )
        ).length,
    },
    { prices: new ScaledPriceSource(factor) },
  );
}

/** Đổi ngưỡng mềm của dòng ngân sách hiện hành (chụp tại dòng; vai trò chủ bảng, lọc theo tài khoản của ngữ cảnh). */
async function setSoftLimit(soft: number): Promise<void> {
  const accountId = currentAccountId();
  await asOwner((c) =>
    c.query('UPDATE ai_gateway.ai_budgets SET soft_limit = $2 WHERE account_id = $1', [
      accountId,
      soft,
    ]),
  );
}

describeDb('Cổng AI thật – ngưỡng chụp trong dòng ngân sách và minEstimate hợp nhất (T034)', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  let h: AiHarness;
  let hScaled: AiHarness;
  const SCALE = 1_000;

  beforeAll(async () => {
    database = makeDatabase({ unit: 'worker', poolMax: 10 });
    stopProducer = await startTestProducer();
    h = await makeHarness(1);
    hScaled = await makeHarness(SCALE);
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });

  describe('soft_limit / cap đọc từ dòng ngân sách', () => {
    it('hạ soft_limit xuống 1,0 USD: used 1,5 USD → cheap + cheap_model (hằng số 2M sẽ cho default)', async () => {
      const accountId = await h.newAccount();
      await h.inAccount(accountId, async () => {
        await h.fake.setBudget({ used: 1_500_000, reserved: 0 });
        await setSoftLimit(1_000_000);
        expect((await h.fake.getBudget()).softLimit).toBe(1_000_000);
        expect((await h.gateway().getUsage()).state).toBe('cheap_model');
        expect((await h.gateway().generate(textReq)).modelTier).toBe('cheap');
      });
    });

    it('nâng soft_limit lên 3,0 USD: used 2,5 USD → default + normal (hằng số 2M sẽ cho cheap)', async () => {
      const accountId = await h.newAccount();
      await h.inAccount(accountId, async () => {
        await h.fake.setBudget({ used: 2_500_000, reserved: 0 });
        await setSoftLimit(3_000_000);
        expect((await h.gateway().getUsage()).state).toBe('normal');
        expect((await h.gateway().generate(textReq)).modelTier).toBe('default');
      });
    });

    it('đổi soft_limit giữa chừng trên cùng một tài khoản: bậc đổi theo ngay, đúng biên < / >=', async () => {
      const accountId = await h.newAccount();
      await h.inAccount(accountId, async () => {
        await h.fake.setBudget({ used: 1_000_000, reserved: 0 });
        await setSoftLimit(1_000_001);
        expect((await h.gateway().getUsage()).state).toBe('normal');
        await setSoftLimit(1_000_000);
        expect((await h.gateway().getUsage()).state).toBe('cheap_model');
      });
    });

    it('trần nhỏ hơn mặc định (cap 1,0 USD): phần trăm và blocked tính theo cap trong dòng, không theo 4 USD', async () => {
      const accountId = await h.newAccount();
      await h.inAccount(accountId, async () => {
        await h.fake.setBudget({ used: 0, reserved: 0, cap: 1_000_000 });
        await setSoftLimit(500_000);
        await h.fake.setBudget({ used: 600_000, reserved: 0 });
        const usage = await h.gateway().getUsage();
        expect(usage.percent).toBe(60);
        expect(usage.state).toBe('cheap_model');
        const minEst = await h.bundle.store.minCallEstimateMicro?.();
        expect(minEst).toBeGreaterThan(0);
        await h.fake.setBudget({ used: 1_000_000 - (minEst ?? 0), reserved: 0 });
        expect((await h.gateway().getUsage()).state).toBe('blocked');
      });
    });
  });

  describe('minEstimate: getUsage().blocked và cờ notified_100 cùng nguồn (giá cheap_vision trong CSDL)', () => {
    it('getUsage dùng giá CSDL: nhân giá đầu ra cheap_vision thì biên blocked dịch theo', async () => {
      const base = await h.bundle.store.minCallEstimateMicro?.();
      const scaled = await hScaled.bundle.store.minCallEstimateMicro?.();
      expect(base).toBeGreaterThan(0);
      expect(scaled).toBeGreaterThan(base ?? 0);
      const accountId = await h.newAccount();
      // Cùng ngân sách: used = cap − base − 1 → không blocked với giá gốc nhưng blocked với giá nhân lên.
      await h.inAccount(accountId, async () => {
        await h.fake.setBudget({ used: 4_000_000 - (base ?? 0) - 1, reserved: 0 });
        expect((await h.gateway().getUsage()).state).not.toBe('blocked');
        expect((await hScaled.gateway().getUsage()).state).toBe('blocked');
        // Đúng biên của giá gốc (cap − used == minEstimate): blocked, khớp quy ước `<=`.
        await h.fake.setBudget({ used: 4_000_000 - (base ?? 0), reserved: 0 });
        expect((await h.gateway().getUsage()).state).toBe('blocked');
      });
    });

    // Quyết toán một lời gọi cheap_vision đưa `used` tới đúng (cap − M − delta); đọc cờ 100% và `blocked` hiển thị.
    for (const [label, delta, flag] of [
      ['dưới biên 1 micro-USD', 1, false],
      ['đúng biên (cap − used == minEstimate)', 0, true],
    ] as const) {
      it(`ở giá đã đổi (x${SCALE}), quyết toán ${label}: notified_100 = ${flag} và blocked ${flag ? 'bật' : 'tắt'}`, async () => {
        // Lời gọi thăm dò trên tài khoản riêng để biết chi phí thực c và ước tính e của đúng yêu cầu này.
        const probeAccount = await hScaled.newAccount();
        const { c, e } = await hScaled.inAccount(probeAccount, async () => {
          await hScaled.fake.setBudget({ used: 0, reserved: 0 });
          await hScaled.gateway().generate(labelReq);
          const [entry] = await hScaled.fake.ledger();
          if (entry === undefined) throw new Error('Thiếu dòng sổ của lời gọi thăm dò');
          return { c: entry.costMicroUsd, e: entry.estimateMicroUsd };
        });
        const minEst = (await hScaled.bundle.store.minCallEstimateMicro?.()) ?? 0;
        // Đủ lớn để giữ chỗ e còn vừa trần: e − c <= minEst.
        expect(minEst).toBeGreaterThanOrEqual(e - c);

        const accountId = await hScaled.newAccount();
        await hScaled.inAccount(accountId, async () => {
          const start = 4_000_000 - minEst - delta - c;
          await hScaled.fake.setBudget({ used: start, reserved: 0 });
          await hScaled.gateway().generate(labelReq);
          const after = await hScaled.fake.getBudget();
          expect(after.used).toBe(4_000_000 - minEst - delta);
          expect(after.reserved).toBe(0);
          expect(after.notified100).toBe(flag);
          const state = (await hScaled.gateway().getUsage()).state;
          expect(state === 'blocked').toBe(flag);
          // Cùng một nguồn: ở giá gốc (nhỏ hơn nhiều) cùng số dư không còn blocked → cờ/blocked KHÔNG phải hằng số.
          const baseState = (await h.gateway().getUsage()).state;
          expect(baseState).not.toBe('blocked');
        });
      });
    }
  });
});
