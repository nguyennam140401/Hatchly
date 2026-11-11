import { BlockList, isIP } from 'node:net';

// Địa chỉ mạng của khách (004, R6, R10). Express tính `req.ip` theo cài đặt `trust proxy` = số proxy
// tin cậy (TRUST_PROXY_HOPS, đặt ở configureApiApp). Ingress PHẢI ghi đè X-Forwarded-For.
// Khớp CIDR bằng `node:net` BlockList – không tự viết phép so khớp bit.

/** Bỏ tiền tố IPv4-mapped (`::ffff:1.2.3.4` → `1.2.3.4`). */
export function normalizeIp(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  return mapped?.[1] ?? ip;
}

/** Địa chỉ mạng của yêu cầu (theo `trust proxy`), đã chuẩn hóa; '0.0.0.0' khi không xác định. */
export function clientIp(req: {
  ip?: string | undefined;
  socket?: { remoteAddress?: string | undefined };
}): string {
  const raw = req.ip ?? req.socket?.remoteAddress;
  if (raw === undefined || raw === '') return '0.0.0.0';
  const ip = normalizeIp(raw);
  return isIP(ip) === 0 ? '0.0.0.0' : ip;
}

/** Bộ khớp danh sách CIDR; danh sách rỗng = không giới hạn (luôn true). */
export function cidrMatcher(cidrs: readonly string[]): (ip: string) => boolean {
  if (cidrs.length === 0) return () => true;
  const list = new BlockList();
  for (const cidr of cidrs) {
    const slash = cidr.lastIndexOf('/');
    const address = cidr.slice(0, slash);
    const prefix = Number(cidr.slice(slash + 1));
    list.addSubnet(address, prefix, isIP(address) === 6 ? 'ipv6' : 'ipv4');
  }
  return (ip: string) => {
    const normalized = normalizeIp(ip);
    const family = isIP(normalized);
    if (family === 0) return false;
    return list.check(normalized, family === 6 ? 'ipv6' : 'ipv4');
  };
}

/** Địa chỉ `ip` thuộc một trong các CIDR (rỗng = mọi địa chỉ). */
export function ipInCidrs(ip: string, cidrs: readonly string[]): boolean {
  return cidrMatcher(cidrs)(ip);
}

/** Nhóm trình duyệt/hệ điều hành ngắn gọn cho phiên và kiểm toán, vd "Chrome · Android" (≤ 60 ký tự). */
export function userAgentSummary(ua: string | undefined): string | null {
  if (ua === undefined || ua.trim() === '') return null;
  const browser = ua.includes('Edg/')
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : ua.includes('Firefox/')
        ? 'Firefox'
        : ua.includes('Chrome/')
          ? 'Chrome'
          : ua.includes('Safari/')
            ? 'Safari'
            : 'Khác';
  const os = ua.includes('Android')
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : ua.includes('Windows')
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : ua.includes('Linux')
            ? 'Linux'
            : 'Khác';
  return `${browser} · ${os}`.slice(0, 60);
}
