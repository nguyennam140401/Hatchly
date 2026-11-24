import { describe, expect, it } from 'vitest';
import { AiError } from '../../../src/modules/ai_gateway';
import { crossedMarks } from '../../../src/modules/ai_gateway/internal/budget/budget-store';
import {
  defaultCycleStart,
  nextCycleStartsAt,
  weekStart,
} from '../../../src/modules/ai_gateway/internal/budget/system-budget';
import {
  actualTokensCost,
  estimateStt,
  estimateTokens,
  MIN_CALL_INPUT_TOKENS,
  MIN_CALL_OUTPUT_TOKENS,
  minCallEstimate,
} from '../../../src/modules/ai_gateway/internal/estimate';
import { validateAiRequest } from '../../../src/modules/ai_gateway/internal/gateway.service';
import {
  JsonPriceSource,
  PriceBook,
  type PriceEntry,
} from '../../../src/modules/ai_gateway/internal/prices/price-book';
import { pickTier } from '../../../src/modules/ai_gateway/internal/tier';

// 005 T052: ước tính (bigint, làm tròn lên), chọn hạng, bảng giá theo thời điểm, kiểm yêu cầu.

const price = (over: Partial<PriceEntry> = {}): PriceEntry => ({
  modelTier: 'default',
  modelId: 'm',
  provider: 'p',
  inputPerMTokMicroUsd: 3_000_000,
  outputPerMTokMicroUsd: 15_000_000,
  cachedInputPerMTokMicroUsd: 300_000,
  perAudioMinuteMicroUsd: 6_000,
  effectiveFrom: new Date('2026-01-01'),
  ...over,
});

describe('estimate', () => {
  it('ceil(inTok × inPrice + maxOut × outPrice) / 1e6, số nguyên, làm tròn lên', () => {
    expect(estimateTokens(price(), 1000, 1000)).toBe(18_000);
    expect(estimateTokens(price(), 1, 0)).toBe(3);
    expect(estimateTokens(price({ inputPerMTokMicroUsd: 1 }), 1, 0)).toBe(1);
    expect(estimateTokens(price(), 0, 0)).toBe(0);
    expect(Number.isInteger(estimateTokens(price(), 333, 777))).toBe(true);
  });
  it('chi phí thực: token đã đệm tính giá riêng', () => {
    expect(
      actualTokensCost(price(), { inputTokens: 1000, cachedInputTokens: 500, outputTokens: 0 }),
    ).toBe(1_650);
  });
  it('STT: ceil(min(durationSec, 300)/60 × giá/phút)', () => {
    expect(estimateStt(price(), 1000)).toBe(30_000);
    expect(estimateStt(price(), 120)).toBe(12_000);
    expect(estimateStt(price(), 1)).toBe(100);
  });
  it('minCallEstimate theo giá cheap_vision hiện hành', () => {
    const cheap = price({ inputPerMTokMicroUsd: 1_000_000, outputPerMTokMicroUsd: 5_000_000 });
    // Lời gọi nhỏ nhất thực tế: 1000 token vào + 500 token ra, tính bằng công thức chung (không số cứng).
    expect(minCallEstimate(cheap)).toBe(
      estimateTokens(cheap, MIN_CALL_INPUT_TOKENS, MIN_CALL_OUTPUT_TOKENS),
    );
    // 1000 × 1.000.000 + 500 × 5.000.000 = 3.500.000.000 / 1e6 = 3500 micro-USD.
    expect(minCallEstimate(cheap)).toBe(3_500);
    expect(Number.isInteger(minCallEstimate(price({ inputPerMTokMicroUsd: 1 })))).toBe(true);
  });
  it('minCallEstimate là ước tính THỰC TẾ (hàng nghìn micro-USD), không phải 1 token', () => {
    const cheap = price({ inputPerMTokMicroUsd: 1_000_000, outputPerMTokMicroUsd: 5_000_000 });
    expect(minCallEstimate(cheap)).toBeGreaterThan(estimateTokens(cheap, 0, 1) * 100);
    expect(MIN_CALL_INPUT_TOKENS).toBe(1000);
    expect(MIN_CALL_OUTPUT_TOKENS).toBe(500);
  });
});

describe('pickTier', () => {
  const snap = (used: number) => ({ used, reserved: 0, softLimit: 2_000_000 });
  it('bảng chọn hạng', () => {
    expect(pickTier('post_generation', snap(1_999_999))).toBe('default');
    expect(pickTier('post_generation', snap(2_000_000))).toBe('cheap');
    expect(
      pickTier('topic_suggestion', { used: 1_500_000, reserved: 500_000, softLimit: 2_000_000 }),
    ).toBe('cheap');
    expect(pickTier('image_labeling', snap(0))).toBe('cheap_vision');
    expect(pickTier('video_labeling', snap(0))).toBe('cheap_vision');
    expect(pickTier('trend_summary', snap(0))).toBe('cheap');
    expect(pickTier('transcription', snap(0))).toBe('stt');
  });
});

