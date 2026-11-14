// Phần THUẦN của diễn tập khôi phục (T103, T108; data-model.md mục 7, contracts/infra-cli.md mục 8).
import { cidrsOverlap } from './params-diff.mjs';

export const MAX_DURATION_SECONDS = 3600;
export const MAX_DATA_LOSS_SECONDS = 300;
export const DEFAULT_DRILL_CIDR = '10.30.0.0/16';

const seconds = (a, b) => Math.round((new Date(a).getTime() - new Date(b).getTime()) / 1000);

/**
 * Bản ghi diễn tập. `result = "pass"` ⇔ durationSeconds ≤ 3600 và dataLossSeconds ≤ 300 và markerFound.
 * @param {{ sourceEnvironment: string, targetTime: string, startedAt: string, queryableAt: string, recoveredTo: string, markerFound: boolean, operator: string, destroyedAt?: string|null }} input
 */
export function computeDrillRecord(input) {
  const durationSeconds = seconds(input.queryableAt, input.startedAt);
  const dataLossSeconds = Math.max(0, seconds(input.targetTime, input.recoveredTo));
  const pass =
    durationSeconds <= MAX_DURATION_SECONDS &&
    dataLossSeconds <= MAX_DATA_LOSS_SECONDS &&
    input.markerFound === true;
  return {
    sourceEnvironment: input.sourceEnvironment,
    targetTime: input.targetTime,
    startedAt: input.startedAt,
    queryableAt: input.queryableAt,
    durationSeconds,
    recoveredTo: input.recoveredTo,
    dataLossSeconds,
    markerFound: input.markerFound === true,
    result: pass ? 'pass' : 'fail',
    operator: input.operator,
    destroyedAt: input.destroyedAt ?? null,
  };
}

/** `--target-time` phải nằm trong cửa sổ giữ sao lưu của môi trường nguồn và không ở tương lai. Trả danh sách lỗi. */
export function validateTargetTime(targetTime, { now = new Date(), retentionDays }) {
  const t = new Date(targetTime);
  if (Number.isNaN(t.getTime())) return ['--target-time không phải thời điểm ISO hợp lệ.'];
  const problems = [];
  if (t.getTime() > now.getTime()) problems.push('--target-time ở tương lai.');
  const oldest = now.getTime() - retentionDays * 86_400_000;
  if (t.getTime() < oldest) {
    problems.push(
      `--target-time ngoài cửa sổ giữ sao lưu của môi trường nguồn (${retentionDays} ngày).`,
    );
  }
  return problems;
}

/** Từ chối `drill start` khi trạng thái `drill/…` còn tài nguyên. */
export function assertNoLeftover(stateAddresses) {
  if (stateAddresses.length > 0) {
    return [
      `Môi trường tạm cũ còn ${stateAddresses.length} tài nguyên – chạy pnpm infra drill destroy trước.`,
    ];
  }
  return [];
}

function toHcl(value, indent = 0) {
  const pad = '  '.repeat(indent);
  if (Array.isArray(value)) return `[${value.map((v) => toHcl(v, indent)).join(', ')}]`;
  if (value !== null && typeof value === 'object') {
    const lines = Object.entries(value).map(([k, v]) => `${pad}  ${k} = ${toHcl(v, indent + 1)}`);
    return `{\n${lines.join('\n')}\n${pad}}`;
  }
  return JSON.stringify(value);
}

/** Các khóa lấy NGUYÊN từ tham số môi trường nguồn (để cùng phiên bản và cấu hình). */
export const COPIED_FROM_SOURCE = [
  'name_prefix',
  'region',
  'kubernetes_version',
  'node_ssh_public_key',
  'lb_package_id',
  'object_storage_endpoint',
  'object_storage_path_style',
  'storage_class',
  'storage_class_encrypted',
  'db_variant',
  'postgres_major',
  'db_max_connections',
  'db_archive_timeout',
  'media_retention',
  'media_cdn_enabled',
  'chart_versions',
  'image_versions',
  'acme_email',
  'monitoring_reserved',
  'registry',
  'admin_cidrs',
  'kms_key_id',
  'base_domain',
  'cdn_cname_target',
];

/**
 * Sinh nội dung `infra/envs/drill.tfvars`. `project_id` = project của môi trường nguồn (diễn tập dùng project nguồn).
 * @param {Record<string, unknown>} source tham số của môi trường nguồn (đã phân tích)
 * @param {{ networkCidr?: string, otherCidrs?: string[] }} options
 */
export function buildDrillTfvars(
  source,
  { networkCidr = DEFAULT_DRILL_CIDR, otherCidrs = [] } = {},
) {
  for (const other of otherCidrs) {
    if (cidrsOverlap(networkCidr, other)) throw new Error(`CIDR ${networkCidr} giao với ${other}`);
  }
  const base = networkCidr.replace(/\.0\.0\/16$/, '');
  const lines = [
    '# Sinh bởi `pnpm infra drill start` – KHÔNG commit (infra/envs/drill.tfvars bị gitignore).',
    'environment      = "drill"',
    'environment_kind = "restore_drill"',
    `project_id       = ${JSON.stringify(source.project_id)}`,
    `network_cidr     = ${JSON.stringify(networkCidr)}`,
    `subnet_cidr      = ${JSON.stringify(`${base}.1.0/24`)}`,
    'node_groups = {',
    '  default = { flavor = ' +
      JSON.stringify(Object.values(source.node_groups ?? {})[0]?.flavor ?? 'TODO') +
      ', count = 1, vcpu = 4, disk_gb = 50 }',
    '}',
    'db_instances             = 1',
    'db_storage_gb            = ' + String(source.db_storage_gb ?? 10),
    `db_resources             = ${toHcl(source.db_resources ?? { cpu: '500m', memory: '1Gi' })}`,
    'db_backup_retention_days = 3',
    'deletion_protection      = false',
    'mail_capture_enabled     = false',
    'search_indexing          = false',
    'powered                  = true',
  ];
  for (const key of COPIED_FROM_SOURCE) {
    if (key in source) lines.push(`${key} = ${toHcl(source[key])}`);
  }
  return `${lines.join('\n')}\n`;
}
