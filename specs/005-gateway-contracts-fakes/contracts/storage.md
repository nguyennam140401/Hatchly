# Hợp đồng – Kho tệp (`core/storage`)

Hạ tầng dùng chung phía máy chủ (không phải module nghiệp vụ, không có schema). Lối vào:
`apps/server/src/core/storage/index.ts`. Chỉ `modules/media`, `modules/context`, `modules/account` và tầng ghép được
nhập (quy tắc ranh giới mới). Đăng bài lấy đường dẫn công khai qua giao diện của `media`. Kiểu dữ liệu:
[data-model.md](../data-model.md) mục 4.

## 1. Giao diện (token `OBJECT_STORAGE`)

```ts
export interface ObjectStorage {
  presignUpload(loc: StorageLocation, opts: { contentType: AllowedContentType; maxBytes: number; ttlSec?: number /* ≤ 900 */ }): Promise<PresignedUpload>;
  stat(loc: StorageLocation, opts?: { hash?: boolean }): Promise<ObjectInfo>;
  read(loc: StorageLocation): Promise<Readable>;                                           // Worker
  write(loc: StorageLocation, body: Readable | Buffer, opts: { contentType: string }): Promise<{ bytes: number; sha256: string }>;
  copy(from: StorageLocation, to: StorageLocation): Promise<void>;
  delete(loc: StorageLocation): Promise<void>;                                             // không có → không lỗi
  list(prefix: StoragePrefix, opts?: { after?: string; limit?: number }): Promise<{ items: { loc: StorageLocation; bytes: number }[]; next?: string }>;
  signedUrl(loc: StorageLocation, purpose: 'preview' | 'public', ttlSec?: number): Promise<SignedUrl>; // preview ≤ 3600, public ≤ 86400
  deleteAllForCurrentAccount(): Promise<{ deleted: number }>;                               // luồng xóa tài khoản
}
export type StoragePrefix = { kind: 'media'; mediaId?: string } | { kind: 'context' } | { kind: 'account' };
export const loc: { mediaOriginal(mediaId): StorageLocation; mediaNormalized(mediaId, variant); mediaThumb(mediaId);
  contextFile(fileId); jobTmp(name) /* jobId từ ngữ cảnh việc → tenants/{acc}/tmp/{jobId}/{name} */ };
export class StorageAccessDenied extends Error {}   // không chứa khóa trong message
```

## 2. Quy tắc bất biến

1. Khóa dựng từ `currentAccountId()` (+ `jobId` của việc đang chạy với `job_tmp`) + mã UUID; không có thao tác nhận
   chuỗi khóa thô. Tên tệp người dùng không bao giờ vào khóa (`../`, ký tự lạ vô hại). **Mọi** khóa, kể cả tệp tạm, nằm
   dưới `tenants/{currentAccountId()}/` (hiến pháp nguyên tắc I).
2. Kiểm lần hai trước mỗi lời gọi S3: khóa phải bắt đầu `tenants/{currentAccountId()}/` (không ngoại lệ); sai →
   `StorageAccessDenied` + nhật ký `storage.access_denied` (không in khóa, chỉ `kind`).
2a. Tệp tạm (`job_tmp`): `presignUpload` → `InvalidRequestError` (chỉ Worker ghi); `write` gắn nhãn đối tượng
   `lifecycle=tmp`, luật vòng đời lọc theo nhãn xóa sau 1 ngày; `signedUrl('preview')` → `InvalidRequestError` (giao diện
   không xem tệp tạm); `signedUrl('public')` được phép.
3. `ttlSec` vượt trần → `InvalidRequestError` (không âm thầm cắt).
4. Không có thao tác nhận nội dung tệp từ trình duyệt qua API (FR-052): `write` chỉ dùng phía Worker/máy chủ cho tệp
   do hệ thống sinh (bản chuẩn hóa, ảnh thu nhỏ).
5. Xác nhận tải lên luôn bằng `stat` (đọc lại), không tin kích thước/dấu do trình duyệt gửi.
6. Kiểu SDK AWS không xuất hiện trên giao diện (FR-008).

## 3. Bản cài đặt

| Bản | Nơi | Ghi chú |
|---|---|---|
| `S3ObjectStorage` (thật) | `core/storage/s3/` | `@aws-sdk/client-s3`, `s3-presigned-post`, `s3-request-presigner` (khóa phiên bản); POST policy: `key` chính xác, `Content-Type` chính xác, `content-length-range`, hạn |
| `MemoryObjectStorage` (giả) | `core/storage/memory/` | Map trong bộ nhớ; `presignUpload` trả URL `memory://…` kèm chữ ký HMAC + hạn; `simulateBrowserUpload(upload, bytes, contentType)` để kiểm thử "dùng" đường dẫn như trình duyệt (FR-053) – kiểm đúng các điều kiện của POST policy |

## 4. Bộ kiểm thử hợp đồng (`test/contracts/storage/`)

`describeObjectStorageContract(make, uploader)` – `uploader` là "trình duyệt" của bản cài đặt (memory:
`simulateBrowserUpload`; S3: `fetch` POST multipart tới MinIO). Chạy `memory` (`pnpm test`) và `s3`→MinIO
(`pnpm test:infra`):
1. Tải lên đúng → `stat` đúng kích thước/loại; `stat({hash:true})` = SHA-256 của nội dung.
2. Quá `maxBytes`, sai `Content-Type`, đổi `key`, sau hạn → bị từ chối.
3. Dùng lại đường dẫn trong hạn → ghi đè đúng vị trí cũ.
4. **Truy cập chéo** (SC-005): ma trận mọi thao tác × mọi `kind` (trừ tổ hợp bị cấm `presignUpload` × `job_tmp` và
   `signedUrl('preview')` × `job_tmp`, kiểm riêng ở mục 6) – ngữ cảnh A không đọc/ghi/xóa/liệt kê/ký được gì của B (dựng tệp B trong ngữ cảnh B trước).
5. `signedUrl` preview/public: hạn đúng trần, hết hạn không tải được.
6. `job_tmp`: ngoài ngữ cảnh việc → `TenantContextError`; khóa nằm dưới `tenants/{acc}/tmp/{jobId}/`; `presignUpload` và
   `signedUrl('preview')` → `InvalidRequestError`; `write` gắn nhãn `lifecycle=tmp` và tệp hết hạn sau 1 ngày (S3: kiểm luật vòng đời bucket lọc
   theo nhãn; memory: dọn theo thời gian giả).
7. `deleteAllForCurrentAccount` của A → mọi tệp của A (kể cả tệp tạm) bị xóa, B còn nguyên.
8. (`infra`) tải lên bằng đường dẫn ký sẵn rồi `stat` thấy tệp đúng vị trí trong ≤ 10 giây (SC-011).
