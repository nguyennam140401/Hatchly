import type { IncomingMessage, ServerResponse } from 'node:http';
import { AUTH_ERROR_MESSAGES, ERROR_CODES, type ErrorResponse } from '@app/shared/core';
import { resolveTraceId } from '../context/request-context';

// Chống giả mạo yêu cầu từ trang khác (FR-012a, R3). Chạy TRƯỚC guard cho mọi phương thức không an
// toàn (POST, PUT, PATCH, DELETE) – kể cả điểm cuối công khai như đăng nhập. Chấp nhận khi `Origin`
// thuộc WEB_ORIGINS, hoặc `Sec-Fetch-Site: same-origin`. Thiếu cả hai → 403 CSRF_REJECTED. Cùng với
// cookie SameSite=Lax. Không cần mã CSRF đồng bộ vì SPA và API cùng site.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Điểm cuối do MÁY gọi (không có trình duyệt, không cookie phiên) nên không có `Origin`: kiểm tra khói sau triển
 * khai (008 FR-032) được SmokeTokenGuard bảo vệ bằng mã riêng và trả 404 khi sai mã. CSRF không áp dụng vì
 * không dựa vào cookie; từ chối 403 ở đây còn làm lộ sự tồn tại của điểm cuối.
 */
const MACHINE_PATHS = ['/api/v1/ops/smoke'];

/**
 * 009 (FR-009a, research R15): hai điểm cuối do MÁY CHỦ META gọi (thông báo gỡ ứng dụng / xóa dữ liệu).
 * Danh sách CỐ ĐỊNH TRONG MÃ, khớp CHÍNH XÁC đường dẫn (không theo tiền tố). Thay cho kiểm tra nguồn
 * gửi: bắt buộc chữ ký HMAC hợp lệ của `signed_request`; hai điểm cuối này không đọc cookie.
 */
export const META_CALLBACK_PATHS: readonly string[] = [
  '/api/v1/auth/facebook/deauthorize',
  '/api/v1/auth/facebook/data-deletion',
];

const isMachinePath = (url: string | undefined): boolean => {
  const path = (url ?? '').split('?')[0] ?? '';
  if (META_CALLBACK_PATHS.includes(path)) return true;
  return MACHINE_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
};

/** Yêu cầu có được phép theo nguồn gửi không. */
export function isOriginAllowed(
  req: Pick<IncomingMessage, 'method' | 'headers'> & { url?: string | undefined },
  allowedOrigins: ReadonlySet<string>,
): boolean {
  if (SAFE_METHODS.has((req.method ?? 'GET').toUpperCase())) return true;
  if (isMachinePath(req.url)) return true;
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== 'null' && allowedOrigins.has(origin)) return true;
  return req.headers['sec-fetch-site'] === 'same-origin';
}

/** Middleware Express/Node: từ chối 403 CSRF_REJECTED theo định dạng ErrorResponse chuẩn. */
export function originCheckMiddleware(webOrigins: readonly string[]) {
  const allowed = new Set(webOrigins);
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    if (isOriginAllowed(req, allowed)) {
      next();
      return;
    }
    const body: ErrorResponse = {
      error: {
        code: ERROR_CODES.CSRF_REJECTED,
        message: AUTH_ERROR_MESSAGES.CSRF_REJECTED,
        actions: [{ kind: 'retry', label: 'Tải lại trang' }],
        support: { traceId: resolveTraceId(req, res), detail: 'origin_not_allowed' },
      },
    };
    res.statusCode = 403;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };
}
