import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AUTH_ERROR_MESSAGES,
  ERROR_CODES,
  ErrorAction,
  ErrorResponse,
  loginThrottledMessage,
  Id,
  MicroUsd,
  UsagePercent,
  UtcDateTime,
  toFieldErrors,
} from '../src/core/index.js';

const UUID_V7 = '0190a0b4-6b5e-7c3a-8f4e-1a2b3c4d5e6f';
const UUID_V4 = '0190a0b4-6b5e-4c3a-8f4e-1a2b3c4d5e6f';

describe('Id (UUID v7)', () => {
  it('nhận UUID v7', () => {
    expect(Id.safeParse(UUID_V7).success).toBe(true);
  });
  it('từ chối UUID v4 và chuỗi rỗng', () => {
    expect(Id.safeParse(UUID_V4).success).toBe(false);
    expect(Id.safeParse('').success).toBe(false);
  });
});

describe('UtcDateTime', () => {
  it('nhận thời điểm có hậu tố Z', () => {
    expect(UtcDateTime.safeParse('2026-11-08T03:00:00Z').success).toBe(true);
  });
  it('từ chối thời điểm có offset khác UTC', () => {
    expect(UtcDateTime.safeParse('2026-11-08T10:00:00+07:00').success).toBe(false);
  });
});

describe('MicroUsd', () => {
  it('chỉ nhận số nguyên không âm', () => {
    expect(MicroUsd.safeParse(4_000_000).success).toBe(true);
    expect(MicroUsd.safeParse(1.5).success).toBe(false);
    expect(MicroUsd.safeParse(-1).success).toBe(false);
  });
});

describe('UsagePercent', () => {
  it('chỉ nhận số nguyên 0–100', () => {
    expect(UsagePercent.safeParse(0).success).toBe(true);
    expect(UsagePercent.safeParse(100).success).toBe(true);
    expect(UsagePercent.safeParse(101).success).toBe(false);
    expect(UsagePercent.safeParse(-1).success).toBe(false);
    expect(UsagePercent.safeParse(50.5).success).toBe(false);
  });
});

describe('ErrorResponse', () => {
  const base = {
    code: 'NOT_FOUND',
    message: 'Không tìm thấy trang.',
    support: { traceId: UUID_V7 },
  };
  it('nhận lỗi có ít nhất một hành động khắc phục', () => {
    const parsed = ErrorResponse.safeParse({
      error: { ...base, actions: [{ kind: 'navigate', label: 'Về trang chủ', href: '/' }] },
    });
    expect(parsed.success).toBe(true);
  });
  it('từ chối actions rỗng', () => {
    expect(ErrorResponse.safeParse({ error: { ...base, actions: [] } }).success).toBe(false);
  });
  it('từ chối mã không phải UPPER_SNAKE_CASE', () => {
    const parsed = ErrorResponse.safeParse({
      error: { ...base, code: 'notFound', actions: [{ kind: 'retry', label: 'Thử lại' }] },
    });
    expect(parsed.success).toBe(false);
  });
});

describe('toFieldErrors – thông điệp tiếng Việt', () => {
  const Sample = z.object({
    message: z.string().trim().min(1).max(5),
    count: z.int().min(1).max(10),
    id: Id,
    at: UtcDateTime,
  });

  it('thiếu trường → "Vui lòng nhập nội dung."', () => {
    const result = Sample.safeParse({});
    expect(result.success).toBe(false);
    const errors = toFieldErrors(result.error!);
    expect(errors).toContainEqual({ path: ['message'], message: 'Vui lòng nhập nội dung.' });
  });

  it('dịch chuỗi quá dài, số ngoài khoảng, UUID và ngày giờ sai', () => {
    const result = Sample.safeParse({
      message: 'quá dài rồi',
      count: 11,
      id: UUID_V4,
      at: '2026-11-08T10:00:00+07:00',
    });
    const errors = toFieldErrors(result.error!);
    expect(errors).toEqual([
      { path: ['message'], message: 'Tối đa 5 ký tự.' },
      { path: ['count'], message: 'Giá trị không được lớn hơn 10.' },
      { path: ['id'], message: 'Mã định danh không hợp lệ.' },
      {
        path: ['at'],
        message: 'Thời gian không đúng định dạng (ví dụ 2026-11-08T03:00:00Z).',
      },
    ]);
  });

  it('không có thông điệp tiếng Anh nào lọt ra', () => {
    const result = Sample.safeParse({ message: 1, count: 'a', id: 2, at: null });
    for (const e of toFieldErrors(result.error!)) {
      expect(e.message).not.toMatch(/Invalid|expected|received/i);
    }
  });

  it('bản ESM và bản CJS trong dist cho cùng kết quả', async () => {
    const require = createRequire(import.meta.url);
    const cjs = require('../dist/core/index.cjs') as typeof import('../src/core/index.js');
    const esm = (await import('../dist/core/index.js')) as typeof import('../src/core/index.js');
    const input = { error: { code: 'x', message: '', actions: [], support: {} } };
    const fromCjs = cjs.toFieldErrors(cjs.ErrorResponse.safeParse(input).error!);
    const fromEsm = esm.toFieldErrors(esm.ErrorResponse.safeParse(input).error!);
    expect(fromCjs.length).toBeGreaterThan(0);
    expect(fromEsm).toEqual(fromCjs);
  });
});

describe('ERROR_CODES', () => {
  it('có VERSION_CONFLICT cho khóa lạc quan (002, FR-019)', () => {
    expect(ERROR_CODES.VERSION_CONFLICT).toBe('VERSION_CONFLICT');
  });

  it('có mã lỗi xác thực (004) và mỗi mã có thông điệp tiếng Việt', () => {
    const authCodes = Object.keys(AUTH_ERROR_MESSAGES);
    expect(authCodes).toHaveLength(14);
    for (const code of authCodes) {
      expect((ERROR_CODES as Record<string, string>)[code]).toBe(code);
      expect(AUTH_ERROR_MESSAGES[code as keyof typeof AUTH_ERROR_MESSAGES].length).toBeGreaterThan(
        5,
      );
    }
    expect(loginThrottledMessage(14 * 60 + 1)).toBe(
      'Bạn đã thử sai nhiều lần. Hãy thử lại sau 15 phút hoặc đặt lại mật khẩu.',
    );
  });

  it('ErrorAction nhận kind mới resend_verification, contact_owner', () => {
    for (const kind of ['resend_verification', 'contact_owner']) {
      expect(ErrorAction.safeParse({ kind, label: 'x' }).success).toBe(true);
    }
  });
});
