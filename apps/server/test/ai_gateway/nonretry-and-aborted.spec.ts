import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setGatewayLogSink, type GatewayLogEntry } from '../../src/core/gateways/op-log';
import { AiError, noRetryOnAiError } from '../../src/modules/ai_gateway';
import {
  instrumented,
  ProviderCallError,
} from '../../src/modules/ai_gateway/internal/providers/provider-error';

// 015 T081.
// (1) FR-037: `noRetryOnAiError` – hết hạn mức / trùng yêu cầu / chưa cấu hình → kết thúc lượt không thử lại (không đốt hàng
//     chờ); lỗi nhà cung cấp tạm thời (và lỗi lạ) được ném lại để hàng chờ thử lại theo chính sách.
// (2) Outcome `aborted`: người dùng hủy KHÔNG phải lỗi nhà cung cấp → không tăng ai_gateway_provider_calls_total{outcome="error"}
//     (không làm tỷ lệ lỗi > 5% của AiProviderErrorRatioHigh) và không phát `ai.provider_error`.

const recorded = vi.hoisted(() => ({
  calls: [] as { provider: string; outcome: string }[],
  events: [] as string[],
}));

vi.mock('../../src/modules/ai_gateway/internal/metrics', async (orig) => {
  const actual = await orig<typeof import('../../src/modules/ai_gateway/internal/metrics')>();
  return {
    ...actual,
    recordProviderCall: (provider: string, outcome: string) => {
      recorded.calls.push({ provider, outcome });
    },
    recordGatewayEvent: (name: string) => {
      recorded.events.push(name);
    },
  };
});

describe('noRetryOnAiError (FR-037)', () => {
  it.each([
    'AI_BUDGET_EXHAUSTED',
    'AI_SYSTEM_BUDGET_EXHAUSTED',
    'AI_DUPLICATE_REQUEST',
    'AI_NOT_CONFIGURED',
  ] as const)('%s → kết thúc lượt không thử lại, lý do chỉ là mã lỗi', (code) => {
    const out = noRetryOnAiError(new AiError(code));
    expect(out).toMatchObject({ kind: 'no_retry', reason: code });
  });

  it('AI_PROVIDER_UNAVAILABLE → ném lại nguyên lỗi để hàng chờ thử lại theo chính sách', () => {
    const err = new AiError('AI_PROVIDER_UNAVAILABLE');
    expect(() => noRetryOnAiError(err)).toThrow(err);
  });

  it('AI_INVALID_REQUEST và lỗi không phải AiError → ném lại, không nuốt lỗi', () => {
    const invalid = new AiError('AI_INVALID_REQUEST');
    expect(() => noRetryOnAiError(invalid)).toThrow(invalid);
    const other = new Error('mất kết nối CSDL');
    expect(() => noRetryOnAiError(other)).toThrow(other);
  });

  it('lý do không chứa lời nhắc hay số tiền (chỉ mã lỗi)', () => {
    const out = noRetryOnAiError(new AiError('AI_BUDGET_EXHAUSTED'));
    expect(JSON.stringify(out)).not.toMatch(/usd|micro|\d{4,}/i);
  });
});

describe('outcome aborted không phải lỗi nhà cung cấp', () => {
  let logs: GatewayLogEntry[];
  beforeEach(() => {
    recorded.calls.length = 0;
    recorded.events.length = 0;
    logs = [];
    setGatewayLogSink({
      write: (e) => {
        logs.push(e);
      },
    });
  });
  afterEach(() => {
    setGatewayLogSink(undefined);
  });

  const providerErrors = () => logs.filter((l) => l.msg === 'ai.provider_error');

  it('tín hiệu đã hủy từ trước: ghi outcome=aborted, không gọi run, không error, không ai.provider_error', async () => {
    const c = new AbortController();
    c.abort();
    const run = vi.fn(() => Promise.resolve('x'));
    const err = await instrumented('anthropic', c.signal, run).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderCallError);
    expect((err as ProviderCallError).kind).toBe('aborted');
    expect(run).not.toHaveBeenCalled();
    expect(recorded.calls).toEqual([{ provider: 'anthropic', outcome: 'aborted' }]);
    expect(recorded.calls.some((x) => x.outcome === 'error')).toBe(false);
    expect(providerErrors()).toEqual([]);
    expect(recorded.events).not.toContain('ai.provider_error');
  });

  it('hủy giữa chừng (run ném lỗi khi tín hiệu đã hủy): aborted, không error, không ai.provider_error', async () => {
    const c = new AbortController();
    const err = await instrumented('openai', c.signal, () => {
      c.abort();
      return Promise.reject(new Error('The operation was aborted'));
    }).catch((e: unknown) => e);
    expect((err as ProviderCallError).kind).toBe('aborted');
    expect(recorded.calls).toEqual([{ provider: 'openai', outcome: 'aborted' }]);
    expect(providerErrors()).toEqual([]);
    expect(recorded.events).not.toContain('ai.provider_error');
  });

  it('lỗi SDK AbortError/APIUserAbortError (không cần signal.aborted) cũng là aborted', async () => {
    for (const name of ['AbortError', 'APIUserAbortError']) {
      recorded.calls.length = 0;
      const e = Object.assign(new Error('x'), { name });
      const err = await instrumented('anthropic', new AbortController().signal, () =>
        Promise.reject(e),
      ).catch((x: unknown) => x);
      expect((err as ProviderCallError).kind).toBe('aborted');
      expect(recorded.calls).toEqual([{ provider: 'anthropic', outcome: 'aborted' }]);
    }
    expect(providerErrors()).toEqual([]);
  });

  it('đối chứng: lỗi 5xx thật VẪN tính outcome=error và phát ai.provider_error (không làm yếu cảnh báo)', async () => {
    const err = await instrumented('anthropic', new AbortController().signal, () =>
      Promise.reject(Object.assign(new Error('boom'), { status: 503 })),
    ).catch((e: unknown) => e);
    expect((err as ProviderCallError).kind).toBe('server');
    expect(recorded.calls).toEqual([{ provider: 'anthropic', outcome: 'error' }]);
    expect(providerErrors()).toHaveLength(1);
    expect(providerErrors()[0]).toMatchObject({
      provider: 'anthropic',
      kind: 'server',
      status: 503,
    });
  });

  it('lời gọi thành công: outcome=ok, không sự kiện lỗi', async () => {
    const out = await instrumented('anthropic', new AbortController().signal, () =>
      Promise.resolve(42),
    );
    expect(out).toBe(42);
    expect(recorded.calls).toEqual([{ provider: 'anthropic', outcome: 'ok' }]);
    expect(providerErrors()).toEqual([]);
  });
});
