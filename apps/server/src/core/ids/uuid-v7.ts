import { randomBytes } from 'node:crypto';

/**
 * Sinh UUID v7 (RFC 9562): 48 bit thời gian mili giây + bit ngẫu nhiên.
 * Dùng cho mã theo dõi; khóa chính của bảng (WBS 1.2) dùng cùng định dạng.
 */
export function uuidV7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  const ts = BigInt(now);
  for (let i = 0; i < 6; i++) {
    bytes[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // phiên bản 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // biến thể RFC
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
