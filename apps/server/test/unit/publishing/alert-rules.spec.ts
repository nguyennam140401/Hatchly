// 013 T052/T080: ops/alerts/publishing.rules.yml có đủ 5 cảnh báo đúng ngưỡng, chỉ tham chiếu chỉ số đã định nghĩa
// (modules/publishing/internal/metrics.ts) và không có nhãn nhận diện tài khoản/bài/lượt đăng.
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

const file = resolve(process.cwd(), '..', '..', 'ops', 'alerts', 'publishing.rules.yml');
const doc = parse(readFileSync(file, 'utf8')) as { groups: { name: string; rules: Rule[] }[] };
const rules = doc.groups.find((g) => g.name === 'publishing')?.rules ?? [];
const byName = (name: string) => rules.find((r) => r.alert === name)!;

const METRICS = new Set([
  'publish_attempt_transitions_total',
  'publish_overdue_attempts',
  'publish_needs_check_total',
  'publish_duplicate_guard_total',
  'publish_reconcile_total',
]);

describe('ops/alerts/publishing.rules.yml', () => {
  it('có đủ các cảnh báo của Hiến pháp VIII và điều kiện xem lại ADR-04', () => {
    expect(rules.map((r) => r.alert).sort()).toEqual([
      'PublishChannelErrorRatioHigh',
      'PublishDuplicateGuardSpike',
      'PublishNeedsCheckRatioHigh',
      'PublishOverdueAttempts',
      'PublishReconcileUnsupportedHigh',
    ]);
  });

  it('ngưỡng: lỗi kênh > 5%/15 phút; quá hạn > 5 phút; Cần kiểm tra > 1%/ngày; không đối soát > 20%', () => {
    expect(byName('PublishChannelErrorRatioHigh').expr).toMatch(
      /\[15m\][\s\S]*\[15m\]\)\), 1\) > 0\.05/,
    );
    expect(byName('PublishChannelErrorRatioHigh').labels.severity).toBe('critical');
    expect(byName('PublishOverdueAttempts').expr).toMatch(/publish_overdue_attempts\) > 0/);
    expect(byName('PublishOverdueAttempts').for).toBe('5m');
    expect(byName('PublishNeedsCheckRatioHigh').expr).toMatch(
      /\[1d\][\s\S]*\[1d\]\)\), 1\) > 0\.01/,
    );
    expect(byName('PublishReconcileUnsupportedHigh').expr).toMatch(/> 0\.2/);
  });

  it('chỉ tham chiếu chỉ số đã định nghĩa; không nhãn nhận diện tài khoản/bài/lượt đăng', () => {
    for (const rule of rules) {
      const referenced = rule.expr.match(/\bpublish_[a-z0-9_]+\b/g) ?? [];
      expect(referenced.length, rule.alert).toBeGreaterThan(0);
      for (const metric of referenced)
        expect(METRICS, `${rule.alert}: ${metric}`).toContain(metric);
      expect(rule.expr).not.toMatch(/account_id|post_id|attempt_id/);
      expect(rule.annotations.description.length).toBeGreaterThan(20);
    }
  });

  it('chỉ số trong mã khớp tên trong quy tắc (không lệch tên)', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src', 'modules', 'publishing', 'internal', 'metrics.ts'),
      'utf8',
    );
    for (const m of METRICS) expect(src, m).toContain(`'${m}'`);
  });
});
