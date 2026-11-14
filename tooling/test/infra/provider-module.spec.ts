import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// T027 (007): các bất biến của lớp nhà cung cấp mà `terraform test` không kiểm được –
// FR-031 (chỉ module provider-vngcloud dùng `vngcloud_*` / `aws_s3_*`), đầu ra không `sensitive` (R8),
// đầu vào không nhận định danh tài nguyên của môi trường khác (bất biến 10).

const infra = join(__dirname, '..', '..', '..', 'infra');
const moduleDir = join(infra, 'modules', 'provider-vngcloud');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '.terraform') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Bỏ dòng chú thích `#` để câu giải thích nhắc tên tài nguyên không bị tính là dùng. */
const withoutComments = (text: string) =>
  text
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('#'))
    .join(' ');

const tfFiles = walk(infra).filter((f) => f.endsWith('.tf'));
const rel = (f: string) => relative(infra, f).replaceAll('\\', '/');

describe('FR-031 – ranh giới lớp nhà cung cấp', () => {
  it('tài nguyên/nguồn dữ liệu vngcloud_* và aws_s3_* chỉ nằm trong modules/provider-vngcloud', () => {
    const offenders = tfFiles
      .filter((f) => !f.startsWith(moduleDir))
      .filter((f) => /\b(?:resource|data)\s+"(?:vngcloud_|aws_s3_)/.test(readFileSync(f, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('module provider-vngcloud thực sự dùng cả hai loại tài nguyên (không rỗng vô nghĩa)', () => {
    const text = tfFiles
      .filter((f) => f.startsWith(moduleDir))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    expect(text).toMatch(/resource\s+"vngcloud_vks_cluster"/);
    expect(text).toMatch(/resource\s+"aws_s3_bucket"/);
  });
});

describe('đầu ra không bí mật (R8)', () => {
  it('không `output` nào có sensitive = true ở bất kỳ tệp .tf nào', () => {
    const offenders = tfFiles
      .filter((f) => /\boutput\s+"/.test(readFileSync(f, 'utf8')))
      .filter((f) =>
        /\bsensitive\s*=\s*true/.test(
          readFileSync(f, 'utf8')
            .split(/\boutput\s+"/)
            .slice(1)
            .join('output "'),
        ),
      )
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('kubeconfig không phải đầu ra của module', () => {
    const outputs = readFileSync(join(moduleDir, 'outputs.tf'), 'utf8');
    expect(outputs).not.toMatch(/output\s+"kubeconfig"/);
    expect(outputs).not.toMatch(/value\s*=\s*vngcloud_vks_cluster\.this\.config\s*$/m);
  });
});

describe('đầu vào của module (bất biến 10)', () => {
  const variablesTf = readFileSync(join(moduleDir, 'variables.tf'), 'utf8');
  const names = [...variablesTf.matchAll(/^variable\s+"([^"]+)"/gm)].map((m) => m[1] ?? '');

  // contracts/provider-layer.md mục 2, cộng các biến 007 thêm (ghi trong hợp đồng, mục 2a).
  const EXPECTED = [
    'environment',
    'environment_kind',
    'name_prefix',
    'project_id',
    'region',
    'allowed_regions',
    'network_cidr',
    'subnet_cidr',
    'admin_cidrs',
    'kubernetes_version',
    'node_groups',
    'powered',
    'web_origins',
    'media_retention',
    'backup_bucket_enabled',
    'db_variant',
    'managed_db',
    'deletion_protection',
    'kms_key_id',
    'labels',
    'pod_cidr',
    'node_ssh_public_key',
    'lb_package_id',
    'object_storage_endpoint',
    'object_storage_path_style',
    'storage_class',
    'storage_class_encrypted',
    'drill_egress_cidrs',
    'source_backup_bucket',
  ];

  it('đúng tập đầu vào đã duyệt (thêm biến mới phải sửa hợp đồng và danh sách này)', () => {
    expect([...names].sort()).toEqual([...EXPECTED].sort());
  });

  it('không có biến chứng thực (client_id, client_secret, khóa truy cập)', () => {
    expect(names.filter((n) => /secret|password|access_key|client_id|token/.test(n))).toEqual([]);
  });

  it('duy nhất `source_backup_bucket` nhận tên bucket của môi trường khác, chỉ cho restore_drill', () => {
    expect(names.filter((n) => n.includes('bucket') && n !== 'backup_bucket_enabled')).toEqual([
      'source_backup_bucket',
    ]);
    const out = readFileSync(join(moduleDir, 'outputs.tf'), 'utf8');
    expect(out).toMatch(/local\.is_drill \? var\.source_backup_bucket/);
  });
});

describe('stack platform và module nền tảng (T028, R8, FR-031)', () => {
  const platformFiles = tfFiles.filter((f) =>
    /^(?:stacks\/platform|modules\/platform-base|modules\/database-cnpg)\//.test(rel(f)),
  );

  it('có tệp để kiểm', () => {
    expect(platformFiles.length).toBeGreaterThan(10);
  });

  it('Terraform không tạo hay giữ giá trị bí mật: không kubernetes_secret*, random_password', () => {
    const offenders = platformFiles
      .filter((f) =>
        /\b(?:resource|data)\s+"(?:kubernetes_secret|random_password|random_string)/.test(
          readFileSync(f, 'utf8'),
        ),
      )
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('không dùng provider vngcloud/aws và không tài nguyên của chúng', () => {
    const offenders = platformFiles
      .filter((f) =>
        /\b(?:vngcloud|aws)_|provider\s+"(?:vngcloud|aws)"|vngcloud\/vngcloud|hashicorp\/aws/.test(
          withoutComments(readFileSync(f, 'utf8')),
        ),
      )
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
