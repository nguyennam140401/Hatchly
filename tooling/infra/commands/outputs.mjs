// `pnpm infra outputs <env> [--json]` – đầu ra bàn giao cho H2/H3 (T056, contracts/handoff-outputs.md mục 1).
// Chạy được bằng chứng thực chỉ đọc. Từ chối in nếu thấy giá trị khớp mẫu bí mật của `scan-secrets`.
import { CliExit, EXIT } from '../lib/exit-codes.mjs';
import { openSession } from '../lib/session.mjs';
import { init, output } from '../lib/terraform.mjs';
import { SECRET_PATTERNS } from '../../scan-secrets.mjs';

/** Gộp đầu ra hai stack thành một tài liệu theo khóa của hợp đồng bàn giao. */
export function mergeOutputs(cloud, platform) {
  return {
    ...platform,
    ingress: {
      ...(cloud.ingress ? { public_ip: cloud.ingress.public_ip } : {}),
      ...platform.ingress,
    },
    kms: platform.kms ?? cloud.kms,
    dns_records: platform.dns_records ?? cloud.dns_records ?? [],
  };
}

/** Ném `CliExit` nếu tài liệu chứa giá trị giống bí mật. */
export function assertNoSecrets(doc) {
  const text = JSON.stringify(doc);
  const hit = SECRET_PATTERNS.find(
    (p) => p.logsOnly !== true && p.onlyIn === undefined && p.re.test(text),
  );
  if (hit !== undefined) {
    throw new CliExit(
      `Từ chối in: đầu ra chứa giá trị giống bí mật (${hit.name}). Báo lại để sửa mã Terraform.`,
      EXIT.BLOCKED,
    );
  }
}

export function formatTable(doc) {
  const lines = [`Môi trường: ${doc.environment}`, ''];
  const row = (k, v) => lines.push(`  ${k.padEnd(34)} ${v ?? '(chưa có)'}`);
  row('cluster.name', doc.cluster?.name);
  row('cluster.endpoint', doc.cluster?.endpoint);
  row('urls.web', doc.urls?.web);
  row('urls.api', doc.urls?.api);
  row('urls.web_origin_host', doc.urls?.web_origin_host);
  row('ingress.public_ip', doc.ingress?.public_ip);
  row('ingress.class', doc.ingress?.class);
  row('ingress.cluster_issuer', doc.ingress?.cluster_issuer);
  row('database.host:port', doc.database ? `${doc.database.host}:${doc.database.port}` : undefined);
  row('storage.endpoint', doc.storage?.endpoint);
  row('storage.bucket', doc.storage?.bucket);
  row('kms.key_id', doc.kms?.key_id);
  row(
    'secrets.api / worker / migrate',
    doc.secrets ? `${doc.secrets.api} / ${doc.secrets.worker} / ${doc.secrets.migrate}` : undefined,
  );
  lines.push('', 'Bản ghi DNS cần tạo:');
  for (const r of doc.dns_records ?? [])
    lines.push(
      `  ${r.type.padEnd(6)} ${String(r.name).padEnd(40)} ${r.value ?? '(chưa có giá trị)'}`,
    );
  return lines.join('\n');
}

export async function run({ env, flags }, deps = {}) {
  const session = await (deps.openSession ?? openSession)(env);
  const getOutput = deps.output ?? output;
  for (const stack of ['cloud', 'platform'])
    await (deps.init ?? init)(stack, env, { env: session.procEnv });
  const cloud = await getOutput('cloud', { env: session.procEnv });
  const platform = await getOutput('platform', { env: session.procEnv });
  const doc = mergeOutputs(cloud, platform);
  assertNoSecrets(doc);
  console.log(flags.json === true ? JSON.stringify(doc, null, 2) : formatTable(doc));
  return EXIT.OK;
}
