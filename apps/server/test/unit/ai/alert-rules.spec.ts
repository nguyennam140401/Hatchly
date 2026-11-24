// 015 T050/T069 (hiến pháp VIII, SC-013): ops/alerts/ai_gateway.rules.yml có đủ 10 quy tắc đúng ngưỡng/mức độ, chỉ dùng
// chỉ số đã định nghĩa trong modules/ai_gateway/internal/metrics.ts, nhãn `event` nằm trong tập GatewayEventName của
// events.ts, KHÔNG có nhãn nhận diện tài khoản hay số tiền (hiến pháp III/VII), nhóm critical tới kênh nhận ≤ 15 phút.
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

const file = resolve(process.cwd(), '..', '..', 'ops', 'alerts', 'ai_gateway.rules.yml');
const doc = parse(readFileSync(file, 'utf8')) as { groups: { name: string; rules: Rule[] }[] };
const rules = doc.groups.find((g) => g.name === 'ai_gateway')?.rules ?? [];
const byName = (name: string) => rules.find((r) => r.alert === name)!;

const METRICS = new Set([
  'ai_gateway_provider_calls_total',
  'ai_gateway_events_total',
  'ai_gateway_open_reservations',
  'ai_gateway_estimate_ratio_sum',
  'ai_gateway_estimate_ratio_count',
]);

/** Kỳ vọng từng quy tắc: mức độ, `for`, cửa sổ tăng/đo (phút), chỉ số chính và (nếu có) nhãn event. */
const EXPECTED: Record<
  string,
  { severity: 'critical' | 'warning'; for: string; window: string; event?: string; metric: string }
> = {
  AiProviderErrorRatioHigh: {
    severity: 'critical',
    for: '5m',
    window: '15m',
    metric: 'ai_gateway_provider_calls_total',
  },
  AiSystemBudgetExhausted: {
    severity: 'warning',
    for: '5m',
    window: '15m',
    event: 'ai.system_budget_exhausted',
    metric: 'ai_gateway_events_total',
  },
  AiOpenReservationsStuck: {
    severity: 'warning',
    for: '5m',
    window: '30m',
    metric: 'ai_gateway_open_reservations',
  },
  AiCostAboveEstimate: {
    severity: 'warning',
    for: '30m',
    window: '1h',
    metric: 'ai_gateway_estimate_ratio_sum',
  },
  AiThresholdRatioHigh: {
    severity: 'warning',
    for: '0m',
    window: '10m',
    event: 'ai.threshold_ratio_high',
    metric: 'ai_gateway_events_total',
  },
  AiInvoiceMismatch: {
    severity: 'warning',
    for: '0m',
    window: '24h',
    event: 'ai.invoice_mismatch',
    metric: 'ai_gateway_events_total',
  },
  AiSettleFailed: {
    severity: 'critical',
    for: '0m',
    window: '10m',
    event: 'ai.settle_failed',
    metric: 'ai_gateway_events_total',
  },
  AiPriceMissing: {
    severity: 'critical',
    for: '0m',
    window: '10m',
    event: 'ai.price_missing',
    metric: 'ai_gateway_events_total',
  },
  AiRouteMissing: {
    severity: 'critical',
    for: '0m',
    window: '10m',
    event: 'ai.route_missing',
    metric: 'ai_gateway_events_total',
  },
  AiIndustrySourceMissing: {
    severity: 'warning',
    for: '5m',
    window: '1h',
    event: 'ai.industry_source_missing',
    metric: 'ai_gateway_events_total',
  },
};

const toMinutes = (s: string): number => {
  const m = /^(\d+)(m|h|d)$/.exec(s);
  if (m === null) throw new Error(`khoảng thời gian không hợp lệ: ${s}`);
  const n = Number(m[1]);
  return m[2] === 'm' ? n : m[2] === 'h' ? n * 60 : n * 1440;
};

