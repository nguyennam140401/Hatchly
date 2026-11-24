import { isSpanContextValid, trace } from '@opentelemetry/api';
import { currentAccountId, getExecutionContext, type Db } from '../../../core';
import { currentTx } from '../../../core/db/transaction';
import { withGatewayOp } from '../../../core/gateways/op-log';
import { gatewayEvent } from './events';
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
import {
  isBudgetBlocked,
  type AttemptRoute,
  type BudgetKey,
  type BudgetStore,
  type Crossed,
  type LedgerDraft,
  type SettleHooks,
} from './budget/budget-store';
import { nextCycleStartsAt as nextCycleStartsAtFrom, weekStart } from './budget/system-budget';
import { AiError, SystemContextRequiredError } from './errors';
import {
  actualSttCost,
  actualTokensCost,
  STT_MAX_SECONDS,
  estimateStt,
  estimateTokens,
  IMAGE_INPUT_TOKENS,
  minCallEstimate,
} from './estimate';
import type { PriceBook, PriceEntry } from './prices/price-book';
import { ProviderCallError } from './providers/provider-error';
import type {
  AiProviderAdapter,
  OrderedPrompt,
  ProviderCallOptions,
  ProviderResult,
} from './providers/provider';
import {
  recordBlocked,
  recordCall,
  recordEstimateRatio,
  recordFallback,
  recordReserveDuration,
} from './metrics';
import { pickTier } from './tier';

// Tầng công khai của Cổng AI (005, contracts/ai-gateway.md mục 2) – trình tự BẮT BUỘC của mỗi lời gọi:
// validate → pickTier → estimate → reserve (không đủ → AI_BUDGET_EXHAUSTED, KHÔNG gọi nhà cung cấp) →
// markCalling → primary → (lỗi/hết giờ: release → reserve lại → markCalling → fallback đúng 1 lần →
// lỗi: release → AI_PROVIDER_UNAVAILABLE) → settle + sổ (+ sự kiện 80/100% trong cùng giao dịch).
// Nhật ký `ai_gateway.<op>` không có lời nhắc, văn bản kết quả hay số tiền.

export interface AiGatewayOptions {
  store: BudgetStore;
  /** Sổ giá theo bậc – CHỈ kho giả. Driver `real` bỏ trống: giá lấy theo tuyến qua `store.attemptRoute` (FR-020). */
  prices?: PriceBook | undefined;
  /** Kho giả: lượt 0. Driver `real`: bộ chuyển đổi mặc định cho `countInputTokens` (ước tính cục bộ, không gọi mạng). */
  primary: AiProviderAdapter;
  /** Kho giả: lượt 1. Driver `real`: không dùng để gọi (chọn theo `adapterFor`). */
  fallback: AiProviderAdapter;
  /**
   * Driver `real`: bộ chuyển đổi theo `provider` của tuyến (`model_routes`). Có hàm này mà trả `undefined` → lượt đó không
   * dùng được (lượt chính: `AI_NOT_CONFIGURED`; lượt dự phòng: bỏ lượt). Bỏ trống → [primary, fallback] như 005.
   */
  adapterFor?: ((provider: string) => AiProviderAdapter | undefined) | undefined;
  providerTimeoutMs: number;
  firstTokenTimeoutMs: number;
  /** Phát `ai_usage_80/100` TRONG giao dịch quyết toán (T080). */
  onCrossed?: (tx: Db, crossed: Crossed, cycleStart: string) => Promise<void>;
}

const LABEL_TASKS = new Set<AiTask>(['image_labeling', 'video_labeling']);

/**
 * Bảo vệ chung cho MỌI kho (kể cả kho giả): không gọi Cổng AI bên trong `tenantTx`/`systemTx` của bên gọi – lỗi lập trình
 * phải nổ ngay ở test với kho giả, không đợi tới khi bật driver `real` (kho thật có kiểm tra riêng ở từng bước).
 */
function assertNoOuterTx(): void {
  if (currentTx() !== undefined) {
    throw new Error(
      'Cổng AI không được gọi bên trong tenantTx/systemTx của bên gọi – xem apps/server/docs/database.md',
    );
  }
}

