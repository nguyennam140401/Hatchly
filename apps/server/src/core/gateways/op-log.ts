import { Logger } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { getExecutionContext } from '../context/request-context';
import { currentAccountId } from '../db/transaction';

// Nhật ký thao tác của 4 hợp đồng cổng (005, FR-007, R16): mỗi thao tác một dòng có cấu trúc
// `{ msg: '<component>.<op>', trace_id, account_id | scope:'system', outcome, duration_ms, ... }` + một
// span OpenTelemetry cùng tên (WBS 1.6 nối exporter). KHÔNG BAO GIỜ ghi mã quyền, lời nhắc, văn bản AI,
// nội dung bài, số tiền: thuộc tính chỉ nhận khóa trong danh sách an toàn, khóa lạ bị bỏ.

export type GatewayComponent = 'platform_gateway' | 'ai_gateway' | 'notifications' | 'storage';

/** Khóa thuộc tính được ghi (giá trị phải là chuỗi ngắn / số / boolean). */
export const SAFE_ATTR_KEYS = new Set([
  'connection_id',
  'channel_type',
  'task',
  'model_tier',
  'model_id',
  'input_tokens',
  'output_tokens',
  'cached_input_tokens',
  'kind',
  'category',
  'raw_code',
  'reason',
  'storage_kind',
  'reservation_state',
  'attempt',
  'fallback',
  'count',
  'job_id',
  'event_type',
  'recipients',
]);

export type GatewayLogLevel = 'info' | 'warn' | 'error';
export type GatewayLogEntry = Record<string, unknown> & { msg: string; level: GatewayLogLevel };

export interface GatewayLogSink {
  write(entry: GatewayLogEntry): void;
}

const nestLogger = new Logger('Gateways');
const NEST_SINK: GatewayLogSink = {
  write: ({ level, ...rest }) => {
    if (level === 'warn') nestLogger.warn(rest);
    else if (level === 'error') nestLogger.error(rest);
    else nestLogger.log(rest);
  },
};

let sink: GatewayLogSink = NEST_SINK;

/** Đổi nơi ghi (kiểm thử ghi ra `test-logs/*.ndjson` để quét bí mật – SC-009). `undefined` → mặc định. */
export function setGatewayLogSink(next: GatewayLogSink | undefined): void {
  sink = next ?? NEST_SINK;
}

function safeAttrs(attrs: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (attrs === undefined) return out;
  for (const [key, value] of Object.entries(attrs)) {
    if (!SAFE_ATTR_KEYS.has(key)) continue;
    if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'string') out[key] = value.slice(0, 120);
  }
  return out;
}

function contextFields(): Record<string, unknown> {
  const accountId = currentAccountId();
  return {
    trace_id: getExecutionContext()?.traceId ?? null,
    ...(accountId === null ? { scope: 'system' } : { account_id: accountId }),
  };
}

/** Ghi một sự kiện cảnh báo/thông tin của cổng (vd `platform.unexpected_result`, `ai.cost_anomaly`). */
export function gatewayEvent(
  level: GatewayLogLevel,
  msg: string,
  attrs?: Record<string, unknown>,
): void {
  sink.write({ msg, level, ...contextFields(), ...safeAttrs(attrs) });
}

/** Kết quả hợp đóng → `outcome` (giá trị `kind`), còn lại `ok`. */
function outcomeOf(value: unknown): string {
  if (value !== null && typeof value === 'object' && 'kind' in value) {
    const kind = value.kind;
    if (typeof kind === 'string') return kind;
  }
  return 'ok';
}

const tracer = trace.getTracer('app.gateways');

/**
 * Chạy một thao tác cổng trong span `<component>.<op>` và ghi đúng một dòng nhật ký khi xong. `attrs`
 * được đọc khi kết thúc – thao tác có thể bổ sung thuộc tính an toàn trong lúc chạy.
 * Lỗi ném ra → `outcome: 'error'` + `error_name` (không thông điệp – có thể chứa dữ liệu), ném tiếp.
 */
export async function withGatewayOp<T>(
  component: GatewayComponent,
  op: string,
  attrs: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const name = `${component}.${op}`;
  const started = performance.now();
  return tracer.startActiveSpan(name, async (span) => {
    try {
      const result = await fn();
      const outcome = outcomeOf(result);
      // Thuộc tính đọc lúc kết thúc: thao tác được bổ sung (vd hạng mô hình, số token) khi chạy.
      const safe = safeAttrs(attrs);
      for (const [k, v] of Object.entries(safe))
        span.setAttribute(k, v as string | number | boolean);
      span.setAttribute('outcome', outcome);
      sink.write({
        msg: name,
        level: 'info',
        ...contextFields(),
        outcome,
        duration_ms: Math.round(performance.now() - started),
        ...safe,
      });
      return result;
    } catch (err) {
      const safe = safeAttrs(attrs);
      span.setStatus({ code: SpanStatusCode.ERROR });
      sink.write({
        msg: name,
        level: 'warn',
        ...contextFields(),
        outcome: 'error',
        error_name: err instanceof Error ? err.name : 'Error',
        ...(typeof (err as { code?: unknown }).code === 'string'
          ? { error_code: (err as { code: string }).code.slice(0, 64) }
          : {}),
        duration_ms: Math.round(performance.now() - started),
        ...safe,
      });
      throw err;
    } finally {
      span.end();
    }
  });
}
