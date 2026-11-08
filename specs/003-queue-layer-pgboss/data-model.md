# Data Model: Lớp hàng chờ nội bộ (003)

Module sở hữu: `queue` (schema `infra` + schema thư viện `pgboss`). Quyết định nền: [research.md](research.md).
Quy ước 002: UUID v7 sinh ở ứng dụng, `timestamptz` UTC, mọi đối tượng thuộc `owner`, migration tay cho
bảng không theo khuôn (`db:generate:custom`).

## 1. Tổng quan

```text
pgboss (thư viện, migration 0005)          infra (module queue)
├── job / job_common  ◄── việc ──────┐     ├── queue_settings   (dùng chung, 6 dòng)
├── queue  (6 hàng chờ)              │     ├── dead_jobs        (account_id NULL được, RLS)
├── version, instance, …             │     ├── schedule_slots   (dùng chung, khóa khung)
                                     └──── ├── audit_log        (002 – thêm action mới)
                                           └── khung nhìn support_dead_jobs_search / _detail
```

Không có khóa ngoại giữa `infra` và `pgboss`. `infra.dead_jobs.account_id` → `account.accounts`
`ON DELETE CASCADE` (khóa ngoại tới bảng tài khoản được phép – ADR-09).

## 2. Hàng chờ (pg-boss `pgboss.queue`) – 6 dòng

| Thuộc tính pg-boss | Nguồn |
|---|---|
| `name` | `publish` · `media` · `ai_batch` · `trends` · `notify` · `scheduled` (enum `QueueName` trong mã) |
| `policy` | `exclusive` (cố định – R3) |
| `partition` | `false` |
| `expireInSeconds` | `queue_settings.lock_seconds` |
| `heartbeatSeconds` | `queue_settings.heartbeat_seconds` |
| `retryLimit` / `retryDelay` | `max_retries` / `retry_delays_seconds[1]` (chỉ dùng khi monitor trả việc) |
| `deleteAfterSeconds` | 2 592 000 (30 ngày – việc xong/hủy) |
| `retentionSeconds` | 1 209 600 (14 ngày cho việc chờ quá lâu – mặc định pg-boss) |

Tạo/đồng bộ bởi `ensureQueues` (sau migration, `owner`) và Worker (`updateQueue` khi thông số đổi).

## 3. Việc (pg-boss `pgboss.job_common`) – phong bì

Bảng của thư viện; module chỉ chạm qua bộ nối trong `modules/queue/internal/pgboss/`.

| Cột pg-boss | Ý nghĩa ở lớp hàng chờ |
|---|---|
| `id` (uuid) | mã việc – ứng dụng tự sinh UUID v7 (`JobOptions.id`) |
| `name` | hàng chờ |
| `data` (jsonb) | **phong bì** (dưới) |
| `state` | `created` (chờ) · `retry` (chờ thử lại) · `active` (đang chạy) · `completed` (xong) · `cancelled` (hủy) · `failed` (hết lượt do monitor – được quét sang việc hỏng, R8) |
| `start_after` | giờ chạy sớm nhất (`runAfter`) |
| `singleton_key` | khóa chống trùng; luôn có (R3) |
| `group_id` | `accountId` (việc tenant) hoặc NULL (việc hệ thống) – cột dùng cho RLS và giới hạn tenant |
| `priority` | `publish` = 10, khác = 0 |
| `retry_count` / `retry_limit` | số lần đã thử lại / tối đa |
| `heartbeat_on`, `expire_seconds` | khóa (R5) |
| `output` | `{ outcome: 'no_retry', reason }` cho kết quả nghiệp vụ |

**Phong bì `JobEnvelope`** (JSON, ≤ 8 192 byte):

| Trường | Kiểu | Ràng buộc |
|---|---|---|
| `type` | string | tên loại việc đã đăng ký, `^[a-z_]+\.[a-z_]+$` |
| `v` | int ≥ 1 | phiên bản khuôn dữ liệu |
| `accountId` | uuid \| null | từ ngữ cảnh giao dịch; NULL ⇔ việc hệ thống; = `group_id` |
| `traceId` | string | từ `ExecutionContext` |
| `payload` | object | khuôn của loại việc (Zod strict), chỉ mã tham chiếu + tham số nhỏ |
| `retriedFrom` | `{ deadJobId, traceId }` \| absent | khi tạo bởi chạy lại việc hỏng |

