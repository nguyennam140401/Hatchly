import { currentAccountId, getExecutionContext, type Db } from '../../../core';
import { gatewayEvent, withGatewayOp } from '../../../core/gateways/op-log';
import { uuidV7 } from '../../../core/ids/uuid-v7';
import {
  AI_TASKS,
  type AiGatewayPublicApi,
  type AiRequest,
  type AiResult,
  type AiStream,
  type AiTask,
  type AiUsage,
  type ModelTier,
  type TranscribeRequest,
} from '../public-api';
import type {
  BudgetKey,
  BudgetStore,
  Crossed,
  LedgerDraft,
  SettleHooks,
} from './budget/budget-store';
import { nextCycleStartsAt, weekStart } from './budget/system-budget';
import { AiError, SystemContextRequiredError } from './errors';
import {
  actualTokensCost,
  estimateStt,
  estimateTokens,
  IMAGE_INPUT_TOKENS,
  minCallEstimate,
} from './estimate';
import type { PriceBook, PriceEntry } from './prices/price-book';
import type { AiProviderAdapter, OrderedPrompt, ProviderResult } from './providers/provider';
import { pickTier } from './tier';

// Tầng công khai của Cổng AI (005, contracts/ai-gateway.md mục 2) – trình tự BẮT BUỘC của mỗi lời gọi:
// validate → pickTier → estimate → reserve (không đủ → AI_BUDGET_EXHAUSTED, KHÔNG gọi nhà cung cấp) →
// markCalling → primary → (lỗi/hết giờ: release → reserve lại → markCalling → fallback đúng 1 lần →
// lỗi: release → AI_PROVIDER_UNAVAILABLE) → settle + sổ (+ sự kiện 80/100% trong cùng giao dịch).
// Nhật ký `ai_gateway.<op>` không có lời nhắc, văn bản kết quả hay số tiền.

export interface AiGatewayOptions {
  store: BudgetStore;
  prices: PriceBook;
  primary: AiProviderAdapter;
  fallback: AiProviderAdapter;
  providerTimeoutMs: number;
  firstTokenTimeoutMs: number;
  /** Phát `ai_usage_80/100` TRONG giao dịch quyết toán (T080). */
  onCrossed?: (tx: Db, crossed: Crossed, cycleStart: string) => Promise<void>;
}

const LABEL_TASKS = new Set<AiTask>(['image_labeling', 'video_labeling']);

function invalid(): AiError {
  return new AiError('AI_INVALID_REQUEST');
}

/** Kiểm yêu cầu (AI_INVALID_REQUEST): loại việc, số token đầu ra, khung hình. */
export function validateAiRequest(req: AiRequest, scope: 'account' | 'system'): void {
  if (!(AI_TASKS as readonly string[]).includes(req.task)) throw invalid();
  if (req.task === 'transcription') throw invalid();
  if ((req.task === 'trend_summary') !== (scope === 'system')) throw invalid();
  if (
    !Number.isInteger(req.maxOutputTokens) ||
    req.maxOutputTokens < 1 ||
    req.maxOutputTokens > 8192
  ) {
    throw invalid();
  }
  const images = req.images ?? [];
  if (images.length > 0 && !LABEL_TASKS.has(req.task)) throw invalid();
  if (images.length > 8) throw invalid();
  if (
    typeof (req.prompt as AiRequest['prompt'] | undefined)?.system !== 'string' ||
    typeof req.prompt.delta !== 'string'
  )
    throw invalid();
}

export function orderPrompt(req: AiRequest): OrderedPrompt {
  const parts = [req.prompt.system];
  if (req.prompt.businessProfile !== undefined) parts.push(req.prompt.businessProfile.text);
  if (req.prompt.weeklyTrends !== undefined) parts.push(req.prompt.weeklyTrends.text);
  parts.push(req.prompt.delta);
  return { task: req.task, parts, images: req.images ?? [] };
}

interface Prepared {
  key: BudgetKey;
  tier: ModelTier;
  price: PriceEntry;
  estimate: number;
  prompt: OrderedPrompt;
  cycleStart: string | null;
}

type ProviderCall = (provider: AiProviderAdapter, signal: AbortSignal) => Promise<ProviderResult>;

export class AiGatewayService implements AiGatewayPublicApi {
  readonly system: AiGatewayPublicApi['system'];

  constructor(private readonly opts: AiGatewayOptions) {
    this.system = {
      generate: (req) => this.systemGenerate(req),
    };
  }

  private traceId(req: { traceId?: string | undefined }): string {
    return req.traceId ?? getExecutionContext()?.traceId ?? uuidV7();
  }

