# Hợp đồng HTTP – 012

Tiền tố `/api`. Mọi điểm cuối: cookie phiên `__Host-sid`; `accountId` **không** có trong đường dẫn/tham số/thân (lấy từ phiên); khai báo
`@CustomerAccess(quyền)` (thiếu → 403 `ACCESS_NOT_DECLARED`). Lỗi theo `ErrorResponse` chuẩn (≥ 1 `actions`, tiếng Việt, mã gốc chỉ ở `support`).
Thời gian là ISO 8601 UTC (`2026-11-20T03:00:00Z`); web hiển thị UTC+7. Khuôn Zod đặt ở `packages/shared/src/modules/{content,approval,publishing}`.

## 1. Quyền

| Quyền (đã có ở `PERMISSIONS`) | Thao tác 012 |
|---|---|
| `post.edit` (chủ, cộng tác viên) | tạo, sửa, xóa nháp, gửi duyệt, rút lại, sửa bài đã duyệt |
| `post.approve` (chỉ chủ) | duyệt, trả lại, hủy lịch, xem Chờ duyệt |
| `post.reschedule` (chủ, cộng tác viên) | đổi giờ |
| `status.view` (chủ, cộng tác viên) | Lịch, danh sách, chi tiết, lịch sử |

Không thêm quyền mới. Chỉ **người gửi duyệt** mới rút lại bài của mình (kiểm theo `submitted_by`, ngoài quyền).

## 2. Điểm cuối

### Bài viết (do `content`, trừ ghi chú)

| Phương thức + đường dẫn | Quyền | Thân / tham số | Kết quả |
|---|---|---|---|
| `POST /posts` | `post.edit` | `{ internalName?, sharedText, scheduledAt?, variants[{ connectionId, customized, text, hashtags[], media[] }] }` (≥ 1 kênh hoặc có chữ) | 201 `Post` (nháp, `version = 1`); 409 `NO_ACTIVE_CHANNEL` nếu tài khoản chưa có kênh hoạt động |
| `GET /posts` | `status.view` | `status?`, `q?`, `cursor?`, `limit ≤ 50` | `{ items: PostSummary[], nextCursor }` |
| `GET /posts/:id` | `status.view` | | `Post` đầy đủ + `validation[]` theo kênh + `attempts[]` (trạng thái đăng) |
| `PUT /posts/:id` | `post.edit` | `{ expectedVersion, … như tạo }` | `Post`. **Thực hiện bởi `approval.savePost`** (xem R7); bài đã duyệt → về Chờ duyệt |
| `DELETE /posts/:id` | `post.edit` | `?expectedVersion` | 204; chỉ Nháp (người tạo hoặc chủ). Bài khác → 409 `POST_NOT_EDITABLE` ("Hủy lịch" trước) |
| `GET /posts/:id/history` | `status.view` | | `{ events: PostEvent[] }` |
| `GET /channel-rules` | `status.view` | | `{ rules: ChannelRule[] }` (ít đổi) |
| `GET /calendar` | `status.view` | `from`, `to` (UTC, ≤ 42 ngày) | `{ items: CalendarItem[] }` |

### Gửi duyệt, duyệt, trả lại, lịch (do `approval`)

| Phương thức + đường dẫn | Quyền | Thân | Kết quả |
|---|---|---|---|
| `POST /posts/submit` | `post.edit` | `{ items: [{ postId, expectedVersion, scheduledAt? }] }` ≤ 50 | `BulkResult`; một `submissionId` cho cả lần gửi → **một** thông báo + **một** email |
| `POST /posts/:id/withdraw` | `post.edit` (+ là người gửi) | `{ expectedVersion }` | `Post` (về Nháp) |
| `POST /posts/:id/approve` | `post.approve` | `{ expectedVersion, scheduledAt }` | `Post` (`approved`); lỗi theo mục 3 |
| `POST /approvals/approve-batch` | `post.approve` | `{ items: [{ postId, expectedVersion, scheduledAt? }] }` ≤ 100 | `BulkResult` (từng bài độc lập) |
| `POST /posts/:id/return` | `post.approve` | `{ expectedVersion, note }` (1–500 ký tự) | `Post` (Nháp có `returnedNote`) |
| `POST /approvals/return-batch` | `post.approve` | `{ items: [{ postId, expectedVersion }], note }` ≤ 100 | `BulkResult`; ghi chú chung |
| `POST /posts/:id/unschedule` | `post.approve` | `{ expectedVersion }` | `Post` (về Nháp) |
| `PUT /posts/:id/schedule` | `post.reschedule` | `{ expectedVersion, scheduledAt }` | `Post`; bài chưa duyệt chỉ đặt giờ dự kiến (không đụng lịch) |
| `GET /approvals/pending` | `post.approve` | `cursor?`, `limit ≤ 100` | `{ items: PendingItem[], nextCursor }` sắp theo `scheduledAt` gần nhất; có `timePassed`, `returned`, `editedAfterApproval` |
| `GET /approvals/pending/count` | `post.approve` | | `{ count }` (cho điều hướng) |
| `POST /approvals/suggest-times` | `post.approve` hoặc `post.edit` | `{ count ≤ 100, after? }` | `{ times: ISO[] }` — `count` giờ **khác nhau**, ≥ now()+5', trong "giờ vàng" cấu hình |

