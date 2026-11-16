# Hợp đồng: điểm cuối HTTP cho giao diện web (Tiến trình đăng)

Mọi điểm cuối: khai báo `@CustomerAccess(<quyền>)` (mặc định từ chối — 004); `accountId` lấy từ phiên, **không** từ path/query/body;
phản hồi dùng danh sách trường cho phép (không `select *`); lỗi theo `error-response` chung, thông điệp tiếng Việt. Kiểu dùng
chung đặt ở `packages/shared/src/modules/publishing/`.

| Phương thức & đường dẫn | Quyền | Mô tả |
|---|---|---|
| `GET /api/posts/{postId}/publish-progress` | `status.view` | Tiến trình đăng của bài theo từng kênh |
| `POST /api/publish-attempts/{attemptId}/republish` | `post.republish` | "Đăng lại" một kênh |
| `POST /api/publish-attempts/{attemptId}/mark-published` | `post.republish` | "Đã đăng" (chỉ từ `needs_check`) |
| `GET /api/publish-attempts/{attemptId}/support-details` | `status.view` | Nội dung vùng "Chi tiết cho hỗ trợ" |

Đổi giờ/hủy do 012 gọi `PublishingPublicApi` nên không có điểm cuối riêng ở đây.

## 1. `GET /api/posts/{postId}/publish-progress`

Hỗ trợ `If-None-Match` (ETag = băm các `version` + `updated_at` của lượt) → `304`.

```jsonc
{
  "postId": "…",
  "overall": "needs_action",                    // scheduled | publishing | published | needs_action | cancelled
  "channels": [{
    "attemptId": "…", "channelType": "facebook_page", "channelName": "Cửa hàng Hoa Mai",
    "status": "needs_action",                    // 5 giá trị hiển thị (FR-027)
    "needsKind": "needs_user",                   // chỉ khi needs_action: "needs_user" | "needs_check"
    "scheduledAt": "2026-11-20T02:00:00Z",       // UTC; web hiển thị UTC+7
    "permalink": null,
    "message": { "text": "Kết nối Facebook đã hết hạn.", "remedies": [{ "action": "reconnect", "labelVi": "Kết nối lại" }] },
    "allowedActions": ["reconnect", "republish", "contact_support"],   // đã lọc theo quyền & trạng thái
    "steps": [
      { "no": 1, "key": "precheck", "state": "failed", "startedAt": "…", "endedAt": "…", "messageVi": "…", "remedies": [ … ] },
      { "no": 2, "key": "prepare_media", "state": "not_run" },
      { "no": 3, "key": "submit", "state": "not_run" },
      { "no": 4, "key": "await_processing", "state": "not_run" },
      { "no": 5, "key": "confirm", "state": "not_run" }
    ]
  }]
}
```

Quy tắc phản hồi:

- `state` bước: `not_run | running | succeeded | failed | skipped | not_applicable`.
- `status` hiển thị gộp `processing/retry_wait/unknown → publishing`. **Người dùng không bao giờ thấy** `retry_wait`/`unknown`.
- `allowedActions` ∈ `republish` (khi `needs_user`/`needs_check`), `mark_published` (khi `needs_check`), `reconnect` (khi lỗi do quyền
  **và** người gọi là chủ; cộng tác viên nhận `ask_owner_to_reconnect`), `change_time` (khi lỗi hạn mức/quá giờ), `contact_support`.
  Kênh `published` **không** có `republish`.
- **Không** có trong phản hồi: mã quyền, `content_hash`, phản hồi thô của nền tảng, `account_id`. Mã lỗi gốc chỉ ở `support-details`.
- Người của tài khoản khác hoặc thiếu quyền → `404`/`403` không lộ sự tồn tại (US5-8).

## 2. `POST /api/publish-attempts/{attemptId}/republish`

Body: `{ "version": <int> }` (khóa lạc quan; lệch → `409 VERSION_CONFLICT`).

- Điều kiện: lượt `needs_user` hoặc `needs_check`, người gọi có `post.republish`.
- Hiệu ứng (một giao dịch): `status → scheduled`, `scheduled_at = now()`, `phase = none`, `content_hash/submitted_at` xóa,
  `needs_reason` xóa, `run_no += 1`, `enqueue(execute_attempt)` với khóa `publish:{id}`; ghi `audit_log`
  `publish.republish` (người thao tác, trạng thái trước, lý do cũ). Từ `needs_check`, phản hồi kèm `warning: "possible_duplicate"`.
- Lỗi: `409 NOT_REPUBLISHABLE` ("Bài đang được đăng" / "Kênh này đã đăng xong") — kể cả kênh `succeeded` (FR-006).

## 3. `POST /api/publish-attempts/{attemptId}/mark-published`

Body: `{ "version": <int>, "permalink"?: string<=2048 }`.

- Điều kiện: lượt `needs_check`. Hiệu ứng: `status → succeeded`, `confirmed_by = 'user'`, `permalink` nếu có (kiểm là URL `https`), `phase = finished`;
  **không** gọi nền tảng; ghi `audit_log` `publish.mark_published`.

## 4. `GET /api/publish-attempts/{attemptId}/support-details`

Trả `{ attemptId, channelType, rawCode, errorCategoryLabel, traceId, runNo, updatedAt }` — **không** mã quyền, không nội dung bài.
Đội hỗ trợ dùng đường `support.lookup` (`supportViewAccount`, có ghi kiểm toán) để xem trạng thái nội bộ đầy đủ (kể cả
`retry_wait`/`unknown`); đường này không thuộc API khách.

## 5. Mã lỗi nghiệp vụ mới (bổ sung `vi-error-messages.ts`)

| Mã | HTTP | Thông điệp |
|---|---|---|
| `PUBLISH_NOT_REPUBLISHABLE` | 409 | "Bài đang được đăng hoặc đã đăng, không thể đăng lại." |
| `PUBLISH_NOT_CHECKABLE` | 409 | "Chỉ xác nhận "Đã đăng" cho bài đang cần kiểm tra." |
| `PUBLISH_VERSION_CONFLICT` | 409 | "Bài vừa có thay đổi. Hãy tải lại rồi thử lại." |
| `PUBLISH_ATTEMPT_NOT_FOUND` | 404 | "Không tìm thấy lượt đăng." |

## 6. Kiểm thử hợp đồng

- Hai yêu cầu `republish` đồng thời → đúng một thành công, một `409`; chỉ một việc được tạo.
- Cộng tác viên thấy `ask_owner_to_reconnect`, không có `reconnect`.
- Quét tự động: chuỗi quyền truy cập mẫu không xuất hiện trong bất kỳ phản hồi nào (SC-008).
