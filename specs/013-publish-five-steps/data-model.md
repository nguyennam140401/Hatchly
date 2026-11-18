# Mô hình dữ liệu – Đăng bài 5 bước (013)

Schema PostgreSQL `publishing` (module `publishing`). Quy ước chung: PK UUID v7 sinh ở ứng dụng; `timestamptz` UTC; cột
`account_id NOT NULL` là cột đầu của mọi chỉ mục; RLS `tenant_isolation` (`account_id = account.current_account_id()`); khóa ngoại
**chỉ** tới `account.accounts` (ADR-09) — `post_id`, `variant_id`, `connection_id`, `media_id` là mã tham chiếu kiểm tra khi ghi
qua module sở hữu.

## 1. Thuật ngữ Việt → Anh (ghi mới cho dự án)

| Tiếng Việt | Mã nguồn |
|---|---|
| lượt đăng | `publish_attempt` / bảng `publish_attempts` |
| bước đăng | `publish_step` / bảng `publish_steps` |
| ánh xạ lỗi | `error_mapping` / bảng `error_mappings` |
| giai đoạn lượt đăng | `phase` |
| Đã gửi, chờ phản hồi | `phase = submitted_awaiting_response` |
| lần chạy (của một lượt đăng) | `run_no` |
| lý do cần xử lý | `needs_reason` |
| đối soát thử lại một lần | `reconcile_retry_used` |
| ngưỡng quá giờ hẹn | `publish.max_late_sec` |
| Chờ đến giờ / Đang xử lý / Chờ thử lại / Không xác định / Cần người dùng / Cần kiểm tra / Thành công / Đã hủy | `scheduled` / `processing` / `retry_wait` / `unknown` / `needs_user` / `needs_check` / `succeeded` / `cancelled` |
| kiểm tra trước / chuẩn bị media / gửi / chờ xử lý / xác nhận | `precheck` / `prepare_media` / `submit` / `await_processing` / `confirm` |

Cần thêm các dòng này vào bảng thuật ngữ mục 11 của `.specify/memory/architecture.md` cùng thay đổi (quy định ở cuối mục 11).

## 2. `publishing.publish_attempts` (bảng `tenant`)

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | v7 |
| `account_id` | uuid NOT NULL, FK → `account.accounts` | |
| `post_id` | uuid NOT NULL | tham chiếu `content.posts` |
| `variant_id` | uuid NOT NULL | tham chiếu `content.channel_variants` |
| `variant_version` | int NOT NULL | phiên bản kênh lúc lên lịch; lệch → hủy (US1-6) |
| `connection_id` | uuid NOT NULL | tham chiếu `platform_gateway.channel_connections` |
| `channel_type` | text NOT NULL | `facebook_page` \| `instagram` \| `zalo_oa` \| `test_channel` (copy lúc tạo) |
| `status` | text NOT NULL | 8 giá trị ở research R1; CHECK |
| `phase` | text NOT NULL DEFAULT `none` | `none` \| `submitted_awaiting_response` \| `awaiting_processing` \| `finished`; CHECK |
| `scheduled_at` | timestamptz NOT NULL | giờ hẹn (giờ chạy sớm nhất của việc) |
| `run_no` | int NOT NULL DEFAULT 0 | tăng mỗi lần luồng chạy lại (thử lại/đối soát/Đăng lại) |
| `transient_attempts` | int NOT NULL DEFAULT 0 | CHECK (0..5) |
| `transient_window_started_at` | timestamptz NULL | lần lỗi tạm thời đầu tiên của chuỗi hiện tại |
| `reconcile_retry_used` | boolean NOT NULL DEFAULT false | |
| `content_hash` | text NULL | `ch1:…`, ghi trước `submit` |
| `submitted_at` | timestamptz NULL | lúc ghi dấu "đã gửi" |
| `processing_id` | text NULL | mã xử lý bất đồng bộ (Instagram) |
| `platform_post_id` | text NULL | mã bài trên nền tảng |
| `permalink` | text NULL | đường dẫn bài (≤ 2048) |
| `confirmed_by` | text NULL | `platform` \| `reconciliation` \| `user` |
| `needs_reason` | text NULL | enum ngắn (R12); NOT NULL khi `status IN ('needs_user','needs_check')` |
| `last_error_category` | text NULL | `transient` \| `user_action` \| `unknown` |
| `last_raw_code` | text NULL | mã lỗi gốc đã lọc `[A-Za-z0-9_.:-]{1,64}` |
| `trace_id` | text NOT NULL | mã theo dõi xuyên suốt |
| `version` | int NOT NULL DEFAULT 1 | khóa lạc quan khi người dùng thao tác |
| `created_at`, `updated_at` | timestamptz NOT NULL | |

