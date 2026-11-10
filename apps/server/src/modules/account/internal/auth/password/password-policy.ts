import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Chính sách mật khẩu (FR-005, R2 – theo NIST SP 800-63B): không bắt buộc kiểu ký tự; 8–128 ký tự
// tính theo điểm mã SAU chuẩn hóa NFKC; không cắt khoảng trắng; cấm danh sách mật khẩu phổ biến
// (so chữ thường); cấm trùng email hoặc phần trước `@`. Quá 128 → từ chối TRƯỚC khi băm.

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordWeakReason = 'too_short' | 'too_long' | 'common' | 'matches_email';

export type PasswordCheck =
  { ok: true; normalized: string } | { ok: false; reason: PasswordWeakReason; message: string };

const MESSAGES: Record<PasswordWeakReason, string> = {
  too_short: `Mật khẩu cần ít nhất ${PASSWORD_MIN_LENGTH} ký tự.`,
  too_long: `Mật khẩu tối đa ${PASSWORD_MAX_LENGTH} ký tự.`,
  common: 'Mật khẩu này quá phổ biến, dễ bị đoán. Hãy chọn mật khẩu khác.',
  matches_email: 'Mật khẩu không được trùng với email.',
};

let banned: Set<string> | undefined;

/** Danh sách cấm (nạp một lần từ common-passwords.txt – có trong dist nhờ scripts/copy-assets.mjs). */
export function bannedPasswords(): ReadonlySet<string> {
  banned ??= new Set(
    readFileSync(join(__dirname, 'common-passwords.txt'), 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#')),
  );
  return banned;
}

/** Chuẩn hóa NFKC – cùng mật khẩu gõ dấu dựng sẵn hay dấu tổ hợp cho cùng kết quả. */
export function normalizePassword(password: string): string {
  return password.normalize('NFKC');
}

/** Kiểm mật khẩu mới; trả mật khẩu đã chuẩn hóa để băm. `emailNormalized` để cấm trùng email. */
export function checkPassword(password: string, emailNormalized?: string): PasswordCheck {
  // Chặn chuỗi rất dài trước cả bước chuẩn hóa (chống làm treo máy chủ).
  if (password.length > PASSWORD_MAX_LENGTH * 4) {
    return { ok: false, reason: 'too_long', message: MESSAGES.too_long };
  }
  const normalized = normalizePassword(password);
  // Đếm theo điểm mã (đặc tả: "8–128 ký tự" sau chuẩn hóa NFKC), không cần tách cụm chữ.
  const length = Array.from(normalized).length;
  if (length < PASSWORD_MIN_LENGTH) return fail('too_short');
  if (length > PASSWORD_MAX_LENGTH) return fail('too_long');
  const lower = normalized.toLowerCase();
  if (bannedPasswords().has(lower)) return fail('common');
  if (emailNormalized !== undefined) {
    const local = emailNormalized.split('@')[0] ?? '';
    if (lower === emailNormalized || (local.length > 0 && lower === local)) {
      return fail('matches_email');
    }
  }
  return { ok: true, normalized };
}

function fail(reason: PasswordWeakReason): PasswordCheck {
  return { ok: false, reason, message: MESSAGES[reason] };
}
