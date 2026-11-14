// `pnpm infra dns-check <env>` – tra từng bản ghi DNS công khai, so với giá trị mong đợi, rồi kiểm chứng chỉ TLS
// (T057). Không cần chứng thực đám mây. Thoát 4 khi chưa đạt.
import { resolve4, resolveCname } from 'node:dns/promises';
import { connect } from 'node:tls';
import { CliExit, EXIT } from '../lib/exit-codes.mjs';
import { openSession } from '../lib/session.mjs';
import { init, output } from '../lib/terraform.mjs';

const MIN_DAYS_LEFT = 14;

/** Tra một bản ghi; trả `{ ok, actual }`. */
export async function checkRecord(record, resolvers = { resolve4, resolveCname }) {
  const expected = String(record.value ?? '').replace(/\.$/, '');
  try {
    const actual =
      record.type === 'A'
        ? await resolvers.resolve4(record.name)
        : record.type === 'CNAME'
          ? await resolvers.resolveCname(record.name)
          : [];
    const clean = actual.map((v) => v.replace(/\.$/, ''));
    return { ok: expected !== '' && clean.includes(expected), actual: clean, expected };
  } catch {
    return { ok: false, actual: [], expected };
  }
}

/** Kiểm chứng chỉ TLS của một tên: hợp lệ, đúng tên, còn hạn > 14 ngày. */
export function checkTls(host, { timeoutMs = 8000, now = () => new Date() } = {}) {
  return new Promise((resolvePromise) => {
    const socket = connect({ host, port: 443, servername: host, timeout: timeoutMs }, () => {
      const cert = socket.getPeerCertificate();
      const daysLeft = (new Date(cert.valid_to).getTime() - now().getTime()) / 86_400_000;
      resolvePromise({
        ok: socket.authorized && daysLeft > MIN_DAYS_LEFT,
        authorized: socket.authorized,
        authError: socket.authorizationError ? String(socket.authorizationError) : undefined,
        daysLeft: Math.floor(daysLeft),
      });
      socket.end();
    });
    socket.on('error', (error) =>
      resolvePromise({ ok: false, authorized: false, authError: error.message, daysLeft: 0 }),
    );
    socket.on('timeout', () => {
      resolvePromise({ ok: false, authorized: false, authError: 'hết thời gian chờ', daysLeft: 0 });
      socket.destroy();
    });
  });
}

export async function run({ env }, deps = {}) {
  const log = deps.log ?? ((m) => console.log(m));
  const getRecords =
    deps.getRecords ??
    (async () => {
      const session = await openSession(env);
      await init('platform', env, { env: session.procEnv });
      return (await output('platform', { env: session.procEnv })).dns_records ?? [];
    });
  const records = await getRecords();
  if (records.length === 0)
    throw new CliExit(
      `Chưa có bản ghi nào (stack chưa dựng?). Chạy: pnpm infra up ${env}`,
      EXIT.NOT_READY,
    );

  let dnsOk = true;
  for (const record of records) {
    const r = await (deps.checkRecord ?? checkRecord)(record);
    if (r.ok) log(`[đạt] ${record.type} ${record.name} → ${r.expected}`);
    else if (r.actual.length === 0) {
      dnsOk = false;
      log(`[thiếu] ${record.type} ${record.name} (cần ${r.expected || 'giá trị chưa biết'})`);
    } else {
      dnsOk = false;
      log(`[sai: đang là ${r.actual.join(', ')}, cần ${r.expected}] ${record.type} ${record.name}`);
    }
  }
  if (!dnsOk) {
    log(
      '\nDNS chưa đạt – tạo/sửa bản ghi theo infra/docs/03-dns-va-chung-chi.md rồi chạy lại (DNS có thể mất vài phút đến vài giờ).',
    );
    return EXIT.NOT_READY;
  }

  let tlsOk = true;
  for (const record of records) {
    const tls = await (deps.checkTls ?? checkTls)(record.name);
    if (tls.ok) log(`[đạt] TLS ${record.name} (còn ${tls.daysLeft} ngày)`);
    else {
      tlsOk = false;
      log(`[lỗi] TLS ${record.name}: ${tls.authError ?? `chỉ còn ${tls.daysLeft} ngày`}`);
    }
  }
  if (!tlsOk) {
    log(
      `\nChứng chỉ chưa cấp được: xem Certificate/Challenge – kubectl get certificate,challenge -A (KUBECONFIG=infra/.credentials/${env}.kubeconfig) và infra/docs/03-dns-va-chung-chi.md.`,
    );
    return EXIT.NOT_READY;
  }
  return EXIT.OK;
}
