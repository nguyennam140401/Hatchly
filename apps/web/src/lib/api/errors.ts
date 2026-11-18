import type { SessionEndReason } from '@app/shared/core';
import { FALLBACK_ACTIONS, type ErrorActionView } from '../catalogs/error-explanations';

// Lỗi thống nhất của lớp gọi API (data-model mục 7). Màn hình chỉ làm việc với AppError, không với lỗi thô.

export type AppErrorKind =
  | 'network'
  | 'session_expired'
  | 'forbidden'
  | 'not_found'
  | 'version_conflict'
  | 'limit_reached'
  | 'validation'
  | 'business'
  | 'rate_limited'
  | 'server'
  | 'invalid_response';

export interface AppErrorInit {
  kind: AppErrorKind;
  status: number;
  code: string;
  message: string;
  actions?: ErrorActionView[];
  fieldErrors?: Record<string, string>;
  retryAfterSeconds?: number;
  support?: { traceId: string; detail?: string | undefined };
  reason?: SessionEndReason;
  /** 012: dữ liệu kèm theo lỗi nghiệp vụ (kênh vướng, giờ gợi ý, bài mới nhất). */
  extra?: Record<string, unknown> | undefined;
}

export class AppError extends Error {
  readonly kind: AppErrorKind;
  readonly status: number;
  readonly code: string;
  /** Luôn ≥ 1 hành động khắc phục (nguyên tắc VI). */
  readonly actions: [ErrorActionView, ...ErrorActionView[]];
  /** Khóa = đường dẫn chấm của ô (vd `address.city`). */
  readonly fieldErrors: Record<string, string>;
  readonly retryAfterSeconds: number | undefined;
  readonly support: { traceId: string; detail?: string | undefined };
  readonly reason: SessionEndReason | undefined;
  readonly extra: Record<string, unknown> | undefined;

  constructor(init: AppErrorInit) {
    super(init.message);
    this.name = 'AppError';
    this.kind = init.kind;
    this.status = init.status;
    this.code = init.code;
    const list =
      init.actions !== undefined && init.actions.length > 0 ? init.actions : FALLBACK_ACTIONS;
    this.actions = [list[0] ?? FALLBACK_ACTIONS[0], ...list.slice(1)];
    this.fieldErrors = init.fieldErrors ?? {};
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.support = init.support ?? { traceId: '' };
    this.reason = init.reason;
    this.extra = init.extra;
  }
}

/** Phân loại theo mã/trạng thái (data-model mục 7). */
export function classify(status: number, code: string): AppErrorKind {
  switch (code) {
    case 'UNAUTHENTICATED':
      return 'session_expired';
    case 'FORBIDDEN':
    case 'ACCOUNT_UNAVAILABLE':
      return 'forbidden';
    case 'VERSION_CONFLICT':
      return 'version_conflict';
    case 'VALIDATION_FAILED':
      return 'validation';
    case 'RATE_LIMITED':
    case 'LOGIN_THROTTLED':
      return 'rate_limited';
    case 'NOT_FOUND':
      return 'not_found';
  }
  if (code.startsWith('LIMIT_')) return 'limit_reached';
  if (status >= 500) return 'server';
  return 'business';
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
