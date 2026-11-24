import { describe, expect, it } from 'vitest';
import {
  actualTokensCost,
  CACHE_WRITE_MULTIPLIER_PERCENT,
  estimateTokens,
} from '../../src/modules/ai_gateway/internal/estimate';
import type { PriceEntry } from '../../src/modules/ai_gateway/internal/prices/price-book';
import { AnthropicAdapter } from '../../src/modules/ai_gateway/internal/providers/anthropic';
import { OpenAiAdapter } from '../../src/modules/ai_gateway/internal/providers/openai';
import {
  buildAdapterIfKeyed,
  buildAdapters,
} from '../../src/modules/ai_gateway/internal/providers/registry';

// 015 US4 (reviews/us4.md mục 5, 6): giá bộ đệm và dựng bộ chuyển đổi lười. Thuần, không CSDL, không mạng.

const KEY_A = 'sk-ant-KEYCANARY-aaaaaaaaaaaaaaaa';
const KEY_O = 'sk-oai-KEYCANARY-bbbbbbbbbbbbbbbb';

const price = (over: Partial<PriceEntry> = {}): PriceEntry => ({
  modelTier: 'default',
  modelId: 'm',
  provider: 'p',
  inputPerMTokMicroUsd: 3_000_000,
  outputPerMTokMicroUsd: 15_000_000,
  cachedInputPerMTokMicroUsd: 300_000,
  effectiveFrom: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

/** Công thức tham chiếu viết độc lập: ceil((fresh×in×100 + write×in×125 + read×cin×100 + out×outp×100) / 10^8). */
function reference(
  p: PriceEntry,
  u: { input: number; output: number; read: number; write: number },
): number {
  const write = Math.min(u.write, Math.max(0, u.input - u.read));
  const fresh = Math.max(0, u.input - u.read - write);
  const num =
    BigInt(fresh) * BigInt(p.inputPerMTokMicroUsd) * 100n +
    BigInt(write) * BigInt(p.inputPerMTokMicroUsd) * 125n +
    BigInt(u.read) * BigInt(p.cachedInputPerMTokMicroUsd) * 100n +
    BigInt(u.output) * BigInt(p.outputPerMTokMicroUsd) * 100n;
  const den = 100_000_000n;
  return Number((num + den - 1n) / den);
}

describe('giá bộ đệm (reviews/us4.md mục 5)', () => {
  it('hệ số ghi bộ đệm là 125 % và là bigint', () => {
    expect(CACHE_WRITE_MULTIPLIER_PERCENT).toBe(125n);
    expect(typeof CACHE_WRITE_MULTIPLIER_PERCENT).toBe('bigint');
  });

  it('ví dụ số tay: vào 1000 (đọc đệm 200, ghi đệm 300, thường 500), ra 100 → 4185 micro-USD', () => {
    // 500×3 + 300×3×1,25 + 200×0,3 + 100×15 = 1500 + 1125 + 60 + 1500
    expect(
      actualTokensCost(price(), {
        inputTokens: 1000,
        outputTokens: 100,
        cachedInputTokens: 200,
        cacheWriteInputTokens: 300,
      }),
    ).toBe(4185);
  });

  it('cache_creation tính giá nhập × 1,25: đắt hơn tính thường đúng 25 % phần ghi; cache_read dùng giá đọc-bộ-đệm', () => {
    const p = price();
    const asNormal = actualTokensCost(p, {
      inputTokens: 1000,
      outputTokens: 0,
      cachedInputTokens: 0,
    });
    const withWrite = actualTokensCost(p, {
      inputTokens: 1000,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 1000,
    });
    expect(asNormal).toBe(3000);
    expect(withWrite).toBe(3750);
    const readOnly = actualTokensCost(p, {
      inputTokens: 1000,
      outputTokens: 0,
      cachedInputTokens: 1000,
    });
    expect(readOnly).toBe(300); // 1000 × 300 000 / 10^6
  });

  it('vắng cacheWriteInputTokens / bằng 0 → công thức cũ (không đổi so với trước US4)', () => {
    const p = price();
    const u = { inputTokens: 777, outputTokens: 333, cachedInputTokens: 111 };
    const old = actualTokensCost(p, u);
    expect(actualTokensCost(p, { ...u, cacheWriteInputTokens: 0 })).toBe(old);
    expect(actualTokensCost(p, { ...u, cacheWriteInputTokens: undefined })).toBe(old);
    expect(old).toBe(reference(p, { input: 777, output: 333, read: 111, write: 0 }));
  });

  it('làm tròn LÊN ở mọi tổ hợp (khớp công thức tham chiếu bigint, giá lẻ)', () => {
    const p = price({
      inputPerMTokMicroUsd: 2_345_679,
      outputPerMTokMicroUsd: 11_111_111,
      cachedInputPerMTokMicroUsd: 234_567,
    });
    for (const input of [1, 7, 333, 1000, 123_457]) {
      for (const read of [0, 1, 100]) {
        for (const write of [0, 1, 50, 999]) {
          for (const output of [0, 1, 99]) {
            const u = { input: Math.max(input, read), output, read, write };
            expect(
              actualTokensCost(p, {
                inputTokens: u.input,
                outputTokens: u.output,
                cachedInputTokens: u.read,
                cacheWriteInputTokens: u.write,
              }),
            ).toBe(reference(p, u));
          }
        }
      }
    }
  });

  it('phần ghi lớn hơn (tổng vào − đọc) bị kẹp, không tính âm/lặp token', () => {
    const p = price();
    const clamped = actualTokensCost(p, {
      inputTokens: 100,
      outputTokens: 0,
      cachedInputTokens: 40,
      cacheWriteInputTokens: 10_000,
    });
    expect(clamped).toBe(
      actualTokensCost(p, {
        inputTokens: 100,
        outputTokens: 0,
        cachedInputTokens: 40,
        cacheWriteInputTokens: 60,
      }),
    );
  });

  it('ước tính giữ chỗ KHÔNG đổi: chỉ phụ thuộc token vào ước tính + tối đa ra, giá thường (chặn trên)', () => {
    const p = price();
    // ceil((500×3 000 000 + 400×15 000 000) / 10^6) = 1500 + 6000
    expect(estimateTokens(p, 500, 400)).toBe(7500);
    // Hàm ước tính không nhận đối số bộ đệm nào → không thể đổi theo cache.
    expect(estimateTokens.length).toBe(3);
    // Trường hợp thường gặp: lượt đầu ghi bộ đệm toàn bộ tiền tố vẫn ≤ ước tính (có biên an toàn 20 % ở token ước tính).
    const inTok = 500; // đã gồm biên an toàn
    const actualAllWrite = actualTokensCost(p, {
      inputTokens: 400,
      outputTokens: 400,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 400,
    });
    expect(actualAllWrite).toBeLessThanOrEqual(estimateTokens(p, inTok, 400));
  });
});

describe('dựng bộ chuyển đổi lười (reviews/us4.md mục 6)', () => {
  const opts = (keys: { anthropic?: string; openai?: string }) => ({
    keys,
    safetyPercent: 20,
    sttAllowedHosts: [],
  });

  it('tuyến đổi sang nhà cung cấp chưa dựng nhưng khóa đã nạp → dựng được đúng loại', () => {
    const a = buildAdapterIfKeyed('anthropic', opts({ anthropic: KEY_A }));
    const o = buildAdapterIfKeyed('openai', opts({ openai: KEY_O }));
    expect(a).toBeInstanceOf(AnthropicAdapter);
    expect(a?.provider).toBe('anthropic');
    expect(o).toBeInstanceOf(OpenAiAdapter);
    expect(o?.provider).toBe('openai');
  });

  it('chỉ có khóa của nhà cung cấp kia → vẫn không dựng được nhà cung cấp này (không mượn khóa)', () => {
    expect(buildAdapterIfKeyed('anthropic', opts({ openai: KEY_O }))).toBeUndefined();
    expect(buildAdapterIfKeyed('openai', opts({ anthropic: KEY_A }))).toBeUndefined();
  });

  it('khóa thiếu / nhà cung cấp lạ → undefined, KHÔNG ném (Cổng trả AI_NOT_CONFIGURED), không in khóa', () => {
    for (const [name, keys] of [
      ['anthropic', {}],
      ['openai', {}],
      ['unknown-ai', { anthropic: KEY_A, openai: KEY_O }],
    ] as const) {
      let out: unknown;
      expect(() => {
        out = buildAdapterIfKeyed(name, opts(keys));
      }).not.toThrow();
      expect(out).toBeUndefined();
    }
  });

  it('buildAdapters (lúc khởi động): chỉ dựng nhà cung cấp của tuyến đã bật; thiếu khóa → lỗi nêu TÊN biến, không in khóa', () => {
    const only = buildAdapters(['openai'], opts({ openai: KEY_O }));
    expect([...only.keys()]).toEqual(['openai']);

    let msg = '';
    try {
      buildAdapters(['anthropic', 'openai'], opts({ openai: KEY_O }));
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('ANTHROPIC_API_KEY');
    expect(msg).not.toContain('OPENAI_API_KEY');
    expect(msg).not.toContain('KEYCANARY');

    expect(() => buildAdapters(['unknown-ai'], opts({}))).toThrow(/unknown-ai/);
  });
});
