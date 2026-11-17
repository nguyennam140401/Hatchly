# Hợp đồng HTTP – module `media` (Thư viện media)

Lược đồ Zod đặt ở `packages/shared/src/modules/media/` (lối vào `@app/shared/media`), dùng chung cho máy chủ (`@ValidBody`,
`@ValidQuery`, `@ValidParam`) và web (`safeParse` phản hồi). Lỗi theo `ErrorResponse` chuẩn (`@app/shared/core`) với `code`,
thông điệp tiếng Việt đời thường và **ít nhất một** hành động khắc phục; mã lỗi gốc chỉ ở "Chi tiết cho hỗ trợ". Mọi điểm cuối
là **khách hàng** (`@CustomerAccess(...)`); không điểm cuối nào nhận mã tài khoản; trường lạ trong thân bị từ chối
(`z.strictObject`). Thời gian là chuỗi ISO 8601 UTC. Tiền tố chung `/api/v1`.

**Quyền** (danh mục `PERMISSIONS`, R12): `media.view` (chủ, cộng tác viên), `media.upload` (chủ, cộng tác viên), `media.delete` (chủ: mọi tệp;
cộng tác viên: tệp mình tải — kiểm ở dịch vụ theo `uploaded_by_user_id`). Hỗ trợ/quản trị nội bộ: `false` cả ba.

**Không có điểm cuối nào trả đường dẫn loại `public`** (FR-017). Mọi URL trong phản hồi là loại `preview`, hạn ≤ 1 giờ, chỉ cho media của tài khoản trong phiên.
URL ký sẵn (kể cả `part-urls`) là bí mật tạm thời: web không lưu, máy chủ không ghi nhật ký (FR-023).

## Kiểu dùng chung

```ts
MediaKind = 'image' | 'video'
MediaStatus = 'processing' | 'ready' | 'unprocessable'          // 'uploading' không bao giờ có trong lưới
MediaItem = {
  id: string; kind: MediaKind; displayName: string; status: MediaStatus;
  originalBytes: number; width: number | null; height: number | null; durationMs: number | null;
  createdAt: string; uploadedBy: { userId: string; displayName: string | null };   // 'Thành viên đã rời' khi null
  thumbUrl: string | null;      // preview ≤ 1 giờ; null khi chưa ready
  failure: { code: string; title: string; action: string } | null,                 // khi unprocessable
  canDelete: boolean;           // theo vai trò + người tải (web chỉ dùng để ẩn/hiện nút; API vẫn kiểm)
}
Quota = { usedBytes: number; reservedBytes: number; limitBytes: number;
          percent: number; state: 'ok' | 'near_full' | 'full' }                    // percent = floor((used + reserved) / limit × 100); near_full ≥ 80%; full khi used + reserved ≥ limit
UploadState = 'open' | 'completing' | 'completed' | 'cancelled' | 'expired' | 'failed' | 'duplicate'
MediaUsage = { postId: string; postTitle: string; postStatus: PostStatus; href: string }  // href dựng ở web từ postId; máy chủ không trả liên kết
```

## 1. `GET /media/quota` — `media.view`

200: `Quota`. Số lấy trực tiếp từ `media.storage_quotas` (không cache). Chưa có dòng ⇒ `used=0, reserved=0, limit=5×1024³`.

## 2. `POST /media/uploads` — `media.upload` (bắt đầu hoặc nhận lại phiên)

Thân: `{ fileName: string(1..255), sizeBytes: int>0, contentType: AllowedContentType, fingerprint: /^[0-9a-f]{64}$/, }`.

Máy chủ kiểm **trước** khi cấp quyền tải: loại thuộc `MEDIA_ACCEPTED`, ảnh ≤ 20 MiB, video ≤ 500 MiB, `UploadGate` cho phép, còn dung lượng
(giữ chỗ bằng UPDATE có điều kiện, cùng giao dịch tạo `media` + `upload_sessions`).

