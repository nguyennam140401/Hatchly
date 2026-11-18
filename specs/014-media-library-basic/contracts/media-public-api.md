# Hợp đồng nội bộ – giao diện công khai của `media` (`MediaPublicApi`)

Lối vào duy nhất cho module khác: `apps/server/src/modules/media/index.ts` (`MEDIA_PUBLIC_API`, kiểu `MediaPublicApi`, `registerMediaUsageProvider`,
kiểu `MediaUsageProvider`). Chỉ module có `media` trong `allowedDeps` (`content`, `publishing`) được nhập (`check:boundaries`). **Không thao tác nào nhận mã
tài khoản** — luôn lấy từ ngữ cảnh (phiên / việc nền); gọi ngoài ngữ cảnh ⇒ `TenantContextError`. Kết quả nghiệp vụ là hợp đóng có `kind` (`switch` hết các nhánh);
chỉ lỗi lập trình/hạ tầng mới ném. Mỗi thao tác ghi một dòng nhật ký `media.<op>` (không URL, không tên tệp) + span OpenTelemetry.

## 1. `MediaPublicApi`

```ts
export type MediaRef = { mediaId: string };

export type MediaSummary = {
  mediaId: string;
  kind: 'image' | 'video';
  displayName: string;
  status: 'processing' | 'ready' | 'unprocessable';
  // Thuộc tính để bộ chuyển đổi nền tảng so với quy tắc kênh (FR-016); media chưa ready thì các trường kích thước là null.
  originalBytes: number;
  normalizedBytes: number | null;     // ảnh: kích thước bản JPEG chuẩn hóa; video: null
  width: number | null; height: number | null; durationMs: number | null;
  contentType: string;                // loại của thứ sẽ được đăng ('image/jpeg' cho ảnh; loại gốc cho video)
};

export type DescribeResult =
  | { kind: 'ok'; media: MediaSummary }
  | { kind: 'deleted' }               // xóa mềm HOẶC đã xóa hẳn sau 30 ngày: UI bài hiện "Media đã bị xóa"
  | { kind: 'not_found' };            // không thuộc tài khoản / mã không có (không phân biệt)

export type PublicUrlResult =
  | { kind: 'ok'; url: string; expiresAt: Date; media: MediaSummary }
  | { kind: 'not_ready' }             // processing → Đăng bài coi là chưa sẵn sàng, KHÔNG đăng ảnh gốc sai định dạng
  | { kind: 'unprocessable' }         // → lỗi "cần người dùng": "chọn media khác"
  | { kind: 'deleted' }
  | { kind: 'not_found' };

export interface MediaPublicApi {
  /** Thuộc tính của nhiều media (≤ 100 mã) – cho kiểm tra quy tắc kênh và hiển thị bài. Giữ nguyên thứ tự đầu vào. */
  describe(mediaIds: readonly string[]): Promise<DescribeResult[]>;

  /** Dùng khi ĐÍNH media vào bài (012): chỉ `ok` khi `status = 'ready'` và chưa xóa. `processing` ⇒ từ chối kèm lý do (FR-013). */
  assertAttachable(mediaIds: readonly string[]):
    Promise<Array<{ kind: 'ok'; media: MediaSummary } | { kind: 'not_ready' | 'unprocessable' | 'deleted' | 'not_found'; mediaId: string }>>;

  /** Ảnh xem trước ngắn hạn (≤ 1 giờ) cho giao diện soạn bài; chỉ media của tài khoản trong ngữ cảnh. */
  getPreviewUrls(mediaIds: readonly string[]): Promise<Array<{ mediaId: string; thumbUrl: string | null; expiresAt: Date | null }>>;

  /**
   * Đường dẫn CÔNG KHAI có hạn cho nền tảng tải (FR-015/016). Ảnh ⇒ bản JPEG chuẩn hóa; video ⇒ tệp gốc.
   * `ttlSec` mặc định 86.400 (cấu hình `MEDIA_PUBLIC_URL_TTL_SEC`), > 86.400 ⇒ `InvalidRequestError` (không âm thầm cắt).
   * Chỉ module `publishing` (bước 2 "chuẩn bị media") được gọi; không có điểm cuối HTTP nào gọi hàm này.
   */
  issuePublicUrl(mediaId: string, opts?: { ttlSec?: number }): Promise<PublicUrlResult>;
}
```

