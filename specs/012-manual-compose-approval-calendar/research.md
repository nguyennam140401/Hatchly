# Research – 012 Soạn bài tay, duyệt, lên lịch, Lịch và Chờ duyệt

Mỗi mục: **Quyết định** · **Lý do** · **Phương án đã xét**. Không còn NEEDS CLARIFICATION.

## R1. Ai làm gì giữa `content`, `approval`, `publishing`

**Quyết định**
- `content` (schema `content`): sở hữu `posts`, `channel_variants`, `post_events`, `channel_rules`. Làm: tạo nháp, đọc, danh
  sách, xóa nháp, kiểm tra nội dung theo kênh, ghi sự kiện, phục vụ `GET /calendar` và danh sách.
- `publishing` (schema `publishing`): sở hữu `publish_attempts`. Làm trong 012: **lên lịch** (tạo mục + tạo việc), **hủy**,
  **đổi giờ**, **đọc trạng thái**, đếm hạn mức kênh cục bộ. Thực thi 5 bước = 013.
- `approval` (schema `approval` để trống): **điều phối**. Mọi thao tác *đổi trạng thái bài hoặc đụng tới lịch* — gửi duyệt,
  rút lại, duyệt, trả lại, hủy lịch, đổi giờ, và **lưu bài khi bài không còn là Nháp** — chạy ở đây trong một giao dịch gọi
  `content` + `publishing` + `notifications`.

**Lý do**: tệp kê khai đã có `approval → content, publishing, notifications, queue`; `publishing → content`. Nếu `content`
tự xử lý duyệt thì phải gọi `publishing` (ngược chiều, tạo vòng). ADD §6 ghi "Duyệt & lịch: thao tác duyệt và xếp lịch,
chỉ chạy ở API" — đúng vai điều phối. Schema `approval` giữ trống, không cần "đặc tả mới" về bảng.

**Đã xét**: (a) `content` làm hết, gọi `publishing` qua cổng đảo phụ thuộc → thêm cơ chế chỉ để tránh một mũi tên;
(b) đặt `publish_attempts` ở `approval` → ngược ADD §4; (c) mở khóa schema `approval` cho `post_events` → thêm bảng vào
schema dành sẵn mà lịch sử bài là dữ liệu của bài, nên `content` hợp hơn.

## R2. Giao diện công khai nhận `tx`, một giao dịch xuyên module

**Quyết định**: hàm của `content` và `publishing` mà `approval` ghép trong một thao tác có chữ ký `fn(tx: Db, …)`, giống
`notifications.emit(tx, …)`. `approval` mở **một** `tenantTx`, truyền `tx` xuống, rồi phát thông báo cũng bằng `tx`.
Không module nào đọc/ghi bảng của module khác; `tx` chỉ là phương tiện chung của giao dịch.

**Lý do**: Hiến pháp II + IV — "duyệt bài, tạo lượt đăng và tạo việc MUST nằm trong cùng một giao dịch" và "module chỉ gọi
nhau qua giao diện công khai". Mẫu `tx` đã được 005 chấp nhận.

**Sửa tệp kê khai**: thêm `content → platform_gateway` (đọc danh sách kênh hoạt động, `mediaRules`, `validateMedia`). Thêm
`publishing → account`? Không cần: kiểm tra gói còn hạn chạy ở `approval` (đã có `account`).

**Quy tắc ranh giới mới**: không. Kiểm tra `pnpm check:boundaries` sinh từ tệp kê khai.

**Đã xét**: sự kiện nội bộ qua hàng chờ giữa module → mất tính nguyên tử "tất cả hoặc không".

## R3. Vòng đời trạng thái và cột

**Quyết định**: `posts.status` ∈ `draft | pending_review | approved | cancelled`. "Đã lên lịch" = `approved`. Nhãn phụ không
phải trạng thái: `returned_note` (có ghi chú = "Bị trả lại", xóa khi gửi duyệt lại), `edited_after_approval` (đặt khi sửa sau
duyệt, xóa khi duyệt lại). "Giờ đã qua" **tính khi đọc** (`scheduled_at < now() + min_lead`), không lưu. Bảng chuyển:

