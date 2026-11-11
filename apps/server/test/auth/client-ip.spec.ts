import { describe, expect, it } from 'vitest';
import {
  cidrMatcher,
  clientIp,
  ipInCidrs,
  normalizeIp,
  userAgentSummary,
} from '../../src/core/auth/client-ip';

// T024 (R6, R10): địa chỉ mạng khách và khớp CIDR IPv4/IPv6 bằng node:net BlockList.

describe('client-ip', () => {
  it('chuẩn hóa IPv4-mapped', () => {
    expect(normalizeIp('::ffff:10.0.0.7')).toBe('10.0.0.7');
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
  });

  it('clientIp lấy req.ip (đã theo trust proxy), rồi socket; giá trị lạ → 0.0.0.0', () => {
    expect(clientIp({ ip: '::ffff:203.0.113.9' })).toBe('203.0.113.9');
    expect(clientIp({ socket: { remoteAddress: '198.51.100.1' } })).toBe('198.51.100.1');
    expect(clientIp({ ip: 'không-phải-ip' })).toBe('0.0.0.0');
    expect(clientIp({})).toBe('0.0.0.0');
  });

  it('danh sách rỗng = không giới hạn', () => {
    expect(ipInCidrs('203.0.113.1', [])).toBe(true);
  });

  it('khớp IPv4 và IPv6', () => {
    const match = cidrMatcher(['10.0.0.0/8', '2001:db8::/32']);
    expect(match('10.1.2.3')).toBe(true);
    expect(match('::ffff:10.1.2.3')).toBe(true);
    expect(match('11.0.0.1')).toBe(false);
    expect(match('2001:db8:abcd::1')).toBe(true);
    expect(match('2001:db9::1')).toBe(false);
    expect(match('rác')).toBe(false);
  });

  it('userAgentSummary ngắn gọn, ≤ 60 ký tự', () => {
    expect(
      userAgentSummary(
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
      ),
    ).toBe('Chrome · Android');
    expect(
      userAgentSummary(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari · iOS');
    expect(userAgentSummary(undefined)).toBeNull();
    expect((userAgentSummary('x'.repeat(500)) ?? '').length).toBeLessThanOrEqual(60);
  });
});
