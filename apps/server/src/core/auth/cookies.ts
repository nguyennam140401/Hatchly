import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Cookie phiên (004, R3, contracts/auth-http-api.md mục 4). Đọc/ghi bằng hàm nhỏ tự viết (không thêm
// thư viện – quyết định T001). `__Host-` buộc Secure, Path=/, không Domain → tên miền con không ghi đè
// được. Trình duyệt coi localhost là ngữ cảnh an toàn nên Secure vẫn chạy ở dev qua http.

export const CUSTOMER_SESSION_COOKIE = '__Host-sid';
export const STAFF_SESSION_COOKIE = '__Host-staff_sid';

const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const COOKIE_VALUE = /^[A-Za-z0-9_-]*$/;

/** Giá trị cookie theo tên từ tiêu đề `Cookie`; undefined khi không có hoặc không hợp lệ. */
export function readCookie(
  req: Pick<IncomingMessage, 'headers'>,
  name: string,
): string | undefined {
  const header = req.headers.cookie;
  if (typeof header !== 'string' || header === '') return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    // Mã phiên là base64url – giá trị khác coi như không có.
    return value !== '' && COOKIE_VALUE.test(value) ? value : undefined;
  }
  return undefined;
}

function appendSetCookie(res: ServerResponse, cookie: string): void {
  const existing = res.getHeader('set-cookie');
  const list = Array.isArray(existing) ? existing : typeof existing === 'string' ? [existing] : [];
  res.setHeader('set-cookie', [...list, cookie]);
}

/**
 * Đặt cookie phiên `HttpOnly; Secure; SameSite=Lax; Path=/` (không Domain). `maxAgeSeconds`
 * undefined → cookie phiên trình duyệt (nhân viên).
 */
export function setSessionCookie(
  res: ServerResponse,
  name: string,
  token: string,
  maxAgeSeconds: number | undefined,
): void {
  if (!COOKIE_NAME.test(name) || !COOKIE_VALUE.test(token)) {
    throw new Error('Tên hoặc giá trị cookie không hợp lệ');
  }
  const parts = [`${name}=${token}`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax'];
  if (maxAgeSeconds !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
  appendSetCookie(res, parts.join('; '));
}

/** Xóa cookie phiên (`Max-Age=0`). */
export function clearSessionCookie(res: ServerResponse, name: string): void {
  appendSetCookie(res, `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

/** SHA-256 của mã (base64url) – thứ DUY NHẤT về mã được lưu trong CSDL và bộ nhớ đệm. */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}