- `describe`/`assertAttachable`/`getPreviewUrls`/`issuePublicUrl` có ở **cả API lẫn Worker** (013 gọi từ Worker). Đọc qua `tenantTx`.
- `assertAttachable` **không** giữ khóa: nếu media bị xóa ngay sau đó, tính nhất quán dựa vào `issuePublicUrl` trả `deleted` (R10).
- Không có thao tác ghi cho module khác: tạo/xóa media chỉ qua HTTP của chính `media` (người dùng thao tác).

## 2. Cổng "bài nào đang dùng media" (đảo phụ thuộc — R10)

```ts
export type PostStatusForMedia =
  | 'draft' | 'pending_review' | 'approved' | 'scheduled' | 'published' | 'failed' | 'cancelled'; // lấy theo trạng thái bài của 012/013

export type MediaUsage = {
  mediaId: string;
  postId: string;
  postTitle: string;               // tiêu đề hiển thị; null/rỗng ⇒ nhà cung cấp tự điền "Bài chưa đặt tên"
  postStatus: PostStatusForMedia;
};

export interface MediaUsageProvider {
  /** Chỉ bài của tài khoản trong ngữ cảnh; đọc qua giao diện/ bảng của module sở hữu bài (không phải của media). ≤ 100 mã/lần. */
  findUsages(mediaIds: readonly string[]): Promise<MediaUsage[]>;
}

/** Gọi MỘT lần lúc khởi động (module bài). Đăng ký lần hai ⇒ ném (lỗi lập trình). */
export function registerMediaUsageProvider(provider: MediaUsageProvider): void;
```

Quy tắc ở `media` (không ở nhà cung cấp): `approved`/`scheduled` ⇒ **chặn** xóa (`MEDIA_IN_USE`); `draft`/`pending_review`/`published`/`failed`/`cancelled` ⇒ xóa được sau `confirm=true`.
Chưa có nhà cung cấp (012 chưa xong) ⇒ `findUsages` mặc định trả `[]`. Kiểm thử hợp đồng dùng nhà cung cấp giả có trạng thái tùy ý.

## 3. Cổng gói (R12) — nội bộ `media`, chưa công khai

```ts
export interface UploadGate {
  canUpload(): Promise<{ allowed: true } | { allowed: false; reason: 'plan_expired' | 'account_suspended' }>;
}
```

Bản mặc định luôn `allowed: true`. WBS 2.6 thay bản gọi `AccountPublicApi`. Điều kiện chặn chỉ áp cho **bắt đầu tải** (`POST /media/uploads`); xem/xóa không qua cổng.

## 4. Việc nền do `media` khai báo (không module khác tạo)

`media.process`, `media.purge_files`, `media.cleanup` (tenant), `media.sweep` (system, lịch hằng giờ) — định nghĩa ở `modules/media/jobs.ts`, **không** xuất qua `index.ts`
(không module nào được tạo các việc này). Chi tiết payload/khóa: [data-model.md](../data-model.md) mục 3.

## 5. Hợp đồng với 012 và 013 (khi chúng được làm)

- **012** thay "media giả lập (005)" bằng `MEDIA_PUBLIC_API`: `assertAttachable` khi đính, `describe`/`getPreviewUrls` khi hiển thị, và gọi `registerMediaUsageProvider` với truy vấn bài-dùng-media
  của chính nó. Không đổi luồng của 012.
- **013** bước 2: `issuePublicUrl` → ánh xạ `not_ready` ⇒ "chưa sẵn sàng" (thử lại sau/đối soát theo FR-08/FR-09 của 013), `deleted`/`unprocessable`/`not_found` ⇒ lỗi "cần người dùng" kèm "vui lòng chọn media khác".
  Quy tắc media của từng kênh nằm ở bộ chuyển đổi nền tảng; `media` chỉ trả `MediaSummary` để so sánh.
- Kiểm thử hợp đồng của `MediaPublicApi` chạy trên bản thật (PostgreSQL + kho `memory`) **và** bản giả của 005 nếu 012/013 đã nhập bản giả — hai bản phải qua cùng bộ kiểm thử.