**Chuyển trạng thái** (do bộ chạy, R6–R8):

```text
created ──lấy──► active ──complete──► completed
   ▲  │            │ ├─retryAfter/lỗi tạm, còn lượt──► retry ──đến giờ──► active
   │  └─cancel──►  │ ├─noRetry──► completed(output.outcome = no_retry)
   │   cancelled   │ ├─PermanentJobError / hết lượt──► (xóa) + infra.dead_jobs
   │               │ └─heartbeat mất / quá trần──► retry | failed ──quét──► infra.dead_jobs
 update(start_after) chỉ khi created|retry
```

## 4. `infra.queue_settings` (bảng dùng chung)

`sharedTable(infra, 'queue_settings', …, { reason: 'Thông số vận hành của 6 hàng chờ, không thuộc tài khoản nào' })`.
Quyền: `app` SELECT; `system` SELECT, UPDATE. Không INSERT/DELETE cho ứng dụng (6 dòng do migration).

| Cột | Kiểu | Ràng buộc | Khởi tạo (publish / media / ai_batch / trends / notify / scheduled) |
|---|---|---|---|
| `queue` | text PK | `IN (6 tên)` | |
| `concurrency_per_worker` | int | `≥ 1 AND ≤ 50` | 10 / 2 / 5 / 2 / 5 / 2 |
| `max_per_tenant` | int NULL | `NULL OR (≥ 1 AND ≤ concurrency_per_worker × 10)` | 3 / 1 / 3 / 1 / NULL / NULL |
| `lock_seconds` | int | `≥ 30 AND ≤ 3600` | 120 / 900 / 180 / 600 / 60 / 600 |
| `heartbeat_seconds` | int | `≥ 10 AND < lock_seconds` | 30 mọi hàng |
| `retry_mode` | text | `IN ('schedule','handler','none')` | handler / schedule / schedule / schedule / schedule / none |
| `max_retries` | int | `≥ 0 AND ≤ 20`; `retry_mode='none' ⇒ 0` | 5 / 3 / 2 / 3 / 5 / 0 |
| `retry_delays_seconds` | int[] | không rỗng, mọi phần tử `≥ 1 AND ≤ 86400` | `{60}` / `{60,300,900}` / `{30,120}` / `{3600,14400}` / `{30,60,120,300,600}` / `{60}` |
| `poll_interval_ms` | int | `≥ 200 AND ≤ 60000` | 1000 / 5000 / 2000 / 5000 / 2000 / 2000 |
| `updated_at` | timestamptz | `DEFAULT now()` | |
| `updated_by` | text NULL | mã nhân viên/“migration” | |

Quy tắc ứng dụng thêm (Zod): `heartbeat_seconds × 2 ≤ lock_seconds`; dòng lỗi → giữ giá trị cũ (R10).

## 5. `infra.dead_jobs` (việc hỏng)

Migration tay (cột `account_id` cho phép NULL – không theo khuôn `tenantTable`). Đăng ký
`registerTable({ kind: 'tenant', tenantColumn: 'account_id', nullableTenant: { reason: 'Việc hệ thống
không thuộc tài khoản nào' } })` – thêm tùy chọn `nullableTenant` vào sổ đăng ký 002 và quy tắc `db:check`
(bảng `tenant` có `account_id` NULL được chỉ khi khai báo lý do).

