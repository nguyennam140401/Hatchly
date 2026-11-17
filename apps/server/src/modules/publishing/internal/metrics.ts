// Chỉ số của Đăng bài (contracts/observability.md mục 1) qua OpenTelemetry API – no-op cho tới khi có SDK.
// Nhãn KHÔNG BAO GIỜ có `account_id`, `post_id`, `attempt_id` (tránh bùng kích thước); nhật ký kỹ thuật mới có.
import { metrics, type Counter, type Histogram } from '@opentelemetry/api';

export type DuplicateGuard = 'conditional_update_lost' | 'phase_resume' | 'unique_index';
export type ReconcileResultLabel = 'found' | 'not_found' | 'unsupported';

let instruments:
  | {
      transitions: Counter;
      lag: Histogram;
      stepDuration: Histogram;
      unknown: Counter;
      needsCheck: Counter;
      reconcile: Counter;
      duplicateGuard: Counter;
      notificationLatency: Histogram;
    }
  | undefined;

function get() {
  if (instruments === undefined) {
    const meter = metrics.getMeter('app.publishing');
    instruments = {
      transitions: meter.createCounter('publish_attempt_transitions_total', {
        description: 'Số lần chuyển trạng thái lượt đăng',
      }),
      lag: meter.createHistogram('publish_lag_seconds', {
        description: 'Độ lệch giữa giờ hẹn và lúc đăng xong (giây)',
        advice: { explicitBucketBoundaries: [5, 15, 30, 60, 120, 300, 600, 1800, 3600] },
      }),
      stepDuration: meter.createHistogram('publish_step_duration_seconds', {
        description: 'Thời gian chạy một bước đăng (giây)',
      }),
      unknown: meter.createCounter('publish_unknown_total', {
        description: 'Số lượt đăng vào trạng thái không xác định',
      }),
      needsCheck: meter.createCounter('publish_needs_check_total', {
        description: 'Số lượt đăng vào "Cần kiểm tra"',
      }),
      reconcile: meter.createCounter('publish_reconcile_total', {
        description: 'Số lần đối soát theo kết quả',
      }),
      duplicateGuard: meter.createCounter('publish_duplicate_guard_total', {
        description: 'Số lần chốt chặn chống đăng trùng được kích hoạt',
      }),
      notificationLatency: meter.createHistogram('publish_notification_latency_seconds', {
        description: 'Từ lúc cần xử lý đến lúc phát thông báo (giây)',
      }),
    };
  }
  return instruments;
}

export interface SweepStats {
  overdueScheduled: number;
  retryWait: number;
  unknown: number;
  needsCheck: number;
}

let lastSweep: SweepStats = { overdueScheduled: 0, retryWait: 0, unknown: 0, needsCheck: 0 };
let gaugesRegistered = false;

function registerGauges(): void {
  if (gaugesRegistered) return;
  gaugesRegistered = true;
  const meter = metrics.getMeter('app.publishing');
  const gauge = (name: string, description: string, pick: (s: SweepStats) => number) => {
    meter.createObservableGauge(name, { description }).addCallback((r) => {
      r.observe(pick(lastSweep));
    });
  };
  gauge(
    'publish_overdue_attempts',
    'Lượt scheduled quá giờ hẹn > 5 phút chưa được lấy',
    (s) => s.overdueScheduled,
  );
  gauge('publish_retry_wait_attempts', 'Lượt đang chờ thử lại', (s) => s.retryWait);
  gauge('publish_unknown_attempts', 'Lượt đang không xác định (chờ đối soát)', (s) => s.unknown);
  gauge('publish_needs_check_attempts', 'Lượt đang ở "Cần kiểm tra"', (s) => s.needsCheck);
}

export const publishMetrics = {
  recordSweep(stats: SweepStats): void {
    lastSweep = stats;
    registerGauges();
  },
  transition(channel: string, from: string, to: string): void {
    get().transitions.add(1, { channel, from, to });
    if (to === 'unknown') get().unknown.add(1, { channel });
    if (to === 'needs_check') get().needsCheck.add(1, { channel });
  },
  lag(channel: string, seconds: number): void {
    get().lag.record(Math.max(0, seconds), { channel });
  },
  stepDuration(step: string, seconds: number): void {
    get().stepDuration.record(seconds, { step });
  },
  reconcile(channel: string, result: ReconcileResultLabel): void {
    get().reconcile.add(1, { channel, result });
  },
  duplicateGuard(guard: DuplicateGuard): void {
    get().duplicateGuard.add(1, { guard });
  },
  notificationLatency(seconds: number): void {
    get().notificationLatency.record(Math.max(0, seconds));
  },
};