/** Đọc cờ hủy qua hàm để TS không thu hẹp kiểu (cờ đổi bất đồng bộ giữa các bước await). */
function isAborted(s: AbortSignal | undefined): boolean {
  return s?.aborted === true;
}

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
  validateRequestId(req.requestId);
}

/** Mã yêu cầu logic hợp lệ: 1–128 ký tự [A-Za-z0-9:_.-] (FR-037a). */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9:_.-]{1,128}$/;

function validateRequestId(requestId: string | undefined): void {
  if (requestId === undefined) return;
  if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) throw invalid();
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
  /** Ước tính cho một dòng giá bất kỳ (lượt dự phòng có thể khác giá lượt chính). */
  estimateWith: (price: PriceEntry) => number;
  prompt: OrderedPrompt;
  cycleStart: string | null;
  /** Kho thật: tuyến + giá lượt 0 đã tra khi `prepare` (dùng lại cho lượt chính, tránh tra hai lần). */
  route0?: AttemptRoute | undefined;
}

/** Giá/ước tính/tuyến của MỘT lượt gọi (0 chính, 1 dự phòng). Kho giả: luôn là giá lượt chính của bậc. */
interface AttemptPlan {
  price: PriceEntry;
  estimate: number;
  provider: string | undefined;
  modelId: string | undefined;
  priceId: string | undefined;
}

type ProviderCall = (
  provider: AiProviderAdapter,
  signal: AbortSignal,
  price: PriceEntry,
  callOpts: ProviderCallOptions,
) => Promise<ProviderResult>;

/** Tối đa một lượt chính + một lượt dự phòng (đúng một lần dự phòng – FR-024a). */
const MAX_ATTEMPTS = 2;

export class AiGatewayService implements AiGatewayPublicApi {
  readonly system: AiGatewayPublicApi['system'];

  constructor(private readonly opts: AiGatewayOptions) {
    this.system = {
      generate: (req) => this.systemGenerate(req),
    };
  }

  /**
   * Mã theo dõi của lời gọi (FR-036, hiến chương VIII): theo yêu cầu → ngữ cảnh thực thi (API/Worker) → span OpenTelemetry
   * đang chạy → sinh mới. Truyền xuống mọi lượt gọi bộ chuyển đổi và ghi vào sổ; KHÔNG vào nội dung lời nhắc.
   */
  private traceId(req: { traceId?: string | undefined }): string {
    if (req.traceId !== undefined) return req.traceId;
    const fromCtx = getExecutionContext()?.traceId;
    if (fromCtx !== undefined && fromCtx !== '') return fromCtx;
    const span = trace.getActiveSpan()?.spanContext();
    if (span !== undefined && isSpanContextValid(span)) return span.traceId;
    return uuidV7();
  }

  /** Tra giá bậc: kho thật theo tuyến lượt 0 (KHÔNG sổ giá theo bậc); kho giả theo `PriceBook`. */
  private async tierPrice(
    tier: ModelTier,
    task: AiTask,
  ): Promise<{ price: PriceEntry; route0?: AttemptRoute }> {
    if (this.opts.store.attemptRoute !== undefined) {
      const route0 = await this.opts.store.attemptRoute(task, tier, 0);
      if (route0 === null) throw new AiError('AI_NOT_CONFIGURED');
      return { price: route0.price, route0 };
    }
    return { price: this.priceOrNotConfigured(tier, task) };
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
    const { price, route0 } = await this.tierPrice(tier, req.task);
    const prompt = orderPrompt(req);
    const inTok =
      (await this.opts.primary.countInputTokens(price.modelId, prompt)) +
      prompt.images.length * IMAGE_INPUT_TOKENS;
    const estimateWith = (pr: PriceEntry) => estimateTokens(pr, inTok, req.maxOutputTokens);
    return {
      key,
      tier,
      price,
      estimate: estimateWith(price),
      estimateWith,
      prompt,
      cycleStart,
      route0,
    };
  }

