# Research – Đăng bài 5 bước (013)

Mỗi mục: **Quyết định · Lý do · Phương án đã xét**. Không còn `NEEDS CLARIFICATION`. Các điểm phụ thuộc kiểm chứng ngoài
(POC-2, Meta App Review) được ghi là *giả định cấu hình được*, không chặn thiết kế.

## R1 – Máy trạng thái và tên trạng thái trong mã

**Quyết định**: `publish_attempts.status` là enum văn bản với 8 giá trị, đặt tên theo ADD/kiến trúc mục 7.1:

| Tài liệu (Việt) | Mã (`status`) | Hiển thị cho người dùng (FR-027) |
|---|---|---|
| Chờ đến giờ | `scheduled` | Đã lên lịch |
| Đang xử lý | `processing` | Đang đăng |
| Chờ thử lại | `retry_wait` | Đang đăng |
| Không xác định | `unknown` | Đang đăng |
| Cần người dùng | `needs_user` | Cần bạn xử lý |
| Cần kiểm tra | `needs_check` | Cần bạn xử lý |
| Thành công | `succeeded` | Đã đăng |
| Đã hủy | `cancelled` | Đã hủy |

Chuyển hợp lệ (mọi chuyển là `UPDATE … SET status = :to … WHERE id = :id AND status = :from`, kiểm tra số dòng = 1):

```
scheduled   → processing | cancelled
processing  → succeeded | retry_wait | needs_user | unknown
retry_wait  → processing
unknown     → succeeded | retry_wait | needs_check
needs_check → succeeded | scheduled
needs_user  → scheduled
```

`succeeded` và `cancelled` là trạng thái cuối. "Đăng lại" từ `needs_user`/`needs_check` về `scheduled` **trên cùng dòng**.

**Lý do**: khớp tuyệt đối vòng đời ở spec FR-002 và sơ đồ ADD; hàm `transition(from[], to, patch)` là nơi **duy nhất** đổi
`status` nên kiểm thử bảng chuyển bao phủ được toàn bộ.

**Đã xét**: bảng lịch sử trạng thái riêng (thừa vì `publish_steps` đã chỉ thêm); trạng thái "Đã gửi, chờ phản hồi" thành
một giá trị `status` thứ 9 – bị loại vì gây trùng nghĩa với `processing` và làm sơ đồ khác ADD (xem R3).

## R2 – Một loại việc, bộ xử lý rẽ nhánh theo giai đoạn

**Quyết định**: một loại việc `publishing.execute_attempt` (hàng chờ `publish`, `scope: 'tenant'`, payload
`{ attemptId }`, `allowGenericRetry: false`, khóa `publish:{attemptId}`). Cột `phase` của lượt đăng quyết định đoạn nào chạy:

| `phase` | Ý nghĩa | Bộ xử lý làm gì khi được gọi |
|---|---|---|
| `none` | chưa gửi gì | bước 1 → 2 → ghi `submitting` → 3 |
| `submitted_awaiting_response` | đã ghi dấu, **chưa biết** nền tảng nhận chưa | **không gửi**; đối soát (R5) |
| `awaiting_processing` | nền tảng đã nhận, đang xử lý bất đồng bộ (Instagram) | bước 4 (`checkStatus`) → bước 5 |
| `finished` | đã ra kết quả cuối | thoát ngay, không tác dụng phụ |

Một lượt đăng chỉ có **một việc đang hiệu lực** tại một thời điểm (khóa chống trùng); việc kế tiếp (thử lại, đối soát, chờ
xử lý) được tạo bằng `retryAfter(seconds)` của chính bộ xử lý hoặc bằng `enqueue` mới trong **cùng giao dịch** chuyển trạng thái
(khi chuyển `needs_user → scheduled`).

**Lý do**: bộ xử lý idempotent bằng cách **đọc trạng thái trước rồi mới làm** (quy tắc `publish` của `queue.md` mục 4);
không cần hàng chờ riêng cho đối soát nên không thêm cấu hình/giới hạn mới.

**Đã xét**: hai loại việc (`execute` và `reconcile`) – loại vì hai việc cùng chạm một lượt đăng dễ chạy chồng nhau, phải thêm
khóa; một hàng chờ riêng cho đối soát – loại vì trái ADD (6 hàng chờ cố định).

