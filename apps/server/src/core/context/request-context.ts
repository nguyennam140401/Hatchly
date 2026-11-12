import type { IncomingMessage, ServerResponse } from 'node:http';
import { uuidV7 } from '../ids/uuid-v7';
import type { Actor } from './actor.types';
import { executionStorage, type ExecutionSource } from './execution-storage';

/**
 * Ngữ cảnh thực thi: một yêu cầu API, một việc nền hoặc một tác vụ hệ thống (002, contracts/db-layer-api.md
 * mục 3).
 *
 * `accountId` CHỈ được đặt bởi `bindAccountToRequest` (từ phiên đăng nhập – WBS 2.1) hoặc
 * `runWithJobContext` (từ dữ liệu việc – WBS 1.3); không bao giờ từ param/body/path do người dùng gửi
 * lên (nguyên tắc I, FR-004).
 */
export interface ExecutionContext {
  readonly traceId: string;
  readonly accountId?: string;
  readonly source: ExecutionSource;
  /** Mã việc nền đang chạy (005) – chỉ có khi `source = 'job'`. */
  readonly jobId?: string;
  /** Người gọi đã xác thực (004) – đọc qua `currentActor()` của core/auth. */
  readonly actor?: Readonly<Actor>;
}

/** Bí danh tương thích với mã của 001. */
export type ApiRequestContext = ExecutionContext;

/** Ngữ cảnh thực thi hiện tại (không có khi chạy ngoài yêu cầu/việc). */
export function getExecutionContext(): ExecutionContext | undefined {
  return executionStorage.getStore();
}

/** Bí danh tương thích với mã của 001. */
export function getRequestContext(): ExecutionContext | undefined {
  return getExecutionContext();
}

export const TRACE_ID_HEADER = 'x-trace-id';

// Chấp nhận mã theo dõi do ingress gửi: UUID hoặc trace id W3C (32 ký tự hex).
const VALID_TRACE_ID =
  /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

const TRACE_ID_KEY = Symbol('traceId');
type WithTraceId = IncomingMessage & { [TRACE_ID_KEY]?: string };

/**
 * Lấy (hoặc sinh một lần) mã theo dõi của yêu cầu và gắn vào tiêu đề phản hồi.
 * Gọi được nhiều lần (logger, middleware, bộ lọc lỗi) – luôn trả cùng một mã.
 * WBS 1.6 thay bằng trace id của OpenTelemetry.
 */
export function resolveTraceId(req: IncomingMessage, res?: ServerResponse): string {
  const holder = req as WithTraceId;
  let traceId = holder[TRACE_ID_KEY];
  if (traceId === undefined) {
    const incoming = req.headers[TRACE_ID_HEADER];
    traceId = typeof incoming === 'string' && VALID_TRACE_ID.test(incoming) ? incoming : uuidV7();
    holder[TRACE_ID_KEY] = traceId;
  }
  if (res && !res.headersSent && !res.hasHeader(TRACE_ID_HEADER)) {
    res.setHeader(TRACE_ID_HEADER, traceId);
  }
  return traceId;
}

/** Middleware (Express) đặt ngữ cảnh yêu cầu vào AsyncLocalStorage. */
export function requestContextMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): void {
  const traceId = resolveTraceId(req, res);
  executionStorage.run({ traceId, source: 'request' }, next);
}