describe('PriceBook', () => {
  it('chọn dòng effectiveFrom <= now mới nhất; giá đổi giữa chu kỳ không tính lại quá khứ', async () => {
    const book = new PriceBook(
      new JsonPriceSource([
        { ...price({ inputPerMTokMicroUsd: 1 }), effectiveFrom: '2026-01-01T00:00:00Z' },
        { ...price({ inputPerMTokMicroUsd: 2 }), effectiveFrom: '2026-06-01T00:00:00Z' },
        { ...price({ inputPerMTokMicroUsd: 3 }), effectiveFrom: '2999-01-01T00:00:00Z' },
      ]),
    );
    await book.refresh();
    expect(book.priceFor('default', new Date('2026-03-01')).inputPerMTokMicroUsd).toBe(1);
    expect(book.priceFor('default', new Date('2026-11-12')).inputPerMTokMicroUsd).toBe(2);
    expect(() => book.priceFor('stt')).toThrow(/stt/);
  });
});

describe('validateAiRequest', () => {
  const base = {
    task: 'post_generation' as const,
    prompt: { system: 's', delta: 'd' },
    maxOutputTokens: 10,
  };
  const code = (fn: () => void) => {
    try {
      fn();
      return 'ok';
    } catch (e) {
      return (e as AiError).code;
    }
  };
  it('maxOutputTokens 1–8 192; images chỉ cho gán nhãn, ≤ 8; trend_summary chỉ hệ thống', () => {
    expect(
      code(() => {
        validateAiRequest(base, 'account');
      }),
    ).toBe('ok');
    expect(
      code(() => {
        validateAiRequest({ ...base, maxOutputTokens: 0 }, 'account');
      }),
    ).toBe('AI_INVALID_REQUEST');
    expect(
      code(() => {
        validateAiRequest({ ...base, maxOutputTokens: 8193 }, 'account');
      }),
    ).toBe('AI_INVALID_REQUEST');
    expect(
      code(() => {
        validateAiRequest({ ...base, maxOutputTokens: 1.5 }, 'account');
      }),
    ).toBe('AI_INVALID_REQUEST');
    const img = { url: 'u', bytes: 1 };
    expect(
      code(() => {
        validateAiRequest({ ...base, images: [img] }, 'account');
      }),
    ).toBe('AI_INVALID_REQUEST');
    expect(
      code(() => {
        validateAiRequest({ ...base, task: 'image_labeling', images: [img] }, 'account');
      }),
    ).toBe('ok');
    expect(
      code(() => {
        validateAiRequest(
          { ...base, task: 'image_labeling', images: Array.from({ length: 9 }, () => img) },
          'account',
        );
      }),
    ).toBe('AI_INVALID_REQUEST');
    expect(
      code(() => {
        validateAiRequest({ ...base, task: 'trend_summary' }, 'account');
      }),
    ).toBe('AI_INVALID_REQUEST');
    expect(
      code(() => {
        validateAiRequest({ ...base, task: 'trend_summary' }, 'system');
      }),
    ).toBe('ok');
    expect(
      code(() => {
        validateAiRequest({ ...base, task: 'nhiem_vu_la' as never }, 'account');
      }),
    ).toBe('AI_INVALID_REQUEST');
  });
});

describe('mốc 80/100% và chu kỳ', () => {
  it('crossedMarks', () => {
    expect(crossedMarks(3_199_999, 4_000_000, { n80: false, n100: false })).toEqual([]);
    expect(crossedMarks(3_200_000, 4_000_000, { n80: false, n100: false })).toEqual([80]);
    expect(crossedMarks(4_000_000, 4_000_000, { n80: false, n100: false })).toEqual([80, 100]);
    expect(crossedMarks(4_000_000, 4_000_000, { n80: true, n100: false })).toEqual([100]);
  });
  it('chu kỳ / tuần theo UTC+7; chu kỳ kế tiếp kẹp ngày cuối tháng', () => {
    expect(defaultCycleStart(new Date('2026-11-30T18:00:00Z'))).toBe('2026-12-01');
    expect(weekStart(new Date('2026-11-12T03:00:00Z'))).toBe('2026-11-09');
    expect(weekStart(new Date('2026-11-15T18:00:00Z'))).toBe('2026-11-16');
    expect(nextCycleStartsAt('2026-01-31').toISOString()).toBe('2026-02-27T17:00:00.000Z');
    expect(nextCycleStartsAt('2026-11-01').toISOString()).toBe('2026-11-30T17:00:00.000Z');
  });
});
