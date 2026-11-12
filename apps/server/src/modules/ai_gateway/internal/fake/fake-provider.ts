import { createHash } from 'node:crypto';
import { z } from 'zod';
import { currentAccountId } from '../../../../core/db';
import type { ScenarioStore } from '../../../../dev/fake-components';
import type {
  AiProviderAdapter,
  OrderedPrompt,
  ProviderResult,
  ProviderStream,
} from '../providers/provider';

// Nhà cung cấp AI GIẢ (005, contracts/ai-gateway.md mục 4) – `primary` và `fallback`. Văn bản tất định
// `"[fake:{task}] " + sha256(prompt).slice(0,8)` lặp tới số token đầu ra; trả dần theo đoạn 8 token; đếm
// token = ký tự ÷ 4 (làm tròn lên). Kịch bản (component=ai, target `provider:{tên}` hoặc `*`), mỗi lời
// gọi tiêu một bước. Không gọi ra ngoài.

export const FakeAiStep = z.strictObject({
  latencyMs: z.number().int().min(0).max(120_000).optional(),
  firstTokenMs: z.number().int().min(0).max(120_000).optional(),
  fail: z.enum(['error', 'timeout']).optional(),
  outputTokens: z.number().int().min(0).max(8192).optional(),
  actualCostMultiplier: z.number().min(0).max(100).optional(),
});
export type FakeAiStep = z.infer<typeof FakeAiStep>;

export const tokensOf = (text: string) => Math.ceil(text.length / 4);

export interface FakeProviderCall {
  provider: string;
  kind: 'complete' | 'stream' | 'transcribe';
  model: string;
  task: string;
}

const DEFAULT_OUTPUT_TOKENS = 48;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    });
  });
}

export class FakeAiProvider implements AiProviderAdapter {
  readonly calls: FakeProviderCall[] = [];
  /** Kiểm thử gắn để quan sát trạng thái lúc nhà cung cấp nhận lời gọi (vd giữ chỗ phải `calling`). */
  onCall: ((call: FakeProviderCall) => Promise<void>) | undefined;

  constructor(
    readonly provider: string,
    private readonly scenarios: () => Promise<ScenarioStore>,
  ) {}

  private async step(): Promise<FakeAiStep> {
    // Kịch bản gắn tài khoản; việc hệ thống (không tài khoản) chạy theo mặc định.
    if (currentAccountId() === null) return {};
    const store = await this.scenarios();
    const found = await store.take('ai', `provider:${this.provider}`);
    if (found === null) return {};
    const parsed = FakeAiStep.safeParse(found.spec);
    return parsed.success ? parsed.data : {};
  }

  private async begin(kind: FakeProviderCall['kind'], model: string, task: string): Promise<FakeAiStep> {
    const call = { provider: this.provider, kind, model, task };
    this.calls.push(call);
    await this.onCall?.(call);
    return this.step();
  }

  private textFor(p: OrderedPrompt, outputTokens: number): string {
    const seed = `[fake:${p.task}] ${createHash('sha256').update(p.parts.join('\n')).digest('hex').slice(0, 8)} `;
    const chars = outputTokens * 4;
    let out = '';
    while (out.length < chars) out += seed;
    return out.slice(0, chars);
  }

  countInputTokens(_model: string, prompt: OrderedPrompt): Promise<number> {
    return Promise.resolve(tokensOf(prompt.parts.join('\n')));
  }

  private async fail(s: FakeAiStep, signal: AbortSignal): Promise<void> {
    if (s.fail === 'error') throw new Error('FAKE_PROVIDER_ERROR');
    if (s.fail === 'timeout') {
      await wait(600_000, signal);
      throw new Error('FAKE_PROVIDER_TIMEOUT');
    }
  }

  async complete(model: string, p: OrderedPrompt, maxOut: number, signal: AbortSignal): Promise<ProviderResult> {
    const s = await this.begin('complete', model, p.task);
    if (s.latencyMs !== undefined) await wait(s.latencyMs, signal);
    await this.fail(s, signal);
    const out = Math.min(s.outputTokens ?? DEFAULT_OUTPUT_TOKENS, maxOut);
    const mult = s.actualCostMultiplier ?? 1;
    const text = this.textFor(p, out);
    return {
      text,
      inputTokens: Math.ceil(tokensOf(p.parts.join('\n')) * mult),
      outputTokens: Math.ceil(out * mult),
      cachedInputTokens: 0,
      modelId: model,
    };
  }

  stream(model: string, p: OrderedPrompt, maxOut: number, signal: AbortSignal): ProviderStream {
    const chunks: string[] = [];
    let done = false;
    let failure: unknown;
    let notify: (() => void) | undefined;
    const wake = () => {
      notify?.();
      notify = undefined;
    };
    let resolveFinal!: (r: ProviderResult) => void;
    let rejectFinal!: (e: unknown) => void;
    const final = new Promise<ProviderResult>((res, rej) => {
      resolveFinal = res;
      rejectFinal = rej;
    });
    final.catch(() => undefined);

    void (async () => {
      try {
        const s = await this.begin('stream', model, p.task);
        await wait(s.firstTokenMs ?? s.latencyMs ?? 0, signal);
        await this.fail(s, signal);
        const out = Math.min(s.outputTokens ?? DEFAULT_OUTPUT_TOKENS, maxOut);
        const text = this.textFor(p, out);
        for (let i = 0; i < text.length; i += 32) {
          if (signal.aborted) throw new Error('aborted');
          chunks.push(text.slice(i, i + 32));
          wake();
          await wait(1, signal);
        }
        const mult = s.actualCostMultiplier ?? 1;
        resolveFinal({
          text,
          inputTokens: Math.ceil(tokensOf(p.parts.join('\n')) * mult),
          outputTokens: Math.ceil(out * mult),
          cachedInputTokens: 0,
          modelId: model,
        });
      } catch (err) {
        failure = err;
        rejectFinal(err);
      } finally {
        done = true;
        wake();
      }
    })();

    return {
      final,
      async *[Symbol.asyncIterator]() {
        let i = 0;
        for (;;) {
          if (i < chunks.length) {
            yield { delta: chunks[i++]! };
            continue;
          }
          if (done) {
            if (failure !== undefined) throw failure instanceof Error ? failure : new Error(String(failure));
            return;
          }
          await new Promise<void>((r) => (notify = r));
        }
      },
    };
  }

  async transcribe(model: string, _audioUrl: string, signal: AbortSignal): Promise<ProviderResult> {
    const s = await this.begin('transcribe', model, 'transcription');
    if (s.latencyMs !== undefined) await wait(s.latencyMs, signal);
    await this.fail(s, signal);
    return { text: '[fake:transcription] xin chào', inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, modelId: model };
  }
}