/** Đọc các tên sự kiện trong `GatewayEventName` từ mã nguồn (không nhập module để khỏi kéo phụ thuộc nhật ký). */
function gatewayEventNames(): Set<string> {
  const src = readFileSync(
    resolve(process.cwd(), 'src', 'modules', 'ai_gateway', 'internal', 'events.ts'),
    'utf8',
  );
  const block = /export type GatewayEventName =([\s\S]*?);/.exec(src)?.[1] ?? '';
  return new Set([...block.matchAll(/'(ai\.[a-z_]+)'/g)].map((m) => m[1]!));
}

describe('ops/alerts/ai_gateway.rules.yml', () => {
  it('có đúng 10 cảnh báo theo thứ tự đã chốt', () => {
    expect(rules.map((r) => r.alert)).toEqual(Object.keys(EXPECTED));
    expect(rules).toHaveLength(10);
  });

  it('tên cảnh báo không trùng nhau', () => {
    const names = rules.map((r) => r.alert);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const [name, exp] of Object.entries(EXPECTED)) {
    it(`${name}: mức ${exp.severity}, for ${exp.for}, cửa sổ ${exp.window}, chỉ số ${exp.metric}`, () => {
      const rule = byName(name);
      expect(rule).toBeDefined();
      expect(rule.labels.severity).toBe(exp.severity);
      expect(rule.for).toBe(exp.for);
      expect(rule.expr).toContain(exp.metric);
      expect(rule.expr).toContain(`[${exp.window}]`);
      if (exp.event !== undefined) expect(rule.expr).toContain(`event="${exp.event}"`);
    });
  }

  it('AiProviderErrorRatioHigh: tỷ lệ lỗi > 5% trong 15 phút, tính theo nhà cung cấp, mẫu số kẹp tối thiểu 1', () => {
    const expr = byName('AiProviderErrorRatioHigh').expr;
    expect(expr).toMatch(/outcome="error"\}\[15m\][\s\S]*\[15m\]\)\), 1\) > 0\.05/);
    expect(expr.match(/sum by \(provider\)/g)).toHaveLength(2);
    expect(expr).toMatch(/clamp_min\(/);
  });

  it('AiCostAboveEstimate: tỷ số tổng/đếm của histogram theo task, ngưỡng > 1, mẫu số kẹp tối thiểu 1', () => {
    const expr = byName('AiCostAboveEstimate').expr;
    expect(expr).toMatch(/sum by \(task\) \(increase\(ai_gateway_estimate_ratio_sum\[1h\]\)\)/);
    expect(expr).toMatch(/ai_gateway_estimate_ratio_count\[1h\]/);
    expect(expr).toMatch(/clamp_min\(/);
    expect(expr).toMatch(/> 1\s*$/);
  });

  it('AiOpenReservationsStuck: min_over_time 30m của gauge, ngưỡng > 50', () => {
    expect(byName('AiOpenReservationsStuck').expr).toMatch(
      /min_over_time\(ai_gateway_open_reservations\[30m\]\) > 50/,
    );
  });

  it('cảnh báo theo sự kiện: sum(increase(...)) > 0', () => {
    for (const [name, exp] of Object.entries(EXPECTED)) {
      if (exp.event === undefined) continue;
      expect(byName(name).expr, name).toMatch(
        /^sum\(increase\(ai_gateway_events_total\{event="ai\.[a-z_]+"\}\[\d+[mh]\]\)\) > 0$/,
      );
    }
  });

  it('chỉ tham chiếu chỉ số đã định nghĩa; không nhãn tài khoản; không số tiền; mô tả tiếng Việt', () => {
    for (const rule of rules) {
      const referenced = rule.expr.match(/\bai_gateway_[a-z0-9_]+\b/g) ?? [];
      expect(referenced.length, rule.alert).toBeGreaterThan(0);
      for (const metric of referenced)
        expect(METRICS, `${rule.alert}: ${metric}`).toContain(metric);
      expect(rule.expr, rule.alert).not.toMatch(/account_id|tenant|micro|cost|usd/i);
      expect(JSON.stringify(rule.labels), rule.alert).not.toMatch(/account_id|micro|usd/i);
      expect(rule.annotations.description.length, rule.alert).toBeGreaterThan(20);
      expect(rule.annotations.summary.length, rule.alert).toBeGreaterThan(10);
      expect(rule.for, rule.alert).toMatch(/^\d+[mh]$/);
      // Sự kiện rời rạc: điều kiện chỉ đúng trong cửa sổ W sau sự kiện, nên `for` PHẢI nhỏ hơn W (nếu không kẹt pending).
      if (rule.expr.startsWith('sum(increase(ai_gateway_events_total{event=')) {
        const w = toMinutes(/\[(\d+[mh])\]/.exec(rule.expr)![1]!);
        expect(toMinutes(rule.for), `${rule.alert}: for < cửa sổ`).toBeLessThan(w);
      }
      expect(['critical', 'warning'], rule.alert).toContain(rule.labels.severity);
      // tiếng Việt: có ít nhất một ký tự có dấu trong tóm tắt và mô tả
      expect(rule.annotations.summary, rule.alert).toMatch(/[À-ỹ]/);
      expect(rule.annotations.description, rule.alert).toMatch(/[À-ỹ]/);
      expect(rule.annotations.summary, rule.alert).not.toMatch(
        /account_id|micro_usd|\$\s?\d|\bUSD\b\s*\d/i,
      );
      expect(rule.annotations.description, rule.alert).not.toMatch(/account_id|micro_usd/i);
    }
  });

  it('chỉ số trong mã khớp tên trong quy tắc (không lệch tên)', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src', 'modules', 'ai_gateway', 'internal', 'metrics.ts'),
      'utf8',
    );
    // histogram `ai_gateway_estimate_ratio` sinh ra hậu tố _sum/_count ở Prometheus
    const sourceNames: Record<string, string> = {
      ai_gateway_provider_calls_total: 'ai_gateway_provider_calls_total',
      ai_gateway_events_total: 'ai_gateway_events_total',
      ai_gateway_open_reservations: 'ai_gateway_open_reservations',
      ai_gateway_estimate_ratio_sum: 'ai_gateway_estimate_ratio',
      ai_gateway_estimate_ratio_count: 'ai_gateway_estimate_ratio',
    };
    for (const m of METRICS) expect(src, m).toContain(`'${sourceNames[m]}'`);
  });

  it('giá trị nhãn event nằm trong tập GatewayEventName của events.ts', () => {
    const known = gatewayEventNames();
    expect(known.size).toBeGreaterThan(5);
    const used = rules.flatMap((r) => [...r.expr.matchAll(/event="([^"]+)"/g)].map((m) => m[1]!));
    expect(used.length).toBeGreaterThan(0);
    for (const e of used) expect(known, e).toContain(e);
  });

  it('SC-013: nhóm critical có for + cửa sổ ≤ 15 phút (tới kênh nhận ≤ 15 phút)', () => {
    const critical = rules.filter((r) => r.labels.severity === 'critical');
    expect(critical.map((r) => r.alert).sort()).toEqual(
      ['AiPriceMissing', 'AiProviderErrorRatioHigh', 'AiRouteMissing', 'AiSettleFailed'].sort(),
    );
    for (const rule of critical) {
      const windows = [...rule.expr.matchAll(/\[(\d+[mh])\]/g)].map((m) => toMinutes(m[1]!));
      expect(windows.length, rule.alert).toBeGreaterThan(0);
      const w = Math.max(...windows);
      expect(toMinutes(rule.for), rule.alert).toBeLessThanOrEqual(15);
      expect(w, rule.alert).toBeLessThanOrEqual(15);
      if (rule.alert === 'AiProviderErrorRatioHigh') {
        // Quy tắc theo tỷ lệ (không rời rạc): firing sau `for` kể từ khi tỷ lệ vượt ngưỡng.
        expect(toMinutes(rule.for), rule.alert).toBe(5);
      } else {
        // Sự kiện rời rạc: for + cửa sổ + 1 phút chu kỳ đánh giá ≤ 15 phút; for < cửa sổ.
        expect(toMinutes(rule.for) + w + 1, rule.alert).toBeLessThanOrEqual(15);
        expect(toMinutes(rule.for), rule.alert).toBeLessThan(w);
      }
    }
  });
});
