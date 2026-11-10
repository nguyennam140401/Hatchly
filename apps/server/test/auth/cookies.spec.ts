import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  clearSessionCookie,
  CUSTOMER_SESSION_COOKIE,
  hashToken,
  readCookie,
  setSessionCookie,
  STAFF_SESSION_COOKIE,
} from '../../src/core/auth/cookies';

// T026 (contracts/auth-http-api.md mục 4): cookie phiên __Host-, đọc/ghi không thư viện.

function fakeRes() {
  const headers: Record<string, unknown> = {};
  return {
    headers,
    setHeader: (k: string, v: unknown) => {
      headers[k.toLowerCase()] = v;
    },
    getHeader: (k: string) => headers[k.toLowerCase()],
  };
}

describe('cookies', () => {
  it('tên cookie đúng hợp đồng', () => {
    expect(CUSTOMER_SESSION_COOKIE).toBe('__Host-sid');
    expect(STAFF_SESSION_COOKIE).toBe('__Host-staff_sid');
  });

  it('readCookie lấy đúng tên, bỏ giá trị không phải base64url', () => {
    const req = { headers: { cookie: 'a=1; __Host-sid=abc_DEF-9; __Host-staff_sid=zz' } };
    expect(readCookie(req, '__Host-sid')).toBe('abc_DEF-9');
    expect(readCookie(req, '__Host-staff_sid')).toBe('zz');
    expect(readCookie(req, 'missing')).toBeUndefined();
    expect(readCookie({ headers: { cookie: '__Host-sid=a%3Bb' } }, '__Host-sid')).toBeUndefined();
    expect(readCookie({ headers: {} }, '__Host-sid')).toBeUndefined();
    expect(readCookie({ headers: { cookie: '__Host-sid=' } }, '__Host-sid')).toBeUndefined();
  });

  it('setSessionCookie: HttpOnly; Secure; SameSite=Lax; Path=/; không Domain', () => {
    const res = fakeRes();
    setSessionCookie(res as never, '__Host-sid', 'tok', 3600);
    setSessionCookie(res as never, '__Host-staff_sid', 'tok2', undefined);
    const [customer, staff] = res.headers['set-cookie'] as string[];
    expect(customer).toBe('__Host-sid=tok; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600');
    expect(staff).toBe('__Host-staff_sid=tok2; Path=/; HttpOnly; Secure; SameSite=Lax');
    expect(customer).not.toMatch(/Domain/i);
  });

  it('setSessionCookie từ chối giá trị có ký tự lạ', () => {
    expect(() => {
      setSessionCookie(fakeRes() as never, '__Host-sid', 'a;b', 1);
    }).toThrow();
  });

  it('clearSessionCookie đặt Max-Age=0', () => {
    const res = fakeRes();
    clearSessionCookie(res as never, '__Host-sid');
    expect((res.headers['set-cookie'] as string[])[0]).toMatch(/^__Host-sid=; .*Max-Age=0$/);
  });

  it('hashToken = SHA-256 của mã', () => {
    expect(hashToken('abc').equals(createHash('sha256').update('abc').digest())).toBe(true);
    expect(hashToken('abc')).toHaveLength(32);
  });
});
