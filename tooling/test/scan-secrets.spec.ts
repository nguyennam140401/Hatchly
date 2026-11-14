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

  it('không bắt tên cookie hay tiền tố đứng một mình', () => {
    expect(scan([join(dir, 'clean.ts')], '/')).toEqual([]);
  });
});