## 3. Hình dạng chính

```
Post {
  id, status, source, internalName?, title,            // title = internalName || 60 ký tự đầu
  sharedText, scheduledAt?, version,
  labels: { returned?: { note, byUserId, at }, editedAfterApproval: bool, timePassed: bool },
  createdBy, submittedBy?, approvedBy?, approvedAt?,
  variants: Variant[]                                  // { id, connectionId, channelType, channelStatus, customized, text, hashtags, media, version, issues[] }
}
validation[] / issues[] = { rule, messageVi, remedies[{ action, labelVi }] }   // rule ∈ text_length|hashtags|media_required|media_rule|channel_inactive
BulkResult { approved|submitted: n, failed: m, results: [{ postId, status:'ok'|'failed', error?: ErrorBody }] }
CalendarItem { postId, title, scheduledAt, status, labels, channels:[{ channelType, displayName, attemptStatus? }], movable: bool, movableReason? }
PostEvent { type, actorUserId|actorDisplayName, at, data }    // data: note?, fromAt?, toAt? — không nội dung bài
```

`displayName` của người dùng dựng ở máy chủ qua `AccountPublicApi.describeMembers` (kể cả "Cộng tác viên đã gỡ"). `movable` đọc từ `publishing` (mọi mục còn `scheduled`).

## 4. Mã lỗi mới (thêm vào `ERROR_CODES`, kèm thông điệp ở `vi-error-messages`)

| Mã | HTTP | Khi nào | Hành động khắc phục |
|---|---|---|---|
| `NO_ACTIVE_CHANNEL` | 409 | chưa có kênh hoạt động | "Kết nối kênh" → Kênh kết nối |
| `POST_NOT_EDITABLE` | 409 | cộng tác viên sửa bài Chờ duyệt; xóa bài không phải Nháp | "Rút lại bài" / "Hủy lịch" |
| `POST_ALREADY_APPROVED` | 409 | duyệt lặp / đổi trạng thái đã xảy ra | "Mở bài" |
| `POST_CONTENT_INVALID` | 422 | nội dung vượt giới hạn kênh/thiếu media/bài rỗng; `fieldErrors` theo kênh | "Sửa nội dung" |
| `TIME_IN_PAST` | 422 | giờ < now()+5' (kèm `suggestedAt`) | "Dùng giờ gợi ý" / "Chọn giờ khác" |
| `CHANNEL_INACTIVE` | 409 | kênh ngắt/hết hạn quyền (kèm `connectionId`) | "Kết nối lại" / "Bỏ kênh này khỏi bài" |
| `CHANNEL_QUOTA_EXCEEDED` | 409 | hết hạn mức đăng của kênh ở giờ đó | "Chọn giờ khác" / "Bỏ kênh này khỏi bài" |
| `CHANNEL_ALREADY_PUBLISHING` | 409 | có mục đã/đang đăng khi hủy, đổi giờ, sửa | "Xem tiến trình" |
| `PLAN_EXPIRED` | 403 | gói hết hạn | "Gia hạn gói" |
| `RETURN_NOTE_REQUIRED` | 422 | ghi chú rỗng/quá 500 | "Nhập ghi chú" |
| `BULK_LIMIT_EXCEEDED` | 422 | > giới hạn mỗi lần (50 gửi duyệt, 100 duyệt/trả lại) | "Chia nhỏ lựa chọn" |
| `VERSION_CONFLICT` (đã có) | 409 | lệch `expectedVersion`; thân kèm `Post` mới nhất | "Xem bản mới" |

Lỗi kiểm tra theo kênh gộp thành **một** phản hồi `409/422` có `channelIssues[{ connectionId, code, remedies }]` — để giao diện hiện đủ mọi kênh vướng
cùng lúc (tất cả hoặc không).

## 5. Nguyên tắc chung

- Idempotent: gọi lặp `approve/return/unschedule` trên bài đã ở trạng thái đích với cùng phiên bản đã dùng → `POST_ALREADY_APPROVED` (hoặc kết quả tương đương), **không** tạo mục/việc/thông báo thứ hai.
- Không điểm cuối nào trả số tiền, mã quyền nền tảng, mã lỗi gốc của nền tảng ngoài `support.detail`.
- Giới hạn tốc độ theo tài khoản của 004 áp dụng; duyệt hàng loạt tính một yêu cầu.
- Truy cập chéo: `:id` của tài khoản khác → 404 `NOT_FOUND` (RLS), không phân biệt "không tồn tại".