| Cột | Kiểu | Ràng buộc / ghi chú |
|---|---|---|
| `id` | uuid PK | UUID v7 |
| `account_id` | uuid NULL | FK `account.accounts(id) ON DELETE CASCADE`; NULL = việc hệ thống |
| `original_job_id` | uuid NOT NULL | **UNIQUE** → chôn idempotent |
| `queue` | text NOT NULL | 6 tên |
| `job_type` | text NOT NULL | |
| `payload_version` | int NOT NULL | `v` của phong bì |
| `payload` | jsonb NOT NULL | chỉ mã tham chiếu (đã kiểm khi tạo) |
| `dedupe_key` | text NOT NULL | khóa chống trùng gốc – dùng lại khi chạy lại |
| `cause` | text NOT NULL | `RETRIES_EXHAUSTED` · `PERMANENT_ERROR` · `NO_HANDLER` · `PAYLOAD_INVALID` · `EXPIRED` |
| `last_error` | jsonb NOT NULL | `{ name, code?, message }` đã lược bí mật, ≤ 2 KB |
| `attempts` | int NOT NULL | số lượt đã chạy (`retry_count + 1`) |
| `job_created_at` | timestamptz NOT NULL | |
| `failed_at` | timestamptz NOT NULL DEFAULT now() | |
| `trace_id` | text NOT NULL | |
| `generic_retry_allowed` | boolean NOT NULL | sao từ đăng ký loại việc (Q1: `publish` = false) |
| `final_failure_notified` | boolean NOT NULL DEFAULT false | đã gọi `onFinalFailure` thành công |
| `final_failure_attempts` | int NOT NULL DEFAULT 0 | ≤ 5 lần gọi lại |
| `retry_status` | text NOT NULL DEFAULT `'none'` | `none` · `requested` · `retried` · `rejected_already_active` |
| `retry_requested_by` / `retry_requested_at` | text / timestamptz NULL | mã nhân viên |
| `retried_at` / `new_job_id` | timestamptz / uuid NULL | |

Chỉ mục: `(account_id, failed_at)`; `(queue, failed_at)` *(ngoại lệ `d-index-not-tenant-first`: tra cứu
vận hành theo hàng chờ xuyên tài khoản)*; `(retry_status) WHERE retry_status = 'requested'` *(ngoại lệ:
việc định kỳ chạy lại quét xuyên tài khoản)*.

**RLS** (`ENABLE ROW LEVEL SECURITY`):

| Chính sách | Vai trò | Điều kiện |
|---|---|---|
| `tenant_isolation` | `app` | `account_id = account.current_account_id()` (USING + WITH CHECK) |
| `system_scoped` | `system` | `account_id = account.current_account_id() OR (account_id IS NULL AND account.current_account_id() IS NULL)` |

Thao tác xuyên tài khoản (dọn > 90 ngày, quét `requested`, đếm chỉ số) đi qua hàm `SECURITY DEFINER`
của `owner`, `EXECUTE` chỉ cho `system`:

| Hàm | Việc |
|---|---|
| `infra.cleanup_dead_jobs(older_than_days int)` → int | xóa dòng `failed_at < now() - days` |
| `infra.claim_dead_job_retries(max int)` → setof (id, account_id) | lấy dòng `requested` (`FOR UPDATE SKIP LOCKED`) |
| `infra.count_dead_jobs_since(since timestamptz)` → setof (queue, n) | chỉ số |
| `infra.request_dead_job_retry(id uuid, staff text, reason text)` → text | **`EXECUTE` cho `support`** – R14 |

**Khung nhìn hỗ trợ** (chủ `owner`, `GRANT SELECT` chỉ cho `support` – quy tắc `i`):

- `infra.support_dead_jobs_search`: `id, account_id, queue, job_type, cause, attempts, failed_at,
  retry_status, retried_at` – không `payload`, không `last_error`.
- `infra.support_dead_jobs_detail`: mọi cột trừ `final_failure_*`, `WHERE account_id =
  account.current_account_id()`.

**Vòng đời**: tạo khi chôn (R8) → (tùy) `requested` → `retried` | `rejected_already_active` → xóa sau
90 ngày (`queue.cleanup`) hoặc khi xóa tài khoản (`purgeAccountJobs`, FK cascade khi xóa `accounts`).

## 6. `infra.schedule_slots` (khung việc định kỳ)

`sharedTable(infra, 'schedule_slots', …, { reason: 'Khung chạy của việc định kỳ hệ thống' })`, khóa chính
ghép (`name`, `slot`) – dùng `sharedTable` với `primaryKey` tùy chọn (thêm vào hàm dựng nếu chưa có).
Quyền: `system` SELECT, INSERT, UPDATE, DELETE; `app` không có.

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `name` | text | tên việc định kỳ |
| `slot` | text | giờ địa phương ISO đầu khung, vd `2026-11-09T05:00+07:00` |
| `slot_at` | timestamptz | cùng thời điểm, UTC – sắp xếp/dọn |
| `status` | text | `enqueued` · `skipped_overlap` |
| `job_id` | uuid NULL | việc pg-boss đã tạo |
| `late_seconds` | int | `now() − slot_at` lúc tạo |
| `created_at` | timestamptz | giờ CSDL |

