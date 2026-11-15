// 009 T086: ops/alerts/auth.rules.yml có đúng quy tắc, đúng ngưỡng, chỉ tham chiếu chỉ số đã định nghĩa
// (src/modules/account/internal/auth/auth-metrics.ts) và không có nhãn nhận diện người dùng.
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

const file = resolve(process.cwd(), '..', '..', 'ops', 'alerts', 'auth.rules.yml');
const doc = parse(readFileSync(file, 'utf8')) as { groups: { name: string; rules: Rule[] }[] };
const rules = doc.groups.find((g) => g.name === 'auth')?.rules ?? [];

/** Chỉ số hợp lệ (tên OTel → Prometheus) – contracts/module-api.md mục 6. */
const METRICS = new Set([
  'auth_oauth_total',
  'account_invitations_total',
  'account_detached_purged_total',
  'auth_oauth_callback_duration_seconds_bucket',
  'auth_oauth_callback_duration_seconds_sum',
  'auth_oauth_callback_duration_seconds_count',
  'account_mail_send_duration_seconds_bucket',
  'account_mail_send_duration_seconds_sum',
  'account_mail_send_duration_seconds_count',
  'account_mail_send_failed_total',
]);

describe('ops/alerts/auth.rules.yml', () => {
  it('có đúng quy tắc tỷ lệ lỗi nhà cung cấp', () => {
    expect(rules.map((r) => r.alert)).toEqual(['AuthOAuthProviderErrorRateHigh']);
  });

  it('AuthOAuthProviderErrorRateHigh: ngưỡng 20% trong 15 phút, theo nhà cung cấp', () => {
    const rule = rules[0]!;
    expect(rule.expr).toMatch(/outcome="provider_error"\}\[15m\][\s\S]*\[15m\]\)\)\s*>\s*0\.2\b/);
    expect(rule.expr).toMatch(/sum by \(provider\)[\s\S]*sum by \(provider\)/);
    expect(rule.for).toBe('5m');
    expect(rule.labels.severity).toMatch(/^(critical|warning)$/);
    expect(rule.annotations.description.length).toBeGreaterThan(20);
  });

  it('mọi biểu thức chỉ tham chiếu chỉ số đã định nghĩa; không nhãn nhận diện người dùng', () => {
    for (const rule of rules) {
      const referenced = rule.expr.match(/\b(?:auth|account)_[a-z0-9_]+\b/g) ?? [];
      expect(referenced.length, rule.alert).toBeGreaterThan(0);
      for (const metric of referenced)
        expect(METRICS, `${rule.alert}: ${metric}`).toContain(metric);
      expect(rule.expr).not.toMatch(/account_id|user_id|email/);
    }
  });
});
