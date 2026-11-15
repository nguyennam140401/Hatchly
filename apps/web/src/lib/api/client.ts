import { ErrorResponse } from '@app/shared/core';
import { setApiReachable } from './connectivity';
import { AppError, classify } from './errors';

// Lớp gọi API duy nhất của web (FR-029). Chỉ thư mục này được gọi `fetch`. Cookie phiên là HttpOnly: web không
// đọc mã phiên; trình duyệt tự gửi cookie (credentials: 'same-origin').

/** Lược đồ kiểm phản hồi (lược đồ Zod của @app/shared thỏa giao diện này). */
export interface ResponseSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions<T> {
  body?: unknown;
  /** Bắt buộc với phản hồi có thân; bỏ qua với 204. */
  schema?: ResponseSchema<T>;
  signal?: AbortSignal;
  /** Không đưa 401/EMAIL_NOT_VERIFIED vào AuthGate (chính lời gọi /auth/me khi mở ứng dụng, trang đăng nhập). */
  silentAuth?: boolean;
  /** Thao tác ghi an toàn để phát lại một lần sau khi đăng nhập lại (không đụng đăng/duyệt/xóa). */
  safeToReplay?: boolean;
  /** Phiên bản bản ghi khi sửa (khóa lạc quan) – cách gửi do `version.ts` quyết định. */
  version?: number;
  headers?: Record<string, string>;
}

/** Cổng xử lý hết phiên (cài bởi `auth-gate.ts`). */
export interface AuthGateHook {
  /** Gọi khi 401 UNAUTHENTICATED; trả kết quả sau khi người dùng đăng nhập lại (hoặc không). */
  onUnauthenticated(error: AppError): Promise<'resumed' | 'switched' | 'ended'>;
  onEmailNotVerified(error: AppError): void;
}

let gate: AuthGateHook | null = null;
export function setAuthGate(hook: AuthGateHook | null): void {
  gate = hook;
}

const FORBIDDEN_KEYS = new Set(['accountid', 'tenantid', 'account_id', 'tenant_id']);

/** FR-010: mã tài khoản lấy từ phiên ở máy chủ – giao diện KHÔNG BAO GIỜ gửi `accountId`/`tenantId`. */
function assertNoTenantIdentifier(path: string, body: unknown): void {
  if (/[?&/](?:account|tenant)[_-]?id(?:[=&/]|$)/i.test(path)) {
    throw new Error('apiClient: không được gửi mã tài khoản trong đường dẫn (mã lấy từ phiên)');
  }
  const seen = new Set<unknown>();
  const walk = (value: unknown): void => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
        throw new Error(`apiClient: không được gửi khóa "${key}" (mã tài khoản lấy từ phiên)`);
      }
      walk(child);
    }
  };
  walk(body);
}

const NETWORK_MESSAGE = 'Không kết nối được máy chủ. Hãy kiểm tra mạng rồi thử lại.';
const INVALID_MESSAGE = 'Máy chủ trả về dữ liệu không đọc được. Vui lòng thử lại sau.';

function invalid(status: number): AppError {
  return new AppError({
    kind: 'invalid_response',
    status,
    code: 'INVALID_RESPONSE',
    message: INVALID_MESSAGE,
    actions: [{ kind: 'retry', label: 'Thử lại' }],
  });
}

async function execute<T>(
  method: HttpMethod,
  path: string,
  options: RequestOptions<T>,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...options.headers,
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: options.signal ?? null,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    setApiReachable(false);
    throw new AppError({
      kind: 'network',
      status: 0,
      code: 'NETWORK',
      message: NETWORK_MESSAGE,
      actions: [{ kind: 'retry', label: 'Thử lại' }],
    });
  }

  setApiReachable(true);
  if (res.status === 204) return undefined as T;
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw invalid(res.status);
  }

  if (!res.ok) {
    const parsed = ErrorResponse.safeParse(json);
    if (!parsed.success) throw invalid(res.status);
    const e = parsed.data.error;
    throw new AppError({
      kind: classify(res.status, e.code),
      status: res.status,
      code: e.code,
      message: e.message,
      actions: e.actions,
      fieldErrors: Object.fromEntries((e.fieldErrors ?? []).map((f) => [f.path.join('.'), f.message])),
      ...(e.retryAfterSeconds !== undefined ? { retryAfterSeconds: e.retryAfterSeconds } : {}),
      support: e.support,
      ...(e.reason !== undefined ? { reason: e.reason } : {}),
    });
  }

  if (options.schema === undefined) return json as T;
  const parsed = options.schema.safeParse(json);
  if (!parsed.success) throw invalid(res.status);
  return parsed.data;
}

async function request<T>(
  method: HttpMethod,
  path: string,
  options: RequestOptions<T> = {},
): Promise<T> {
  assertNoTenantIdentifier(path, options.body);
  try {
    return await execute(method, path, options);
  } catch (err) {
    if (!(err instanceof AppError) || options.silentAuth === true || gate === null) throw err;
    if (err.code === 'EMAIL_NOT_VERIFIED') {
      gate.onEmailNotVerified(err);
      throw err;
    }
    if (err.kind !== 'session_expired') throw err;
    const outcome = await gate.onUnauthenticated(err);
    // Chỉ phát lại GET và thao tác khai báo `safeToReplay`, mỗi lời gọi MỘT lần (nguyên tắc II).
    if (outcome === 'resumed' && (method === 'GET' || options.safeToReplay === true)) {
      return execute(method, path, options);
    }
    throw err;
  }
}

export const apiClient = { request };
