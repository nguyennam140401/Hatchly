import { describe, expect, it } from 'vitest';
import { PasswordHasher } from '../../src/modules/account/internal/auth/password/password-hasher';
import {
  bannedPasswords,
  checkPassword,
} from '../../src/modules/account/internal/auth/password/password-policy';

// T030 (FR-005, R2): chính sách mật khẩu và băm argon2id.

const hasher = new PasswordHasher({ memoryCost: 64, timeCost: 1 });

describe('chính sách mật khẩu', () => {
  it('8–128 ký tự theo điểm mã sau NFKC', () => {
    expect(checkPassword('Ab1!xyz')).toMatchObject({ ok: false, reason: 'too_short' });
    expect(checkPassword('Ab1!xyzQ')).toMatchObject({ ok: true });
    expect(checkPassword('Đ'.repeat(128))).toMatchObject({ ok: true });
    expect(checkPassword('Đ'.repeat(129))).toMatchObject({ ok: false, reason: 'too_long' });
  });

  it('chuỗi rất dài bị từ chối nhanh, trước khi chuẩn hóa/băm', () => {
    const start = performance.now();
    expect(checkPassword('x'.repeat(1_000_000))).toMatchObject({ ok: false, reason: 'too_long' });
    expect(performance.now() - start).toBeLessThan(50);
  });

  it('không cắt khoảng trắng', () => {
    const r = checkPassword('  khoảng trắng  ');
    expect(r).toMatchObject({ ok: true, normalized: '  khoảng trắng  ' });
  });

  it('dấu dựng sẵn và dấu tổ hợp cho cùng kết quả chuẩn hóa', () => {
    const composed = 'Mậtkhẩuxịn9'.normalize('NFC');
    const decomposed = composed.normalize('NFD');
    expect(composed).not.toBe(decomposed);
    const a = checkPassword(composed);
    const b = checkPassword(decomposed);
    expect(a.ok && b.ok && a.normalized === b.normalized).toBe(true);
  });

  it('cấm mật khẩu phổ biến (cả tiếng Việt), so chữ thường', () => {
    expect(bannedPasswords().size).toBeGreaterThan(9_000);
    for (const p of ['matkhau123', 'MATKHAU123', '123456789', 'password', 'anhyeuem']) {
      const r = checkPassword(p);
      if (r.ok) throw new Error(`"${p}" lẽ ra bị cấm hoặc quá ngắn`);
    }
    expect(checkPassword('12345678')).toMatchObject({ ok: false, reason: 'common' });
  });

  it('cấm trùng email hoặc phần trước @', () => {
    expect(checkPassword('lan.nguyen', 'lan.nguyen@example.vn')).toMatchObject({
      ok: false,
      reason: 'matches_email',
    });
    expect(checkPassword('Lan.Nguyen@Example.vn', 'lan.nguyen@example.vn')).toMatchObject({
      ok: false,
      reason: 'matches_email',
    });
  });

  it('mọi lỗi có lời giải thích tiếng Việt', () => {
    const r = checkPassword('ngan');
    expect(!r.ok && r.message).toMatch(/ít nhất 8 ký tự/);
  });
});

describe('PasswordHasher', () => {
  it('argon2id PHC, verify đúng/sai, băm hỏng → false', async () => {
    const h = await hasher.hash('Mậtkhẩuxịn9');
    expect(h).toMatch(/^\$argon2id\$v=19\$m=64,t=1,p=1\$/);
    expect(await hasher.verify(h, 'Mậtkhẩuxịn9')).toBe(true);
    expect(await hasher.verify(h, 'sai')).toBe(false);
    expect(await hasher.verify('rác', 'x')).toBe(false);
  });

  it('needsRehash khi tham số khác cấu hình', async () => {
    const h = await hasher.hash('x1234567');
    expect(hasher.needsRehash(h)).toBe(false);
    expect(new PasswordHasher({ memoryCost: 128, timeCost: 1 }).needsRehash(h)).toBe(true);
    expect(hasher.needsRehash('$2b$10$abc')).toBe(true);
  });

  it('verifyDummy luôn false', async () => {
    expect(await hasher.verifyDummy('bất kỳ')).toBe(false);
  });
});