| Từ → Đến | Ai | Điều kiện (WHERE) | Hệ quả cùng giao dịch |
|---|---|---|---|
| `draft` → `pending_review` | `post.edit` | `version`, hợp lệ, không rỗng | sự kiện `submitted`, thông báo `post_pending_review` |
| `pending_review` → `draft` (rút lại) | người gửi, `post.edit` | `version`, `submitted_by = actor` | sự kiện `withdrawn` |
| `draft`/`pending_review` → `approved` | `post.approve` | `version`, hợp lệ, `scheduled_at ≥ now()+5'` | tạo mục + việc, sự kiện `approved` |
| `pending_review` → `draft` (trả lại) | `post.approve` | `version`, ghi chú 1–500 | sự kiện `returned`, thông báo `post_returned` |
| `approved` → `pending_review` (sửa nội dung) | `post.edit` | mọi mục còn `scheduled` | hủy mục + việc, sự kiện `edited_after_approval`, thông báo `post_pending_review` |
| `approved` → `draft` (hủy lịch) | `post.approve` | mọi mục còn `scheduled` | hủy mục + việc, sự kiện `unscheduled` |
| `approved` → `approved` (đổi giờ) | `post.reschedule` | mọi mục còn `scheduled`, giờ mới hợp lệ | đổi giờ mục + việc, sự kiện `rescheduled`, cộng tác viên → thông báo `approved_post_rescheduled` |

Mọi chuyển trạng thái là `UPDATE … WHERE id = :id AND version = :v AND status = :kỳ_vọng RETURNING`; 0 dòng → tra lại để
phân biệt `VERSION_CONFLICT`, `POST_ALREADY_APPROVED`, `POST_NOT_EDITABLE`, `POST_NOT_FOUND`.

**Chủ tự soạn không qua "Gửi duyệt"** (US4-3): `draft → approved` trực tiếp. **`cancelled`**: 012 không đưa bài vào (xem plan,
"Điều chỉnh"). **Chủ sửa bài Chờ duyệt**: được (chủ sửa mọi bài, FR-021) và bài **giữ** Chờ duyệt; chỉ cộng tác viên bị chặn
(FR-015). Mỗi lần lưu tăng `version` nên người đang duyệt trên bản cũ nhận `VERSION_CONFLICT`.

## R4. Duyệt idempotent và chống duyệt nhầm bản

**Quyết định**: yêu cầu duyệt mang `expectedVersion` (bản người duyệt đã xem). Trong giao dịch:
1. `UPDATE content.posts SET status='approved', version=version+1, approved_by, approved_at, scheduled_at=:t, edited_after_approval=false, returned_note=NULL WHERE id=:id AND version=:v AND status IN ('draft','pending_review')`.
2. 1 dòng → `publishing.schedule(tx, …)`: `INSERT … ON CONFLICT DO NOTHING` cho từng kênh + `enqueue` việc (`dedupeKey publish:{attemptId}`, `runAfter = scheduled_at`).
3. 0 dòng → đọc lại: đã `approved` với **đúng phiên bản + giờ** do yêu cầu trước → trả `POST_ALREADY_APPROVED` (không tạo thêm); lệch phiên bản → `VERSION_CONFLICT` kèm nội dung mới.

Bấm đúp/2 tab: một yêu cầu thắng ở bước 1, yêu cầu kia thấy 0 dòng. Chỉ mục duy nhất của `publish_attempts` là chốt chặn cuối.

**Lý do**: Hiến pháp II, FR-010, FR-012, SC-003. Không cần khóa khuyến nghị toàn cục; cập nhật có điều kiện là đủ.

## R5. Kiểm tra điều kiện lên lịch, hạn mức kênh

**Quyết định**: kiểm tra theo **cả bài** (FR-011), chia hai pha:
- **Trước giao dịch** (có thể gọi ngoài): `platformGateway.checkAccount(connectionId)` cho từng kênh để lấy `status` kênh và
  `quotaRemaining` (nếu `capabilities.reportsQuota`). Không gọi nền tảng bên trong giao dịch.
- **Trong giao dịch**: (1) kiểm tra cục bộ nội dung từng kênh theo `channel_rules` + `mediaRules`; (2) giờ ≥ now()+5';
  (3) gói còn hạn (`AccountPublicApi`); (4) **đếm cục bộ** số mục đang hiệu lực của kênh trong cửa sổ 24 giờ quanh giờ đăng
  (`max_posts_per_24h` của `channel_rules`, vd Instagram), dưới `pg_advisory_xact_lock(hashtext('publish_quota:'||connection_id))`
  để hai lần duyệt đồng thời không cùng vượt; (5) `quotaRemaining` của nền tảng nếu có (Zalo OA theo gói).

Lỗi trả theo từng kênh (`channelIssues[]`) + hành động: `choose_other_time`, `remove_channel`, `reconnect`.

**Lý do**: hạn mức là *cổng chặn sớm*, quyết định cuối vẫn ở "kiểm tra trước" của 013 (FR-011 "khi nền tảng cho biết"). Cửa sổ 24 giờ
trượt tính theo `scheduled_at`, không theo giờ đăng thật (013 chưa có).

