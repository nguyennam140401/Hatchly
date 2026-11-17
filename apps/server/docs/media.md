# Module Thư viện media (`media`) – hướng dẫn cho module khác

Giao diện công khai duy nhất: `apps/server/src/modules/media/index.ts`. Chỉ module có `media` trong `allowedDeps` của
`modules.manifest.json` (hiện `content`, `publishing`) được nhập; `pnpm check:boundaries` chặn phần còn lại. **Không thao tác nào nhận
mã tài khoản** – luôn lấy từ ngữ cảnh (phiên / việc nền); gọi ngoài ngữ cảnh ⇒ `TenantContextError`. Mã media của tài khoản khác ≡ mã
không tồn tại (`not_found`). Hợp đồng chi tiết: `specs/014-media-library-basic/contracts/media-public-api.md`.

## 1. Đính media vào bài (module `content`, 012)

```ts
constructor(@Inject(MEDIA_PUBLIC_API) private readonly media: MediaPublicApi) {}

const [r] = await this.media.assertAttachable([mediaId]);
switch (r.kind) {
  case 'ok':           // r.media: MediaSummary – thuộc tính để so quy tắc kênh (kích thước, thời lượng, loại)
  case 'not_ready':    // đang xử lý → "Ảnh đang xử lý, thử lại sau ít phút" (FR-013)
  case 'unprocessable' // → "Không dùng được ảnh này, hãy chọn ảnh khác"
  case 'deleted':      // → "Media đã bị xóa"
  case 'not_found':    // → "Chọn media khác"
}
```

- `describe(ids ≤ 100)` – thuộc tính hiển thị, **giữ thứ tự đầu vào**; `deleted` = đã xóa mềm (sau 30 ngày dòng bị xóa hẳn và trở thành
  `not_found` – giao diện bài coi cả hai là "media không còn").
- `getPreviewUrls(ids)` – đường dẫn xem trước (loại `preview`, ≤ 1 giờ) cho giao diện soạn bài; media chưa `ready` ⇒ `thumbUrl = null`.
- `assertAttachable` **không giữ khóa**: nếu media bị xóa ngay sau đó, tính nhất quán dựa vào `issuePublicUrl` lúc đăng.

## 2. Cấp đường dẫn công khai cho nền tảng (module `publishing`, 013 bước 2 "chuẩn bị media")

```ts
const r = await this.media.issuePublicUrl(mediaId, { ttlSec: 86_400 });   // hoặc getPublishableMedia(ids, { ttlSec })
```

- Ảnh ⇒ bản **JPEG chuẩn hóa** (`normalized/jpeg`); video ⇒ **tệp gốc**. Hạn mặc định `MEDIA_PUBLIC_URL_TTL_SEC` (86.400 giây);
  `ttlSec` > 86.400 ⇒ `InvalidRequestError` (không âm thầm cắt).
- **Chỉ `publishing`** được gọi; không điểm cuối HTTP nào gọi hàm này (kiểm bằng `test/media/no-public-url.e2e.spec.ts`).
- Ánh xạ lỗi cho 013: `not_ready` ⇒ chưa sẵn sàng (thử lại/đối soát); `deleted` · `unprocessable` · `not_found` ⇒ lỗi "cần người dùng"
  kèm "vui lòng chọn media khác". Quy tắc media của từng kênh nằm ở bộ chuyển đổi nền tảng; `media` chỉ trả `MediaSummary`.
- `getPublishableMedia(ids, { ttlSec })` bọc `issuePublicUrl` cho nhiều tệp: đủ ⇒ `{ kind: 'ok', items }`; có tệp không cấp được ⇒
  `{ kind: 'unavailable', mediaIds }` (013 dùng trực tiếp).

## 3. "Bài nào đang dùng media" (đảo phụ thuộc – module bài đăng ký MỘT lần lúc khởi động)

`media` không nhập `content` (tránh vòng). Module bài gọi:

```ts
registerMediaUsageProvider({
  findUsages: async (mediaIds) => [...]   // ≤ 100 mã; chỉ bài của tài khoản trong ngữ cảnh
});
```

Mỗi phần tử: `{ mediaId, postId, postTitle, postStatus }` với `postStatus ∈ draft | pending_review | approved | scheduled | published |
failed | cancelled`. Quy tắc chặn nằm ở `media`, không ở nhà cung cấp: `approved`/`scheduled` ⇒ **chặn xóa** (`MEDIA_IN_USE`); các
trạng thái còn lại ⇒ xóa được sau khi người dùng xác nhận (`confirm=true`). Chưa đăng ký ⇒ coi như không có bài nào. Đăng ký lần hai ⇒ ném.

## 4. Việc nền do `media` sở hữu (không module nào được tạo)

`media.process` · `media.purge_files` · `media.cleanup` (hàng chờ `media`, theo tenant) và `media.sweep` (hàng `scheduled`, việc hệ thống,
cron `7 * * * *` UTC; quét tuần Chủ nhật 00:xx UTC). Khóa chống trùng `media_process:{mediaId}`, `media_purge:{mediaId}`,
`media_cleanup:{accountId}:{scope}`. Xem `modules/media/jobs.ts`.

## 5. Cấu hình

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `MEDIA_QUOTA_BYTES` | 5 × 1024³ | hạn mức dung lượng mỗi tài khoản (lúc tạo dòng `storage_quotas` mới) |
| `MEDIA_PUBLIC_URL_TTL_SEC` | 86400 (trần 86400) | hạn đường dẫn công khai cho nền tảng |
| `MEDIA_PREVIEW_URL_TTL_SEC` | 3600 (trần 3600) | hạn đường dẫn xem trước cho giao diện |
| `FFMPEG_PATH`, `FFPROBE_PATH` | `ffmpeg`, `ffprobe` | đường dẫn công cụ video (ảnh container đã cài sẵn; chỉ đặt khi chạy cục bộ) |

## 6. Đóng gói và vận hành

- Ảnh container có `ffmpeg`; Worker cần `emptyDir` ≥ 2 GiB cho tệp tạm của việc `media` (video ≤ 500 MB) và bộ nhớ ≥ 1 GiB (sharp + giải mã HEIC WASM).
- HEIC giải mã bằng `libheif-js` (bản dựng sẵn của `sharp` không có bộ giải mã HEVC); bằng sáng chế HEVC/HEIC cần chủ dự án xem trước khi phát hành thương mại.
- Dung lượng 5 GB tính theo **tệp gốc** của media `processing`/`ready` chưa xóa; bản chuẩn hóa/thu nhỏ **không** tính hạn mức (kiểm ở chỉ số `media_storage_bytes_by_kind`).
