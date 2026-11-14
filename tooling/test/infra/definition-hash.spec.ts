import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { definitionHash, hashFiles } from '../../infra/lib/definition-hash.mjs';

// T085 (007): dấu định nghĩa ổn định, nhạy đúng chỗ.

const realInfra = join(__dirname, '..', '..', '..', 'infra');

/** Bản sao tối thiểu của cây infra/ để đổi thử mà không đụng mã thật. */
function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), 'infra-hash-'));
  for (const sub of ['modules', 'stacks', 'envs', 'docs', 'smoke-deploy']) {
    cpSync(join(realInfra, sub), join(dir, sub), {
      recursive: true,
      // Bỏ `.terraform` (nhị phân provider, rất nặng) – không tham gia dấu định nghĩa.
      filter: (src) =>
        !src.includes('.terraform' + (src.endsWith('.terraform') ? '' : '/')) ||
        src.endsWith('.terraform.lock.hcl'),
    });
  }
  return dir;
}

const touch = (dir: string, file: string, suffix = '\n# thay đổi\n') => {
  const path = join(dir, file);
  writeFileSync(path, readFileSync(path, 'utf8') + suffix);
};

describe('definitionHash', () => {
  it('ổn định giữa hai lần tính', () => {
    const dir = sandbox();
    expect(definitionHash(dir)).toBe(definitionHash(dir));
    expect(definitionHash(dir)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('không phụ thuộc kiểu xuống dòng CRLF/LF (Windows và Linux cho cùng giá trị)', () => {
    const lf = sandbox();
    const crlf = sandbox();
    const file = join(crlf, 'stacks', 'cloud', 'main.tf');
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replaceAll('\r\n', '\n').replaceAll('\n', '\r\n'),
    );
    expect(definitionHash(crlf)).toBe(definitionHash(lf));
  });

  it('đổi một byte trong modules/, stacks/ hoặc khóa provider → băm đổi', () => {
    for (const file of [
      'modules/provider-vngcloud/buckets.tf',
      'stacks/platform/main.tf',
      'stacks/cloud/.terraform.lock.hcl',
    ]) {
      const dir = sandbox();
      const before = definitionHash(dir);
      touch(dir, file);
      expect(definitionHash(dir), file).not.toBe(before);
    }
  });

  it('đổi tệp tham số, tài liệu, kê khai tạm, kiểm thử → băm KHÔNG đổi', () => {
    const dir = sandbox();
    const before = definitionHash(dir);
    touch(dir, 'envs/staging.tfvars');
    touch(dir, 'docs/00-tong-quan.md');
    touch(dir, 'smoke-deploy/base/api.yaml', '\n# ghi chú\n');
    touch(dir, 'stacks/cloud/tests/parameters.tftest.hcl');
    expect(definitionHash(dir)).toBe(before);
  });

  it('thứ tự tệp không ảnh hưởng: cùng danh sách đảo thứ tự cho cùng… khác nội dung thì khác', () => {
    const a = join(realInfra, 'README.md');
    const b = join(realInfra, '.terraform-version');
    expect(hashFiles([a, b], realInfra)).not.toBe(hashFiles([b, a], realInfra));
  });
});
