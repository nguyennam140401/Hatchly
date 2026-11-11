import { describe, expect, it } from 'vitest';
import { normalizeEmail } from '../../src/modules/account/internal/auth/email';
import { hmacKey, newToken } from '../../src/modules/account/internal/auth/tokens';

// T031, T032 (FR-002, R5, R6, R8): chuẩn hóa email; mã ngẫu nhiên; khóa HMAC chống dò.

describe('normalizeEmail', () => {
  it('trim → NFC → chữ thường toàn bộ', () => {
    expect(normalizeEmail('  Lan.Nguyen@Example.VN ')).toEqual({
      email: 'Lan.Nguyen@Example.VN',
      emailNormalized: 'lan.nguyen@example.vn',
    });
  });

  it('dấu tổ hợp và dựng sẵn cho cùng dạng chuẩn', () => {
    const a = normalizeEmail('thư@ví-dụ.vn'.normalize('NFD'));
    const b = normalizeEmail('thư@ví-dụ.vn'.normalize('NFC'));
    expect(a?.emailNormalized).toBe(b?.emailNormalized);
  });

  it('cho phép tên miền quốc tế', () => {
    expect(normalizeEmail('ban@cửahàng.vn')).not.toBeNull();
  });

  it('sai cú pháp hoặc quá dài → null', () => {
    for (const bad of ['', '   ', 'khong-co-a-cong', 'a@', '@b.vn', 'a b@c.vn']) {
      expect(normalizeEmail(bad), bad).toBeNull();
    }
    expect(normalizeEmail(`${'a'.repeat(250)}@b.vn`)).toBeNull();
  });
});

describe('tokens', () => {
  it('newToken: 32 byte base64url, không lặp', () => {
    const a = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(a);
  });

  it('hmacKey phụ thuộc khóa bí mật, loại và giá trị', () => {
    const k = hmacKey('s'.repeat(32), 'login_email', 'a@b.vn');
    expect(k).toHaveLength(32);
    expect(hmacKey('s'.repeat(32), 'login_email', 'a@b.vn').equals(k)).toBe(true);
    expect(hmacKey('t'.repeat(32), 'login_email', 'a@b.vn').equals(k)).toBe(false);
    expect(hmacKey('s'.repeat(32), 'login_ip', 'a@b.vn').equals(k)).toBe(false);
  });
});
