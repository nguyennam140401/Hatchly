import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// T112 (007, SC-013, FR-031): tài nguyên/nguồn dữ liệu của nhà cung cấp chỉ nằm trong module provider-vngcloud;
// module giả dùng cho kiểm thử hợp đồng không phụ thuộc nhà cung cấp nào.

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

const hcl = walk(infra).filter((f) => f.endsWith('.tf') || f.endsWith('.tftest.hcl'));
const rel = (f: string) => relative(infra, f).replaceAll('\\', '/');

describe('cô lập nhà cung cấp', () => {
  it('không thấy `resource|data "vngcloud_…"` hay `"aws_s3_…"` ngoài infra/modules/provider-vngcloud/', () => {
    const offenders = hcl
      .filter((f) => !f.startsWith(moduleDir) && !f.endsWith('.tftest.hcl'))
      .filter((f) => /\b(?:resource|data)\s+"(?:vngcloud_|aws_s3_)/.test(readFileSync(f, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('module giả của kiểm thử chỉ dùng terraform_data', () => {
    const stub = hcl.filter((f) => rel(f).includes('provider-stub'));
    expect(stub.length).toBeGreaterThan(0);
    for (const f of stub) {
      const types = [...readFileSync(f, 'utf8').matchAll(/^\s*resource\s+"([^"]+)"/gm)].map(
        (m) => m[1],
      );
      expect(
        types.every((t) => t === 'terraform_data'),
        rel(f),
      ).toBe(true);
    }
  });

  it('stack platform và kê khai tạm không nhắc tên nhà cung cấp trong mã (chỉ chuẩn mở)', () => {
    const files = hcl.filter((f) => rel(f).startsWith('stacks/platform/') && f.endsWith('.tf'));
    for (const f of files) {
      const code = readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .filter((l) => !l.trim().startsWith('#'))
        .join(' ');
      expect(code, rel(f)).not.toMatch(/vngcloud|aws_/);
    }
  });
});