**Chỉ mục & ràng buộc**

- `UNIQUE (account_id, post_id, connection_id) WHERE status <> 'cancelled'` — `ux_publish_attempts_active_pair`.
- `INDEX (account_id, status, scheduled_at)` — Lịch/danh sách và bộ quét.
- `INDEX (account_id, post_id)` — màn hình Tiến trình đăng.
- Bộ quét quá hạn (R14) đọc theo từng tài khoản bằng `systemTx` với `tenant: 'from-context'`, nên **không** thêm chỉ mục
  nào không bắt đầu bằng `account_id`.
- CHECK: `(status IN ('needs_user','needs_check')) = (needs_reason IS NOT NULL)`.
- CHECK: `phase = 'finished'` chỉ khi `status IN ('succeeded','cancelled')`.
- CHECK: `status = 'succeeded' ⇒ platform_post_id IS NOT NULL OR confirmed_by = 'user'` (người dùng xác nhận tay không bắt buộc có mã bài).

**Bất biến (kiểm bằng kiểm thử)**

1. `phase = 'submitted_awaiting_response'` ⇒ `content_hash IS NOT NULL AND submitted_at IS NOT NULL`.
2. `content_hash` và `submitted_at` **chỉ được ghi một lần** cho mỗi lượt gửi; chỉ `Đăng lại` hoặc thử lại sau đối soát được đặt
   `phase = 'none'` và xóa chúng (qua `transition()`).
3. Mọi `UPDATE` đổi `status` đi qua `transition(from, to)`; không có đường ghi trực tiếp khác (quy tắc lint `publishing-no-raw-status-update`).

## 3. `publishing.publish_steps` (bảng nhật ký phân vùng tháng – `partitionedLogTable`)

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid | v7 |
| `account_id` | uuid NOT NULL | cột đầu của khóa/chỉ mục |
| `attempt_id` | uuid NOT NULL | tham chiếu `publish_attempts` |
| `run_no` | int NOT NULL | lần chạy luồng |
| `step_no` | smallint NOT NULL | 1..5 |
| `step_key` | text NOT NULL | `precheck` \| `prepare_media` \| `submit` \| `await_processing` \| `confirm` |
| `event` | text NOT NULL | `started` \| `finished` |
| `outcome` | text NULL | khi `finished`: `succeeded` \| `failed` \| `skipped` \| `not_applicable` |
| `error_category` | text NULL | |
| `raw_code` | text NULL | mã lỗi gốc đã lọc |
| `message_vi` | text NULL | ≤ 500 ký tự; lời giải thích tiếng Việt thường |
| `remedies` | jsonb NULL | `[{action, labelVi}]` (≥ 1 khi `failed`) |
| `note` | text NULL | vd "Xác nhận nhờ đối soát" (≤ 200) |
| `occurred_at` | timestamptz NOT NULL | khóa phân vùng |
| `trace_id` | text NOT NULL | |

- PK `(occurred_at, id)`; chỉ mục `(account_id, attempt_id, run_no, step_no, occurred_at)`.
- **Chỉ thêm**: không UPDATE/DELETE (kiểm `pnpm db:immutable`); xóa bằng bỏ cả phân vùng > 12 tháng (đăng ký `registerPartitionedLog`
  với `retentionMonths: 12`).
