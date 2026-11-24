import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiError, type AiRequest } from '../../src/modules/ai_gateway';
import { actualTokensCost } from '../../src/modules/ai_gateway/internal/estimate';
import { AiGatewayService } from '../../src/modules/ai_gateway/internal/gateway.service';
import { DbPriceSource } from '../../src/modules/ai_gateway/internal/prices/db-price-source';
import type {
  AiProviderAdapter,
  PartialUsage,
} from '../../src/modules/ai_gateway/internal/providers/provider';
import { ProviderCallError } from '../../src/modules/ai_gateway/internal/providers/provider-error';
import { makeAiHarness, type AiHarness } from '../contracts/ai/harness';
import { createAccount, describeDb, makeDatabase, type TestDatabase } from '../db/helpers/db';
import { startTestProducer } from '../support/queue-test-kit';
import { insertPrice, reservationRows, stubRoutes, uniqueModel } from './helpers/price-fixtures';
import {
  OK_RESULT,
  spied,
  StubAdapter,
  untilAborted,
  type Spy,
  type StreamRun,
} from './helpers/stub-adapter';

// 015 US4 (reviews/us4.md mục 3, 4, 5, 6) trên kho THẬT `DbBudgetStore` (bảng ai_gateway.*), nhà cung cấp giả viết tay,
// bộ chuyển đổi chọn theo `provider` của tuyến (`adapterFor`) như driver `real`. Khác bản bộ nhớ (us4-gateway-abort-interrupt):
//  - dòng sổ THẬT có cột `anomaly` = 'missing_usage' và đúng MỘT dòng cho luồng đứt,
//  - giữ chỗ chuyển trạng thái đúng trong bảng (`released`/`settled`), reserved = 0,
//  - bộ chuyển đổi thiếu (khóa chưa nạp) → AI_NOT_CONFIGURED trước khi giữ chỗ.
// Chạy `pnpm test:db`.

const HOUR = 3_600_000;
const req = (over: Partial<AiRequest> = {}): AiRequest => ({
  task: 'post_generation',
  prompt: { system: 'Bạn là trợ lý viết bài.', delta: 'US4_CANARY Viết bài khai trương.' },
  maxOutputTokens: 400,
  ...over,
});

