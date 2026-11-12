import { createHash, randomBytes } from 'node:crypto';

// Mã trạng thái chống giả mạo của luồng kết nối (005, R6): 32 byte ngẫu nhiên, chỉ lưu SHA-256 (cùng
// account_id, user_id, channelType), hạn 10 phút, dùng một lần (cập nhật có điều kiện `used_at IS NULL`).

export const OAUTH_STATE_TTL_MS = 10 * 60_000;
export const SELECTION_TTL_MS = 10 * 60_000;

export function newOauthState(): { state: string; hash: Buffer } {
  const state = randomBytes(32).toString('base64url');
  return { state, hash: hashOauthState(state) };
}

export function hashOauthState(state: string): Buffer {
  return createHash('sha256').update(state, 'utf8').digest();
}