## R3 – Thứ tự ghi trước khi gửi (cửa sổ chết Worker)

**Quyết định**: bước 3 gồm **ba bước tách rời, mỗi bước một giao dịch ngắn đã commit**:

1. (Giao dịch A) `processing`, `phase = none` → ghi `content_hash`, `phase = submitted_awaiting_response`, `submitted_at =
   now()` bằng UPDATE có điều kiện `WHERE phase = 'none'`; commit. Nếu 0 dòng → ai đó đã ghi → rẽ sang đối soát.
2. Gọi `PlatformGateway.submit()` (**ngoài** mọi giao dịch, có `AbortSignal` ≤ thời gian khóa − biên an toàn).
3. (Giao dịch B) ghi kết quả: `published` → `succeeded`; `processing` → `phase = awaiting_processing`; `failed` → theo loại lỗi.

Bảng cửa sổ chết:

| Worker chết khi… | Trạng thái còn lại | Lần chạy lại làm gì |
|---|---|---|
| trước A | `phase = none` | chạy từ bước 1 (chưa gửi, an toàn) |
| sau A, trước/trong `submit` | `submitted_awaiting_response` | **đối soát**, không gửi |
| sau `submit`, trước B | `submitted_awaiting_response` | **đối soát** → thấy bài → `succeeded` |
| sau B | trạng thái mới | tiếp theo trạng thái đó / `finished` thì thoát |

**Lý do**: chỉ cần một điểm nhất quán (A) để bảo đảm "không gửi mù"; A và B ngắn nên không giữ kết nối CSDL khi chờ mạng.

**Đã xét**: ghi A và B trong **một** giao dịch bao quanh `submit` – loại vì giữ kết nối lâu và, nếu hủy giao dịch sau khi
nền tảng đã nhận, làm mất dấu → đăng trùng.

## R4 – Thử lại lỗi "chắc chắn chưa nhận"

**Quyết định**: tối đa **5 lần trong 30 phút** tính từ lần lỗi tạm thời đầu tiên của lượt đó. Giãn cách mặc định (giây):
`60, 180, 360, 600, 600` (cộng dồn 1 + 3 + 6 + 10 + 10 = 30 phút). Hết 5 lần **hoặc** qua 30 phút (cái nào đến trước) →
`needs_user` với lý do `retries_exhausted`. Nếu nền tảng trả `retryAfterSec` lớn hơn giãn cách thì lấy giá trị lớn hơn nhưng
vẫn không vượt cửa sổ 30 phút. Cột: `transient_attempts` (số lần), `transient_window_started_at`. Thử lại bằng
`retryAfter(delay)`; trạng thái `retry_wait`.

**Lý do**: khớp Hiến pháp II và ADR-04; giãn cách tăng dần giảm áp lực lên nền tảng đang quá tải; đặt cấu hình trong bảng
cấu hình hàng chờ (đọc lại mỗi 60 giây) nên chỉnh được không phát hành.

**Đã xét**: backoff mũ thuần – cộng dồn khó đoán trước, không đảm bảo trần 30 phút.

## R5 – Đối soát và đúng-một-lần thử lại

**Quyết định**:

- Vào `unknown` khi: hết thời gian chờ sau khi đã gửi; mã lỗi gốc chưa có trong bảng; lỗi bước 4 không rõ; Worker chết sau
  `submitted_awaiting_response`; chờ xử lý quá trần thời gian.
- Lần đối soát đầu sau **2 phút** kể từ `submitted_at`; nếu `not_found` → đối soát lặp mỗi 2 phút đến mốc **10 phút**.
- Cửa sổ tìm: `[submitted_at − 5 phút, now]`, so `content_hash` (đã chuẩn hóa cùng quy tắc lúc gửi – `contentHash()` của cổng).
- `found` → `succeeded` (ghi "xác nhận nhờ đối soát"); `not_found` sau 10 phút và **`reconcile_retry_used = false`** → đặt
  `reconcile_retry_used = true`, `phase = none`, `retry_wait` và chạy lại từ bước 3 **đúng một lần** (bước 1–2 chạy lại để kiểm
  tra điều kiện); nếu lần này lại rơi vào `unknown` → `needs_check` (không thử tiếp).