| Kết quả | HTTP | Thân |
|---|---|---|
| Phiên mới, `single` | 201 | `{ uploadId, mediaId, resumed: false, mode: 'single', expiresAt, post: { url, fields, expiresAt } }` |
| Phiên mới, `multipart` | 201 | `{ uploadId, mediaId, resumed: false, mode: 'multipart', partSizeBytes, partCount, completedParts: [], expiresAt }` |
| Nhận lại phiên đang mở (cùng người + `fingerprint`) | 200 | như trên nhưng `resumed: true`, `completedParts: number[]` (từ `listParts` của kho) |
| Phiên cũ đã hết hạn | 201 | phiên mới + `previousExpired: true` ⇒ web hiện "Lần tải trước đã hết hạn, đang tải lại từ đầu" |
| Tên/loại không hợp lệ | 400 | `VALIDATION_FAILED` + `fieldErrors` |
| Loại không nhận | 400 | `MEDIA_TYPE_UNSUPPORTED` "Loại tệp này chưa được hỗ trợ. Dùng ảnh JPEG, PNG, WebP, HEIC hoặc video MP4, MOV." — hành động `fix_input` |
| Quá cỡ | 400 | `MEDIA_TOO_LARGE` "Ảnh tối đa 20 MB – hãy giảm kích thước rồi tải lại." / "Video tối đa 500 MB." (+ `{ maxBytes }`) |
| Hết chỗ | 409 | `MEDIA_QUOTA_EXCEEDED` "Thư viện đã đầy (4,9/5 GB). Hãy xóa bớt ảnh/video cũ rồi tải lại." + `{ quota: Quota }`, hành động `navigate` "Xem danh sách để xóa" |
| Gói hết hạn | 403 | `MEDIA_PLAN_EXPIRED` "Gói của bạn đã hết hạn nên chưa tải thêm được. Bạn vẫn xem và xóa được ảnh/video." — hành động `navigate` "Gia hạn gói" |
| Thiếu quyền (hỗ trợ/quản trị) | 403 | `FORBIDDEN` |

`mediaId` được trả để web biết khóa lưu của phiên; **không** dùng để đọc tệp trước khi `ready`.

## 3. `POST /media/uploads/:uploadId/part-urls` — `media.upload` (chỉ `multipart`)

Thân: `{ partNumbers: int[1..partCount] (1–20 phần) }` → 200 `{ parts: { partNumber, url, contentLength, expiresAt }[] }`.
Mỗi URL hết hạn ≤ 15 phút; hết hạn giữa chừng thì web gọi lại (FR-006). Phần đã lên (theo `listParts`) vẫn được cấp URL mới (ghi đè cùng số phần là hợp lệ).
`uploadId` của tài khoản/người khác hoặc phiên không `open` ⇒ 404 `NOT_FOUND` (không phân biệt). Cập nhật `last_activity_at`/`expires_at`.

## 4. `POST /media/uploads/:uploadId/complete` — `media.upload` (idempotent)

Không thân. Máy chủ: ghép multipart từ `listParts` (không cần ETag từ trình duyệt), `stat`, so dung lượng với `declared_bytes`, dò nội dung (R8) khớp loại
khai báo, **chốt** dung lượng, đặt `processing`, tạo việc `media.process` — một giao dịch.

| Kết quả | HTTP | Thân |
|---|---|---|
| Đạt (hoặc gọi lặp sau khi đã đạt) | 202 | `{ uploadId, mediaId, state: 'completed' }` |
| Kho chưa đủ phần / chưa có tệp | 409 | `UPLOAD_INCOMPLETE` "Tệp chưa lên đủ. Hãy thử tải lại." (phiên vẫn `open`, tiếp tục được) |
| Dung lượng lệch / loại thật không khớp / loại không nhận / ảnh động | 422 | `UPLOAD_REJECTED` + `failureCode ∈ size_mismatch | type_mismatch | type_unsupported | animated`; phiên `failed`, giữ chỗ **đã trả**, tệp dở đã xóa; thông điệp kèm cách khắc phục ("Tệp bị lỗi khi tải – tải lại") |
| Phiên đã hết hạn/hủy/không có | 404 | `NOT_FOUND` |

## 5. `GET /media/uploads/:uploadId` — `media.upload`

Dùng để hỏi tiến trình sau khi tải xong (web hỏi mỗi 2 giây, giãn dần tới 10 giây) và để nhận biết kết quả trùng.

200: `{ uploadId, state: UploadState, mediaId, mediaStatus: 'uploading' | MediaStatus | null, duplicateOf: { mediaId, displayName } | null, failureCode: string | null, completedParts?: number[], expiresAt }`.
Trạng thái `duplicate` ⇒ web hiện "Tệp này đã có trong thư viện" kèm liên kết tới `duplicateOf`. Phiên của người khác ⇒ 404.

## 6. `DELETE /media/uploads/:uploadId` — `media.upload`

Hủy một lần tải đang mở: hủy multipart, xóa tệp dở, **trả giữ chỗ**, xóa dòng `uploading`. 204; phiên đã đóng ⇒ 204 (không tác dụng).

## 7. `GET /media` — `media.view`

Truy vấn: `kind?: 'image'|'video'`, `from?`, `to?` (ngày tải, ISO, theo UTC+7 do web đổi), `q?: string(≤100)`, `cursor?: string`, `limit?: 1..60` (mặc định 40).

