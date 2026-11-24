// Chỉ số OpenTelemetry của Cổng AI (015 T043, contracts/jobs-and-alerts.md mục 3, hiến chương VIII) qua OpenTelemetry API –
// no-op cho tới khi có SDK. Nhãn là giá trị có số lượng nhỏ cố định (task, tier, outcome, reason, provider); `account_id` là
// nhãn phân tán cao DUY NHẤT và chỉ gắn khi bên gọi truyền vào. KHÔNG chỉ số nào mang số tiền: tiền theo tài khoản nhận dạng
// được không bao giờ ra chỉ số (hiến chương III/VII); `ai_gateway_estimate_ratio` là tỷ lệ token thực / ước tính (không tiền).
//
// Tên Prometheus (bộ đếm thêm `_total`):
//   ai_gateway_reserve_duration_ms             histogram: thời gian giữ chỗ (p95 ≤ 50 ms – SC-003)
//   ai_gateway_calls_total{task,tier,outcome}  ok | fallback | blocked | error mã lỗi
//   ai_gateway_fallback_total{task}            số lần phải dùng tuyến dự phòng
//   ai_gateway_blocked_total{reason}           số lần bị chặn (budget_exhausted | system_budget_exhausted | duplicate)
//   ai_gateway_estimate_ratio{task}            histogram: chi phí thực / ước tính, không thứ nguyên (hiệu chỉnh R-09)
//   ai_gateway_open_reservations               gauge: số giữ chỗ chưa đóng (phát hiện giữ chỗ treo)
//   ai_gateway_provider_calls_total{provider,outcome}  ok | error | aborted (cảnh báo tỷ lệ lỗi > 5%/15 phút chỉ tính error; aborted = bên gọi hủy)
//   ai_gateway_provider_latency_ms{provider}   histogram: thời gian một lời gọi nhà cung cấp
//   ai_gateway_events_total{event}             mỗi sự kiện ai.* phát ra (ai.invoice_mismatch, ai.settle_failed, ...)
import { metrics, type Counter, type Histogram } from '@opentelemetry/api';
import { GATEWAY_EVENT_NAMES } from './event-names';

interface Instruments {
  reserveDuration: Histogram;
  calls: Counter;
  fallback: Counter;
  blocked: Counter;
  estimateRatio: Histogram;
  providerCalls: Counter;
  providerLatency: Histogram;
  events: Counter;
}

let cached: Instruments | undefined;

const METER = 'app.ai_gateway';

/** Tạo muộn (lần ghi đầu) để chọn đúng MeterProvider đã đăng ký. */
function get(): Instruments {
  if (cached !== undefined) return cached;
  const meter = metrics.getMeter(METER);
  cached = {
    reserveDuration: meter.createHistogram('ai_gateway_reserve_duration_ms', {
      description: 'Thời gian giữ chỗ ngân sách AI (ms)',
      unit: 'ms',
    }),
    calls: meter.createCounter('ai_gateway_calls_total', {
      description: 'Số lời gọi Cổng AI theo loại việc, bậc mô hình và kết quả',
    }),
    fallback: meter.createCounter('ai_gateway_fallback_total', {
      description: 'Số lần chuyển sang tuyến dự phòng theo loại việc',
    }),
    blocked: meter.createCounter('ai_gateway_blocked_total', {
      description: 'Số lời gọi bị chặn trước khi gọi nhà cung cấp theo lý do',
    }),
    estimateRatio: meter.createHistogram('ai_gateway_estimate_ratio', {
      description: 'Tỷ lệ token thực / token ước tính theo loại việc',
    }),
    providerCalls: meter.createCounter('ai_gateway_provider_calls_total', {
      description: 'Số lời gọi nhà cung cấp AI theo kết quả',
    }),
    providerLatency: meter.createHistogram('ai_gateway_provider_latency_ms', {
      description: 'Thời gian một lời gọi nhà cung cấp AI (ms)',
      unit: 'ms',
    }),
    events: meter.createCounter('ai_gateway_events_total', {
      description: 'Số sự kiện vận hành ai.* của Cổng AI theo tên sự kiện (nền cho cảnh báo)',
    }),
  };
  seedZero(cached);
  return cached;
}

