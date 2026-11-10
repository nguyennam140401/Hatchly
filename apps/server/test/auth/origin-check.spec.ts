import { describe, expect, it } from 'vitest';
import {
  isOriginAllowed,
  originCheckMiddleware,
} from '../../src/core/auth/origin-check.middleware';

// T025 (FR-012a, R3): chống giả mạo yêu cầu từ trang khác.

const allowed = new Set(['https://app.example.vn']);
const req = (method: string, headers: Record<string, string> = {}) => ({ method, headers });

describe('origin-check', () => {
  it('GET/HEAD/OPTIONS luôn qua', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS']) expect(isOriginAllowed(req(m), allowed)).toBe(true);
  });

  it('POST với Origin trong danh sách → qua', () => {
    expect(isOriginAllowed(req('POST', { origin: 'https://app.example.vn' }), allowed)).toBe(true);
  });

  it('POST với Sec-Fetch-Site: same-origin → qua', () => {
    expect(isOriginAllowed(req('DELETE', { 'sec-fetch-site': 'same-origin' }), allowed)).toBe(true);
  });

  it('thiếu cả hai, Origin lạ, Origin null, same-site khác origin → từ chối', () => {
    expect(isOriginAllowed(req('POST'), allowed)).toBe(false);
    expect(isOriginAllowed(req('PUT', { origin: 'https://evil.example' }), allowed)).toBe(false);
    expect(isOriginAllowed(req('PATCH', { origin: 'null' }), allowed)).toBe(false);
    expect(
      isOriginAllowed(
        req('POST', { origin: 'https://cdn.example.vn', 'sec-fetch-site': 'same-site' }),
        allowed,
      ),
    ).toBe(false);
  });

  it('middleware trả 403 CSRF_REJECTED theo ErrorResponse', () => {
    const mw = originCheckMiddleware(['https://app.example.vn']);
    const headers: Record<string, unknown> = {};
    let body = '';
    const res = {
      statusCode: 200,
      setHeader: (k: string, v: unknown) => {
        headers[k.toLowerCase()] = v;
      },
      getHeader: (k: string) => headers[k.toLowerCase()],
      hasHeader: (k: string) => k.toLowerCase() in headers,
      end: (b: string) => {
        body = b;
      },
    };
    let called = false;
    mw(req('POST', { origin: 'https://evil.example' }) as never, res as never, () => {
      called = true;
    });
    expect(called).toBe(false);
    expect(res.statusCode).toBe(403);
    const parsed = JSON.parse(body) as { error: { code: string; actions: unknown[] } };
    expect(parsed.error.code).toBe('CSRF_REJECTED');
    expect(parsed.error.actions.length).toBeGreaterThan(0);
  });
});
