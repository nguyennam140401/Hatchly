# Data Model – 012

Quy ước chung: khóa chính UUID v7 sinh ở ứng dụng; `timestamptz` UTC; cột `account_id NOT NULL` đứng đầu mọi chỉ mục của
bảng tenant; RLS `tenant_isolation` (`account_id = account.current_account_id()`); mã người dùng/kênh/bài giữa module là
**mã tham chiếu, không khóa ngoại** (ADR-09). Khóa ngoại chỉ trong nội bộ module và tới `account.accounts`. Truy cập qua
`tenantTx`. Tên theo bảng thuật ngữ ([research.md](research.md) R12).

## 1. Schema `content`

### 1.1 `content.posts` (tenantTable)

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `account_id` | uuid NOT NULL | FK → `account.accounts` |
| `status` | text NOT NULL | CHECK ∈ `draft`, `pending_review`, `approved`, `cancelled` |
| `source` | text NOT NULL DEFAULT `manual` | CHECK ∈ `manual`, `ai` (012 chỉ ghi `manual`) |
| `internal_name` | varchar(80) NULL | tên gợi nhớ, không đăng |
| `shared_text` | text NOT NULL DEFAULT `''` | nội dung chung, ≤ 63 206 ký tự (CHECK `char_length`) |
| `scheduled_at` | timestamptz NULL | giờ đăng (một giờ cho mọi kênh); NULL khi chưa chọn |
| `created_by` | uuid NOT NULL | mã người dùng (tham chiếu) |
| `submitted_by` / `submitted_at` / `submission_id` | uuid / timestamptz / uuid NULL | lần gửi duyệt gần nhất |
| `approved_by` / `approved_at` | uuid / timestamptz NULL | |
| `returned_note` | varchar(500) NULL | có giá trị = nhãn "Bị trả lại" |
| `returned_by` / `returned_at` | uuid / timestamptz NULL | |
| `edited_after_approval` | boolean NOT NULL DEFAULT false | nhãn "Đã sửa sau khi duyệt" |
| `version` | integer NOT NULL DEFAULT 1 | khóa lạc quan; mọi cập nhật `version = version + 1` |
| `created_at`, `updated_at` | timestamptz NOT NULL | |
| `deleted_at` | timestamptz NULL | xóa mềm 30 ngày rồi xóa hẳn (việc dọn hằng ngày sẵn có) |

CHECK: `status = 'approved' → scheduled_at IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL`;
`returned_note IS NULL OR char_length(btrim(returned_note)) BETWEEN 1 AND 500`;
`status IN ('pending_review') → submitted_by IS NOT NULL`.

Chỉ mục: `(account_id, status, scheduled_at) WHERE deleted_at IS NULL` · `(account_id, scheduled_at) WHERE deleted_at IS NULL AND scheduled_at IS NOT NULL` ·
`(account_id, created_at DESC, id) WHERE deleted_at IS NULL` · `(account_id, submission_id) WHERE submission_id IS NOT NULL`.

### 1.2 `content.channel_variants` (tenantTable)

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `account_id` | uuid NOT NULL | |
| `post_id` | uuid NOT NULL | FK → `content.posts` (cùng module), `ON DELETE CASCADE` |
| `connection_id` | uuid NOT NULL | tham chiếu `platform_gateway.channel_connections` (không FK) |
| `channel_type` | text NOT NULL | sao chép từ kết nối lúc chọn kênh (để kiểm tra khi kết nối mất) |
| `customized` | boolean NOT NULL DEFAULT false | false → hiển thị `posts.shared_text`, `text` rỗng |
| `text` | text NOT NULL DEFAULT `''` | chỉ có nghĩa khi `customized`; ≤ 63 206 |
| `hashtags` | text[] NOT NULL DEFAULT `{}` | mỗi phần tử không khoảng trắng, ≤ 100 ký tự; ≤ 30 phần tử |
| `media` | jsonb NOT NULL DEFAULT `[]` | mảng `{ mediaId: uuid, kind: 'image'\|'video' }` ≤ 20; chỉ mã tham chiếu |
| `version` | integer NOT NULL DEFAULT 1 | tăng khi dòng đổi (ghi chi tiết; khóa chặn thật ở `posts.version`) |
| `created_at`, `updated_at` | timestamptz NOT NULL | |

