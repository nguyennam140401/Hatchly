import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PROTECTED_RULES,
  dataTaggedAddresses,
  isProtected,
  protectionRemovals,
} from '../../infra/lib/protected-resources.mjs';

// T088 (007): mọi tài nguyên mang nhãn data="true" phải khớp một luật bảo vệ.

const plan = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'infra', name), 'utf8')) as {
    resource_changes: { address: string; type: string }[];
  };

describe('độ phủ danh sách tài nguyên được bảo vệ', () => {
  it('mọi tài nguyên có nhãn data = "true" đều khớp một luật', () => {
    const tagged = dataTaggedAddresses(plan('plan-data-tagged.json')) as {
      address: string;
      type: string;
    }[];
    expect(tagged.length).toBeGreaterThanOrEqual(3);
    const uncovered = tagged.filter((t) => !isProtected(t)).map((t) => t.address);
    expect(uncovered).toEqual([]);
  });

  it('tài nguyên có nhãn mà không có luật bị bắt (quên cập nhật danh sách)', () => {
    const extra = { address: 'module.x.aws_efs_file_system.data[0]', type: 'aws_efs_file_system' };
    expect(isProtected(extra)).toBe(false);
  });

  it('mọi luật khai loại tài nguyên hợp lệ', () => {
    for (const rule of PROTECTED_RULES as readonly { type: string }[])
      expect(rule.type).toMatch(/^[a-z0-9_]+$/);
  });

  it('nhận diện việc gỡ bảo vệ xóa (bucket force_destroy, Helm deletionProtect)', () => {
    expect(protectionRemovals(plan('plan-unprotect.json'))).toHaveLength(2);
    expect(protectionRemovals(plan('plan-update-only.json'))).toEqual([]);
  });
});