  /**
   * Kế hoạch của lượt `attempt`: kho thật trả tuyến + giá của lượt đó (khớp dòng giữ chỗ) để gọi, ước tính và quyết
   * toán đúng mô hình/giá; kho giả không có → giá lượt chính của bậc (hành vi cũ, hợp đồng 005).
   * Trả `null` khi hết lượt theo `attemptsFor`, hoặc khi lượt DỰ PHÒNG thiếu giá/tuyến (bỏ lượt đó; sự kiện
   * `ai.price_missing` do kho đã ghi) → bên gọi dừng với `AI_PROVIDER_UNAVAILABLE`.
   */
  private async planAttempt(
    p: Prepared,
    task: AiTask,
    attempt: number,
  ): Promise<AttemptPlan | null> {
    if (this.opts.store.attemptRoute === undefined) {
      return {
        price: p.price,
        estimate: p.estimate,
        provider: undefined,
        modelId: undefined,
        priceId: undefined,
      };
    }
    let route: AttemptRoute | null;
    if (attempt === 0 && p.route0 !== undefined) {
      route = p.route0;
    } else {
      try {
        route = await this.opts.store.attemptRoute(task, p.tier, attempt);
      } catch (err) {
        if (attempt > 0 && err instanceof AiError && err.code === 'AI_NOT_CONFIGURED') return null;
        throw err;
      }
    }
    if (route === null) return null;
    return {
      price: route.price,
      estimate: p.estimateWith(route.price),
      provider: route.provider,
      modelId: route.modelId,
      priceId: route.priceId,
    };
  }

  /** Mốc dưới `getUsage`: cùng nguồn với cờ 100%; thiếu giá → 0 kèm cảnh báo `ai.price_missing` (không ném). */
  private async minEstimateForUsage(): Promise<number> {
    if (this.opts.store.minCallEstimateMicro !== undefined) {
      return this.opts.store.minCallEstimateMicro();
    }
    try {
      if (this.opts.prices === undefined) throw new Error('no price book');
      return minCallEstimate(this.opts.prices.priceFor('cheap_vision'));
    } catch {
      gatewayEvent('warn', 'ai.price_missing', {
        task: 'image_labeling',
        model_tier: 'cheap_vision',
        reason: 'price_not_found',
      });
      return 0;
    }
  }