- `unsupported` (kênh/quyền không đối soát) → `needs_check` **ngay**, không chờ.
- Cờ `reconcile_retry_used` được đặt bằng UPDATE có điều kiện `WHERE reconcile_retry_used = false` để hai Worker không cùng "thử
  lại một lần".

**Lý do**: đúng ADR-04/FR-020; giữ mốc 2/10 phút là giá trị cấu hình (`publish.reconcile_first_delay_sec`,
`publish.reconcile_give_up_after_sec`) vì còn chờ POC-2.

**Đã xét**: đối soát theo URL bài (không có trước khi gửi); theo văn bản thô (lệch vì nền tảng rút gọn liên kết/chuẩn hóa
Unicode) – loại, dùng `contentHash` đã chuẩn hóa như 005.

## R6 – Ranh giới với 012 và cổng đọc nội dung

**Quyết định**: `publishing` **không** đọc bảng `content`. Nó gọi `ContentPublicApi.getVariantForPublish(postId,
variantId)` → `{ postStatus, variantVersion, text, mediaIds[], approved: boolean }`. Vì `content` hiện là khung rỗng, API này
được thêm vào `content/public-api.ts` như **khoảng trống hợp đồng** (xem `contracts/publishing-public-api.md` mục 4); trong
kiểm thử 013 nó được thay bằng bản giả đặt ở `apps/server/test/support/`. 012 hiện thực nó thật.

Hợp đồng ngược lại (012 → 013) là `PublishingPublicApi` với bốn thao tác giữ đúng tên 012 đã dùng: `schedule`,
`cancel`, `reschedule`, `getStatus` (+ `getStatuses` theo lô cho Lịch).

**Lý do**: khớp FR-022 của 012 và Hiến pháp IV (không đọc bảng chéo module); 013 tự kiểm chứng được mà không chờ 012.

**Đã xét**: 013 đọc thẳng `content.posts` – vi phạm ADR-09/Hiến pháp IV; chờ 012 xong rồi mới làm 013 – kéo dài đường găng và
Meta App Review cần luồng đăng chạy sớm.

## R7 – Quá giờ hẹn 60 phút

**Quyết định**: ở bước 1, **chỉ khi** lượt đăng vào `processing` lần đầu (`scheduled → processing`, `transient_attempts = 0`,
`reconcile_retry_used = false`) so `now() − scheduled_at` (giờ CSDL) với ngưỡng `publish.max_late_sec` (mặc định 3 600). Vượt →
`needs_user` với `needs_reason = 'overdue'`, thông điệp "Bài đã quá giờ hẹn, chưa đăng", hành động "Đăng lại". Không áp dụng
cho lượt thử lại/đối soát (chúng không đi qua điều kiện "vào lần đầu").

Khi người dùng "Đăng lại": `scheduled_at = now()`, nên không còn quá hạn.

**Lý do**: đúng Clarifications 2026-11-16 và FR-009; so bằng giờ CSDL tránh lệch đồng hồ máy.

## R8 – Cập nhật màn hình Tiến trình đăng

**Quyết định**: web **thăm dò** `GET …/publish-progress` mỗi 5 giây khi có lượt chưa kết thúc (`scheduled` trong 10 phút
tới, `processing`, `retry_wait`, `unknown`), tăng dần đến 30 giây sau 5 phút, dừng khi tất cả cuối/`needs_*`; dừng khi tab ẩn.
Dùng `ETag`/`If-None-Match` (băm `version` + `updated_at` của các lượt) để phản hồi 304. Đạt "≤ 15 giây" của SC-011.

**Lý do**: không thêm hạ tầng đẩy (Hiến pháp IX; không SSE/WebSocket ở giai đoạn 1 – kiến trúc nói "Giao diện hỏi định kỳ").

**Đã xét**: SSE – cần giữ kết nối dài qua Ingress và hai bản API; để sau nếu thăm dò thành chi phí.

## R9 – Bộ chuyển đổi Facebook/Instagram

**Quyết định**: viết bằng `fetch` của Node, bọc trong `GraphClient` (cố định phiên bản Graph API ở cấu hình
`META_GRAPH_VERSION`, thời gian chờ qua `AbortSignal`, không ghi mã quyền vào log: mã quyền gắn vào header
`Authorization`, không vào URL). Đặt trong `platform_gateway/internal/adapters/{facebook,instagram}/`, đăng ký ở `registry.ts`.