  private async keyForAccount(): Promise<{ key: BudgetKey; cycleStart: string }> {
    const cycleStart = await this.opts.store.currentCycleStart();
    return { key: { scope: 'account', cycleStart }, cycleStart };
  }

  private async prepare(
    req: AiRequest,
    key: BudgetKey,
    cycleStart: string | null,
  ): Promise<Prepared> {
    const snapshot = await this.opts.store.usage(key);
    const tier = pickTier(req.task, snapshot);
    const price = this.opts.prices.priceFor(tier);
    const prompt = orderPrompt(req);
    const inTok =
      (await this.opts.primary.countInputTokens(price.modelId, prompt)) +
      prompt.images.length * IMAGE_INPUT_TOKENS;
    return {
      key,
      tier,
      price,
      estimate: estimateTokens(price, inTok, req.maxOutputTokens),
      prompt,
      cycleStart,
    };
  }

  private hooks(cycleStart: string | null): SettleHooks | undefined {
    const onCrossed = this.opts.onCrossed;
    if (onCrossed === undefined || cycleStart === null) return undefined;
    return { onCrossed: (tx, crossed) => onCrossed(tx, crossed, cycleStart) };
  }

  /** Quyết toán; lỗi → thử lại 1 lần → vẫn lỗi: cảnh báo, giữ chỗ còn `calling` chờ releaseStale. */
  private async settle(
    reservationId: string,
    actual: number,
    ledger: LedgerDraft,
    estimate: number,
    cycleStart: string | null,
  ): Promise<void> {
    if (actual > estimate) {
      gatewayEvent('warn', 'ai.cost_anomaly', { task: ledger.task, model_tier: ledger.modelTier });
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await this.opts.store.settle(reservationId, actual, ledger, this.hooks(cycleStart));
        return;
      } catch {
        if (attempt === 2) {
          gatewayEvent('warn', 'ai.settle_failed', {
            task: ledger.task,
            model_tier: ledger.modelTier,
          });
        }
      }
    }
  }

  /** Gọi một nhà cung cấp với thời gian chờ; hủy từ bên gọi lan xuống nhà cung cấp. */
  private async withTimeout(
    provider: AiProviderAdapter,
    call: ProviderCall,
    outer: AbortSignal | undefined,
  ): Promise<ProviderResult> {
    const controller = new AbortController();
    const onAbort = () => {
      controller.abort();
    };
    outer?.addEventListener('abort', onAbort);
    const timer = setTimeout(() => {
      controller.abort();
    }, this.opts.providerTimeoutMs);
    try {
      return await call(provider, controller.signal);
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
    }
  }

  /** Giữ chỗ → markCalling → chính → dự phòng (đúng 1 lần). Trả kết quả + mã giữ chỗ chưa quyết toán. */
  private async callWithFallback(
    p: Prepared,
    task: AiTask,
    industryId: string | undefined,
    call: ProviderCall,
    signal: AbortSignal | undefined,
    exhausted: 'AI_BUDGET_EXHAUSTED' | 'AI_SYSTEM_BUDGET_EXHAUSTED',
    attrs: Record<string, unknown>,
  ): Promise<{ result: ProviderResult; reservationId: string; provider: AiProviderAdapter }> {
    for (const [i, provider] of [this.opts.primary, this.opts.fallback].entries()) {
      const r = await this.opts.store.reserve(p.key, p.estimate, {
        task,
        modelTier: p.tier,
        industryId,
      });
      if (!r.ok) {
        if (exhausted === 'AI_SYSTEM_BUDGET_EXHAUSTED') {
          gatewayEvent('warn', 'ai.system_budget_exhausted', { task });
        }
        throw new AiError(exhausted);
      }
      // Ngay trước khi gọi: `held → calling` (giữ chỗ treo sau mốc này có thể đã tốn tiền).
      await this.opts.store.markCalling(r.reservationId);
      try {
        const result = await this.withTimeout(provider, call, signal);
        attrs.fallback = i === 1;
        return { result, reservationId: r.reservationId, provider };
      } catch {
        await this.opts.store.release(r.reservationId);
        if (signal?.aborted === true) throw new AiError('AI_PROVIDER_UNAVAILABLE');
      }
    }
    throw new AiError('AI_PROVIDER_UNAVAILABLE');
  }

  private async run(
    req: AiRequest,
    key: BudgetKey,
    cycleStart: string | null,
    industryId: string | undefined,
    signal: AbortSignal | undefined,
    exhausted: 'AI_BUDGET_EXHAUSTED' | 'AI_SYSTEM_BUDGET_EXHAUSTED',
    attrs: Record<string, unknown>,
  ): Promise<AiResult> {
    const p = await this.prepare(req, key, cycleStart);
    attrs.model_tier = p.tier;
    const traceId = this.traceId(req);
    const { result, reservationId, provider } = await this.callWithFallback(
      p,
      req.task,
      industryId,
      (prov, s) => prov.complete(p.price.modelId, p.prompt, req.maxOutputTokens, s),
      signal,
      exhausted,
      attrs,
    );
    const usage = {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cachedInputTokens: result.cachedInputTokens,
    };
    attrs.input_tokens = usage.inputTokens;
    attrs.output_tokens = usage.outputTokens;
    await this.settle(
      reservationId,
      actualTokensCost(p.price, usage),
      {
        task: req.task,
        modelTier: p.tier,
        modelId: result.modelId,
        provider: provider.provider,
        ...usage,
        traceId,
        industryId,
      },
      p.estimate,
      cycleStart,
    );
    return { text: result.text, modelTier: p.tier, usage, traceId };
  }

  generate(req: AiRequest, opts?: { signal?: AbortSignal }): Promise<AiResult> {
    const attrs: Record<string, unknown> = { task: req.task };
    return withGatewayOp('ai_gateway', 'generate', attrs, async () => {
      if (currentAccountId() === null) throw new AiError('AI_INVALID_REQUEST');
      validateAiRequest(req, 'account');
      const { key, cycleStart } = await this.keyForAccount();
      return this.run(req, key, cycleStart, undefined, opts?.signal, 'AI_BUDGET_EXHAUSTED', attrs);
    });
  }

  private systemGenerate(
    req: AiRequest & { task: 'trend_summary'; industryId: string },
  ): Promise<AiResult> {
    const attrs: Record<string, unknown> = { task: req.task };
    return withGatewayOp('ai_gateway', 'system.generate', attrs, async () => {
      if (currentAccountId() !== null) throw new SystemContextRequiredError();
      validateAiRequest(req, 'system');
      return this.run(
        req,
        { scope: 'system', weekStart: weekStart() },
        null,
        req.industryId,
        undefined,
        'AI_SYSTEM_BUDGET_EXHAUSTED',
        attrs,
      );
    });
  }

  transcribe(req: TranscribeRequest, opts?: { signal?: AbortSignal }): Promise<AiResult> {
    const attrs: Record<string, unknown> = { task: 'transcription', model_tier: 'stt' };
    return withGatewayOp('ai_gateway', 'transcribe', attrs, async () => {
      if (currentAccountId() === null) throw new AiError('AI_INVALID_REQUEST');
      if (
        !Number.isFinite(req.durationSec) ||
        req.durationSec < 0 ||
        (req.language as string) !== 'vi'
      ) {
        throw new AiError('AI_INVALID_REQUEST');
      }
      const { key, cycleStart } = await this.keyForAccount();
      const price = this.opts.prices.priceFor('stt');
      // Chỉ 5 phút đầu được ước tính/tính tiền.
      const estimate = estimateStt(price, req.durationSec);
      const traceId = this.traceId({});
      const p: Prepared = {
        key,
        tier: 'stt',
        price,
        estimate,
        prompt: { task: 'transcription', parts: [], images: [] },
        cycleStart,
      };
      const { result, reservationId, provider } = await this.callWithFallback(
        p,
        'transcription',
        undefined,
        (prov, s) => prov.transcribe(price.modelId, req.audioUrl, s),
        opts?.signal,
        'AI_BUDGET_EXHAUSTED',
        attrs,
      );
      const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
      await this.settle(
        reservationId,
        estimate,
        {
          task: 'transcription',
          modelTier: 'stt',
          modelId: result.modelId,
          provider: provider.provider,
          ...usage,
          traceId,
        },
        estimate,
        cycleStart,
      );
      return { text: result.text, modelTier: 'stt', usage, traceId };
    });
  }

  generateStream(req: AiRequest): AiStream {
    const controller = new AbortController();
    const queue: string[] = [];
    let finished = false;
    let failure: unknown;
    let wake: (() => void) | undefined;
    const notify = () => {
      wake?.();
      wake = undefined;
    };
    const attrs: Record<string, unknown> = { task: req.task };

    const result = withGatewayOp(
      'ai_gateway',
      'generateStream',
      attrs,
      async (): Promise<AiResult> => {
        try {
          if (currentAccountId() === null) throw new AiError('AI_INVALID_REQUEST');
          validateAiRequest(req, 'account');
          const { key, cycleStart } = await this.keyForAccount();
          const p = await this.prepare(req, key, cycleStart);
          attrs.model_tier = p.tier;
          const traceId = this.traceId(req);
          for (const [i, provider] of [this.opts.primary, this.opts.fallback].entries()) {
            const r = await this.opts.store.reserve(p.key, p.estimate, {
              task: req.task,
              modelTier: p.tier,
            });
            if (!r.ok) throw new AiError('AI_BUDGET_EXHAUSTED');
            await this.opts.store.markCalling(r.reservationId);
            const attempt = new AbortController();
            const onAbort = () => {
              attempt.abort();
            };
            controller.signal.addEventListener('abort', onAbort);
            let received = '';
            let firstTimer: NodeJS.Timeout | undefined = setTimeout(() => {
              attempt.abort();
            }, this.opts.firstTokenTimeoutMs);
            const total = setTimeout(() => {
              attempt.abort();
            }, this.opts.providerTimeoutMs);
            const stream = provider.stream(
              p.price.modelId,
              p.prompt,
              req.maxOutputTokens,
              attempt.signal,
            );
            try {
              for await (const chunk of stream) {
                if (firstTimer !== undefined) {
                  clearTimeout(firstTimer);
                  firstTimer = undefined;
                }
                received += chunk.delta;
                queue.push(chunk.delta);
                notify();
              }
              const final = await stream.final;
              const usage = {
                inputTokens: final.inputTokens,
                outputTokens: final.outputTokens,
                cachedInputTokens: final.cachedInputTokens,
              };
              attrs.fallback = i === 1;
              attrs.output_tokens = usage.outputTokens;
              await this.settle(
                r.reservationId,
                actualTokensCost(p.price, usage),
                {
                  task: req.task,
                  modelTier: p.tier,
                  modelId: final.modelId,
                  provider: provider.provider,
                  ...usage,
                  traceId,
                },
                p.estimate,
                cycleStart,
              );
              return { text: final.text, modelTier: p.tier, usage, traceId };
            } catch {
              if (received.length > 0) {
                // Đã có đầu ra (bị hủy / đứt giữa chừng) → quyết toán phần đã sinh, phần còn lại trả.
                const outputTokens = Math.ceil(received.length / 4);
                const usage = { inputTokens: 0, outputTokens, cachedInputTokens: 0 };
                const inTok = await this.opts.primary.countInputTokens(p.price.modelId, p.prompt);
                usage.inputTokens = inTok;
                await this.settle(
                  r.reservationId,
                  Math.min(actualTokensCost(p.price, usage), p.estimate),
                  {
                    task: req.task,
                    modelTier: p.tier,
                    modelId: p.price.modelId,
                    provider: provider.provider,
                    ...usage,
                    traceId,
                  },
                  p.estimate,
                  cycleStart,
                );
                return { text: received, modelTier: p.tier, usage, traceId };
              }
              await this.opts.store.release(r.reservationId);
              if (controller.signal.aborted) {
                return {
                  text: '',
                  modelTier: p.tier,
                  usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
                  traceId,
                };
              }
            } finally {
              if (firstTimer !== undefined) clearTimeout(firstTimer);
              clearTimeout(total);
              controller.signal.removeEventListener('abort', onAbort);
            }
          }
          throw new AiError('AI_PROVIDER_UNAVAILABLE');
        } catch (err) {
          failure = err;
          throw err;
        } finally {
          finished = true;
          notify();
        }
      },
    );
    result.catch(() => undefined);

    return {
      result,
      cancel: () => {
        controller.abort();
      },
      async *[Symbol.asyncIterator]() {
        let i = 0;
        for (;;) {
          if (i < queue.length) {
            const chunk = queue[i++];
            if (chunk !== undefined) yield { delta: chunk };
            continue;
          }
          if (finished) {
            if (failure !== undefined)
              throw failure instanceof Error ? failure : new AiError('AI_PROVIDER_UNAVAILABLE');
            return;
          }
          await new Promise<void>((r) => (wake = r));
        }
      },
    };
  }

  getUsage(): Promise<AiUsage> {
    return withGatewayOp('ai_gateway', 'getUsage', {}, async () => {
      const { key, cycleStart } = await this.keyForAccount();
      const s = await this.opts.store.usage(key);
      const spent = s.used + s.reserved;
      const percent =
        s.cap <= 0 ? 100 : Math.min(100, Math.max(0, Math.floor((spent * 100) / s.cap)));
      const minEstimate = minCallEstimate(this.opts.prices.priceFor('cheap_vision'));
      const state: AiUsage['state'] =
        spent >= s.cap || s.cap - spent < minEstimate
          ? 'blocked'
          : spent >= s.softLimit
            ? 'cheap_model'
            : 'normal';
      return { percent, state, nextCycleStartsAt: nextCycleStartsAt(cycleStart) };
    });
  }
}
