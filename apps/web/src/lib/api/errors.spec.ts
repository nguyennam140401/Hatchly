import { describe, expect, it } from 'vitest';
import { ApiError } from '../api-client';
import { AppError, classify, toAppError } from './errors';

const body = (code: string, extra: Record<string, unknown> = {}) => ({
  message: 'Thông điệp',
  actions: [{ kind: 'retry' as const, label: 'Thử lại' }],
  support: { traceId: 't-1', detail: code },
  code,
  ...extra,
});

describe('classify', () => {
  it.each([
    [401, 'UNAUTHENTICATED', 'session_expired'],
    [403, 'FORBIDDEN', 'forbidden'],
    [403, 'ACCOUNT_UNAVAILABLE', 'forbidden'],
    [409, 'VERSION_CONFLICT', 'version_conflict'],
    [400, 'VALIDATION_FAILED', 'validation'],
    [429, 'RATE_LIMITED', 'rate_limited'],
    [429, 'LOGIN_THROTTLED', 'rate_limited'],
    [404, 'NOT_FOUND', 'not_found'],
    [409, 'LIMIT_POSTS', 'limit_reached'],
    [500, 'INTERNAL_ERROR', 'server'],
    [409, 'SEATS_FULL', 'business'],
  ])('%s %s → %s', (status, code, kind) => {
    expect(classify(status, code)).toBe(kind);
  });
});

describe('toAppError', () => {
  it('lỗi mạng', () => {
    const e = toAppError(new ApiError(0, 'NETWORK', null, 'network'));
    expect(e.kind).toBe('network');
    expect(e.actions.length).toBeGreaterThanOrEqual(1);
  });
  it('phản hồi sai hình', () => {
    const e = toAppError(new ApiError(200, 'INVALID_RESPONSE', null, 'invalid_response'));
    expect(e.kind).toBe('invalid_response');
  });
  it('lỗi theo ô: khóa là đường dẫn chấm', () => {
    const api = new ApiError(
      400,
      'VALIDATION_FAILED',
      body('VALIDATION_FAILED', { fieldErrors: [{ path: ['address', 'city'], message: 'Thiếu' }] }),
      'api_error',
    );
    const e = toAppError(api);
    expect(e.kind).toBe('validation');
    expect(e.fieldErrors).toEqual({ 'address.city': 'Thiếu' });
    expect(e.support.traceId).toBe('t-1');
  });
  it('giữ `reason` của phiên', () => {
    const api = new ApiError(
      401,
      'UNAUTHENTICATED',
      body('UNAUTHENTICATED', { reason: 'password_changed' }),
      'api_error',
    );
    expect(toAppError(api).reason).toBe('password_changed');
  });
  it('luôn có ≥ 1 hành động dù máy chủ không trả', () => {
    const e = new AppError({ kind: 'server', status: 500, code: 'X', message: 'm', actions: [] });
    expect(e.actions.length).toBeGreaterThanOrEqual(1);
  });
});
