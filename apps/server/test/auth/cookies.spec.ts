import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  clearSessionCookie,
  CUSTOMER_SESSION_COOKIE,
  hashToken,
  OAUTH_FLOW_COOKIE,
  OAUTH_FLOW_COOKIE_MAX_AGE_SECONDS,
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
  it('009: cookie lượt đăng nhập __Host-oauth – HttpOnly; Secure; SameSite=Lax; Path=/; 30 phút; xóa được', () => {
    expect(OAUTH_FLOW_COOKIE).toBe('__Host-oauth');
    expect(OAUTH_FLOW_COOKIE_MAX_AGE_SECONDS).toBe(1800);
    const res = fakeRes();
    setSessionCookie(
      res as never,
      OAUTH_FLOW_COOKIE,
      'ma_luot-123',
      OAUTH_FLOW_COOKIE_MAX_AGE_SECONDS,
    );
    expect(res.headers['set-cookie']).toEqual([
      '__Host-oauth=ma_luot-123; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1800',
    ]);
    // SameSite=Lax để cookie đi kèm lần chuyển hướng GET từ nhà cung cấp về; không có Domain.
    expect(String((res.headers['set-cookie'] as string[])[0])).not.toMatch(/Domain=/i);
    clearSessionCookie(res as never, OAUTH_FLOW_COOKIE);
    expect((res.headers['set-cookie'] as string[])[1]).toBe(
      '__Host-oauth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    );
    expect(readCookie({ headers: { cookie: '__Host-oauth=ma_luot-123' } }, OAUTH_FLOW_COOKIE)).toBe(
      'ma_luot-123',
    );
  });
});
