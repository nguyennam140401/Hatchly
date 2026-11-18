# Hợp đồng – mở rộng kho tệp `core/storage` cho tải nhiều phần

Bổ sung vào [`specs/005-gateway-contracts-fakes/contracts/storage.md`](../../005-gateway-contracts-fakes/contracts/storage.md). Chỉ **thêm** thao tác vào `ObjectStorage`; mọi
thao tác hiện có giữ nguyên. Quy tắc bất biến 1–6 của 005 áp dụng nguyên vẹn (khóa dựng từ `currentAccountId()`, kiểm lần hai `tenants/{acc}/`, `ttlSec` vượt trần ⇒
`InvalidRequestError`, kiểu SDK AWS không lộ ra giao diện).

## 1. Giao diện thêm

```ts
export type MultipartHandle = { uploadId: string };           // chuỗi mờ, KHÔNG vào nhật ký
export type PartInfo = { partNumber: number; bytes: number; etag: string };

export interface ObjectStorage {
  // …thao tác đã có…

  /** Mở phiên nhiều phần cho `media_original`. `bytes` = dung lượng khai báo (kiểm 1..MAX_MULTIPART_BYTES); `contentType` ∈ ALLOWED_CONTENT_TYPES. */
  createMultipart(loc: StorageLocation, opts: { contentType: AllowedContentType; bytes: number; partSizeBytes: number }): Promise<MultipartHandle>;

  /** URL ký sẵn `PUT` cho MỘT phần; hạn ≤ MAX_UPLOAD_TTL_SEC (900). `contentLength` được ký vào URL khi nhà cung cấp cho phép (R1). */
  presignPart(loc: StorageLocation, h: MultipartHandle, part: { partNumber: number; contentLength: number; ttlSec?: number }): Promise<{ url: string; expiresAt: Date; headers: Record<string, string> }>;

  /** Phần đã lên – nguồn sự thật cho tiếp tục tải. Phân trang nội bộ (≤ 10.000 phần), trả đủ. */
  listParts(loc: StorageLocation, h: MultipartHandle): Promise<PartInfo[]>;

  /** Ghép phần theo `listParts` (máy chủ tự lấy ETag, trình duyệt không gửi). Thiếu phần / lệch kích thước ⇒ `MultipartIncompleteError`. Gọi lại khi đã ghép ⇒ trả `{bytes}` đúng. */
  completeMultipart(loc: StorageLocation, h: MultipartHandle, expect: { bytes: number }): Promise<{ bytes: number }>;

  /** Hủy phiên và xóa các phần đã lên. Phiên không còn ⇒ không lỗi. */
  abortMultipart(loc: StorageLocation, h: MultipartHandle): Promise<void>;
}
export class MultipartIncompleteError extends Error { readonly code = 'MULTIPART_INCOMPLETE'; }   // không chứa khóa/uploadId
export const MAX_MULTIPART_BYTES = 5 * 1024 ** 3;     // trần an toàn gấp 10 lần video lớn nhất
```

## 2. Quy tắc bổ sung

1. Chỉ `media_original` được mở phiên nhiều phần (`kind` khác ⇒ `InvalidRequestError`); `job_tmp` bị cấm như `presignUpload`.
2. `partNumber` ∈ [1, 10.000]; `partSizeBytes` ≥ 5 MiB (trừ khi chỉ có một phần); `bytes` ≤ `MAX_MULTIPART_BYTES`.
3. `completeMultipart` kiểm: mọi phần 1..N có mặt, mọi phần trừ phần cuối đúng `partSizeBytes`, tổng đúng `expect.bytes`; sai ⇒ `MultipartIncompleteError` và **không** ghép.
4. `uploadId` không bao giờ xuất hiện ở nhật ký/chỉ số/thông điệp lỗi; chỉ lưu ở `media.upload_sessions.multipart_upload_id`.
5. Không có thao tác nhận nội dung phần qua API (FR-052 của 005 giữ): phần đi thẳng từ trình duyệt tới kho bằng URL ký sẵn.

## 3. Bản cài đặt

| Bản | Cách làm |
|---|---|
| `S3ObjectStorage` | `CreateMultipartUploadCommand` / `UploadPartCommand` + `getSignedUrl` (ký `content-length` nếu cho phép) / `ListPartsCommand` (phân trang theo `PartNumberMarker`) / `CompleteMultipartUploadCommand` / `AbortMultipartUploadCommand`. Không thêm phụ thuộc mới (đã có `@aws-sdk/client-s3` + `s3-request-presigner` đã khóa phiên bản). |
| `MemoryObjectStorage` | Map `uploadId → { loc, parts }`; URL `memory://…` có chữ ký HMAC + hạn; `simulateBrowserUploadPart(url, bytes)` kiểm hạn/`contentLength`/phần; `completeMultipart` ghép theo thứ tự phần. |

## 4. Bộ kiểm thử hợp đồng (`test/contracts/storage/multipart.contract.ts`, chạy `memory` ở `pnpm test`, `s3`→MinIO ở `pnpm test:infra`)

1. Tải đủ phần rồi `completeMultipart` ⇒ `stat` đúng kích thước; `stat({hash:true})` bằng SHA-256 nội dung.
2. Tải thiếu một phần ⇒ `MultipartIncompleteError`; `listParts` còn đúng các phần đã lên; tải bù phần thiếu rồi ghép được (**tiếp tục tải**).
3. Ghi đè một phần (URL mới, cùng số phần) ⇒ phần mới thắng.
4. URL phần hết hạn ⇒ bị từ chối; `ttlSec` > 900 ⇒ `InvalidRequestError`.
5. Phần sai `contentLength` (khi nhà cung cấp ký được) ⇒ bị từ chối; (khi không ký được) ⇒ `completeMultipart` bác theo tổng.
6. `abortMultipart` ⇒ `listParts` lỗi/`[]`, `stat` không có; gọi lặp không lỗi.
7. **Truy cập chéo**: ngữ cảnh A không `createMultipart`/`presignPart`/`listParts`/`completeMultipart`/`abortMultipart` trên khóa của B (ma trận 005 mở rộng).
8. `deleteAllForCurrentAccount` của A cũng hủy phiên nhiều phần đang mở của A (không để rác tính phí).
9. (`infra`, MinIO) tệp 25 MiB gồm 4 phần: ngắt giữa chừng, `listParts` đúng, ghép sau khi bù phần (kiểm **V5**).
