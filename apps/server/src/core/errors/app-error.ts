import type { ErrorAction, FieldError, SessionEndReason } from '@app/shared/core';

export interface AppErrorOptions {
  /** Mã ổn định UPPER_SNAKE_CASE (vd `VALIDATION_FAILED`). */
  code: string;
  httpStatus: number;
  /** Lời giải thích tiếng Việt đời thường. */
  message: string;
  /** Ít nhất một hành động khắc phục (nguyên tắc VI). */
  actions: [ErrorAction, ...ErrorAction[]];
  fieldErrors?: FieldError[];
  /** Số giây chờ trước khi thử lại (429) – xuất trong thân lỗi; tiêu đề `Retry-After` do nơi gọi đặt. */
  retryAfterSeconds?: number;
  /** Mã lỗi gốc cho "Chi tiết cho hỗ trợ" – không chứa bí mật, SQL hay stack trace. */
  detail?: string;
  /** 011: lý do phiên kết thúc (chỉ 401 UNAUTHENTICATED). */
  reason?: SessionEndReason;
}

/** Lỗi nghiệp vụ có chủ đích; bộ lọc toàn cục chuyển thành `ErrorResponse`. */
export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly actions: [ErrorAction, ...ErrorAction[]];
  readonly fieldErrors: FieldError[] | undefined;
  readonly detail: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly reason: SessionEndReason | undefined;

  constructor(options: AppErrorOptions) {
    super(options.message);
    this.name = 'AppError';
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    this.actions = options.actions;
    this.fieldErrors = options.fieldErrors;
    this.detail = options.detail;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.reason = options.reason;
  }
}
