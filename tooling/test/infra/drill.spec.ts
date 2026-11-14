import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertNoLeftover,
  buildDrillTfvars,
  computeDrillRecord,
  validateTargetTime,
} from '../../infra/lib/drill.mjs';
import { cidrsOverlap, parseTfvars } from '../../infra/lib/params-diff.mjs';

// T103 (007): bản ghi diễn tập, kiểm đầu vào, tệp tham số sinh ra.

const base = {
  sourceEnvironment: 'production',
  targetTime: '2026-12-01T02:00:00Z',
  startedAt: '2026-12-01T03:00:00Z',
  queryableAt: '2026-12-01T03:31:40Z',
  recoveredTo: '2026-12-01T01:58:12Z',
  markerFound: true,
  operator: 'tester',
};
const rec = (patch = {}) =>
  computeDrillRecord({ ...base, ...patch }) as {
    durationSeconds: number;
    dataLossSeconds: number;
    result: string;
  };

describe('computeDrillRecord', () => {
  it('tính số đo theo data-model.md mục 7', () => {
    const r = rec();
    expect(r.durationSeconds).toBe(1900);
    expect(r.dataLossSeconds).toBe(108);
    expect(r.result).toBe('pass');
  });

  it('biên thời gian: 3600 giây đạt, 3601 giây không', () => {
    expect(rec({ queryableAt: '2026-12-01T04:00:00Z' }).result).toBe('pass');
    expect(rec({ queryableAt: '2026-12-01T04:00:01Z' }).result).toBe('fail');
  });

  it('biên mất dữ liệu: 300 giây đạt, 301 giây không', () => {
    expect(rec({ recoveredTo: '2026-12-01T01:55:00Z' }).result).toBe('pass');
    expect(rec({ recoveredTo: '2026-12-01T01:54:59Z' }).result).toBe('fail');
  });

  it('thiếu dòng đánh dấu → không đạt; mất dữ liệu không âm', () => {
    expect(rec({ markerFound: false }).result).toBe('fail');
    expect(rec({ recoveredTo: '2026-12-01T02:10:00Z' }).dataLossSeconds).toBe(0);
  });
});

describe('kiểm đầu vào của drill start', () => {
  const now = new Date('2026-12-01T12:00:00Z');
  it('--target-time trong cửa sổ giữ sao lưu → hợp lệ; ngoài cửa sổ hoặc tương lai → từ chối', () => {
    expect(validateTargetTime('2026-12-01T02:00:00Z', { now, retentionDays: 30 })).toEqual([]);
    expect(validateTargetTime('2026-10-01T02:00:00Z', { now, retentionDays: 30 })[0]).toContain(
      'ngoài cửa sổ',
    );
    expect(validateTargetTime('2026-12-02T02:00:00Z', { now, retentionDays: 30 })[0]).toContain(
      'tương lai',
    );
    expect(validateTargetTime('không phải ngày', { now, retentionDays: 30 })).toHaveLength(1);
  });

  it('từ chối khi trạng thái drill/… còn tài nguyên', () => {
    expect(assertNoLeftover([])).toEqual([]);
    expect(assertNoLeftover(['a.b'])[0]).toContain('drill destroy');
  });
});

describe('drill.tfvars sinh ra', () => {
  const root = join(__dirname, '..', '..', '..', 'infra', 'envs');
  const production = parseTfvars(readFileSync(join(root, 'production.tfvars'), 'utf8'));
  const staging = parseTfvars(readFileSync(join(root, 'staging.tfvars'), 'utf8'));

  it('project_id = project của môi trường nguồn; CIDR không giao với staging/production', () => {
    const text = buildDrillTfvars(production, {
      otherCidrs: [String(production.network_cidr), String(staging.network_cidr)],
    });
    const parsed = parseTfvars(text);
    expect(parsed.project_id).toBe(production.project_id);
    expect(parsed.environment).toBe('drill');
    expect(parsed.environment_kind).toBe('restore_drill');
    expect(cidrsOverlap(String(parsed.network_cidr), String(production.network_cidr))).toBe(false);
    expect(cidrsOverlap(String(parsed.network_cidr), String(staging.network_cidr))).toBe(false);
    expect(parsed.postgres_major).toBe(production.postgres_major);
    expect(parsed.chart_versions).toEqual(production.chart_versions);
  });

  it('CIDR chọn trùng môi trường khác → lỗi', () => {
    expect(() =>
      buildDrillTfvars(production, { networkCidr: '10.10.0.0/16', otherCidrs: ['10.10.0.0/16'] }),
    ).toThrow(/giao với/);
  });
});