- **Không bao giờ chứa**: mã quyền, nội dung bài, phản hồi thô của nền tảng. `raw_code` đã lọc; `message_vi`/`remedies` lấy từ `error_mappings`.
- Bước bị bỏ qua vì bước trước lỗi vẫn có dòng `finished/skipped` để hỗ trợ thấy "chưa chạy" (SC-005).

## 4. `publishing.error_mappings` (bảng `shared`, không thuộc tài khoản)

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `channel_type` | text NOT NULL | |
| `raw_code` | text NOT NULL | |
| `category` | text NOT NULL | `transient` \| `user_action` \| `unknown` |
| `message_vi` | text NOT NULL | ≤ 500 |
| `remedies` | jsonb NOT NULL | ≥ 1 phần tử (CHECK `jsonb_array_length >= 1`) |
| `needs_reason` | text NULL | gợi ý `needs_reason` khi `user_action` |
| `retry_after_sec` | int NULL | chỉ khi `transient` |
| `enabled` | boolean NOT NULL DEFAULT true | |
| `updated_at`, `updated_by` | timestamptz / text | `updated_by` là nhãn nhân viên, không email |

`UNIQUE (channel_type, raw_code)`. Vai trò `app` chỉ SELECT; ghi qua vai trò `system` (quản trị nội bộ) và ghi `audit_log`.

## 5. Cấu hình (bảng sẵn có – `infra.queue_settings` hoặc cấu hình môi trường; không thêm bảng)

| Khóa | Mặc định | Dùng ở |
|---|---|---|
| `publish.max_late_sec` | 3600 | R7 |
| `publish.transient_delays_sec` | `[60,180,360,600,600]` | R4 |
| `publish.transient_window_sec` | 1800 | R4 |
| `publish.reconcile_first_delay_sec` | 120 | R5 |
| `publish.reconcile_poll_sec` | 120 | R5 |
| `publish.reconcile_give_up_after_sec` | 600 | R5 |
| `publish.await_processing_max_sec.image` / `.video` | 600 / 1800 | bước 4 |
| `publish.min_schedule_lead_sec` | 300 | do 012 dùng, lưu cùng chỗ |

## 6. Quan hệ

```
account.accounts 1─* publishing.publish_attempts 1─* publishing.publish_steps (qua attempt_id, không FK vì phân vùng)
content.posts / channel_variants / platform_gateway.channel_connections  ← tham chiếu bằng mã (không FK)
publishing.error_mappings   (dùng chung, đọc khi phân loại lỗi)
```

## 7. RLS và kiểm thử truy cập chéo

- `publish_attempts`, `publish_steps`: `tenantTable` / `partitionedLogTable` → `tenant_isolation`; `pnpm db:check` bắt buộc đạt.
- `error_mappings`: `sharedTable`; không có cột tài khoản; `app` chỉ đọc.
- Kiểm thử bắt buộc ở CI: tài khoản A `SELECT/UPDATE/DELETE` lượt/bước của B → 0 dòng/lỗi; đường dẫn HTTP của lượt đăng tài khoản
  khác → 404 (không lộ tồn tại).

## 8. Vòng đời dữ liệu

| Sự kiện | Xử lý |
|---|---|
| Quá 12 tháng | bỏ phân vùng `publish_steps`; `publish_attempts` xóa mềm/xóa theo chính sách bảng nghiệp vụ (30 ngày sau `deleted_at`) |
| Yêu cầu xóa tài khoản / ngắt kênh | `purgeAccountJobs()`; các lượt `scheduled|retry_wait` → `cancelled`; lượt `processing` chờ xong rồi dừng; sau 90 ngày/30 ngày xóa hẳn theo luồng của `account` |
| Di cư | migration tương thích ngược (thêm bảng/cột mới, không đổi nghĩa cột cũ) |