UNIQUE `(account_id, post_id, connection_id)` (một phiên bản mỗi kênh mỗi bài). Chỉ mục `(account_id, post_id)`.
Bỏ kênh = xóa dòng (ghi sự kiện `channels_changed`); trạng thái kiểm tra giới hạn **không lưu** — tính khi đọc/duyệt (tránh dữ liệu cũ).

### 1.3 `content.post_events` (tenantTable, chỉ thêm — `pnpm db:immutable`)

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `account_id` | uuid NOT NULL | |
| `post_id` | uuid NOT NULL | FK → `content.posts` (`ON DELETE CASCADE`) |
| `type` | text NOT NULL | CHECK ∈ `created`, `submitted`, `withdrawn`, `approved`, `returned`, `unscheduled`, `rescheduled`, `edited_after_approval`, `channels_changed` |
| `actor_user_id` | uuid NOT NULL | |
| `occurred_at` | timestamptz NOT NULL | |
| `data` | jsonb NOT NULL DEFAULT `{}` | khuôn theo `type`, **không nội dung bài**: `{ fromVersion, toVersion, note?, fromAt?, toAt?, submissionId? }` |

Chỉ mục `(account_id, post_id, occurred_at)`. `note` (ghi chú trả lại ≤ 500) được phép — là lời của chủ, không phải nội dung bài; hiển thị trong "Lịch sử".

### 1.4 `content.channel_rules` (sharedTable – không dữ liệu khách)

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `channel_type` | text PK | `facebook_page`, `instagram`, `zalo_oa`, `test_channel` |
| `max_text_length` | integer NOT NULL | Facebook 63 206; Instagram 2 200; Zalo OA theo hạn mức hiện hành |
| `max_hashtags` | integer NULL | Instagram 30; NULL = không giới hạn |
| `media_required` | boolean NOT NULL | Instagram true |
| `max_posts_per_24h` | integer NULL | hạn mức cục bộ cho cửa sổ trượt 24 giờ (Instagram); NULL = không đếm |
| `updated_at` | timestamptz NOT NULL | |

Dữ liệu khởi tạo trong migration (giá trị khởi đầu, đổi bằng cập nhật dòng, **không cần phát hành**), cache trong tiến trình 5 phút
như các cấu hình khác. Quy tắc media chi tiết (định dạng, dung lượng, tỉ lệ, thời lượng) lấy từ `platformGateway.mediaRules` + `validateMedia`, không lặp ở bảng này.
Giá trị Zalo OA và Instagram cần xác minh ở POC-2 (R-C).

## 2. Schema `publishing`

### 2.1 `publishing.publish_attempts` (tenantTable) — phần 012

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `account_id` | uuid NOT NULL | |
| `post_id` | uuid NOT NULL | tham chiếu `content.posts` (không FK) |
| `channel_connection_id` | uuid NOT NULL | tham chiếu `platform_gateway.channel_connections` |
| `channel_type` | text NOT NULL | |
| `status` | text NOT NULL | CHECK ∈ `scheduled`, `processing`, `retry_wait`, `needs_user`, `unknown`, `needs_check`, `succeeded`, `cancelled` (**đủ bộ trạng thái ADD §7.1** để 013 không phải sửa CHECK) |
| `scheduled_at` | timestamptz NOT NULL | |
| `content_version` | integer NOT NULL | `posts.version` đã duyệt — 013 dùng so khớp nội dung |
| `created_at`, `updated_at` | timestamptz NOT NULL | |
| `version` | integer NOT NULL DEFAULT 1 | |

**Chỉ mục duy nhất**: `UNIQUE (account_id, post_id, channel_connection_id) WHERE status <> 'cancelled'` — chốt chặn "tối đa một lượt hiệu lực".
Chỉ mục: `(account_id, scheduled_at) WHERE status = 'scheduled'` · `(account_id, post_id)` · `(account_id, channel_connection_id, scheduled_at) WHERE status <> 'cancelled'` (đếm hạn mức 24 giờ).

