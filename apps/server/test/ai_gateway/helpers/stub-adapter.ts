import type {
  BudgetStore,
  LedgerDraft,
} from '../../../src/modules/ai_gateway/internal/budget/budget-store';
import type {
  AiProviderAdapter,
  ProviderCallOptions,
  ProviderResult,
  ProviderStream,
} from '../../../src/modules/ai_gateway/internal/providers/provider';
import {
  createProviderStream,
  ProviderCallError,
} from '../../../src/modules/ai_gateway/internal/providers/provider-error';

// Nhà cung cấp giả viết tay + kho bọc ghi vết cho kiểm thử Cổng AI (015 US4): điều khiển chính xác điểm đứt/hủy của luồng.

export const OK_RESULT: ProviderResult = {
  text: 'ok',
  inputTokens: 100,
  outputTokens: 20,
  cachedInputTokens: 0,
  modelId: 'stub-model',
};

export type StreamRun = (emit: (d: string) => void, signal: AbortSignal) => Promise<ProviderResult>;
export type CompleteRun = (signal: AbortSignal) => Promise<ProviderResult>;

/** Hủy → ném `aborted` (như bộ chuyển đổi thật). */
export const untilAborted = (provider: string, signal: AbortSignal): Promise<never> =>
  new Promise((_, reject) => {
    const fire = () => {
      reject(new ProviderCallError(provider, 'aborted'));
    };
    if (signal.aborted) fire();
    else signal.addEventListener('abort', fire);
  });

/**
 * Nhà cung cấp giả. Giống bộ chuyển đổi thật: tín hiệu đã hủy → ném TRƯỚC khi "gọi mạng" (không tăng `network`).
 * `invoked` đếm số lần Cổng gọi vào bộ chuyển đổi; `network` đếm số lần thật sự "ra ngoài" (tốn tiền).
 * `countInputTokens` luôn trả 500 (ước tính cục bộ cố định để tính được số mong đợi).
 */
export class StubAdapter implements AiProviderAdapter {
  invoked = { complete: 0, stream: 0 };
  network = { complete: 0, stream: 0 };
  onComplete: CompleteRun = () => Promise.resolve(OK_RESULT);
  onStream: StreamRun = (emit) => {
    emit('Xin chào');
    return Promise.resolve({ ...OK_RESULT, text: 'Xin chào' });
  };
  constructor(readonly provider: string) {}

  countInputTokens(): Promise<number> {
    return Promise.resolve(500);
  }
  /** Tham số theo lời gọi (`opts`) Cổng đã truyền xuống, theo thứ tự gọi (FR-036: kiểm `traceId`). */
  receivedOpts: (ProviderCallOptions | undefined)[] = [];
  complete(
    _m: string,
    _p: unknown,
    _max: number,
    signal: AbortSignal,
    opts?: ProviderCallOptions,
  ): Promise<ProviderResult> {
    this.receivedOpts.push(opts);
    this.invoked.complete++;
    if (signal.aborted) return Promise.reject(new ProviderCallError(this.provider, 'aborted'));
    this.network.complete++;
    return this.onComplete(signal);
  }
  stream(
    _m: string,
    _p: unknown,
    _max: number,
    signal: AbortSignal,
    opts?: ProviderCallOptions,
  ): ProviderStream {
    this.receivedOpts.push(opts);
    this.invoked.stream++;
    return createProviderStream((emit) => {
      if (signal.aborted) return Promise.reject(new ProviderCallError(this.provider, 'aborted'));
      this.network.stream++;
      return this.onStream(emit, signal);
    });
  }
  transcribe(): Promise<ProviderResult> {
    return Promise.reject(new ProviderCallError(this.provider, 'unsupported'));
  }
}

export interface Spy {
  afterMarkCalling?: () => void;
  settles: { actual: number; ledger: LedgerDraft }[];
}

/** Bao kho: ghi lại các lời gọi `settle` (số tiền + bản nháp sổ) và chạy móc ngay sau `markCalling`. */
export function spied(store: BudgetStore, spy: Spy): BudgetStore {
  return new Proxy<BudgetStore>(store, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      const fn = value as (...a: unknown[]) => unknown;
      if (key === 'markCalling') {
        return async (...a: unknown[]) => {
          const out = await fn.apply(target, a);
          spy.afterMarkCalling?.();
          return out;
        };
      }
      if (key === 'settle') {
        return (id: string, actual: number, ledger: LedgerDraft, hooks?: unknown) => {
          spy.settles.push({ actual, ledger });
          return fn.call(target, id, actual, ledger, hooks);
        };
      }
      return fn.bind(target);
    },
  });
}
