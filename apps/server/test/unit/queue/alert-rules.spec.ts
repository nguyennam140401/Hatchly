// 003 T064 – US6 AS2, FR-032: ops/alerts/queue.rules.yml có đúng 10 quy tắc, đúng ngưỡng, chỉ tham chiếu
// chỉ số của contracts/queue-observability.md mục 1.
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

const file = resolve(process.cwd(), '..', '..', 'ops', 'alerts', 'queue.rules.yml');
const doc = parse(readFileSync(file, 'utf8')) as { groups: { name: string; rules: Rule[] }[] };
const rules = doc.groups.find((g) => g.name === 'queue')?.rules ?? [];
const byName = new Map(rules.map((r) => [r.alert, r]));

/** Chỉ số hợp lệ (tên OTel → Prometheus) – contracts/queue-observability.md mục 1. */
const METRICS = new Set([
  'queue_jobs_waiting',
  'queue_jobs_oldest_wait_seconds',
  'queue_job_duration_bucket',
  'queue_job_duration_sum',
  'queue_job_duration_count',
  'queue_jobs_finished_total',
  'queue_dead_jobs_created_total',
  'queue_dead_jobs_last_24h',
  'queue_workers_live',
  'queue_settings_invalid_total',
]);

describe('ops/alerts/queue.rules.yml', () => {
  it('có đúng 10 quy tắc tên theo hợp đồng', () => {
    expect(rules.map((r) => r.alert).sort()).toEqual(
      [
        'QueuePublishOldestWaitHigh',
        'QueueMediaOldestWaitHigh',
        'QueueNotifyOldestWaitHigh',
        'QueuePublishDeadJob',
        'QueueDeadJobsHigh',
        'QueueErrorRateHigh',
        'QueueBacklogGrowing',
        'QueueMediaVideoP95High',
        'QueueWorkersLow',
        'QueueSettingsInvalid',
      ].sort(),
    );
  });

  it.each([
    ['QueuePublishOldestWaitHigh', /queue="publish"\}\)\s*>\s*300\b/, '1m'],
    ['QueueMediaOldestWaitHigh', /queue="media"\}\)\s*>\s*600\b/, '1m'],
    ['QueueNotifyOldestWaitHigh', /queue="notify"\}\)\s*>\s*300\b/, '1m'],
    [
      'QueuePublishDeadJob',
      /increase\(queue_dead_jobs_created_total\{queue="publish"\}\[5m\]\)\s*>\s*0\b/,
      '0m',
    ],
    ['QueueDeadJobsHigh', /queue!="publish"\}\)\s*>\s*10\b/, '5m'],
    ['QueueErrorRateHigh', /outcome!="completed"\}\[15m\][\s\S]*\[15m\]\)\)\s*>\s*0\.05\b/, '15m'],
    [
      'QueueBacklogGrowing',
      /deriv\([\s\S]*\[30m:1m\]\)\s*>\s*0[\s\S]*queue_jobs_waiting\)\s*>\s*0/,
      '30m',
    ],
    [
      'QueueMediaVideoP95High',
      /histogram_quantile\(0\.95,[\s\S]*queue="media"[\s\S]*\)\s*>\s*480\b/,
      '15m',
    ],
    ['QueueWorkersLow', /max\(queue_workers_live\)\s*<\s*2\b/, '2m'],
    ['QueueSettingsInvalid', /increase\(queue_settings_invalid_total\[10m\]\)\s*>\s*0\b/, '0m'],
  ])('%s: ngưỡng và thời gian đúng', (name, pattern, duration) => {
    const rule = byName.get(name)!;
    expect(rule.expr).toMatch(pattern);
    expect(rule.for).toBe(duration);
    expect(rule.labels.severity).toMatch(/^(critical|warning)$/);
    expect(rule.annotations.description.length).toBeGreaterThan(20);
  });

  it('mọi biểu thức chỉ tham chiếu chỉ số đã định nghĩa; không nhãn account_id', () => {
    for (const rule of rules) {
      const referenced = rule.expr.match(/\bqueue_[a-z0-9_]+\b/g) ?? [];
      expect(referenced.length, rule.alert).toBeGreaterThan(0);
      for (const metric of referenced)
        expect(METRICS, `${rule.alert}: ${metric}`).toContain(metric);
      expect(rule.expr).not.toContain('account_id');
    }
  });
});
