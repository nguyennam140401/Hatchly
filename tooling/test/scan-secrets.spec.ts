import { join } from 'node:path';
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

  it('không bắt tên cookie hay tiền tố đứng một mình', () => {
    expect(scan([join(dir, 'clean.ts')], '/')).toEqual([]);
  });
});