013 thêm cột (`submitted_at`, `platform_post_id`, `last_error_*`, …) và bảng `publish_steps` bằng migration chỉ thêm; không đổi các cột trên.

## 3. Bảng chuyển trạng thái của `publish_attempts` trong 012

| Thao tác | Trước | Sau | Điều kiện |
|---|---|---|---|
| lên lịch | (không có) | `scheduled` | `INSERT … ON CONFLICT DO NOTHING` (chỉ mục duy nhất) |
| hủy | `scheduled` | `cancelled` | `UPDATE … WHERE status = 'scheduled'`; **mọi** mục của bài còn `scheduled`, nếu không → `CHANNEL_ALREADY_PUBLISHING` và hoàn tác |
| đổi giờ | `scheduled` | `scheduled` (giờ mới) | như trên; kèm `rescheduleJob` cùng `tx` |

Các trạng thái còn lại do 013 chuyển; 012 chỉ **đọc**.

## 4. Việc nền

| Loại việc | Hàng chờ | Phạm vi | Payload | `dedupeKey` | `runAfter` |
|---|---|---|---|---|---|
| `publishing.run_attempt` | `publish` | tenant | `{ attemptId: uuid }` | `publish:{attemptId}` | `scheduled_at` |

Tạo trong giao dịch duyệt; hủy/đổi giờ bằng `cancelJob({queue,'publish', dedupeKey})` / `rescheduleJob` cùng `tx`. Mục hủy mà việc đã `running` →
`CHANNEL_ALREADY_PUBLISHING`, hoàn tác. Không có việc định kỳ mới.

## 5. Trạng thái hiển thị (chữ + biểu tượng; bổ sung bảng của 011 FR-005)

| Dữ liệu hệ thống | Nhãn người dùng | Ghi chú |
|---|---|---|
| `draft`, không `returned_note` | Nháp | |
| `draft` + `returned_note` | Nháp – Bị trả lại | kèm ghi chú |
| `pending_review` | Chờ duyệt | |
| `pending_review` + `edited_after_approval` | Chờ duyệt – Đã sửa sau khi duyệt | |
| `pending_review`/`draft` + `scheduled_at < now()+5'` | + nhãn "Giờ đã qua" | tính khi đọc |
| `approved` + mọi mục `scheduled` | Đã lên lịch | |
| `approved` + có mục khác | gộp "xấu nhất" theo UI/UX §7 (Đang đăng, Đã đăng, Cần bạn xử lý, …) | đọc từ `publishing.statusesByPosts` |
| `cancelled` | Đã hủy | chưa có thao tác nào tạo ra (plan) |

## 6. Kiểm toán và dữ liệu cá nhân

- Hành động `infra.audit_log`: xem [research.md](research.md) R12; metadata `{ postId, fromVersion, toVersion, submissionId?, count? }`, không nội dung bài.
- **Dữ liệu cá nhân mới**: nội dung bài (chữ, hashtag) và tham chiếu media — dữ liệu khách hàng thuộc phạm vi xóa tài khoản (FR-033) và xóa mềm 30 ngày.
  Không có bên nhận mới ở nước ngoài. Thông báo chỉ mang `postTitle ≤ 60`.
- Xóa tài khoản: việc xóa hiện có của `account` phải gồm 4 bảng tenant mới (khai báo qua `tenantTable` là đủ, danh sách bảng sinh từ sổ đăng ký).

## 7. Migration (chỉ thêm, tương thích ngược)

| Tệp | Nội dung |
|---|---|
| `0017_content_posts.sql` | `content.posts`, `content.channel_variants`, `content.post_events`, `content.channel_rules` + RLS + quyền cho `app`/`system` + dữ liệu khởi tạo `channel_rules` |
| `0018_publishing_attempts.sql` | `publishing.publish_attempts` + chỉ mục duy nhất có điều kiện + RLS + quyền |

Đánh số lại theo `dev` trước khi merge (R-B). Không hàm `SECURITY DEFINER` mới. Không đổi bảng có sẵn. Bản cũ của API/Worker không chạm bảng mới → chạy song song được.
