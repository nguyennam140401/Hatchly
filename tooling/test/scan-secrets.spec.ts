import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanFiles } from '../scan-secrets.mjs';

// T082 (004, contracts/auth-ops.md mục 5): quét bí mật bắt cookie phiên và băm argon2id thật.

const dir = join(__dirname, 'fixtures', 'secrets');
interface Finding {
  file: string;
  line: number;
  name: string;
}
const scan = scanFiles as (files: string[], root?: string) => Finding[];

describe('tooling/scan-secrets.mjs', () => {
  it('bắt cookie phiên và băm argon2id trong nhật ký mẫu', () => {
    const found = scan([join(dir, 'leaky.log')], '/').map((f) => [f.line, f.name]);
    expect(found).toEqual([
      [1, 'cookie phiên khách hàng'],
      [2, 'băm mật khẩu argon2id'],
    ]);
  });

  it('005: chuỗi mồi (canary) chỉ bị bắt trong tệp nhật ký', () => {
    const found = scan([join(dir, 'leaky-canary.ndjson')], '/').map((f) => [f.line, f.name]);
    expect(found).toEqual([
      [1, 'mã quyền giả lọt nhật ký'],
      [2, 'lời nhắc AI lọt nhật ký'],
      [3, 'nội dung bài lọt nhật ký'],
    ]);
    // Mã kiểm thử chứa chuỗi mồi là bình thường (không phải nhật ký).
    expect(scan([join(dir, 'canary-in-source.ts')], '/')).toEqual([]);
  });

  it('007: bắt khóa S3 và chuỗi kết nối gán cứng trong infra/, bỏ qua tệp sạch', () => {
    const root = join(dir, '..', 'secrets-infra');
    const at = (f: string) => scan([join(root, 'infra', f)], root).map((x) => [x.line, x.name]);
    expect(at('bad.tfvars')).toEqual([[1, 'khóa truy cập/bí mật S3 gán cứng']]);
    expect(at('conn.tf')).toEqual([[1, 'chuỗi kết nối có mật khẩu']]);
    expect(at('clean.tfvars')).toEqual([]);
  });

  it('009: tham số đường quay về OAuth và signed_request chỉ bị bắt trong tệp nhật ký', () => {
    const found = scan([join(dir, 'leaky-oauth.ndjson')], '/').map((f) => [f.line, f.name]);
    expect(found).toEqual([
      // Dòng 1 có cả `state=xyz` nhưng quá ngắn để là giá trị thật – chỉ `code` bị bắt.
      [1, 'mã ủy quyền OAuth lọt nhật ký'],
      [2, 'state OAuth lọt nhật ký'],
      [3, 'signed_request của Meta lọt nhật ký'],
    ]);
    // Mã nguồn và kiểm thử dựng URL có `?code=` là bình thường (không phải nhật ký).
    expect(scan([join(dir, 'canary-in-source.ts')], '/')).toEqual([]);
  });

  it('không bắt tên cookie hay tiền tố đứng một mình', () => {
    expect(scan([join(dir, 'clean.ts')], '/')).toEqual([]);
  });
});

// 008 (T011): phạm vi mở rộng sang định nghĩa quy trình và nhật ký của một lần chạy.
// Giá trị giả được ghép lúc chạy để kho mã không chứa chuỗi giống bí mật thật.
describe('tooling/scan-secrets.mjs – phạm vi quy trình (008)', () => {
  const scanWith = scanFiles as (
    files: string[],
    root?: string,
    options?: { explicit?: boolean },
  ) => Finding[];
  const fakeAwsKey = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
  const fakeGithubToken = ['ghp', 'a1B2'.repeat(9)].join('_');
  const fakeTelegramToken = ['123456789', `AA${'x'.repeat(33)}`].join(':');

  function workspace(files: Record<string, string>) {
    const root = mkdtempSync(join(tmpdir(), 'scan-'));
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, name)), { recursive: true });
      writeFileSync(join(root, name), content);
    }
    return root;
  }

  it('quét Jenkinsfile*, ops/**, infra/ci/**, .github/** dù đuôi tệp lạ', () => {
    const root = workspace({
      'ops/ci/Jenkinsfile.deploy': `pipeline {\n  environment { KEY = '${fakeAwsKey}' }\n}\n`,
      'ops/ci/vm/bootstrap.sh': `#!/bin/sh\nexport GH=${fakeGithubToken}\n`,
      'infra/ci/main.tf': `variable "bot" { default = "${fakeTelegramToken}" }\n`,
      '.github/CODEOWNERS': `# ${fakeAwsKey}\n`,
      'docs/ghi-chu.unknown': `${fakeAwsKey}\n`,
    });
    const files = [
      'ops/ci/Jenkinsfile.deploy',
      'ops/ci/vm/bootstrap.sh',
      'infra/ci/main.tf',
      '.github/CODEOWNERS',
      'docs/ghi-chu.unknown',
    ].map((f) => join(root, f));
    const found = scanWith(files, root).map((f) => [f.file, f.line, f.name]);
    expect(found).toEqual([
      ['ops/ci/Jenkinsfile.deploy', 2, 'khóa truy cập AWS'],
      ['ops/ci/vm/bootstrap.sh', 2, 'mã truy cập GitHub'],
      ['infra/ci/main.tf', 1, 'mã bot Telegram'],
      ['.github/CODEOWNERS', 1, 'khóa truy cập AWS'],
    ]);
  });

  it('tệp nêu đích danh (nhật ký một lần chạy) được quét dù không có đuôi, kể cả chuỗi mồi', () => {
    const root = workspace({
      'run-57/console': `+ helm upgrade\ntoken=${fakeGithubToken}\nfake_tok_abcdef\n`,
    });
    const file = join(root, 'run-57', 'console');
    expect(scanWith([file], root)).toEqual([]);
    const found = scanWith([file], root, { explicit: true }).map((f) => [f.line, f.name]);
    expect(found).toEqual([
      [2, 'mã truy cập GitHub'],
      [3, 'mã quyền giả lọt nhật ký'],
    ]);
  });

  it('dòng lệnh nhận tệp đơn; báo tệp + dòng, không in giá trị', () => {
    const root = workspace({ 'deploy.log': `ok\nkey ${fakeAwsKey}\n` });
    const script = join(__dirname, '..', 'scan-secrets.mjs');
    const result = spawnSync(process.execPath, [script, join(root, 'deploy.log')], {
      encoding: 'utf8',
      cwd: root,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('deploy.log:2 – khóa truy cập AWS');
    expect(result.stderr).not.toContain(fakeAwsKey);
    expect(result.stdout).not.toContain(fakeAwsKey);
  });
});
