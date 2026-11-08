import type { ErrorAction, FieldError } from '@app/shared/core';

export interface AppErrorOptions {
  /** Mã ổn định UPPER_SNAKE_CASE (vd `VALIDATION_FAILED`). */
  code: string;
  httpStatus: number;
  /** Lời giải thích tiếng Việt đời thường. */
  message: string;
  /** Ít nhất một hành động khắc phục (nguyên tắc VI). */
  actions: [ErrorAction, ...ErrorAction[]];
  fieldErrors?: FieldError[];
  /** Mã lỗi gốc cho "Chi tiết cho hỗ trợ" – không chứa bí mật, SQL hay stack trace. */
  detail?: string;
}

/** Lỗi nghiệp vụ có chủ đích; bộ lọc toàn cục chuyển thành `ErrorResponse`. */
export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly actions: [ErrorAction, ...ErrorAction[]];
  readonly fieldErrors: FieldError[] | undefined;
  readonly detail: string | undefined;

  constructor(options: AppErrorOptions) {
    super(options.message);
    this.name = 'AppError';
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    this.actions = options.actions;
    this.fieldErrors = options.fieldErrors;
    this.detail = options.detail;
  }
}