**Đã xét**: gọi nền tảng trong giao dịch → giữ khóa chờ mạng; cache `quotaRemaining` → cấm cache hạn mức.

## R6. Duyệt / trả lại hàng loạt

**Quyết định**: `POST /approvals/approve-batch` nhận ≤ 100 `items[{postId, expectedVersion, scheduledAt?}]`; máy chủ chạy **tuần tự**,
mỗi bài một `tenantTx` riêng (gồm cả `checkAccount` cache trong yêu cầu theo `connectionId` để 50 bài cùng kênh chỉ gọi một lần),
trả `results[{postId, status:'approved'|'failed', error?, remedies[]}]` + tóm tắt `approved/failed`. Cùng cách cho trả lại.
Không "hoàn tác cả lô" khi có bài lỗi.

Đạt 50 bài ≤ 10 giây: ≈ 100 ms/bài (một giao dịch ngắn, `checkAccount` gộp theo kênh). Nếu đo lệch, tăng song song **theo kênh**
nhưng không song song cùng một bài.

**Dời tất cả bài quá giờ về giờ gợi ý**: web gọi `POST /approvals/suggest-times {count}` lấy `count` giờ **khác nhau** rồi gửi
`scheduledAt` riêng từng bài trong `items` — máy chủ không tự dời khi yêu cầu không có `scheduledAt` cho bài quá giờ
(trả `TIME_IN_PAST` cho bài đó, đúng "không tự dời âm thầm").

**Giới hạn 100** là hằng chia sẻ `BULK_LIMIT`; vượt → `VALIDATION_FAILED`.

## R7. Sửa bài đã duyệt

**Quyết định**: `PUT /posts/:id` đi vào `approval.savePost`. Trong một giao dịch: đọc bài → chọn nhánh theo trạng thái:
`draft` → `content.saveDraft`; `pending_review` → chặn cộng tác viên (`POST_NOT_EDITABLE`), chủ lưu giữ nguyên trạng thái;
`approved` → `content.applyEdit` (đặt `pending_review`, `edited_after_approval = true`, tăng `version`) + `publishing.cancelByPost(tx, postId)`
(mục `scheduled` → `cancelled`, huỷ việc bằng `cancelJob` cùng `tx`) + sự kiện + thông báo `post_pending_review` (`submissionId` mới).
Nếu có mục đã `processing/succeeded/…`: kênh đó **không sửa được** (`CHANNEL_ALREADY_PUBLISHING`), phần còn lại theo FR-021.

**Phát hiện "sửa nội dung" vs "đổi giờ"**: so chữ, hashtag, danh sách media, tập kênh của yêu cầu với bản hiện có (băm có tiền tố
cố định, tính ở `content`); chỉ đổi `scheduled_at` đi đường `reschedule`, không đi `savePost`. Gửi cả hai cùng lúc → tách thành
hai bước hoặc từ chối `VALIDATION_FAILED` (giao diện luôn tách).

## R8. Thông báo: dùng danh mục 005, không loại mới

- `post_pending_review` (chủ; in-app + một email `immediate` theo khóa chống trùng từ `submissionId`) — gửi duyệt nhiều bài =
  **một** sự kiện với `postIds ≤ 50`; nếu gửi > 50 bài thì chia nhóm 50 cùng `submissionId` cha → chỉ khóa theo `submissionId`
  của từng nhóm: chấp nhận một email/nhóm (ghi chú SC-007 cho ≤ 50 bài).
- `post_returned` (người gửi duyệt — `authorUserId` lấy từ `posts.submitted_by`; in-app, không email).
- `approved_post_rescheduled` (chủ; chỉ khi người đổi là cộng tác viên; in-app).
- Tham số hiển thị: `postTitle ≤ 60` (không nội dung đầy đủ), không số tiền.

**Sửa sau duyệt** dùng `post_pending_review` (FR-028d). Không loại mới → không đổi `NOTIFICATION_TYPES` ở `packages/shared`.

## R9. Lịch và danh sách

- `GET /calendar?from&to`: bài có `scheduled_at` trong khoảng `[from, to)` (UTC), mọi trạng thái trừ xóa mềm; chỉ trả trường thẻ
  (id, tiêu đề, `scheduled_at`, trạng thái, nhãn, kênh) + trạng thái đăng từ `publishing.statusesByPosts(postIds)`. Giới hạn khoảng ≤ 42 ngày.
