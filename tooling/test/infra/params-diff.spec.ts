import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_TO_DIFFER,
  NOT_APPLICABLE_DEFAULTS,
  checkParams,
  cidrsOverlap,
  diffKeys,
  parseTfvars,
} from '../../infra/lib/params-diff.mjs';

// T022 (007): so hai tệp tham số – khóa được phép khác / phải giống, CIDR không trùng, khóa "không áp dụng".

const root = join(__dirname, '..', '..', '..');
const read = (file: string) => readFileSync(join(root, 'infra', file), 'utf8');

const staging = parseTfvars(read('envs/staging.tfvars'));
const omit = (obj: Record<string, unknown>, key: string) =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));
const production = parseTfvars(read('envs/production.tfvars'));

describe('parseTfvars', () => {
  it('đọc chuỗi, số, bool, danh sách, đối tượng, chú thích', () => {
    const parsed = parseTfvars(`
      # chú thích
      a = "x" // cuối dòng
      b = 3
      c = true
      d = null
      e = ["p", "q"]
      f = { k = 1, "quoted" = "v" }
      g = {
        nested = { z = [1, 2] }
      }
      /* khối */
    `);
    expect(parsed).toEqual({
      a: 'x',
      b: 3,
      c: true,
      d: null,
      e: ['p', 'q'],
      f: { k: 1, quoted: 'v' },
      g: { nested: { z: [1, 2] } },
    });
  });

  it('từ chối nội suy ${…} và giá trị lạ', () => {
    expect(() => parseTfvars('a = "${var.x}"')).toThrow(/nội suy/);
    expect(() => parseTfvars('a = var.x')).toThrow(/không phải chuỗi/);
  });
});

describe('checkParams', () => {
  it('hai tệp mẫu hợp lệ → không có vấn đề', () => {
    expect(checkParams(staging, production)).toEqual([]);
  });

  it('đổi postgres_major một bên → lỗi nêu tên khóa', () => {
    const problems = checkParams(staging, { ...production, postgres_major: 16 });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('postgres_major');
  });

  it('khóa chỉ có ở một tệp (ngoài danh sách "không áp dụng") → lỗi', () => {
    const problems = checkParams(staging, omit(production, 'db_variant'));
    expect(problems.join('\n')).toContain('db_variant');
  });

  it('network_cidr trùng/giao nhau → lỗi', () => {
    expect(
      checkParams(staging, { ...production, network_cidr: staging.network_cidr }).join('\n'),
    ).toContain('network_cidr');
    expect(
      checkParams(staging, { ...production, network_cidr: '10.20.128.0/17' }).join('\n'),
    ).toContain('giao nhau');
    expect(cidrsOverlap('10.10.0.0/16', '10.20.0.0/16')).toBe(false);
  });

  it('khóa "không áp dụng" vắng ở production.tfvars → so với mặc định, không tính là lệch', () => {
    for (const key of Object.keys(NOT_APPLICABLE_DEFAULTS)) {
      expect(checkParams(staging, omit(production, key)), key).toEqual([]);
    }
  });

  it('khóa "không áp dụng" khác mặc định thì vẫn là lệch', () => {
    const problems = checkParams({ ...staging, staging_max_vcpu: 16 }, production);
    expect(problems.join('\n')).toContain('staging_max_vcpu');
  });

  it('mọi khóa ALLOWED_TO_DIFFER khác nhau cũng được', () => {
    const changed = { ...production, environment: 'x', project_id: 'y' };
    expect(checkParams(staging, changed)).toEqual([]);
    expect(diffKeys(staging, production)).toContain('node_groups');
    expect(ALLOWED_TO_DIFFER.has('node_groups')).toBe(true);
  });
});

describe('NOT_APPLICABLE_DEFAULTS khớp mặc định trong variables.shared.tf', () => {
  const variables = read('stacks/cloud/variables.shared.tf');
  for (const [key, expected] of Object.entries(NOT_APPLICABLE_DEFAULTS)) {
    it(key, () => {
      const block = new RegExp(`variable "${key}" \\{[\\s\\S]*?\\n\\}`).exec(variables);
      expect(block, `không thấy biến ${key}`).not.toBeNull();
      const def = /default\s*=\s*(\S+)/.exec(block?.[0] ?? '');
      expect(def?.[1]).toBe(String(expected));
    });
  }
});
