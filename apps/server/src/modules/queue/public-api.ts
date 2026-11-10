/**
 * Kiểu công khai của module Hàng chờ (`queue`, WBS 1.3) – contracts/queue-api.md.
 *
 * Module khác chỉ dùng module này qua `index.ts` và chỉ khi có `queue` trong `allowedDeps`. KHÔNG kiểu
 * nào của pg-boss xuất hiện ở đây (FR-002) – thư viện nằm sau `internal/pgboss/`.
 */
import type { z } from 'zod';

/** 6 hàng chờ nghiệp vụ (FR-004). */
export const QUEUE_NAMES = [
  'publish',
  'media',
  'ai_batch',
  'trends',
  'notify',
  'scheduled',
] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

export type JobScope = 'tenant' | 'system';

/** Loại việc đã khai báo bằng `defineJobType` (dùng ở cả API và Worker). */
export interface JobTypeDefinition<P = unknown> {
  /** `<module>.<action>`, duy nhất toàn ứng dụng. */
  readonly name: string;
  readonly queue: QueueName;
  readonly scope: JobScope;
  readonly payload: z.ZodType<P>;
  /** Phiên bản khuôn dữ liệu hiện hành (`v` của phong bì). */
  readonly version: number;
  readonly migrate: ((payload: unknown, fromVersion: number) => unknown) | undefined;
  /** ≤ 8 192 byte cho cả phong bì. */
  readonly maxPayloadBytes: number;
  /** `false` cho loại việc `publish` (Clarifications Q1) – hỗ trợ không chạy lại chung được. */
  readonly allowGenericRetry: boolean;
  readonly retry: { maxRetries?: number; delaysSeconds?: number[] } | undefined;
  /** Chỉ để suy kiểu – không có giá trị lúc chạy. */
  readonly __payload?: P;
}

export interface EnqueueOptions {
  /** Giờ chạy sớm nhất (so với giờ CSDL). */
  runAfter?: Date;
  /** Khóa chống trùng, vd `publish:${attemptId}`; mặc định `${type}:${jobId}`; ≤ 200 ký tự. */
  dedupeKey?: string;
}

export type PendingState = 'pending' | 'retry_wait' | 'running';

export type EnqueueResult =
  { status: 'created'; jobId: string } | { status: 'exists'; jobId: string; state: PendingState };

export type JobRef = { jobId: string } | { queue: QueueName; dedupeKey: string };

export type ChangeResult =
  | { status: 'cancelled' | 'rescheduled'; jobId: string }
  | {
      status: 'not_pending';
      jobId: string;
      state: 'running' | 'completed' | 'cancelled' | 'failed';
    }
  | { status: 'not_found' };

/** Ngữ cảnh truyền cho bộ xử lý (FR-014). */
export interface JobContext {
  jobId: string;
  type: string;
  queue: QueueName;
  /** 1 = lượt đầu. */
  attempt: number;
  maxRetries: number;
  accountId: string | null;
  traceId: string;
  /** Bị hủy khi sắp hết khóa, mất khóa, tắt quá hạn (R5). Bộ xử lý PHẢI tôn trọng. */
  signal: AbortSignal;
}

/** Kết quả "thử lại sau N giây" (vd nền tảng báo giới hạn tần suất). */
export interface RetryAfter {
  readonly kind: 'retry_after';
  readonly seconds: number;
}

/** Kết quả nghiệp vụ "không thử lại" (vd hết ngân sách AI) – không vào việc hỏng. */
export interface NoRetry {
  readonly kind: 'no_retry';
  readonly reason: string;
}

// eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- bộ xử lý "không trả gì" = hoàn tất
export type JobHandlerResult = void | RetryAfter | NoRetry;

export type JobHandler<P> = (payload: P, ctx: JobContext) => Promise<JobHandlerResult>;

export type DeadJobCause =
  'RETRIES_EXHAUSTED' | 'PERMANENT_ERROR' | 'NO_HANDLER' | 'PAYLOAD_INVALID' | 'EXPIRED';

export interface FinalFailureInfo {
  deadJobId: string;
  cause: DeadJobCause;
  attempts: number;
  lastErrorCode?: string;
}

export interface JobHandlerOptions<P> {
  /** Gọi một lần khi việc vào việc hỏng, trong ngữ cảnh của việc, giao dịch riêng (FR-016). */
  onFinalFailure?: (payload: P, info: FinalFailureInfo) => Promise<void>;
}

export type DeadJobRetryStatus = 'none' | 'requested' | 'retried' | 'rejected_already_active';

export interface DeadJobFilter {
  queue?: QueueName;
  jobType?: string;
  accountId?: string;
  failedFrom?: Date;
  failedTo?: Date;
  retryStatus?: DeadJobRetryStatus;
  /** ≤ 100. */
  limit?: number;
  /** Phân trang theo id (id cuối của trang trước). */
  after?: string;
}

/** Dòng tra cứu – KHÔNG có dữ liệu việc hay lỗi (khung nhìn tìm kiếm). */
export interface DeadJobSummary {
  id: string;
  accountId: string | null;
  queue: QueueName;
  jobType: string;
  cause: DeadJobCause;
  attempts: number;
  failedAt: Date;
  retryStatus: DeadJobRetryStatus;
  retriedAt: Date | null;
}

export interface DeadJobDetail extends DeadJobSummary {
  originalJobId: string;
  payloadVersion: number;
  /** Chỉ mã tham chiếu (đã kiểm khi tạo – FR-012). Không có với việc hệ thống xem qua tra cứu. */
  payload: Record<string, unknown> | null;
  dedupeKey: string | null;
  lastError: { name: string; code?: string; message: string } | null;
  jobCreatedAt: Date | null;
  traceId: string | null;
  genericRetryAllowed: boolean | null;
  retryRequestedBy: string | null;
  retryRequestedAt: Date | null;
  newJobId: string | null;
}

export type DeadJobRetryRequestResult =
  'requested' | 'rejected_not_allowed' | 'rejected_already_active' | 'not_found';

/** Việc định kỳ đã khai báo bằng `defineSchedule`. */
export interface ScheduleDefinition {
  readonly name: string;
  readonly cron: string;
  readonly tz: 'Asia/Ho_Chi_Minh' | 'UTC';
  readonly jobType: JobTypeDefinition<Record<string, never>>;
}

export interface PartitionedLogDefinition {
  table: string;
  ensureFunction: string;
  monthsAhead: number;
  retentionMonths?: number;
  dropFunction?: string;
}
