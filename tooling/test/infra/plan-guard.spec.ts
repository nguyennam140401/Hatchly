import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { guardDataLoss, guardSavedPlan, guardStagingFirst } from '../../infra/lib/plan-guard.mjs';
import { protectedChanges } from '../../infra/lib/protected-resources.mjs';

// T086 (007, FR-026): ba lớp chặn lên phát hành, kiểm trên bản xem trước mẫu.

const plan = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'infra', name), 'utf8')) as {
    resource_changes: { address: string; type: string; change: { actions: string[] } }[];
  };
const changesOf = (name: string) =>
  protectedChanges(plan(name)) as { address: string; action: string }[];

describe('lớp (a) – đã chạy ở thử nghiệm', () => {
  const definitionHash = 'sha256:abcdef0123456789abcdef';
  it('không có bản ghi → chặn, nguyên văn thông điệp', () => {
    const r = guardStagingFirst({ env: 'production', definitionHash, stagingRecords: [] });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(3);
    expect(r.message).toBe(
      'Thay đổi này chưa áp dụng thành công ở thử nghiệm (dấu abcdef012345). Chạy `pnpm infra apply staging` trước.',
    );
  });
  it('chỉ có stack cloud → vẫn chặn; đủ hai stack → qua', () => {
    expect(
      guardStagingFirst({ env: 'production', definitionHash, stagingRecords: [{ stack: 'cloud' }] })
        .ok,
    ).toBe(false);
    expect(
      guardStagingFirst({
        env: 'production',
        definitionHash,
        stagingRecords: [{ stack: 'cloud' }, { stack: 'platform' }],
      }).ok,
    ).toBe(true);
  });
  it('staging: lớp (a) không áp dụng', () => {
    expect(guardStagingFirst({ env: 'staging', definitionHash, stagingRecords: [] }).ok).toBe(true);
  });
});

describe('lớp (b) – đúng bản đã lưu', () => {
  const meta = {
    definitionHash: 'sha256:a',
    paramsHash: 'sha256:p',
    expiresAt: '2026-11-15T00:00:00Z',
  };
  const base = {
    env: 'production',
    planExists: true,
    meta,
    currentDefinitionHash: 'sha256:a',
    currentParamsHash: 'sha256:p',
    now: new Date('2026-11-14T00:00:00Z'),
  };
  it('khớp và còn hạn → qua', () => {
    expect(guardSavedPlan(base).ok).toBe(true);
  });
  it('dấu mã hoặc tham số đổi → chặn nguyên văn', () => {
    for (const patch of [
      { currentDefinitionHash: 'sha256:b' },
      { currentParamsHash: 'sha256:q' },
    ]) {
      const r = guardSavedPlan({ ...base, ...patch });
      expect(r.message).toBe(
        'Mã hoặc tham số đã đổi sau khi xem trước. Chạy lại `pnpm infra plan production`.',
      );
    }
  });
  it('quá hạn 24 giờ hoặc thiếu tệp → chặn', () => {
    expect(guardSavedPlan({ ...base, now: new Date('2026-11-16T00:00:00Z') }).ok).toBe(false);
    expect(guardSavedPlan({ ...base, planExists: false }).ok).toBe(false);
    expect(guardSavedPlan({ ...base, meta: undefined }).ok).toBe(false);
  });
});

describe('lớp (c) – tài nguyên chứa dữ liệu', () => {
  const none = new Set<string>();
  const input = (file: string, patch = {}) => ({
    env: 'production',
    protectedChanges: changesOf(file),
    confirmDataLoss: false,
    typedConfirmation: false,
    protectionRemoved: none,
    ...patch,
  });

  it('chỉ sửa / không đổi → qua', () => {
    expect(changesOf('plan-noop.json')).toEqual([]);
    expect(changesOf('plan-update-only.json')).toEqual([]);
    expect(guardDataLoss(input('plan-update-only.json')).ok).toBe(true);
  });

  it.each([
    ['plan-replace-media-bucket.json', 'aws_s3_bucket.media'],
    ['plan-delete-pg-cluster.json', 'helm_release.pg_cluster'],
    ['plan-delete-database-namespace.json', 'database'],
  ])('%s → chặn kèm danh sách địa chỉ', (file, fragment) => {
    const r = guardDataLoss(input(file));
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Bản xem trước sẽ XÓA/THAY THẾ');
    expect(r.message).toContain(fragment);
  });

  it('có --confirm-data-loss nhưng chưa gỡ bảo vệ ở lần áp dụng trước → vẫn chặn', () => {
    const r = guardDataLoss(
      input('plan-replace-media-bucket.json', { confirmDataLoss: true, typedConfirmation: true }),
    );
    expect(r.ok).toBe(false);
    expect(r.details.join('\n')).toContain('chưa được gỡ ở một lần áp dụng trước');
  });

  it('đủ ba điều kiện → qua và dataLossConfirmed = true', () => {
    const address = changesOf('plan-replace-media-bucket.json')[0]?.address ?? '';
    const r = guardDataLoss(
      input('plan-replace-media-bucket.json', {
        confirmDataLoss: true,
        typedConfirmation: true,
        protectionRemoved: new Set([address]),
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.dataLossConfirmed).toBe(true);
  });

  it('đủ bản ghi + cờ nhưng chưa gõ lại production → chặn', () => {
    const address = changesOf('plan-replace-media-bucket.json')[0]?.address ?? '';
    const r = guardDataLoss(
      input('plan-replace-media-bucket.json', {
        confirmDataLoss: true,
        protectionRemoved: new Set([address]),
      }),
    );
    expect(r.ok).toBe(false);
  });

  it('thay nhóm máy (không chứa dữ liệu) → không chặn', () => {
    expect(changesOf('plan-replace-node-group.json')).toEqual([]);
  });

  it('staging: chỉ cảnh báo, không chặn', () => {
    const r = guardDataLoss(input('plan-replace-media-bucket.json', { env: 'staging' }));
    expect(r.ok).toBe(true);
    expect(r.warn).toBe(true);
  });
});