| Việc | Facebook Page | Instagram (chuyên nghiệp) |
|---|---|---|
| Chữ | `POST /{page-id}/feed` | **không hỗ trợ** → chặn ở bước 1 |
| Một ảnh | `POST /{page-id}/photos` (`url`) | `POST /{ig-id}/media` (`image_url`) → `/media_publish` |
| Nhiều ảnh | tải từng ảnh `published=false` → `/feed` với `attached_media` | từng mục `is_carousel_item` → bản `CAROUSEL` → `/media_publish` |
| Video | `POST /{page-id}/videos` (`file_url`) | `media_type=VIDEO` → chờ `status_code` → `/media_publish` |
| Xử lý | đồng bộ (bước 4 = "không áp dụng") | bất đồng bộ (bước 4 = `checkStatus` định kỳ) |
| Đối soát | đọc `/{page-id}/posts` gần nhất, so `contentHash` | đọc `/{ig-id}/media` gần nhất; **chưa chắc** đọc được → khai báo bằng cờ |

Các chi tiết điểm cuối, trường, giới hạn là **giả định cần kiểm chứng ở POC-2 và khi nộp Meta App Review** (đã có ở
`docs/wiki/open-questions.md`); bộ chuyển đổi chỉ lộ ra giao diện chung nên đổi chi tiết không đổi luồng đăng.
Mã lỗi Graph (`code`/`error_subcode`/HTTP) được chuẩn hóa thành `rawCode` kiểu `FB:190`, `IG:2207026`… rồi qua `classifyError`.

**Lý do**: ít phụ thuộc (không SDK ngoài), dễ giả lập bằng máy chủ giả trong kiểm thử hợp đồng, đúng "bọc sau giao diện nội bộ".

**Đã xét**: SDK Meta chính thức – kéo thêm phụ thuộc và tự giữ phiên bản; để sau nếu lượng lỗi lệch.

## R10 – Cờ chuyển giữa bản thật và giả lập

**Quyết định**: cấu hình môi trường `PLATFORM_ADAPTER_MODE=real|fake` theo kênh (`facebook_page`, `instagram`), mặc định `fake`
ở dev/test, `real` ở production; production **từ chối** `fake` (đã có cơ chế `STAGING_ALLOW_FAKES` ở 007). Kênh chưa có bộ chuyển đổi
thật (Zalo OA, kênh thử) vẫn dùng bản giả lập – không chặn luồng (Assumptions spec).

## R11 – Bảng `error_mappings` và nguồn thông điệp

**Quyết định**: `publishing.error_mappings` (bảng dùng chung) chứa `(channel_type, raw_code) → category, message_vi,
remedies`. Migration nạp các dòng ban đầu từ ADD mục 7 + bảng mặc định trong bộ chuyển đổi; sửa dòng = sửa dữ liệu (không phát
hành). `ErrorMappingService` đọc, cache **trong tiến trình 5 phút** (cấu hình, không phải trạng thái lượt đăng) và gọi
`applyErrorMapping` (có sẵn ở 005) sau `gateway.classifyError`. Thay đổi bảng ghi `audit_log`. Mã không có dòng ⇒ `unknown`.

**Quy tắc an toàn**: một dòng chỉ được đổi sang `transient` bằng thao tác quản trị nội bộ có lý do (vì đây là cách duy nhất để
một mã bị gửi lại); kiểm thử hợp đồng khẳng định mọi mã `transient` mặc định là mã chắc chắn chưa được nền tảng nhận.

## R12 – Thông báo "Bài cần xử lý / cần kiểm tra"

**Quyết định**: dùng sự kiện đã có `publish_needs_action` (`state: needs_user | needs_check`). Mở rộng `refs` bằng hai trường
**tùy chọn** (tương thích ngược): `channelType` (enum) và `reason` (enum ngắn: `token_expired`, `not_professional_account`,
`media_invalid`, `rate_limited_daily`, `plan_expired`, `overdue`, `retries_exhausted`, `uncertain_result`). Không đưa tên bài vào
sự kiện (nguyên tắc dữ liệu tối thiểu); mẫu thông báo lấy tên bài qua `content` ở phía `notifications` (đã có người nhận
`owner`, `post_author`). Phát **trong giao dịch** chuyển sang `needs_*` (nguyên tắc IV). Email gộp 10 phút do `notifications` lo.
Lỗi trong lúc `transient` **không** phát (FR-018).

