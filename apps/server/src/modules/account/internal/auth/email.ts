import { z } from 'zod';

// Chuẩn hóa email (FR-002, R5): trim → NFC → chữ thường toàn bộ (cả phần trước @) → kiểm cú pháp
// (cho phép tên miền quốc tế). Lưu cả dạng hiển thị (đã trim).

const EmailSyntax = z.email({ pattern: z.regexes.unicodeEmail });

export interface NormalizedEmail {
  /** Dạng người dùng nhập, đã cắt khoảng trắng. */
  email: string;
  /** Dạng so sánh/duy nhất. */
  emailNormalized: string;
}

/** Chuẩn hóa; null khi sai cú pháp. */
export function normalizeEmail(input: string): NormalizedEmail | null {
  const email = input.trim().normalize('NFC');
  const emailNormalized = email.toLowerCase();
  if (emailNormalized.length === 0 || emailNormalized.length > 254) return null;
  if (!EmailSyntax.safeParse(emailNormalized).success) return null;
  return { email, emailNormalized };
}