  /**
   * Thiếu giá hợp lệ → `AI_NOT_CONFIGURED` + sự kiện `ai.price_missing` TRƯỚC khi giữ chỗ/gọi nhà cung cấp (FR-022).
   * Sự kiện chỉ mang loại việc và bậc – không lời nhắc, không số tiền.
   */
  private priceOrNotConfigured(tier: ModelTier, task: AiTask): PriceEntry {
    try {
      if (this.opts.prices === undefined) throw new Error('no price book');
      return this.opts.prices.priceFor(tier);
    } catch {
      gatewayEvent('error', 'ai.price_missing', {
        task,
        model_tier: tier,
        reason: 'price_not_found',
      });
      throw new AiError('AI_NOT_CONFIGURED');
    }
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
      gatewayEvent('warn', 'ai.cost_anomaly', {
        task: ledger.task,
        model_tier: ledger.modelTier,
        reason: 'cost_anomaly',
      });
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await this.opts.store.settle(reservationId, actual, ledger, this.hooks(cycleStart));
        return;
      } catch {
        if (attempt === 2) {
          // Giữ chỗ còn `calling` → bộ dọn quyết toán theo ước tính sau 15 phút (ai.unsettled_reservation).
          gatewayEvent('error', 'ai.settle_failed', {
            task: ledger.task,
            model_tier: ledger.modelTier,
            reason: 'settle_failed',
          });
        }
      }
    }
  }

  /** Gọi một nhà cung cấp với thời gian chờ; hủy từ bên gọi lan xuống nhà cung cấp. */
  private async withTimeout(
    provider: AiProviderAdapter,
    call: (provider: AiProviderAdapter, signal: AbortSignal) => Promise<ProviderResult>,
    outer: AbortSignal | undefined,
  ): Promise<ProviderResult> {
    const controller = new AbortController();
    const onAbort = () => {
      controller.abort();
    };
    outer?.addEventListener('abort', onAbort);
    // Tín hiệu ĐÃ hủy từ trước: sự kiện 'abort' không bắn lại → hủy ngay để bộ chuyển đổi không gọi ra ngoài (không tốn tiền).
    if (outer?.aborted === true) controller.abort();
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

  /** `held → calling`; lỗi → trả giữ chỗ (không đợi bộ dọn 15 phút) rồi ném lại lỗi gốc. Chưa gọi nhà cung cấp. */
  private async markCallingOrRelease(reservationId: string): Promise<void> {
    try {
      await this.opts.store.markCalling(reservationId);
    } catch (err) {
      await this.opts.store.release(reservationId).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Kế hoạch + bộ chuyển đổi của lượt `i`, hoặc `null` nếu không còn lượt dùng được (chỉ lượt dự phòng). Lượt CHÍNH thiếu
   * tuyến/giá/bộ chuyển đổi → `AI_NOT_CONFIGURED` (ném từ đây hoặc từ kho), không bao giờ lặng lẽ bỏ qua.
   */
  private async nextAttempt(
    p: Prepared,
    task: AiTask,
    i: number,
  ): Promise<{ plan: AttemptPlan; provider: AiProviderAdapter } | null> {
    const plan = await this.planAttempt(p, task, i);
    if (plan === null) return null;
    const adapter =
      plan.provider !== undefined && this.opts.adapterFor !== undefined
        ? this.opts.adapterFor(plan.provider)
        : [this.opts.primary, this.opts.fallback][i];
    if (adapter === undefined) {
      gatewayEvent(i === 0 ? 'error' : 'warn', 'ai.route_missing', {
        task,
        model_tier: p.tier,
        ...(plan.provider !== undefined ? { provider: plan.provider } : {}),
        reason: 'adapter_missing',
      });
      if (i === 0) throw new AiError('AI_NOT_CONFIGURED');
      return null;
    }
    return { plan, provider: adapter };
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
    traceId: string,
    requestId?: string,
  ): Promise<{
    result: ProviderResult;
    reservationId: string;
    provider: AiProviderAdapter;
    /** Nhà cung cấp của TUYẾN thực sự trả kết quả (kho thật); kho giả: nhãn bộ chuyển đổi (hợp đồng 005). */
    ledgerProvider: string;
    price: PriceEntry;
    estimate: number;
  }> {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      // `attempt` = thứ tự lượt (0 chính, 1 dự phòng) theo `attemptsFor`: kho thật ghi đúng tuyến/giá của LƯỢT NÀY
      // (FR-020) và `traceId` (VIII) – kho giả bỏ qua. Gọi/ước tính/quyết toán cùng dùng giá của lượt này.
      const resolved = await this.nextAttempt(p, task, i);
      if (resolved === null) break; // hết lượt / lượt dự phòng không dùng được → AI_PROVIDER_UNAVAILABLE
      const { plan, provider } = resolved;
      // Bên gọi đã hủy trước khi giữ chỗ → không giữ chỗ, không gọi.
      if (isAborted(signal)) throw new AiError('AI_PROVIDER_UNAVAILABLE');
      const reserveStart = performance.now();
      const r = await this.opts.store.reserve(p.key, plan.estimate, {
        task,
        modelTier: p.tier,
        industryId,
        requestId,
        attempt: i,
        traceId,
        provider: plan.provider,
        modelId: plan.modelId,
        priceId: plan.priceId,
      });
      recordReserveDuration(performance.now() - reserveStart);
      if (!r.ok) {
        recordBlocked(
          r.duplicate === true
            ? 'duplicate'
            : exhausted === 'AI_SYSTEM_BUDGET_EXHAUSTED'
              ? 'system_budget_exhausted'
              : 'budget_exhausted',
        );
        if (r.duplicate === true) throw new AiError('AI_DUPLICATE_REQUEST', { status: r.status });
        if (exhausted === 'AI_SYSTEM_BUDGET_EXHAUSTED') {
          gatewayEvent('warn', 'ai.system_budget_exhausted', { task });
        }
        throw new AiError(exhausted);
      }
      // Ngay trước khi gọi: `held → calling` (giữ chỗ treo sau mốc này có thể đã tốn tiền).
      await this.markCallingOrRelease(r.reservationId);
      try {
        // Hủy xảy ra trong lúc giữ chỗ/markCalling → trả giữ chỗ, KHÔNG gọi nhà cung cấp (nhánh catch bên dưới).
        if (isAborted(signal)) throw new AiError('AI_PROVIDER_UNAVAILABLE');
        const result = await this.withTimeout(
          provider,
          (prov, s) => call(prov, s, plan.price, { traceId }),
          signal,
        );
        attrs.fallback = i === 1;
        if (i === 1) recordFallback(task);
        return {
          result,
          reservationId: r.reservationId,
          provider,
          ledgerProvider: plan.provider ?? provider.provider,
          price: plan.price,
          estimate: plan.estimate,
        };
      } catch {
        await this.opts.store.release(r.reservationId);
        if (isAborted(signal)) throw new AiError('AI_PROVIDER_UNAVAILABLE');
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
    const { result, reservationId, ledgerProvider, price, estimate } = await this.callWithFallback(
      p,
      req.task,
      industryId,
      (prov, s, pr, o) => prov.complete(pr.modelId, p.prompt, req.maxOutputTokens, s, o),
      signal,
      exhausted,
      attrs,
      traceId,
      req.requestId,
    );
    const usage = {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cachedInputTokens: result.cachedInputTokens,
    };
    attrs.input_tokens = usage.inputTokens;
    attrs.output_tokens = usage.outputTokens;
    const actual = actualTokensCost(price, {
      ...usage,
      cacheWriteInputTokens: result.cacheWriteInputTokens,
    });
    recordCall(req.task, p.tier, attrs.fallback === true ? 'fallback' : 'ok', currentAccountId());
    recordEstimateRatio(req.task, actual, estimate);
    await this.settle(
      reservationId,
      actual,
      {
        task: req.task,
        modelTier: p.tier,
        modelId: result.modelId,
        provider: ledgerProvider,
        ...usage,
        traceId,
        industryId,
      },
      estimate,
      cycleStart,
    );
    return { text: result.text, modelTier: p.tier, usage, traceId };
  }

  /** Ghi `ai_gateway_calls_total` nhánh lỗi (outcome = mã lỗi): bọc quanh mỗi thao tác công khai. Không đổi lỗi gốc. */
  private async trackErrors<T>(
    task: string,
    attrs: Record<string, unknown>,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const tier = typeof attrs.model_tier === 'string' ? attrs.model_tier : 'unknown';
      recordCall(task, tier, err instanceof AiError ? err.code : 'error', currentAccountId());
      throw err;
    }
  }

  generate(req: AiRequest, opts?: { signal?: AbortSignal }): Promise<AiResult> {
    const attrs: Record<string, unknown> = { task: req.task };
    return withGatewayOp('ai_gateway', 'generate', attrs, () =>
      this.trackErrors(req.task, attrs, async () => {
        assertNoOuterTx();
        if (currentAccountId() === null) throw new AiError('AI_INVALID_REQUEST');
        validateAiRequest(req, 'account');
        const { key, cycleStart } = await this.keyForAccount();
        return this.run(
          req,
          key,
          cycleStart,
          undefined,
          opts?.signal,
          'AI_BUDGET_EXHAUSTED',
          attrs,
        );
      }),
    );
  }

  private systemGenerate(
    req: AiRequest & { task: 'trend_summary'; industryId: string },
  ): Promise<AiResult> {
    const attrs: Record<string, unknown> = { task: req.task };
    return withGatewayOp('ai_gateway', 'system.generate', attrs, () =>
      this.trackErrors(req.task, attrs, async () => {
        assertNoOuterTx();
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
      }),
    );
  }

  transcribe(req: TranscribeRequest, opts?: { signal?: AbortSignal }): Promise<AiResult> {
    const attrs: Record<string, unknown> = { task: 'transcription', model_tier: 'stt' };
    return withGatewayOp('ai_gateway', 'transcribe', attrs, () =>
      this.trackErrors('transcription', attrs, async () => {
        assertNoOuterTx();
        if (currentAccountId() === null) throw new AiError('AI_INVALID_REQUEST');
        if (
          // Hợp đồng: bên gọi (module media) báo thời lượng THẬT; thiếu/0/âm/NaN → từ chối để giữ chỗ luôn là chặn trên.
          !Number.isFinite(req.durationSec) ||
          req.durationSec <= 0 ||
          (req.language as string) !== 'vi'
        ) {
          throw new AiError('AI_INVALID_REQUEST');
        }
        validateRequestId(req.requestId);
        const { key, cycleStart } = await this.keyForAccount();
        const { price, route0 } = await this.tierPrice('stt', 'transcription');
        // Chỉ 5 phút đầu được ước tính/tính tiền.
        const estimate = estimateStt(price, req.durationSec);
        const traceId = this.traceId({});
        const p: Prepared = {
          key,
          tier: 'stt',
          price,
          estimate,
          estimateWith: (pr) => estimateStt(pr, req.durationSec),
          prompt: { task: 'transcription', parts: [], images: [] },
          cycleStart,
          route0,
        };
        const {
          result,
          reservationId,
          ledgerProvider,
          price: attemptPrice,
          estimate: attemptEstimate,
        } = await this.callWithFallback(
          p,
          'transcription',
          undefined,
          (prov, s, pr, o) => prov.transcribe(pr.modelId, req.audioUrl, s, o),
          opts?.signal,
          'AI_BUDGET_EXHAUSTED',
          attrs,
          traceId,
          req.requestId,
        );
        const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
        recordCall(
          'transcription',
          'stt',
          attrs.fallback === true ? 'fallback' : 'ok',
          currentAccountId(),
        );
        // Quyết toán theo số giây nhà cung cấp báo = thời lượng THỰC (không kẹp 300 – bộ chuyển đổi gửi nguyên tệp, nhà
        // cung cấp tính đủ; làm tròn lên theo độ chi tiết; 0 giây → 0, không dị thường). Vượt ước tính → kho kẹp theo trần. Nhà cung cấp không báo → theo ƯỚC TÍNH + `missing_usage` (settle() phát ai.cost_anomaly).
        const reported = result.audioSeconds;
        const hasUsage = typeof reported === 'number' && Number.isFinite(reported) && reported >= 0;
        const actual = hasUsage ? actualSttCost(attemptPrice, reported) : attemptEstimate;
        if (!hasUsage) {
          gatewayEvent('warn', 'ai.cost_anomaly', {
            task: 'transcription',
            model_tier: 'stt',
            reason: 'missing_usage',
          });
        }
        await this.settle(
          reservationId,
          actual,
          {
            task: 'transcription',
            modelTier: 'stt',
            modelId: result.modelId,
            provider: ledgerProvider,
            ...usage,
            traceId,
            // Ghi thời lượng THỰC (không kẹp lặng lẽ); > 300 s → `over_estimate` để đối chiếu hóa đơn.
            ...(hasUsage
              ? {
                  audioSeconds: Math.ceil(reported),
                  ...(reported > STT_MAX_SECONDS ? { anomaly: 'over_estimate' as const } : {}),
                }
              : { anomaly: 'missing_usage' as const }),
          },
          attemptEstimate,
          cycleStart,
        );
        return { text: result.text, modelTier: 'stt', usage, traceId };
      }),
    );
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
          assertNoOuterTx();
          if (currentAccountId() === null) throw new AiError('AI_INVALID_REQUEST');
          validateAiRequest(req, 'account');
          const { key, cycleStart } = await this.keyForAccount();
          const p = await this.prepare(req, key, cycleStart);
          attrs.model_tier = p.tier;
          const traceId = this.traceId(req);
          for (let i = 0; i < MAX_ATTEMPTS; i++) {
            const resolved = await this.nextAttempt(p, req.task, i);
            if (resolved === null) break; // hết lượt / dự phòng không dùng được → AI_PROVIDER_UNAVAILABLE
            const { plan, provider } = resolved;
            // Đã hủy (cancel()) trước khi giữ chỗ → không giữ chỗ, không gọi; kết quả rỗng như nhánh hủy.
            if (controller.signal.aborted) {
              recordCall(req.task, p.tier, 'cancelled', currentAccountId());
              return {
                text: '',
                modelTier: p.tier,
                usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
                traceId,
              };
            }
            const reserveStart = performance.now();
            const r = await this.opts.store.reserve(p.key, plan.estimate, {
              task: req.task,
              modelTier: p.tier,
              requestId: req.requestId,
              attempt: i,
              traceId,
              provider: plan.provider,
              modelId: plan.modelId,
              priceId: plan.priceId,
            });
            recordReserveDuration(performance.now() - reserveStart);
            if (!r.ok) {
              recordBlocked(r.duplicate === true ? 'duplicate' : 'budget_exhausted');
              if (r.duplicate === true) {
                throw new AiError('AI_DUPLICATE_REQUEST', { status: r.status });
              }
              throw new AiError('AI_BUDGET_EXHAUSTED');
            }
            await this.markCallingOrRelease(r.reservationId);
            const attempt = new AbortController();
            const onAbort = () => {
              attempt.abort();
            };
            controller.signal.addEventListener('abort', onAbort);
            // Hủy xảy ra trong lúc giữ chỗ/markCalling: sự kiện 'abort' không bắn lại → hủy lượt ngay (bộ chuyển đổi ném
            // trước khi gọi mạng; nhánh catch trả giữ chỗ).
            if (isAborted(controller.signal)) attempt.abort();
            let received = '';
            let firstTimer: NodeJS.Timeout | undefined = setTimeout(() => {
              attempt.abort();
            }, this.opts.firstTokenTimeoutMs);
            const total = setTimeout(() => {
              attempt.abort();
            }, this.opts.providerTimeoutMs);
            try {
              // Tạo luồng TRONG `try`: ném đồng bộ → trả giữ chỗ, dọn hai bộ hẹn giờ + trình nghe hủy.
              const stream = provider.stream(
                plan.price.modelId,
                p.prompt,
                req.maxOutputTokens,
                attempt.signal,
                { traceId },
              );
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
              if (i === 1) recordFallback(req.task);
              recordCall(req.task, p.tier, i === 1 ? 'fallback' : 'ok', currentAccountId());
              const cost = actualTokensCost(plan.price, {
                ...usage,
                cacheWriteInputTokens: final.cacheWriteInputTokens,
              });
              recordEstimateRatio(req.task, cost, plan.estimate);
              await this.settle(
                r.reservationId,
                cost,
                {
                  task: req.task,
                  modelTier: p.tier,
                  modelId: final.modelId,
                  provider: plan.provider ?? provider.provider,
                  ...usage,
                  traceId,
                },
                plan.estimate,
                cycleStart,
              );
              return { text: final.text, modelTier: p.tier, usage, traceId };
            } catch (err) {
              if (received.length > 0 && !isAborted(controller.signal)) {
                // Luồng ĐỨT do lỗi nhà cung cấp (hoặc hết giờ) SAU KHI đã gửi chữ ra: KHÔNG tự chuyển dự phòng (sẽ trộn
                // hai bản/đổi nội dung đã hiển thị). Trả phần đã sinh kèm `interrupted`; tạo lại = lượt mới + giữ chỗ mới.
                // Quyết toán theo usage nhà cung cấp đã báo (nếu có), còn thiếu thì ước tính an toàn (kẹp ≤ giữ chỗ).
                const reported = err instanceof ProviderCallError ? err.partialUsage : undefined;
                const outputEstimate = Math.ceil(Buffer.byteLength(received, 'utf8') / 3);
                const inputTokens =
                  reported?.inputTokens ??
                  (await this.opts.primary.countInputTokens(plan.price.modelId, p.prompt)) +
                    p.prompt.images.length * IMAGE_INPUT_TOKENS;
                const usage = {
                  inputTokens,
                  outputTokens: Math.max(reported?.outputTokens ?? 0, outputEstimate),
                  cachedInputTokens: reported?.cachedInputTokens ?? 0,
                };
                // Đầu ra luôn là ước tính (nhà cung cấp chưa chốt usage cuối) ⇒ sổ ghi `missing_usage`.
                const cost = Math.min(
                  actualTokensCost(plan.price, {
                    ...usage,
                    cacheWriteInputTokens: reported?.cacheWriteInputTokens,
                  }),
                  plan.estimate,
                );
                attrs.output_tokens = usage.outputTokens;
                recordCall(req.task, p.tier, 'interrupted', currentAccountId());
                await this.settle(
                  r.reservationId,
                  cost,
                  {
                    task: req.task,
                    modelTier: p.tier,
                    modelId: plan.price.modelId,
                    provider: plan.provider ?? provider.provider,
                    ...usage,
                    traceId,
                    anomaly: 'missing_usage',
                  },
                  plan.estimate,
                  cycleStart,
                );
                return { text: received, modelTier: p.tier, usage, traceId, interrupted: true };
              }
              if (received.length > 0) {
                // Người dùng hủy giữa chừng → quyết toán phần đã sinh, phần còn lại trả (một dòng sổ).
                const outputTokens = Math.ceil(received.length / 4);
                const usage = { inputTokens: 0, outputTokens, cachedInputTokens: 0 };
                const inTok = await this.opts.primary.countInputTokens(
                  plan.price.modelId,
                  p.prompt,
                );
                usage.inputTokens = inTok;
                recordCall(req.task, p.tier, 'partial', currentAccountId());
                await this.settle(
                  r.reservationId,
                  Math.min(actualTokensCost(plan.price, usage), plan.estimate),
                  {
                    task: req.task,
                    modelTier: p.tier,
                    modelId: plan.price.modelId,
                    provider: plan.provider ?? provider.provider,
                    ...usage,
                    traceId,
                  },
                  plan.estimate,
                  cycleStart,
                );
                return { text: received, modelTier: p.tier, usage, traceId };
              }
              await this.opts.store.release(r.reservationId);
              if (isAborted(controller.signal)) {
                recordCall(req.task, p.tier, 'cancelled', currentAccountId());
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
          const tier = typeof attrs.model_tier === 'string' ? attrs.model_tier : 'unknown';
          recordCall(
            req.task,
            tier,
            err instanceof AiError ? err.code : 'error',
            currentAccountId(),
          );
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
      let keyed: { key: BudgetKey; cycleStart: string };
      try {
        keyed = await this.keyForAccount();
      } catch (err) {
        // Không có mốc chu kỳ (gói hết hạn/chưa kích hoạt): không có ngân sách để dùng → `blocked`, KHÔNG ném và
        // không tạo ngân sách. `nextCycleStartsAt` chưa biết → thời điểm hiện tại (UI chỉ hiển thị khi gia hạn).
        if (err instanceof AiError && err.code === 'AI_BUDGET_EXHAUSTED') {
          return { percent: 100, state: 'blocked', nextCycleStartsAt: new Date() };
        }
        throw err;
      }
      const { key, cycleStart } = keyed;
      const s = await this.opts.store.usage(key);
      const spent = s.used + s.reserved;
      const percent =
        s.cap <= 0 ? 100 : Math.min(100, Math.max(0, Math.floor((spent * 100) / s.cap)));
      // Cùng hàm với cờ 100% (kho thật: giá CSDL; kho giả: sổ giá giả).
      const minEstimate = await this.minEstimateForUsage();
      const state: AiUsage['state'] = isBudgetBlocked(s, minEstimate)
        ? 'blocked'
        : spent >= s.softLimit
          ? 'cheap_model'
          : 'normal';
      // Kho thật trả `cycleEnd` (đúng cả khi chu kỳ bị kẹp ngày cuối tháng, vd mốc 31 → 28/02 → 31/03); kho giả suy ra.
      const nextCycleStartsAt =
        s.cycleEnd !== undefined
          ? new Date(`${s.cycleEnd}T00:00:00+07:00`)
          : nextCycleStartsAtFrom(cycleStart);
      return { percent, state, nextCycleStartsAt };
    });
  }
}
