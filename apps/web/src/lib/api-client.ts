import { ErrorResponse, HealthResponse } from '@app/shared/core';

// Lớp gọi API của web: mọi phản hồi được kiểm tra bằng lược đồ dùng chung (FR-013, R15).
// Chỉ được nhập @app/shared (quy tắc web-only-shared).

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
