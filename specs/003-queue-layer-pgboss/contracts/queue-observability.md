# Hợp đồng: chỉ số, nhật ký, cảnh báo của lớp hàng chờ

## 1. Chỉ số (OpenTelemetry API, meter `app.queue`) – FR-031

Nhãn chung: `queue` (6 giá trị). Không bao giờ có nhãn `account_id`, `job_id`, `dedupe_key`.

| Chỉ số | Loại | Nhãn thêm | Nguồn |
|---|---|---|---|
| `queue.jobs.waiting` | gauge | — | đếm `created`+`retry` có `start_after <= now()` (mỗi 30 giây) |
| `queue.jobs.oldest_wait_seconds` | gauge | — | `now() − min(start_after)` của việc đến giờ chưa lấy |
| `queue.job.duration` | histogram (giây) | `job_type`, `outcome` | đo trong bộ chạy |
| `queue.jobs.finished` | counter | `job_type`, `outcome` ∈ `completed`·`retry`·`no_retry`·`dead`·`aborted` | bộ chạy |
| `queue.dead_jobs.created` | counter | `job_type`, `cause` | `buryJob` |
| `queue.dead_jobs.last_24h` | gauge | — | `infra.count_dead_jobs_since(now() − 24h)` |
| `queue.workers.live` | gauge | (không có `queue`) | `getInstances()` `live = true`, tên `worker` |
| `queue.settings.invalid` | counter | — | R10 |

Mỗi bản Worker xuất cùng giá trị gauge; quy tắc cảnh báo dùng `max by (queue)`.

## 2. Nhật ký có cấu trúc (pino) – FR-033

`queue.job_finished` (info; `warn` khi `outcome` ≠ `completed`), một dòng mỗi lượt:

| Trường | Ví dụ |
|---|---|
| `trace_id`, `account_id` (null cho việc hệ thống) | |
| `queue`, `job_type`, `job_id`, `attempt`, `max_retries` | |
| `duration_ms`, `wait_ms` (từ `start_after` tới lúc lấy) | |
| `outcome` | `completed` · `retry` · `no_retry` · `dead` · `aborted` |
| `retry_in_s` (khi `retry`), `error_code`, `error_message` (đã lược – R13) | |
| `payload_ref` | chỉ các trường `*Id` của payload, vd `{ attemptId }` |

Sự kiện khác: `queue.started` (queues, version), `queue.fetch_failed` (giãn cách), `queue.schema_version_mismatch`,
`queue.settings_invalid`, `queue.settings_applied`, `queue.schedule_slot` (`name`, `slot`, `status`,
`late_seconds`), `queue.final_failure_callback_failed`, `queue.job_aborted` (lý do: `lock_lost` ·
`lock_deadline` · `shutdown`).

**Cấm** trong mọi dòng: payload đầy đủ, nội dung bài, prompt, mã quyền truy cập, chuỗi kết nối, mật
khẩu (SC-011 – `test/queue/secrets-in-logs.queue.spec.ts` quét nhật ký mẫu của toàn bộ bộ kiểm thử).

## 3. Quy tắc cảnh báo – `ops/alerts/queue.rules.yml` (FR-032, kiến trúc mục 9)

| Tên | Biểu thức (rút gọn) | Trong |
|---|---|---|
| `QueuePublishOldestWaitHigh` | `max by (queue) (queue_jobs_oldest_wait_seconds{queue="publish"}) > 300` | 1m |
| `QueueMediaOldestWaitHigh` | `… {queue="media"} > 600` | 1m |
| `QueueNotifyOldestWaitHigh` | `… {queue="notify"} > 300` | 1m |
| `QueuePublishDeadJob` | `increase(queue_dead_jobs_created_total{queue="publish"}[5m]) > 0` | 0m |
| `QueueDeadJobsHigh` | `max by (queue) (queue_dead_jobs_last_24h{queue!="publish"}) > 10` | 5m |
| `QueueErrorRateHigh` | tỷ lệ `outcome!="completed"` / tổng trên 15m > 0.05 | 15m |
| `QueueBacklogGrowing` | `deriv(max by (queue)(queue_jobs_waiting)[30m:1m]) > 0` và `queue_jobs_waiting > 0` | 30m |
| `QueueMediaVideoP95High` | `histogram_quantile(0.95, … queue_job_duration_bucket{queue="media",job_type=~"media\\..*video.*"}) > 480` | 15m |
| `QueueWorkersLow` | `max(queue_workers_live) < 2` | 2m |
| `QueueSettingsInvalid` | `increase(queue_settings_invalid_total[10m]) > 0` | 0m |

Ngưỡng nằm trong tệp, đổi được không cần sửa mã. Kiểm thử cấu trúc: tệp phân tích được, có đủ 10 tên
trên, mọi biểu thức chỉ dùng chỉ số ở mục 1.