- Chỉ mục `(account_id, scheduled_at) WHERE deleted_at IS NULL` và `(account_id, status, scheduled_at)`.
- Ranh giới ngày theo UTC+7 do **web** tính rồi gửi `from/to` UTC; máy chủ không đổi múi giờ (trừ gợi ý giờ).
- Danh sách: phân trang theo con trỏ `(created_at, id)`; tìm theo từ khóa bằng `ILIKE` trên `shared_text` + `internal_name` (đủ cho quy mô
  này; không thêm chỉ mục toàn văn — xem lại khi > 5.000 bài/tài khoản).
- **Không cache** trạng thái đăng/lịch; web theo quy tắc làm mới của 011.

## R10. Bộ thực thi tạm của `publishing.run_attempt`

**Quyết định**: khai báo loại việc ở `publishing/jobs.ts` (hàng chờ `publish`, tenant, payload `{ attemptId }`, `allowGenericRetry:false`).
Bộ xử lý trong 012:
- `PUBLISH_EXECUTOR=fake` (dev/test/staging): đọc mục; nếu `scheduled` → chuyển `processing` có điều kiện → gọi bộ chuyển đổi giả lập 005
  `submit` → ghi `succeeded` hoặc `needs_user` (theo kịch bản) — chỉ để kiểm chứng đầu–cuối Lịch/Trạng thái.
- Mặc định (production, hoặc không đặt biến): **không đổi trạng thái**, trả `RetryAfter` 15 phút — việc không mất, mục vẫn `scheduled`.
- Mục `cancelled`/đã rời `scheduled` → bỏ qua (an toàn khi chạy lại).
013 thay thân hàm bằng bộ thực thi thật **không đổi** tên loại việc, payload, `dedupeKey`.

`production` từ chối `PUBLISH_EXECUTOR=fake` như các cổng giả lập khác (cùng cơ chế `STAGING_ALLOW_FAKES`).

**Đã xét**: không đăng ký bộ xử lý → loại việc lạ (008 R22); đặt `concurrency` hàng chờ về 0 → CHECK của `queue_settings` ≥ 1.

## R11. Giao diện: kéo thả, soạn, xem trước

- **Kéo thả** bằng sự kiện gốc (HTML5 drag & drop + trợ giúp con trỏ cảm ứng); luôn có nút "Đổi giờ" mở hộp chọn ngày giờ — đường chính cho điện thoại và bàn phím (FR-024, FR-027).
- **Soạn**: nền biểu mẫu 011 (chặn mất dữ liệu FR-017, khóa phiên bản FR-018, chỉ-xem theo quyền FR-019). Nội dung chung → bản riêng từng kênh bằng cờ `customized` trên `channel_variants`: tab chưa sửa hiển thị nội dung chung (không sao chép), sửa riêng mới ghi `text` (US1-2).
- **Xem trước** là thành phần thuần hiển thị theo `channelType` (đoạn văn, hashtag, ô media), không gọi nền tảng.
- **Kiểm tra theo kênh** dùng cùng khuôn Zod ở `packages/shared` (FR-014 của 011) + `GET /channel-rules` (ít đổi; làm mới khi vào màn hình).
- **Trạng thái** dùng bảng quy đổi duy nhất của 011 (FR-005); 012 chỉ bổ sung các khóa `draft`, `pending_review`, `approved`, nhãn `returned`, `edited_after_approval`, `time_passed`.
- Danh mục thành phần/trang mới nằm trong thư mục `features/{posts,approvals,calendar}`; không thêm thư viện lịch.

## R12. Thuật ngữ mới và nhật ký kiểm toán

Thuật ngữ (thêm vào `architecture.md` mục 11 khi implement):
`bài` → `post`; `phiên bản kênh` → `channel_variant`; `sự kiện bài` → `post_event`; `giới hạn kênh` → `channel_rules`; `mục lịch đăng`
→ `publish_attempt` (đã có `luot_dang`); `gửi duyệt` → `submit`; `lần gửi duyệt` → `submission` (`submissionId`); `rút lại` → `withdraw`;
`trả lại` → `return`; `hủy lịch` → `unschedule`; `đổi giờ` → `reschedule`; `giờ gợi ý` → `suggested time`; `giờ đã qua` → `time_passed`;
`nguồn tạo` → `source` (`manual`|`ai`); `tên gợi nhớ` → `internal_name`.

**Kiểm toán** (`infra.audit_log`, metadata chỉ mã, không nội dung): `post.submit`, `post.withdraw`, `post.approve`, `post.return`,
`post.unschedule`, `post.reschedule`, `post.edit_after_approval`, `post.delete_draft`. Mỗi hành động ghi người, `post_id`, phiên bản trước–sau, `trace_id`.
