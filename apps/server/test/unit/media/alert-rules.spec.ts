// 014 T086: ops/alerts/media.rules.yml có đủ 3 cảnh báo đúng ngưỡng, chỉ tham chiếu chỉ số đã định nghĩa trong
// modules/media/internal/metrics.ts và không có nhãn nhận diện tài khoản/media.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Rule {
  alert: string;
  expr: string;
  for: string;
  labels: { severity: string };
  annotations: { summary: string; description: string };
}

const file = resolve(process.cwd(), '..', '..', 'ops', 'alerts', 'media.rules.yml');
const doc = parse(readFileSync(file, 'utf8')) as { groups: { name: string; rules: Rule[] }[] };
const rules = doc.groups.find((g) => g.name === 'media')?.rules ?? [];
const byName = (name: string): Rule => rules.find((r) => r.alert === name)!;

const METRICS = new Set([
  'media_quota_drift_total',
  'media_processed_total',
  'media_process_duration_seconds_bucket',
]);

describe('ops/alerts/media.rules.yml', () => {
  it('có đủ cảnh báo: lệch bộ đếm, tỷ lệ "không xử lý được", xử lý video chậm', () => {
    expect(rules.map((r) => r.alert).sort()).toEqual([
      'MediaQuotaDriftDetected',
      'MediaUnprocessableRatioHigh',
      'MediaVideoProcessSlow',
    ]);
  });

  it('ngưỡng: lệch > 0 trong 24 giờ; không xử lý được > 5%/giờ; p95 video > 120 giây', () => {
    expect(byName('MediaQuotaDriftDetected').expr).toMatch(/\[24h\]\) > 0$/);
    expect(byName('MediaUnprocessableRatioHigh').expr).toMatch(
      /\[1h\][\s\S]*\[1h\]\)\), 1\) > 0\.05/,
    );
    expect(byName('MediaVideoProcessSlow').expr).toMatch(/histogram_quantile\(0\.95[\s\S]*> 120$/);
    expect(byName('MediaVideoProcessSlow').expr).toContain('kind="video"');
  });

  it('chỉ tham chiếu chỉ số đã định nghĩa; không nhãn nhận diện tài khoản/media', () => {
    for (const rule of rules) {
      const referenced = rule.expr.match(/\bmedia_[a-z0-9_]+\b/g) ?? [];
      expect(referenced.length, rule.alert).toBeGreaterThan(0);
      for (const metric of referenced) expect(METRICS, `${rule.alert}: ${metric}`).toContain(metric);
      expect(rule.expr).not.toMatch(/account_id|media_id|file_name/);
      expect(rule.annotations.description.length).toBeGreaterThan(20);
      expect(['warning', 'critical']).toContain(rule.labels.severity);
    }
  });

  it('chỉ số trong mã khớp tên trong quy tắc', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src', 'modules', 'media', 'internal', 'metrics.ts'),
      'utf8',
    );
    for (const name of ['media_quota_drift_total', 'media_processed_total', 'media_process_duration_seconds']) {
      expect(src, name).toContain(`'${name}'`);
    }
  });
});
