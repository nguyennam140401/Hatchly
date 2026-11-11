// Chặn mọi kết nối mạng ra ngoài máy cục bộ (005, SC-007): nạp bằng
//   node --require ./test/helpers/deny-egress.cjs …
// Luồng chạy cục bộ bằng bản giả lập phải chạy được khi không có Internet – mọi đích không phải
// localhost hoặc dịch vụ của docker compose → ném lỗi nêu rõ máy đích.
'use strict';

const net = require('node:net');
const tls = require('node:tls');
const dns = require('node:dns');

const ALLOWED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  // Tên dịch vụ của docker-compose.yml.
  'postgres',
  'mailpit',
  'minio',
  'api',
  'worker',
]);

function isAllowed(host) {
  if (host === undefined || host === null || host === '') return true; // socket cục bộ (IPC)
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  return ALLOWED_HOSTS.has(h) || h.startsWith('127.') || h.endsWith('.localhost');
}

function deny(host, port) {
  const err = new Error(
    `deny-egress: chặn kết nối ra ngoài tới ${String(host)}${port === undefined ? '' : `:${String(port)}`} (SC-007 – bản giả lập không được gọi mạng ngoài)`,
  );
  err.code = 'EGRESS_DENIED';
  return err;
}

/** Lấy host/port từ mọi dạng tham số của connect(). */
function target(args) {
  const first = args[0];
  if (Array.isArray(first)) return target(first);
  if (first !== null && typeof first === 'object') {
    if (first.path !== undefined) return { host: undefined, port: undefined };
    return { host: first.host ?? 'localhost', port: first.port };
  }
  if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
    return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: first };
  }
  // connect(path) – socket tệp.
  return { host: undefined, port: undefined };
}

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function patchedConnect(...args) {
  const { host, port } = target(args);
  if (!isAllowed(host)) throw deny(host, port);
  return originalConnect.apply(this, args);
};

const originalTlsConnect = tls.connect;
tls.connect = function patchedTlsConnect(...args) {
  const { host, port } = target(args);
  const servername = args[0] !== null && typeof args[0] === 'object' ? args[0].servername : undefined;
  if (!isAllowed(host) || (servername !== undefined && !isAllowed(servername))) {
    throw deny(servername ?? host, port);
  }
  return originalTlsConnect.apply(this, args);
};

const originalLookup = dns.lookup;
dns.lookup = function patchedLookup(hostname, ...rest) {
  if (!isAllowed(hostname)) {
    const callback = rest.find((r) => typeof r === 'function');
    const err = deny(hostname);
    if (callback !== undefined) {
      process.nextTick(() => callback(err));
      return undefined;
    }
    throw err;
  }
  return originalLookup.call(this, hostname, ...rest);
};

const originalPromisesLookup = dns.promises.lookup;
dns.promises.lookup = function patchedPromisesLookup(hostname, ...rest) {
  if (!isAllowed(hostname)) return Promise.reject(deny(hostname));
  return originalPromisesLookup.call(this, hostname, ...rest);
};

module.exports = { isAllowed };