## R13 – Nhật ký 5 bước: chỉ thêm

**Quyết định**: `publish_steps` ghi **mỗi sự kiện một dòng** (`event = started | finished`), `run_no` tăng theo mỗi lần chạy
lại luồng (thử lại/đối soát/Đăng lại). Bộ đọc gộp theo `(attempt_id, run_no, step_no)` thành dòng thời gian. Bảng phân vùng
tháng (`partitionedLogTable`), giữ 12 tháng, `account_id` đầu chỉ mục, RLS.

**Lý do**: nhật ký "chỉ thêm, không sửa" (FR-012) nên không UPDATE được "đang chạy → xong"; ghi hai dòng là cách duy nhất vẫn
giữ nguyên tính bất biến (`pnpm db:immutable` kiểm).

## R14 – Quét quá hạn, trạng thái kẹt

**Quyết định**: việc định kỳ `publishing.sweep_overdue` (mỗi phút, `scope: 'system'`): (1) đếm lượt `scheduled` có `scheduled_at <
now() − 5 phút` mà chưa vào `processing` → chỉ số + cảnh báo; (2) đếm `unknown`/`needs_check` theo kênh; (3) phát hiện lượt `processing`
mà không còn việc nào hiệu lực (mất việc – không nên xảy ra vì tạo việc trong cùng giao dịch) → ghi cảnh báo, **không tự gửi**.
Không tự "chữa" bằng gửi lại. Bộ quét dùng `systemTx` + `tenant: 'from-context'` cho phần cần đọc từng tài khoản.

## R15 – Điều kiện gói và tài khoản ở bước 1

**Quyết định**: bước 1 gọi `AccountPublicApi.getPublishingEligibility()` (**khoảng trống hợp đồng nhỏ**: trả `{ planActive:
boolean, deletionRequested: boolean }`). Gói hết hạn/yêu cầu xóa → `needs_user` (lý do `plan_expired`) hoặc `cancelled` (khi đang
xóa tài khoản). Cần thêm `account` vào `allowedDeps` của `publishing` (**ADR-12**).

## R16 – Quyền và API cho web

**Quyết định**: bốn điểm cuối (xem `contracts/publishing-http-api.md`): xem Tiến trình đăng (`status.view`), "Đăng lại" và "Đã
đăng" (`post.republish`), đổi giờ do 012 gọi qua giao diện công khai (không có điểm cuối riêng ở 013). Tra cứu hỗ trợ
(`support.lookup`) dùng `supportViewAccount`/`supportSearch` đã có; **không** làm màn hình hỗ trợ (spec).
`accountId` luôn từ phiên; `attemptId` không đủ để vượt tenant vì RLS.

## R17 – Chỉ số và cảnh báo

**Quyết định**: chỉ số OpenTelemetry (xem `contracts/observability.md`): `publish_attempt_transitions_total{channel,from,to}`,
`publish_lag_seconds` (histogram), `publish_overdue_attempts`, `publish_unknown_total`, `publish_needs_check_ratio`,
`publish_channel_error_ratio_15m`, `publish_dead_jobs`. Nhãn **không** chứa `account_id` ở chỉ số tổng hợp (tránh bùng kích thước);
nhật ký có `account_id` và `trace_id`.

## R18 – Chỉ mục duy nhất và việc tạo lại sau hủy

**Quyết định**: chỉ mục duy nhất một phần `(account_id, post_id, connection_id) WHERE status <> 'cancelled'`. Bài "Đã đăng" vẫn
nằm trong chỉ mục nên **không thể tạo lượt thứ hai** cho cặp đó (đúng yêu cầu "không đăng trùng"); muốn đăng lại một bài đã `succeeded`
thì tạo **bài mới** (ngoài phạm vi). Hủy rồi duyệt lại tạo dòng mới (dòng cũ `cancelled` không vi phạm chỉ mục).
