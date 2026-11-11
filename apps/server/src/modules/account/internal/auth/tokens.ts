import { createHmac, randomBytes } from 'node:crypto';
import { hashToken } from '../../../../core/auth/cookies';

// Mã phiên và mã một lần (R3, R8): 32 byte ngẫu nhiên, base64url. CSDL chỉ lưu SHA-256. Khóa chống dò
// là HMAC-SHA256 – không lưu email/địa chỉ mạng dạng rõ (R6). Chỉ dùng hàm chuẩn của node:crypto.

export { hashToken };

/** Mã ngẫu nhiên mới (43 ký tự base64url). */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Khóa đếm chống dò: HMAC-SHA256(secret, kind + ':' + value). */
export function hmacKey(secret: string, kind: string, value: string): Buffer {
  return createHmac('sha256', secret).update(`${kind}:${value}`, 'utf8').digest();
}
