# Hợp đồng: giao diện công khai của module `queue`

Nhập duy nhất từ `apps/server/src/modules/queue/index.ts`. Module khác **không** thấy kiểu của pg-boss
(FR-002) – mọi kiểu dưới đây do module `queue` định nghĩa. Kiểm ranh giới: chỉ `modules/queue/internal/**`
được nhập `pg-boss` (quy tắc mới `pgboss-only-in-queue`, FR-001).

## 1. Khai báo loại việc (API + Worker)

```ts
export type QueueName = 'publish' | 'media' | 'ai_batch' | 'trends' | 'notify' | 'scheduled';

export function defineJobType<P extends z.ZodObject>(def: {
  name: string;                 // '<module>.<action>', duy nhất
  queue: QueueName;
  scope: 'tenant' | 'system';
  payload: P;                   // z.strictObject – tên trường bị cấm → ném khi khai báo (R13)
  version: number;              // ≥ 1
  migrate?: (payload: unknown, fromVersion: number) => z.input<P>;
  maxPayloadBytes?: number;     // ≤ 8192
  allowGenericRetry?: boolean;  // mặc định true; queue 'publish' ⇒ phải false (Clarifications Q1)
  retry?: { maxRetries?: number; delaysSeconds?: number[] }; // không vượt queue_settings
}): JobTypeDefinition<z.output<P>>;
```

Khai báo đặt trong `modules/<owner>/jobs.ts` (không nằm trong `internal/`) và xuất qua `index.ts` của module
sở hữu khi module khác cần tạo việc đó. Khai báo trùng tên → ném lúc khởi động.

## 2. Tạo việc trong giao dịch (FR-007…013)

```ts
export interface EnqueueOptions {
  runAfter?: Date;          // giờ chạy sớm nhất (theo giờ CSDL khi so sánh)
  dedupeKey?: string;       // vd `publish:${attemptId}`; mặc định `${type}:${jobId}`; ≤ 200 ký tự
}
export type EnqueueResult =
  | { status: 'created'; jobId: string }
  | { status: 'exists'; jobId: string; state: 'pending' | 'retry_wait' | 'running' };

export function enqueue<P>(def: JobTypeDefinition<P>, payload: P, opts?: EnqueueOptions): Promise<EnqueueResult>;
export function enqueueMany<P>(def: JobTypeDefinition<P>,
  items: { payload: P; opts?: EnqueueOptions }[]): Promise<{ jobIds: string[] }>;   // ≤ 100 việc
```

Điều kiện (lỗi là `AppError` mã `INTERNAL_ERROR` cho khách, mã gốc trong `detail`):

| Tình huống | Mã gốc |
|---|---|
| Gọi ngoài `tenantTx`/`systemTx` | `QUEUE_TX_REQUIRED` |
| `scope: 'tenant'` mà giao dịch không có tenant | `QUEUE_TENANT_CONTEXT_REQUIRED` |
| `scope: 'system'` trong giao dịch tenant | `QUEUE_SYSTEM_CONTEXT_REQUIRED` |
| Loại việc chưa khai báo / sai khuôn / > kích thước | `QUEUE_JOB_TYPE_UNKNOWN` / `QUEUE_PAYLOAD_INVALID` / `QUEUE_PAYLOAD_TOO_LARGE` |
| Trùng khóa trong cùng lô `enqueueMany`, hoặc một khóa của lô đã có việc hiệu lực | `QUEUE_DUPLICATE_IN_BATCH` (cả lô không tạo) |

Không có tham số `accountId` – lấy từ giao dịch. `traceId` lấy từ `ExecutionContext`.

## 3. Hủy / đổi giờ việc chưa chạy (FR-011)

```ts
export type JobRef = { jobId: string } | { queue: QueueName; dedupeKey: string };
export type ChangeResult =
  | { status: 'cancelled' | 'rescheduled'; jobId: string }
  | { status: 'not_pending'; jobId: string; state: 'running' | 'completed' | 'cancelled' | 'failed' }
  | { status: 'not_found' };

export function cancelJob(ref: JobRef): Promise<ChangeResult>;
export function rescheduleJob(ref: JobRef, runAfter: Date): Promise<ChangeResult>;
```

Chỉ trong giao dịch; RLS bảo đảm chỉ thấy việc của tenant hiện hành (việc tenant khác → `not_found`).

## 4. Bộ xử lý (chỉ Worker – FR-003, FR-014…016)

