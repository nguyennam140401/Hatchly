import { beforeAll, describe, expect, it } from 'vitest';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { AiError, type AiRequest } from '../../src/modules/ai_gateway';
import { actualTokensCost } from '../../src/modules/ai_gateway/internal/estimate';
import { AiGatewayService } from '../../src/modules/ai_gateway/internal/gateway.service';
import type {
  PartialUsage,
  ProviderResult,
} from '../../src/modules/ai_gateway/internal/providers/provider';
import { ProviderCallError } from '../../src/modules/ai_gateway/internal/providers/provider-error';
import { makeAiHarness, type AiHarness } from '../contracts/ai/harness';
import {
  OK_RESULT,
  spied,
  StubAdapter,
  untilAborted,
  type Spy,
  type StreamRun,
} from './helpers/stub-adapter';

// 015 US4 (reviews/us4.md mục 3, 4, 5) ở tầng Cổng AI, kho `memory` (pnpm test), nhà cung cấp là bản giả viết tay để điều
// khiển chính xác điểm đứt/hủy:
//  (3) hủy từ trước hoặc ngay sau markCalling → trả giữ chỗ, KHÔNG gọi nhà cung cấp, reserved = 0.
//  (4) luồng đứt SAU khi có chữ → interrupted, KHÔNG dự phòng, quyết toán theo partialUsage hoặc byte/3 (kẹp ≤ giữ chỗ),
//      sổ anomaly='missing_usage' (kiểm ở lời gọi settle vì kho bộ nhớ không lưu cột này – xem us4-gateway.db.spec.ts cho
//      dòng sổ thật), đúng MỘT dòng sổ; đứt TRƯỚC khi có chữ → dự phòng đúng một lần; người dùng hủy → hành vi cũ.
//  (5) giá bộ đệm đi tới sổ; ước tính giữ chỗ không đổi.

const req = (over: Partial<AiRequest> = {}): AiRequest => ({
  task: 'post_generation',
  prompt: { system: 'Bạn là trợ lý viết bài.', delta: 'Viết bài khai trương quán cà phê.' },
  maxOutputTokens: 400,
  ...over,
});

let h: AiHarness;
beforeAll(async () => {
  h = await makeAiHarness('memory', () => Promise.resolve(uuidV7()), {
    onCrossed: () => Promise.resolve(),
    count: () => Promise.resolve(0),
  });
});

interface Rig {
  primary: StubAdapter;
  fallback: StubAdapter;
  spy: Spy;
  gw: AiGatewayService;
}

function rig(o: { providerTimeoutMs?: number; firstTokenTimeoutMs?: number } = {}): Rig {
  const primary = new StubAdapter('stub-primary');
  const fallback = new StubAdapter('stub-fallback');
  const spy: Spy = { settles: [] };
  const gw = new AiGatewayService({
    store: spied(h.bundle.store, spy),
    prices: h.bundle.prices,
    primary,
    fallback,
    providerTimeoutMs: o.providerTimeoutMs ?? 2_000,
    firstTokenTimeoutMs: o.firstTokenTimeoutMs ?? 2_000,
  });
  return { primary, fallback, spy, gw };
}

const inAccount = <T>(fn: () => Promise<T>): Promise<T> => h.inAccount(uuidV7(), fn);
const states = async () => (await h.fake.reservations()).map((r) => r.state);
const defaultPrice = () => h.bundle.prices.priceFor('default');

async function expectClean(): Promise<void> {
  expect(await h.fake.getBudget()).toMatchObject({ used: 0, reserved: 0 });
  expect(await h.fake.ledger()).toEqual([]);
}