/** Lý do chặn cố định (xem recordBlocked ở gateway.service). */
const BLOCK_REASONS = ['budget_exhausted', 'system_budget_exhausted', 'duplicate'] as const;

/**
 * Khởi tạo mẫu 0 một lần cho các chuỗi nhãn nhỏ, cố định để `increase()` của Prometheus thấy bước tăng đầu tiên của sự kiện
 * hiếm. KHÔNG khởi tạo theo `account_id`/`task` (tập không cố định).
 */
function seedZero(i: Instruments): void {
  try {
    for (const event of GATEWAY_EVENT_NAMES) i.events.add(0, { event });
    for (const reason of BLOCK_REASONS) i.blocked.add(0, { reason });
  } catch {
    /* chỉ số không được làm hỏng luồng nghiệp vụ */
  }
}

/** Thuộc tính phân tán cao: chỉ `account_id`, chỉ khi có. */
function withAccount(
  attrs: Record<string, string>,
  accountId: string | null | undefined,
): Record<string, string> {
  return accountId === null || accountId === undefined
    ? attrs
    : { ...attrs, account_id: accountId };
}

/**
 * Histogram thời gian giữ chỗ: KHÔNG gắn `account_id` (mỗi tài khoản × mỗi bucket sẽ nhân chuỗi thời gian không giới hạn);
 * hợp đồng jobs-and-alerts mục 3 chỉ yêu cầu p95 toàn cục (SC-003). Truy vết theo tài khoản dùng nhật ký/trace.
 */
export function recordReserveDuration(ms: number): void {
  get().reserveDuration.record(ms);
}

export function recordCall(
  task: string,
  tier: string,
  outcome: string,
  accountId?: string | null,
): void {
  get().calls.add(1, withAccount({ task, tier, outcome }, accountId));
}

export function recordFallback(task: string): void {
  get().fallback.add(1, { task });
}

export function recordBlocked(reason: string): void {
  get().blocked.add(1, { reason });
}

/** Tỷ số thực / ước tính (không thứ nguyên, không phải số tiền); bỏ qua khi ước tính ≤ 0. */
export function recordEstimateRatio(task: string, actual: number, estimate: number): void {
  if (!(estimate > 0)) return;
  get().estimateRatio.record(actual / estimate, { task });
}

/**
 * Đếm sự kiện vận hành `ai.*` (cùng nơi phát với nhật ký cấu trúc). Nhãn CHỈ `event` (tập giá trị cố định) – không mã tài
 * khoản, không số tiền, không trường tự do. Không bao giờ làm hỏng đường gọi chính.
 */
export function recordGatewayEvent(event: string): void {
  try {
    get().events.add(1, { event });
  } catch {
    /* chỉ số không được làm hỏng luồng nghiệp vụ */
  }
}

/** Bộ chuyển đổi nhà cung cấp (T046/T047) gọi sau MỖI lời gọi: kết quả + độ trễ. */
export function recordProviderCall(
  provider: string,
  outcome: 'ok' | 'error' | 'aborted',
  ms: number,
): void {
  const i = get();
  i.providerCalls.add(1, { provider, outcome });
  i.providerLatency.record(ms, { provider });
}

/**
 * Gauge số giữ chỗ chưa đóng. `read` trả số đếm tổng hợp (không mã tài khoản) – nối ở Worker (bể `system`). Lỗi đọc ⇒ bỏ
 * qua lần lấy mẫu đó. Trả hàm hủy đăng ký.
 */
export function registerOpenReservationsGauge(read: () => Promise<number>): () => void {
  const meter = metrics.getMeter(METER);
  const gauge = meter.createObservableGauge('ai_gateway_open_reservations', {
    description: 'Số giữ chỗ ngân sách AI chưa đóng (held/calling)',
  });
  const callback = async (
    result: Parameters<Parameters<typeof gauge.addCallback>[0]>[0],
  ): Promise<void> => {
    try {
      result.observe(await read());
    } catch {
      /* bỏ qua lần lấy mẫu */
    }
  };
  gauge.addCallback(callback);
  return () => {
    gauge.removeCallback(callback);
  };
}