```ts
export interface JobContext {
  jobId: string; type: string; queue: QueueName;
  attempt: number;          // 1 = lượt đầu
  maxRetries: number;
  accountId: string | null;
  traceId: string;
  signal: AbortSignal;      // hủy khi sắp hết khóa, mất khóa, tắt quá hạn (R5)
}
export type JobHandlerResult = void | RetryAfter | NoRetry;
export function retryAfter(seconds: number): RetryAfter;   // 1 … 86400
export function noRetry(reason: string): NoRetry;          // kết quả nghiệp vụ, không vào việc hỏng
export class PermanentJobError extends Error { constructor(code: string, message?: string) }

export function registerJobHandler<P>(
  def: JobTypeDefinition<P>,
  handler: (payload: P, ctx: JobContext) => Promise<JobHandlerResult>,
  opts?: { onFinalFailure?: (payload: P, info: FinalFailureInfo) => Promise<void> },
): void;
export interface FinalFailureInfo { deadJobId: string; cause: DeadJobCause; attempts: number; lastErrorCode?: string }
```

- Bộ xử lý chạy bên trong `runWithJobContext({ traceId, accountId })`; tự mở `tenantTx` (việc tenant)
  hoặc `systemTx` (việc hệ thống) khi cần CSDL – lớp hàng chờ **không** bọc bộ xử lý trong một giao dịch
  dài (bộ xử lý gọi API ngoài).
- `registerJobHandler` gọi ở API → ném `QUEUE_HANDLER_ON_API`. Đăng ký hai lần → ném.
- `onFinalFailure` chạy trong cùng ngữ cảnh, giao dịch riêng; lỗi được thử lại bởi `queue.sweep_failed`.

## 5. Việc định kỳ (FR-026…029)

```ts
export function defineSchedule(def: {
  name: string;             // duy nhất
  cron: string;             // 5 trường; 6 trường chỉ khi APP_ENV=test
  tz?: 'Asia/Ho_Chi_Minh' | 'UTC';
  jobType: JobTypeDefinition<Record<string, never>>; // scope 'system', payload rỗng
}): ScheduleDefinition;

export function registerPartitionedLog(def: {
  table: string;                // 'infra.audit_log'
  ensureFunction: string;       // hàm SECURITY DEFINER đã có EXECUTE cho system
  monthsAhead: number;          // 1–6
  retentionMonths?: number;     // chỉ khi bảng có chính sách giữ (vd 12)
  dropFunction?: string;
}): void;
```

## 6. Việc hỏng (FR-023…025) – cho màn hình hỗ trợ WBS 4.7 (chỉ API)

```ts
export interface DeadJobFilter {
  queue?: QueueName; jobType?: string; accountId?: string;
  failedFrom?: Date; failedTo?: Date;
  retryStatus?: 'none' | 'requested' | 'retried' | 'rejected_already_active';
  limit?: number;        // ≤ 100
  after?: string;        // phân trang theo id
}
export function searchDeadJobs(actor: SupportActor, filter: DeadJobFilter): Promise<DeadJobSummary[]>;
export function getDeadJob(actor: SupportActor, accountId: string | null, deadJobId: string, reason: string): Promise<DeadJobDetail | null>;
export function requestDeadJobRetry(actor: SupportActor, deadJobId: string, reason: string):
  Promise<'requested' | 'rejected_not_allowed' | 'rejected_already_active' | 'not_found'>;
```

- `searchDeadJobs` → `supportSearch(actor, 'dead_job_filter', …)` (khung nhìn tìm kiếm, kiểm toán loại bộ lọc).
- `getDeadJob` với `accountId` → `supportViewAccount` (kiểm toán, lý do ≥ 5 ký tự); `null` (việc hệ
  thống) → khung nhìn tìm kiếm + kiểm toán `support.search`.
- `requestDeadJobRetry` → hàm `infra.request_dead_job_retry` (R14); `rejected_not_allowed` cho loại việc
  `publish` kèm hướng dẫn "dùng 'Đăng lại' trong màn hình lượt đăng" (thông điệp cho WBS 4.7).
- **Phân quyền** (hỗ trợ / quản trị nội bộ) do guard của WBS 2.1/4.7 kiểm ở tầng máy chủ trước khi gọi;
  ở đây `SupportActor` là bắt buộc và mọi thao tác đều vào `infra.audit_log`.

## 7. Xóa mọi việc của tài khoản (FR-037)

```ts
export function purgeAccountJobs(): Promise<{ jobs: number; deadJobs: number }>;
```

Chỉ trong `systemTx({ tenant: 'from-context' })` ở Worker (luồng xóa tài khoản); ngoài ngữ cảnh đó →
`QUEUE_SYSTEM_TENANT_CONTEXT_REQUIRED`. Idempotent.

## 8. Khuôn kiểm thử dùng lại (FR-035) – `apps/server/test/support/queue-test-kit.ts`

```ts
runJobInline(def, payload, { accountId?, attempt? }): Promise<JobHandlerResult>; // không cần Worker thật
expectIdempotent(def, payload, { accountId?, snapshot: () => Promise<unknown> }): Promise<void>;
// chạy bộ xử lý 2 lần trên cùng dữ liệu, so snapshot() sau lần 1 và lần 2 (deep equal)
startTestWorkers(n: 1 | 2, opts?): Promise<{ stop(): Promise<void>; drain(): Promise<void> }>;
```