describe('(3) hủy trước khi gọi nhà cung cấp', () => {
  it('generate: tín hiệu đã hủy từ trước → AI_PROVIDER_UNAVAILABLE, không gọi nhà cung cấp, reserved = 0, không sổ', async () => {
    await inAccount(async () => {
      const { gw, primary, fallback } = rig();
      const c = new AbortController();
      c.abort();
      const err = await gw.generate(req(), { signal: c.signal }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AiError);
      expect((err as AiError).code).toBe('AI_PROVIDER_UNAVAILABLE');
      expect(primary.invoked).toEqual({ complete: 0, stream: 0 });
      expect(fallback.invoked).toEqual({ complete: 0, stream: 0 });
      await expectClean();
      expect((await states()).filter((x) => x === 'held' || x === 'calling')).toEqual([]);
    });
  });

  it('generate: hủy NGAY SAU markCalling → trả giữ chỗ (released), không gọi nhà cung cấp, không dự phòng, reserved = 0', async () => {
    await inAccount(async () => {
      const c = new AbortController();
      const r = rig();
      r.spy.afterMarkCalling = () => {
        c.abort();
      };
      const err = await r.gw.generate(req(), { signal: c.signal }).catch((e: unknown) => e);
      expect((err as AiError).code).toBe('AI_PROVIDER_UNAVAILABLE');
      expect(r.primary.invoked.complete).toBe(0);
      expect(r.fallback.invoked.complete).toBe(0);
      expect(await states()).toEqual(['released']);
      await expectClean();
    });
  });

  it('generateStream: cancel() trước khi giữ chỗ → kết quả rỗng, không giữ chỗ/gọi nhà cung cấp, không sổ', async () => {
    await inAccount(async () => {
      const { gw, primary, fallback } = rig();
      const s = gw.generateStream(req());
      s.cancel();
      const out = await s.result;
      expect(out.text).toBe('');
      expect(primary.invoked.stream + fallback.invoked.stream).toBe(0);
      expect(await states()).toEqual([]);
      await expectClean();
    });
  });

  it('generateStream: cancel() ngay sau markCalling → không "ra ngoài", trả giữ chỗ, không dự phòng, không sổ', async () => {
    await inAccount(async () => {
      const r = rig();
      const s = r.gw.generateStream(req());
      r.spy.afterMarkCalling = () => {
        s.cancel();
      };
      const out = await s.result;
      expect(out.text).toBe('');
      expect(r.primary.network.stream).toBe(0);
      expect(r.fallback.invoked.stream).toBe(0);
      expect(await states()).toEqual(['released']);
      await expectClean();
    });
  });
});