PK `(name, slot)` → đúng một việc mỗi khung trên mọi bản (FR-027). Dọn > 90 ngày bởi `queue.cleanup`.

## 7. `infra.audit_log` – hành động mới (bảng của 002, không đổi cấu trúc)

| `action` | `actor_type` | `account_id` | `metadata` |
|---|---|---|---|
| `dead_job.retry_requested` | `support`/`admin` | của việc (NULL cho việc hệ thống) | `{ dead_job_id }` |
| `dead_job.retry_rejected` | `support`/`admin` | như trên | `{ dead_job_id, why }` |
| `dead_job.retried` | `system` | như trên | `{ dead_job_id, new_job_id }` |
| `queue.account_jobs_purged` | `system` | tài khoản bị xóa | `{ jobs, dead_jobs }` |

Xem việc hỏng qua `supportSearch`/`supportViewAccount` đã tự ghi `support.search`/`support.view_account`.

## 8. Đăng ký trong mã (không lưu CSDL)

**Loại việc – `JobTypeDefinition<P>`** (`defineJobType`, dùng ở cả API và Worker):

| Thuộc tính | Bắt buộc | Ghi chú |
|---|---|---|
| `name` | có | duy nhất toàn ứng dụng, `<module>.<action>` |
| `queue` | có | một trong 6 |
| `scope` | có | `'tenant'` \| `'system'` |
| `payload` | có | Zod `strictObject` (R13) |
| `version` | có | `v` hiện hành |
| `migrate` | không | `(payload, fromVersion) => payload` |
| `maxPayloadBytes` | không | ≤ 8 192 |
| `allowGenericRetry` | không | mặc định `true`; **bắt buộc `false` khi `queue = 'publish'`** (kiểm khi đăng ký – Q1) |
| `retry` | không | ghi đè trong phạm vi hàng chờ: `{ maxRetries? ≤ settings, delaysSeconds? }` |

**Bộ xử lý – `registerJobHandler(def, handler, { onFinalFailure? })`** – chỉ ở Worker (FR-003);
`handler(payload, ctx)` với `ctx = { jobId, attempt, maxRetries, signal, traceId, accountId }`.

**Việc định kỳ – `ScheduleDefinition`** (`defineSchedule`): `name` (duy nhất), `cron`, `tz`
(mặc định theo R9), `jobType` (loại việc `scope: 'system'`, hàng chờ mặc định `scheduled`).

**Bảng nhật ký phân vùng – `registerPartitionedLog`**: `{ table, ensureFunction, monthsAhead,
retentionMonths?, dropFunction? }`. Đăng ký sẵn `infra.audit_log` (`ensure_audit_log_partitions`,
`monthsAhead: 2`, `retentionMonths: 12`, hàm mới `infra.drop_audit_log_partitions_before(months int)`
`SECURITY DEFINER`, `EXECUTE` cho `system`).

**Việc định kỳ nội bộ của module `queue`**:

| Tên | Lịch | Việc |
|---|---|---|
| `queue.cleanup` | `30 3 * * *` (UTC+7) | `cleanup_dead_jobs(90)`, xóa `schedule_slots` > 90 ngày (việc xong > 30 ngày do `deleteAfterSeconds` của pg-boss) |
| `queue.partitions` | `0 4 1 * *` (UTC+7) + chạy một lần khi Worker khởi động | `ensure_*_partitions(monthsAhead)`; bỏ phân vùng quá `retentionMonths` |
| `queue.sweep_failed` | `* * * * *` | chôn việc `failed`; gọi lại `onFinalFailure` chưa thành công (R8) |
| `queue.dead_job_retries` | `* * * * *` | thực hiện yêu cầu chạy lại (R14) |

## 9. Ánh xạ thuật ngữ

Xem cuối [research.md](research.md); thêm vào `.specify/memory/architecture.md` mục 11 trong cùng thay đổi.
