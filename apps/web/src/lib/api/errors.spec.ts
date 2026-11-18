import { describe, expect, it } from 'vitest';
import { AppError, classify } from './errors';

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

describe('AppError', () => {
  it('luôn có ≥ 1 hành động dù máy chủ không trả', () => {
    const e = new AppError({ kind: 'server', status: 500, code: 'X', message: 'm', actions: [] });
    expect(e.actions.length).toBeGreaterThanOrEqual(1);
  });
});