describeDb('Cổng AI – kho thật: hủy/đứt/giá bộ đệm/bộ chuyển đổi thiếu (US4)', () => {
  const a = uniqueModel('a');
  const b = uniqueModel('b');
  let database: TestDatabase;
  let h: AiHarness;

  let stopProducer: () => Promise<void>;

  beforeAll(async () => {
    database = makeDatabase({ unit: 'worker', poolMax: 10 });
    stopProducer = await startTestProducer(); // giữ chỗ hẹn việc dọn `ai_gateway.release_stale` qua hàng chờ
    // Giá: vào 1 000 000, ra 2 000 000, đọc đệm 100 000 micro-USD / 1 triệu token.
    for (const m of [a, b]) {
      await insertPrice(m, {
        effectiveFrom: new Date(Date.now() - HOUR),
        input: 1_000_000,
        output: 2_000_000,
        cached: 100_000,
      });
    }
    h = await makeAiHarness(
      'db',
      () => createAccount(),
      { onCrossed: () => Promise.resolve(), count: () => Promise.resolve(0) },
      { routes: stubRoutes(a, b), prices: new DbPriceSource({ ttlMs: 0 }) },
    );
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });

  interface Rig {
    primary: StubAdapter;
    fallback: StubAdapter;
    spy: Spy;
    gw: AiGatewayService;
    /** Đặt `true` → `adapterFor` không có bộ chuyển đổi cho nhà cung cấp lượt chính (khóa chưa nạp). */
    missing: { primary: boolean };
  }

  function rig(o: { providerTimeoutMs?: number; firstTokenTimeoutMs?: number } = {}): Rig {
    const primary = new StubAdapter(a.provider);
    const fallback = new StubAdapter(b.provider);
    const spy: Spy = { settles: [] };
    const missing = { primary: false };
    const adapterFor = (provider: string): AiProviderAdapter | undefined =>
      provider === a.provider ? (missing.primary ? undefined : primary) : fallback;
    const gw = new AiGatewayService({
      store: spied(h.bundle.store, spy),
      primary, // chỉ dùng để ước tính token (countInputTokens → 500)
      fallback,
      adapterFor,
      providerTimeoutMs: o.providerTimeoutMs ?? 3_000,
      firstTokenTimeoutMs: o.firstTokenTimeoutMs ?? 3_000,
    });
    return { primary, fallback, spy, gw, missing };
  }

  const priceA = () => ({
    modelTier: 'default' as const,
    modelId: a.modelId,
    provider: a.provider,
    inputPerMTokMicroUsd: 1_000_000,
    outputPerMTokMicroUsd: 2_000_000,
    cachedInputPerMTokMicroUsd: 100_000,
    effectiveFrom: new Date(),
  });

  const inFreshAccount = async <T>(fn: (id: string) => Promise<T>): Promise<T> => {
    const id = await createAccount();
    return h.inAccount(id, () => fn(id));
  };

  const TEXT = 'Xin chào các bạn, hôm nay quán mở cửa sớm';
  const emitThenFail =
    (partial?: PartialUsage): StreamRun =>
    async (emit) => {
      emit('Xin chào ');
      emit('các bạn, hôm nay quán mở cửa sớm');
      await new Promise((r) => setTimeout(r, 10));
      const err = new ProviderCallError(a.provider, 'network');
      if (partial !== undefined) err.partialUsage = partial;
      throw err;
    };

  describe('(3) hủy trước khi gọi', () => {
    it('generate: tín hiệu đã hủy từ trước → không giữ chỗ, không gọi nhà cung cấp, không sổ', async () => {
      await inFreshAccount(async (id) => {
        const r = rig();
        const c = new AbortController();
        c.abort();
        const err = await r.gw.generate(req(), { signal: c.signal }).catch((e: unknown) => e);
        expect((err as AiError).code).toBe('AI_PROVIDER_UNAVAILABLE');
        expect(r.primary.invoked.complete + r.fallback.invoked.complete).toBe(0);
        expect(
          (await reservationRows(id)).filter((x) => ['held', 'calling'].includes(x.state)),
        ).toEqual([]);
        expect(await h.fake.getBudget()).toMatchObject({ used: 0, reserved: 0 });
        expect(await h.fake.ledger()).toEqual([]);
      });
    });

    it('generate: hủy ngay sau markCalling → giữ chỗ released, không gọi nhà cung cấp, không dự phòng, reserved = 0', async () => {
      await inFreshAccount(async (id) => {
        const r = rig();
        const c = new AbortController();
        r.spy.afterMarkCalling = () => {
          c.abort();
        };
        const err = await r.gw.generate(req(), { signal: c.signal }).catch((e: unknown) => e);
        expect((err as AiError).code).toBe('AI_PROVIDER_UNAVAILABLE');
        expect(r.primary.invoked.complete).toBe(0);
        expect(r.fallback.invoked.complete).toBe(0);
        expect((await reservationRows(id)).map((x) => x.state)).toEqual(['released']);
        expect(await h.fake.getBudget()).toMatchObject({ used: 0, reserved: 0 });
        expect(await h.fake.ledger()).toEqual([]);
      });
    });

    it('generateStream: cancel() ngay sau markCalling → không "ra ngoài", giữ chỗ released, không sổ', async () => {
      await inFreshAccount(async (id) => {
        const r = rig();
        const s = r.gw.generateStream(req());
        r.spy.afterMarkCalling = () => {
          s.cancel();
        };
        const out = await s.result;
        expect(out.text).toBe('');
        expect(r.primary.network.stream).toBe(0);
        expect(r.fallback.invoked.stream).toBe(0);
        expect((await reservationRows(id)).map((x) => x.state)).toEqual(['released']);
        expect(await h.fake.getBudget()).toMatchObject({ used: 0, reserved: 0 });
        expect(await h.fake.ledger()).toEqual([]);
      });
    });
  });

  describe('(4) luồng đứt giữa chừng – dòng sổ thật', () => {
    it('đứt SAU chữ, có usage từ Anthropic: interrupted, không dự phòng, ĐÚNG một dòng sổ anomaly=missing_usage, giữ chỗ settled, reserved = 0', async () => {
      await inFreshAccount(async (id) => {
        const r = rig();
        r.primary.onStream = emitThenFail({
          inputTokens: 300,
          outputTokens: 1,
          cachedInputTokens: 100,
          cacheWriteInputTokens: 50,
        });
        const out = await r.gw.generateStream(req()).result;
        expect(out.interrupted).toBe(true);
        expect(out.text).toBe(TEXT);
        expect(r.fallback.invoked.stream).toBe(0);

        const ledger = await h.fake.ledger();
        expect(ledger).toHaveLength(1);
        expect(ledger[0]!.anomaly).toBe('missing_usage');
        expect(ledger[0]!.inputTokens).toBe(300);
        expect(ledger[0]!.outputTokens).toBe(Math.ceil(Buffer.byteLength(TEXT, 'utf8') / 3));
        const expected = Math.min(
          actualTokensCost(priceA(), {
            inputTokens: 300,
            outputTokens: ledger[0]!.outputTokens,
            cachedInputTokens: 100,
            cacheWriteInputTokens: 50,
          }),
          ledger[0]!.estimateMicroUsd,
        );
        expect(ledger[0]!.costMicroUsd).toBe(expected);
        expect(ledger[0]!.provider).toBe(a.provider);
        expect((await reservationRows(id)).map((x) => [x.state, x.provider])).toEqual([
          ['settled', a.provider],
        ]);
        expect(await h.fake.getBudget()).toMatchObject({ reserved: 0, used: expected });
      });
    });

    it('đứt SAU chữ, không có usage: đầu vào = ước tính cục bộ (500), kẹp ≤ giữ chỗ, anomaly=missing_usage, một dòng sổ', async () => {
      await inFreshAccount(async () => {
        const r = rig();
        r.primary.onStream = emitThenFail();
        // maxOutputTokens = 1: giữ chỗ 500×1 + 1×2 = 502; chi phí theo chữ đã sinh lớn hơn → kẹp.
        const out = await r.gw.generateStream(req({ maxOutputTokens: 1 })).result;
        expect(out.interrupted).toBe(true);
        const ledger = await h.fake.ledger();
        expect(ledger).toHaveLength(1);
        expect(ledger[0]!.anomaly).toBe('missing_usage');
        expect(ledger[0]!.inputTokens).toBe(500);
        expect(ledger[0]!.estimateMicroUsd).toBe(502);
        expect(ledger[0]!.costMicroUsd).toBeLessThanOrEqual(502);
        expect(ledger[0]!.costMicroUsd).toBe(502);
        expect(await h.fake.getBudget()).toMatchObject({ reserved: 0 });
      });
    });

    it('đứt TRƯỚC khi có chữ → lượt chính released, dự phòng settled đúng một lần theo tuyến rank 2; sổ ghi nhà cung cấp dự phòng, không missing_usage', async () => {
      await inFreshAccount(async (id) => {
        const r = rig();
        r.primary.onStream = () => Promise.reject(new ProviderCallError(a.provider, 'server', 503));
        const out = await r.gw.generateStream(req()).result;
        expect(out.interrupted).not.toBe(true);
        expect(out.text).toBe('Xin chào');
        expect(r.primary.invoked.stream).toBe(1);
        expect(r.fallback.invoked.stream).toBe(1);
        expect((await reservationRows(id)).map((x) => [x.state, x.provider])).toEqual([
          ['released', a.provider],
          ['settled', b.provider],
        ]);
        const ledger = await h.fake.ledger();
        expect(ledger).toHaveLength(1);
        expect(ledger[0]!.provider).toBe(b.provider);
        expect(ledger[0]!.anomaly).toBeNull();
      });
    });

    it('người dùng hủy giữa chừng (hành vi cũ): một dòng sổ, anomaly KHÔNG phải missing_usage, không dự phòng, reserved = 0', async () => {
      await inFreshAccount(async (id) => {
        const r = rig();
        r.primary.onStream = async (emit, signal) => {
          emit('Xin chào ');
          return untilAborted(a.provider, signal);
        };
        const s = r.gw.generateStream(req());
        for await (const chunk of s) {
          if (chunk.delta !== '') s.cancel();
        }
        const out = await s.result;
        expect(out.interrupted).not.toBe(true);
        expect(out.text).toBe('Xin chào ');
        expect(r.fallback.invoked.stream).toBe(0);
        const ledger = await h.fake.ledger();
        expect(ledger).toHaveLength(1);
        expect(ledger[0]!.anomaly).not.toBe('missing_usage');
        expect((await reservationRows(id)).map((x) => x.state)).toEqual(['settled']);
        expect(await h.fake.getBudget()).toMatchObject({ reserved: 0 });
      });
    });
  });

  describe('(5) giá bộ đệm trong sổ thật', () => {
    // vào 1000 (đọc đệm 200, ghi đệm 300, thường 500), ra 100:
    // 500×1 + 300×1×1,25 + 200×0,1 + 100×2 = 500 + 375 + 20 + 200 = 1095 micro-USD. Ước tính = 500×1 + 400×2 = 1300.
    const CACHED = {
      ...OK_RESULT,
      inputTokens: 1000,
      outputTokens: 100,
      cachedInputTokens: 200,
      cacheWriteInputTokens: 300,
    };

    it('generate: cost = 1095, estimate = 1300 (ước tính không cộng hệ số ghi đệm), không anomaly', async () => {
      await inFreshAccount(async () => {
        const r = rig();
        r.primary.onComplete = () => Promise.resolve(CACHED);
        await r.gw.generate(req());
        const [row] = await h.fake.ledger();
        expect(row!.costMicroUsd).toBe(1095);
        expect(row!.estimateMicroUsd).toBe(1300);
        expect(row!.anomaly).toBeNull();
        expect(r.spy.settles[0]!.actual).toBe(1095);
      });
    });

    it('generateStream: cùng công thức (1095)', async () => {
      await inFreshAccount(async () => {
        const r = rig();
        r.primary.onStream = (emit) => {
          emit('ok');
          return Promise.resolve(CACHED);
        };
        await r.gw.generateStream(req()).result;
        const [row] = await h.fake.ledger();
        expect(row!.costMicroUsd).toBe(1095);
        expect(row!.estimateMicroUsd).toBe(1300);
      });
    });
  });

  describe('(6) bộ chuyển đổi của tuyến không có (khóa chưa nạp)', () => {
    it('lượt chính thiếu bộ chuyển đổi → AI_NOT_CONFIGURED trước khi giữ chỗ (không giữ chỗ, không sổ, không gọi ai)', async () => {
      await inFreshAccount(async (id) => {
        const r = rig();
        r.missing.primary = true;
        const err = await r.gw.generate(req()).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AiError);
        expect((err as AiError).code).toBe('AI_NOT_CONFIGURED');
        expect(r.primary.invoked.complete + r.fallback.invoked.complete).toBe(0);
        expect(await reservationRows(id)).toEqual([]);
        expect(await h.fake.ledger()).toEqual([]);
        expect(await h.fake.getBudget()).toMatchObject({ used: 0, reserved: 0 });
        // Thông báo lỗi không lộ khóa hay lời nhắc.
        const text = `${(err as Error).message}\n${(err as Error).stack ?? ''}`;
        expect(text).not.toContain('US4_CANARY');
        expect(text).not.toMatch(/sk-[A-Za-z0-9]/);
      });
    });

    it('lượt dự phòng thiếu bộ chuyển đổi → bỏ lượt: lỗi chính thì AI_PROVIDER_UNAVAILABLE (không AI_NOT_CONFIGURED), chỉ một giữ chỗ released', async () => {
      await inFreshAccount(async (id) => {
        const primary = new StubAdapter(a.provider);
        primary.onComplete = () => Promise.reject(new ProviderCallError(a.provider, 'server', 500));
        const gw = new AiGatewayService({
          store: h.bundle.store,
          primary,
          fallback: primary,
          adapterFor: (p) => (p === a.provider ? primary : undefined),
          providerTimeoutMs: 3_000,
          firstTokenTimeoutMs: 3_000,
        });
        const err = await gw.generate(req()).catch((e: unknown) => e);
        expect((err as AiError).code).toBe('AI_PROVIDER_UNAVAILABLE');
        expect((await reservationRows(id)).map((x) => x.state)).toEqual(['released']);
      });
    });
  });
});
