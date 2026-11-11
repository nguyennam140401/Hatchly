import { ErrorResponse, HealthResponse } from '@app/shared/core';

/** Lược đồ kiểm phản hồi (lược đồ Zod của @app/shared thỏa giao diện này). */
export interface ResponseSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

// Lớp gọi API của web: mọi phản hồi được kiểm tra bằng lược đồ dùng chung (FR-013, R15).
// Chỉ được nhập @app/shared (quy tắc web-only-shared). Cookie phiên là HttpOnly – web không bao giờ
// đọc mã phiên; trình duyệt tự gửi cookie (credentials: 'same-origin').

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'network' | 'invalid_response' | 'api_error'; message?: string };

/** Gọi GET /healthz của API. */
export async function getHealth(signal?: AbortSignal): Promise<ApiResult<HealthResponse>> {
  let res: Response;
  try {
    res = await fetch('/healthz', {
      headers: { accept: 'application/json' },
      signal: signal ?? null,
    });
  } catch {
    return { ok: false, reason: 'network' };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: 'invalid_response' };
  }

  if (!res.ok) {
    const error = ErrorResponse.safeParse(body);
    return error.success
      ? { ok: false, reason: 'api_error', message: error.data.error.message }
      : { ok: false, reason: 'invalid_response' };
  }

  const parsed = HealthResponse.safeParse(body);
  // Chỉ chấp nhận phản hồi từ đơn vị API (không phải cổng kiểm tra sống của Worker).
  return parsed.success && parsed.data.unit === 'api'
    ? { ok: true, data: parsed.data }
    : { ok: false, reason: 'invalid_response' };
}

export type ApiErrorBody = ErrorResponse['error'];

const NETWORK_MESSAGE = 'Không kết nối được máy chủ. Hãy kiểm tra mạng rồi thử lại.';
const INVALID_MESSAGE = 'Máy chủ trả về dữ liệu không đọc được. Vui lòng thử lại sau.';

/** Lỗi có kiểu của lời gọi API – `body` theo ErrorResponse khi máy chủ trả lỗi chuẩn. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: ApiErrorBody | null,
    readonly reason: 'network' | 'invalid_response' | 'api_error',
  ) {
    super(body?.message ?? (reason === 'network' ? NETWORK_MESSAGE : INVALID_MESSAGE));
    this.name = 'ApiError';
  }

  /** Lỗi theo ô (đường dẫn nối bằng dấu chấm → thông điệp). */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries(
      (this.body?.fieldErrors ?? []).map((f) => [f.path.join('.'), f.message]),
    );
  }
}

type AuthListener = (error: ApiError) => void;
const authListeners = new Set<AuthListener>();

/**
 * Đăng ký nghe lỗi phiên: 401 UNAUTHENTICATED và 403 EMAIL_NOT_VERIFIED (cổng phiên chuyển trang).
 * Trả hàm hủy đăng ký.
 */
export function onAuthError(listener: AuthListener): () => void {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

const AUTH_CODES = new Set(['UNAUTHENTICATED', 'EMAIL_NOT_VERIFIED']);

export interface RequestOptions {
  /** Không phát sự kiện lỗi phiên (vd chính cổng phiên gọi /auth/me, trang đăng nhập). */
  silentAuth?: boolean;
  signal?: AbortSignal;
}

/** Gọi API JSON; 2xx → dữ liệu đã kiểm theo `schema` (204 → undefined); còn lại ném ApiError. */
export async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  options: RequestOptions & { body?: unknown; schema?: ResponseSchema<T> } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: options.signal ?? null,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', null, 'network');
  }

  if (res.status === 204) return undefined as T;
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(res.status, 'INVALID_RESPONSE', null, 'invalid_response');
  }

  if (!res.ok) {
    const parsed = ErrorResponse.safeParse(body);
    const error = parsed.success
      ? new ApiError(res.status, parsed.data.error.code, parsed.data.error, 'api_error')
      : new ApiError(res.status, 'INVALID_RESPONSE', null, 'invalid_response');
    if (options.silentAuth !== true && AUTH_CODES.has(error.code)) {
      for (const listener of authListeners) listener(error);
    }
    throw error;
  }

  if (options.schema === undefined) return body as T;
  const parsed = options.schema.safeParse(body);
  if (!parsed.success) throw new ApiError(res.status, 'INVALID_RESPONSE', null, 'invalid_response');
  return parsed.data;
}
