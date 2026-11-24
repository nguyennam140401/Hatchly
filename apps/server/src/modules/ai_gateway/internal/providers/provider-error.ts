import { gatewayEvent } from '../events';
import { recordProviderCall } from '../metrics';
import type { PartialUsage, ProviderResult, ProviderStream } from './provider';

// Chuẩn hóa lỗi + tiện ích dùng chung của các bộ chuyển đổi (015 T046/T047, contracts/provider-adapter.md mục 1).
// KHÔNG nhập SDK ở đây. Thông điệp lỗi chỉ chứa nhà cung cấp + loại lỗi + mã HTTP: không khóa API, không lời nhắc,
// không thân yêu cầu/phản hồi (FR-017, FR-026). Không giữ `cause` (lỗi SDK có thể lặp lại khóa/lời nhắc).

export type ProviderErrorKind =
  | 'aborted' // bên gọi hủy hoặc hết thời gian chờ (AbortSignal)
  | 'network' // lỗi mạng / ngắt kết nối
  | 'rate_limited' // 429
  | 'server' // 5xx
  | 'auth' // 401/403
  | 'bad_request' // các 4xx còn lại
  | 'bad_response' // phản hồi không đọc được
  | 'unsupported'; // bộ chuyển đổi không hỗ trợ thao tác

export class ProviderCallError extends Error {
  /**
   * Mức dùng token nhà cung cấp ĐÃ báo trước khi luồng đứt (vd `message_start` của Anthropic: phần đầu vào đã biết; đầu ra
   * chưa chắc). Không có = nhà cung cấp chưa báo gì → Cổng quyết toán theo ước tính an toàn + ghi `missing_usage`.
   */
  partialUsage?: PartialUsage | undefined;

  constructor(
    readonly provider: string,
    readonly kind: ProviderErrorKind,
    readonly status?: number,
  ) {
    super(
      `Lỗi nhà cung cấp AI (${provider}): ${kind}${status !== undefined ? ` [HTTP ${status}]` : ''}`,
    );
    this.name = 'ProviderCallError';
  }
}

/** Phân loại lỗi bất kỳ (kể cả lỗi SDK) thành `ProviderCallError`, KHÔNG chép thông điệp/nguyên nhân gốc. */
export function normalizeProviderError(
  provider: string,
  err: unknown,
  signal: AbortSignal,
): ProviderCallError {
  if (err instanceof ProviderCallError) return err;
  if (signal.aborted) return new ProviderCallError(provider, 'aborted');
  const status =
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { status?: unknown }).status === 'number'
      ? (err as { status: number }).status
      : undefined;
  if (status !== undefined) {
    if (status === 429) return new ProviderCallError(provider, 'rate_limited', status);
    if (status >= 500) return new ProviderCallError(provider, 'server', status);
    if (status === 401 || status === 403) return new ProviderCallError(provider, 'auth', status);
    return new ProviderCallError(provider, 'bad_request', status);
  }
  const name = err instanceof Error ? err.name : '';
  if (name === 'APIUserAbortError' || name === 'AbortError') {
    return new ProviderCallError(provider, 'aborted');
  }
  return new ProviderCallError(provider, 'network');
}

/** Tiêu đề mã theo dõi: chỉ ký tự an toàn, ≤ 128 (không để tiêu đề bị chèn). */
export function traceHeaders(traceId: string | undefined): Record<string, string> {
  if (traceId === undefined) return {};
  const safe = traceId.replace(/[^A-Za-z0-9:_.-]/g, '').slice(0, 128);
  return safe === '' ? {} : { 'x-trace-id': safe };
}

/**
 * Chạy một lời gọi: đo độ trễ + kết quả (`ai_gateway_provider_*`), chuẩn hóa lỗi, ghi MỘT dòng nhật ký an toàn khi lỗi
 * (chỉ nhà cung cấp/loại/mã HTTP). Đã hủy sẵn → ném ngay, không gọi mạng.
 */
export async function instrumented<T>(
  provider: string,
  signal: AbortSignal,
  run: () => Promise<T>,
): Promise<T> {
  const t0 = performance.now();
  try {
    if (signal.aborted) throw new ProviderCallError(provider, 'aborted');
    const out = await run();
    recordProviderCall(provider, 'ok', performance.now() - t0);
    return out;
  } catch (err) {
    const normalized = normalizeProviderError(provider, err, signal);
    // Hủy từ phía bên gọi/AbortSignal không phải lỗi nhà cung cấp: không tính vào tỷ lệ lỗi, không phát sự kiện lỗi.
    if (normalized.kind === 'aborted') {
      recordProviderCall(provider, 'aborted', performance.now() - t0);
      throw normalized;
    }
    recordProviderCall(provider, 'error', performance.now() - t0);
    gatewayEvent('warn', 'ai.provider_error', {
      provider,
      kind: normalized.kind,
      ...(normalized.status !== undefined ? { status: normalized.status } : {}),
    });
    throw normalized;
  }
}

/**
 * Dựng `ProviderStream` từ một hàm chạy nền: `run(emit)` đẩy từng đoạn qua `emit` rồi trả kết quả cuối. Vòng lặp và
 * `final` cùng bị từ chối khi lỗi; không ai lắng nghe `final` cũng không gây lỗi chưa xử lý.
 */
export function createProviderStream(
  run: (emit: (delta: string) => void) => Promise<ProviderResult>,
): ProviderStream {
  const chunks: string[] = [];
  let done = false;
  let failure: unknown;
  let notify: (() => void) | undefined;
  const wake = () => {
    notify?.();
    notify = undefined;
  };
  const final = (async () => {
    try {
      return await run((delta) => {
        chunks.push(delta);
        wake();
      });
    } catch (err) {
      failure = err;
      throw err;
    } finally {
      done = true;
      wake();
    }
  })();
  final.catch(() => undefined);

  return {
    final,
    async *[Symbol.asyncIterator]() {
      let i = 0;
      for (;;) {
        if (i < chunks.length) {
          const chunk = chunks[i++];
          if (chunk !== undefined) yield { delta: chunk };
          continue;
        }
        if (done) {
          if (failure !== undefined) {
            throw failure instanceof Error ? failure : new ProviderCallError('unknown', 'network');
          }
          return;
        }
        await new Promise<void>((r) => (notify = r));
      }
    },
  };
}
