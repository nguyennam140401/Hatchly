import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EXCEPTION_GROUPS,
  compareComponents,
  componentTypes,
} from '../../infra/lib/component-types.mjs';

// T076 (007, SC-004): hai môi trường cùng tập loại tài nguyên, trừ đúng nhóm mail-capture.

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'infra', name), 'utf8')) as {
    resource_changes: { address: string; type: string }[];
  };

describe('componentTypes / SC-004', () => {
  it('hai bản xem trước mẫu có cùng tập loại tài nguyên', () => {
    const diff = compareComponents(
      componentTypes(fixture('plan-staging.json')) as Set<string>,
      componentTypes(fixture('plan-production.json')) as Set<string>,
    );
    expect(diff).toEqual({ onlyA: [], onlyB: [] });
  });

  it('ngoại lệ là đúng một nhóm: mail-capture', () => {
    expect((EXCEPTION_GROUPS as readonly { name: string }[]).map((g) => g.name)).toEqual([
      'mail-capture',
    ]);
  });

  it('thêm một loại tài nguyên chỉ ở một môi trường → bị bắt', () => {
    const staging = fixture('plan-staging.json');
    staging.resource_changes.push({
      address: 'module.x.aws_s3_bucket_policy.extra',
      type: 'aws_s3_bucket_policy',
    });
    const diff = compareComponents(
      componentTypes(staging) as Set<string>,
      componentTypes(fixture('plan-production.json')) as Set<string>,
    );
    expect(diff.onlyA).toEqual(['aws_s3_bucket_policy']);
  });

  it('bỏ qua nguồn dữ liệu và tài nguyên của nhóm ngoại lệ', () => {
    const types = componentTypes(fixture('plan-staging.json')) as Set<string>;
    expect(types.has('kubernetes_deployment_v1')).toBe(false);
    expect(types.has('helm_release')).toBe(true);
  });
});