200: `{ items: MediaItem[], nextCursor: string | null, quota: Quota }`. Mới nhất trước; `q` so khớp `display_name` không phân biệt hoa/thường và dấu cách chuẩn hóa. Chỉ
media của tài khoản trong phiên; `uploading` và đã xóa mềm không có mặt. `quota` kèm theo để thanh dung lượng không cần gọi riêng.

## 8. `GET /media/:mediaId` — `media.view`

200: `MediaItem` + `{ previewUrl: string | null (ảnh: bản chuẩn hóa; video: tệp gốc, ≤ 1 giờ), mimeType, uploadedAtLabel? }`. Không tồn tại / đã xóa mềm / tài khoản khác ⇒ 404 "Tệp này không còn trong thư viện." (không phân biệt).

## 9. `GET /media/:mediaId/usages` — `media.view`

200: `{ usages: MediaUsage[], blocking: boolean }` — `blocking = true` khi có bài `approved`/`scheduled`. Đi qua `MediaUsageProvider` (R10); chỉ trả bài của chính tài khoản.
Dùng để dựng hộp xác nhận xóa; **không** thay thế việc kiểm lại lúc xóa.

## 10. `DELETE /media/:mediaId` — `media.delete`

Tham số truy vấn: `confirm?: boolean` (mặc định `false`).

| Tình huống | HTTP | Thân / mã lỗi |
|---|---|---|
| Không bài nào dùng | 204 | xóa mềm, trả dung lượng, tạo `media.purge_files` |
| Có bài `approved`/`scheduled` dùng | 409 | `MEDIA_IN_USE` "Ảnh đang dùng trong 2 bài đã lên lịch." + `{ usages }`, hành động `navigate` "Mở bài để đổi media" — **không** có trạng thái xóa dở |
| Chỉ bài nháp/chờ duyệt/đã đăng dùng, `confirm` chưa `true` | 409 | `MEDIA_USED_CONFIRM_REQUIRED` + `{ usages }` — web hiện hộp xác nhận liệt kê từng bài (tiêu đề, trạng thái, liên kết) |
| Như trên với `confirm=true` | 204 | xóa như thường; bài nháp sau đó thấy "Media đã bị xóa" |
| Cộng tác viên xóa tệp của người khác | 403 | `MEDIA_DELETE_NOT_OWNER` "Bạn chỉ xóa được ảnh/video do chính mình tải lên. Nhờ chủ tài khoản hoặc người đã tải xóa giúp." |
| `uploading` (chưa vào thư viện) | 404 | dùng `DELETE /media/uploads/:id` |
| Đã xóa / không có / tài khoản khác | 404 | `NOT_FOUND` — `DELETE` lặp lại cho cùng kết quả an toàn: lần hai là 404 |
| `unprocessable` | 204 | xóa dòng + việc purge; **không** trả `used_bytes` lần nữa (đã trả khi chuyển `unprocessable`) |

Dung lượng trả ngay trong cùng giao dịch xóa mềm khi dòng ở `processing`/`ready` (`UPDATE … WHERE status IN (…) RETURNING`).

## 11. Ánh xạ lỗi tổng quát

| Điều kiện | HTTP | `code` |
|---|---|---|
| Chưa đăng nhập / phiên hết hạn | 401 | `UNAUTHENTICATED` |
| Sai vai trò (hỗ trợ/quản trị) | 403 | `FORBIDDEN` |
| Thân/truy vấn sai | 400 | `VALIDATION_FAILED` |
| Không có / của tài khoản khác | 404 | `NOT_FOUND` (không phân biệt hai trường hợp) |
| Kho tệp tạm lỗi khi cấp URL / xác nhận | 503 | `STORAGE_UNAVAILABLE` — hành động `retry` |

## 12. Kiểm thử hợp đồng bắt buộc

1. Ma trận quyền: mỗi điểm cuối × `owner`/`collaborator`/`support`/`admin` (kể cả "cộng tác viên chỉ xóa tệp mình").
2. Truy cập chéo: tài khoản A với `mediaId`/`uploadId` của B ⇒ 404 ở mọi điểm cuối.
3. Quét phản hồi: không URL nào là loại `public` (kiểm hạn ≤ 3600 giây từ tham số URL ký sẵn / từ `SignedUrl.purpose`).
4. `complete` gọi hai lần liên tiếp ⇒ cùng kết quả, một `media`, một việc `media.process`.
5. Hai yêu cầu `POST /media/uploads` song song vượt dung lượng còn lại ⇒ đúng một thành công (SC-005, ≥ 20 yêu cầu).