describe('(4) luồng đứt giữa chừng', () => {
  const PARTS = ['Xin chào ', 'các bạn, hôm nay quán mở cửa sớm'];
  const TEXT = PARTS.join('');
  const bytesOf = (t: string) => Buffer.byteLength(t, 'utf8');
  const cut = (partial?: PartialUsage) => {
    const err = new ProviderCallError('stub-primary', 'network');
    if (partial !== undefined) err.partialUsage = partial;
    return err;
  };
  /** Phát các đoạn rồi đứt (sau một nhịp để Cổng kịp nhận chữ). */
  const emitThenFail =
    (err: Error): StreamRun =>
    async (emit) => {
      for (const p of PARTS) emit(p);
      await new Promise((r) => setTimeout(r, 10));
      throw err;
    };

  it('có usage từ nhà cung cấp (Anthropic message_start): interrupted, không dự phòng, một dòng sổ, quyết toán theo usage báo + byte/3, sổ missing_usage', async () => {
    await inAccount(async () => {
      const r = rig();
      r.primary.onStream = emitThenFail(
        cut({
          inputTokens: 300,
          outputTokens: 1,
          cachedInputTokens: 100,
          cacheWriteInputTokens: 6,
        }),
      );
      const s = r.gw.generateStream(req());
      let seen = '';
      for await (const c of s) seen += c.delta;
      const out = await s.result;

      expect(out.interrupted).toBe(true);
      expect(out.text).toBe(TEXT);
      expect(seen).toBe(TEXT);
      expect(r.primary.invoked.stream).toBe(1);
      expect(r.fallback.invoked.stream).toBe(0); // KHÔNG tự dự phòng

      const outputTokens = Math.max(1, Math.ceil(bytesOf(TEXT) / 3));
      expect(out.usage).toEqual({ inputTokens: 300, outputTokens, cachedInputTokens: 100 });

      expect(r.spy.settles).toHaveLength(1);
      const { actual, ledger: draft } = r.spy.settles[0]!;
      expect(draft.anomaly).toBe('missing_usage');
      const ledger = await h.fake.ledger();
      expect(ledger).toHaveLength(1);
      const expected = Math.min(
        actualTokensCost(defaultPrice(), {
          inputTokens: 300,
          outputTokens,
          cachedInputTokens: 100,
          cacheWriteInputTokens: 6,
        }),
        ledger[0]!.estimateMicroUsd,
      );
      expect(actual).toBe(expected);
      expect(actual).toBeLessThanOrEqual(ledger[0]!.estimateMicroUsd);
      expect(await states()).toEqual(['settled']);
      expect((await h.fake.getBudget()).reserved).toBe(0);
    });
  });

  it('usage báo ra nhiều hơn byte/3 → dùng số lớn hơn (không hạ thấp chi phí)', async () => {
    await inAccount(async () => {
      const r = rig();
      r.primary.onStream = emitThenFail(
        cut({ inputTokens: 300, outputTokens: 90, cachedInputTokens: 0 }),
      );
      const out = await r.gw.generateStream(req()).result;
      expect(out.usage.outputTokens).toBe(Math.max(90, Math.ceil(bytesOf(TEXT) / 3)));
    });
  });

  it('không có usage (OpenAI/đứt trước message_start): đầu vào = ước tính cục bộ, đầu ra = byte/3, kẹp ≤ giữ chỗ, sổ missing_usage', async () => {
    await inAccount(async () => {
      const r = rig();
      r.primary.onStream = emitThenFail(cut());
      // maxOutputTokens = 1 → giữ chỗ nhỏ (500×3 + 15 = 1515) < chi phí ước theo chữ đã sinh → phải bị kẹp.
      const out = await r.gw.generateStream(req({ maxOutputTokens: 1 })).result;
      expect(out.interrupted).toBe(true);
      expect(out.text).toBe(TEXT);
      expect(out.usage.inputTokens).toBe(500); // countInputTokens của bộ ước tính, không có ảnh
      expect(out.usage.outputTokens).toBe(Math.ceil(bytesOf(TEXT) / 3));
      expect(r.fallback.invoked.stream).toBe(0);

      const ledger = await h.fake.ledger();
      expect(ledger).toHaveLength(1);
      expect(ledger[0]!.estimateMicroUsd).toBe(1515);
      expect(r.spy.settles).toHaveLength(1);
      expect(r.spy.settles[0]!.ledger.anomaly).toBe('missing_usage');
      const unclamped = actualTokensCost(defaultPrice(), {
        inputTokens: 500,
        outputTokens: out.usage.outputTokens,
        cachedInputTokens: 0,
      });
      expect(unclamped).toBeGreaterThan(1515); // tiền đề của ca: nếu không kẹp sẽ vượt giữ chỗ
      expect(r.spy.settles[0]!.actual).toBe(1515); // kẹp ≤ giữ chỗ
      expect((await h.fake.getBudget()).reserved).toBe(0);
    });
  });

  it('hết thời gian tổng SAU khi đã có chữ cũng là luồng đứt: interrupted, không dự phòng', async () => {
    await inAccount(async () => {
      const r = rig({ providerTimeoutMs: 150, firstTokenTimeoutMs: 150 });
      r.primary.onStream = async (emit, signal) => {
        emit('Xin chào ');
        return untilAborted('stub-primary', signal);
      };
      const out = await r.gw.generateStream(req()).result;
      expect(out.interrupted).toBe(true);
      expect(out.text).toBe('Xin chào ');
      expect(r.fallback.invoked.stream).toBe(0);
      expect(await h.fake.ledger()).toHaveLength(1);
      expect((await h.fake.getBudget()).reserved).toBe(0);
    });
  });

  it('đứt khi CHƯA có chữ → trả giữ chỗ rồi dự phòng ĐÚNG MỘT lần; không interrupted; một dòng sổ của lượt dự phòng', async () => {
    await inAccount(async () => {
      const r = rig();
      r.primary.onStream = () => Promise.reject(cut());
      r.fallback.onStream = (emit) => {
        emit('Chào bạn');
        return Promise.resolve({ ...OK_RESULT, text: 'Chào bạn', modelId: 'fb-model' });
      };
      const out = await r.gw.generateStream(req()).result;
      expect(out.interrupted).not.toBe(true);
      expect(out.text).toBe('Chào bạn');
      expect(r.primary.invoked.stream).toBe(1);
      expect(r.fallback.invoked.stream).toBe(1);
      expect(await states()).toEqual(['released', 'settled']);
      const ledger = await h.fake.ledger();
      expect(ledger).toHaveLength(1);
      expect(ledger[0]!.provider).toBe('stub-fallback');
      expect(r.spy.settles[0]!.ledger.anomaly).toBeUndefined();
      expect((await h.fake.getBudget()).reserved).toBe(0);
    });
  });

  it('hết thời gian chờ chữ ĐẦU TIÊN (chưa có chữ) → dự phòng đúng một lần', async () => {
    await inAccount(async () => {
      const r = rig({ providerTimeoutMs: 2_000, firstTokenTimeoutMs: 60 });
      r.primary.onStream = (_emit, signal) => untilAborted('stub-primary', signal);
      const out = await r.gw.generateStream(req()).result;
      expect(out.text).toBe('Xin chào');
      expect(r.primary.invoked.stream).toBe(1);
      expect(r.fallback.invoked.stream).toBe(1);
      expect(out.interrupted).not.toBe(true);
    });
  });

  it('cả hai lượt đứt khi chưa có chữ → AI_PROVIDER_UNAVAILABLE, đúng 2 lời gọi, cả hai giữ chỗ released, không sổ', async () => {
    await inAccount(async () => {
      const r = rig();
      r.primary.onStream = () => Promise.reject(cut());
      r.fallback.onStream = () =>
        Promise.reject(new ProviderCallError('stub-fallback', 'server', 503));
      const s = r.gw.generateStream(req());
      const err = await s.result.catch((e: unknown) => e);
      expect((err as AiError).code).toBe('AI_PROVIDER_UNAVAILABLE');
      expect(r.primary.invoked.stream).toBe(1);
      expect(r.fallback.invoked.stream).toBe(1);
      expect(await states()).toEqual(['released', 'released']);
      await expectClean();
    });
  });

  it('lượt chính đứt SAU chữ + lượt dự phòng sẵn sàng: dự phòng KHÔNG bao giờ được gọi (không trộn hai bản)', async () => {
    await inAccount(async () => {
      const r = rig();
      r.primary.onStream = emitThenFail(cut());
      const out = await r.gw.generateStream(req()).result;
      expect(out.interrupted).toBe(true);
      expect(r.fallback.invoked.stream).toBe(0);
      expect(r.fallback.network.stream).toBe(0);
    });
  });

  it('người dùng hủy giữa chừng (hành vi cũ): quyết toán phần đã sinh theo ký tự/4, một dòng sổ, KHÔNG interrupted, KHÔNG missing_usage, không dự phòng', async () => {
    await inAccount(async () => {
      const r = rig();
      r.primary.onStream = async (emit, signal) => {
        emit('Xin chào ');
        return untilAborted('stub-primary', signal);
      };
      const s = r.gw.generateStream(req());
      for await (const chunk of s) {
        if (chunk.delta !== '') s.cancel();
      }
      const out = await s.result;
      expect(out.interrupted).not.toBe(true);
      expect(out.text).toBe('Xin chào ');
      expect(out.usage).toEqual({
        inputTokens: 500,
        outputTokens: Math.ceil('Xin chào '.length / 4),
        cachedInputTokens: 0,
      });
      expect(r.fallback.invoked.stream).toBe(0);
      expect(await h.fake.ledger()).toHaveLength(1);
      expect(r.spy.settles).toHaveLength(1);
      expect(r.spy.settles[0]!.ledger.anomaly).toBeUndefined();
      expect(await states()).toEqual(['settled']);
      expect((await h.fake.getBudget()).reserved).toBe(0);
    });
  });

  it('luồng đủ: không có cờ interrupted', async () => {
    await inAccount(async () => {
      const r = rig();
      const out = await r.gw.generateStream(req()).result;
      expect(out.interrupted).not.toBe(true);
      expect(out.text).toBe('Xin chào');
    });
  });
});

