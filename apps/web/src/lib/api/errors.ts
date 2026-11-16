import type { SessionEndReason } from '@app/shared/core';
import { explain, FALLBACK_ACTIONS, type ErrorActionView } from '../catalogs/error-explanations';

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

/** Hình tối thiểu của `ApiError` cũ (lib/api-client) để chuyển đổi mà không nhập vòng. */
export interface LegacyApiErrorLike {
  status: number;
  code: string;
  reason: 'network' | 'invalid_response' | 'api_error';
  message: string;
  body: {
    message: string;
    actions: ErrorActionView[];
    fieldErrors?: { path: string[]; message: string }[] | undefined;
    retryAfterSeconds?: number | undefined;
    reason?: SessionEndReason | undefined;
    support: { traceId: string; detail?: string | undefined };
  } | null;
}

export function toAppError(err: LegacyApiErrorLike): AppError {
  if (err.reason === 'network') {
    return new AppError({
      kind: 'network',
      status: 0,
      code: 'NETWORK',
      message: 'Không kết nối được máy chủ. Hãy kiểm tra mạng rồi thử lại.',
      actions: [{ kind: 'retry', label: 'Thử lại' }],
    });
  }
  if (err.body === null) {
    return new AppError({
      kind: 'invalid_response',
      status: err.status,
      code: 'INVALID_RESPONSE',
      message: 'Máy chủ trả về dữ liệu không đọc được. Vui lòng thử lại sau.',
      actions: [{ kind: 'retry', label: 'Thử lại' }],
    });
  }
  const body = err.body;
  return new AppError({
    kind: classify(err.status, err.code),
    status: err.status,
    code: err.code,
    message: body.message,
    actions: body.actions.length > 0 ? body.actions : (explain(err.code)?.actions ?? []),
    fieldErrors: Object.fromEntries(
      (body.fieldErrors ?? []).map((f) => [f.path.join('.'), f.message]),
    ),
    ...(body.retryAfterSeconds !== undefined ? { retryAfterSeconds: body.retryAfterSeconds } : {}),
    support: body.support,
    ...(body.reason !== undefined ? { reason: body.reason } : {}),
  });
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
