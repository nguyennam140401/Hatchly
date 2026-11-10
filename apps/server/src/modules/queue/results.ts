// Kết quả bộ xử lý (contracts/queue-api.md mục 4, research R7).
import type { NoRetry, RetryAfter } from './public-api';

/** Thử lại sau `seconds` giây (1 … 86 400), vẫn tính một lượt thử. */
export function retryAfter(seconds: number): RetryAfter {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86_400) {
    throw new RangeError('retryAfter: số giây phải là số nguyên trong khoảng 1–86400');
  }
  return Object.freeze({ kind: 'retry_after', seconds });
}

/** Kết thúc lượt mà không thử lại, không vào việc hỏng (vd hết ngân sách AI – FR-015). */
export function noRetry(reason: string): NoRetry {
  return Object.freeze({ kind: 'no_retry', reason: reason.slice(0, 200) });
}

/** Lỗi vĩnh viễn: chôn việc ngay, không thử lại (vd dữ liệu tham chiếu đã bị xóa). */
export class PermanentJobError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = 'PermanentJobError';
    this.code = code;
  }
}

export function isRetryAfter(value: unknown): value is RetryAfter {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'retry_after'
  );
}

export function isNoRetry(value: unknown): value is NoRetry {
  return (
    typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'no_retry'
  );
}