describe('(5) giá bộ đệm đi tới sổ, ước tính giữ chỗ không đổi', () => {
  // Giá `default` giả: vào 3 000 000, ra 15 000 000, đọc đệm 300 000 (micro-USD / 1 triệu token).
  const CACHED: ProviderResult = {
    text: 'ok',
    inputTokens: 1000,
    outputTokens: 100,
    cachedInputTokens: 200,
    cacheWriteInputTokens: 300,
    modelId: 'stub-model',
  };
  const NO_CACHE: ProviderResult = { ...CACHED };
  delete NO_CACHE.cacheWriteInputTokens;

  it('generate: chi phí sổ = 500×3 + 300×3×1,25 + 200×0,3 + 100×15 = 4185; ghi đệm không đổi ước tính (7500)', async () => {
    await inAccount(async () => {
      const r = rig();
      r.primary.onComplete = () => Promise.resolve(CACHED);
      await r.gw.generate(req());
      const [row] = await h.fake.ledger();
      expect(row!.costMicroUsd).toBe(4185);
      expect(row!.estimateMicroUsd).toBe(7500); // 500 token vào ước tính × 3 + 400 token ra tối đa × 15
      expect(row!.anomaly).toBeNull();
    });
  });

  it('generate: cùng usage nhưng không ghi đệm → rẻ hơn đúng 25 % phần ghi (4185 − 225 = 3960), ước tính y hệt', async () => {
    await inAccount(async () => {
      const r = rig();
      r.primary.onComplete = () => Promise.resolve(NO_CACHE);
      await r.gw.generate(req());
      const [row] = await h.fake.ledger();
      expect(row!.costMicroUsd).toBe(3960);
      expect(row!.estimateMicroUsd).toBe(7500);
    });
  });

  it('generateStream: final có cacheWriteInputTokens → cùng công thức (4185), ước tính 7500', async () => {
    await inAccount(async () => {
      const r = rig();
      r.primary.onStream = (emit) => {
        emit('ok');
        return Promise.resolve(CACHED);
      };
      await r.gw.generateStream(req()).result;
      const [row] = await h.fake.ledger();
      expect(row!.costMicroUsd).toBe(4185);
      expect(row!.estimateMicroUsd).toBe(7500);
    });
  });

  it('usage thực vượt giữ chỗ (ghi đệm toàn bộ): sổ ghi over_estimate, ngân sách vẫn ≤ trần và reserved = 0', async () => {
    await inAccount(async () => {
      const r = rig();
      // 6000 token vào, toàn bộ ghi đệm: 6000×3×1,25 = 22 500 + 100×15 > ước tính 7500.
      r.primary.onComplete = () =>
        Promise.resolve({
          ...CACHED,
          inputTokens: 6000,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 6000,
        });
      await r.gw.generate(req());
      const [row] = await h.fake.ledger();
      expect(row!.costMicroUsd).toBe(24_000);
      expect(row!.anomaly).toBe('over_estimate');
      const b = await h.fake.getBudget();
      expect(b.reserved).toBe(0);
      expect(b.used).toBeLessThanOrEqual(b.cap);
    });
  });
});
