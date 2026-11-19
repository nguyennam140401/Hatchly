/**
 * Giao diện công khai của module Thư viện media (`media`) – 014 contracts/media-public-api.md.
 *
 * Trách nhiệm (ADD mục 6): tải ảnh/video thẳng lên kho tệp bằng đường dẫn ký sẵn (tenants/{mã}/), chuẩn hóa JPEG,
 * ảnh thu nhỏ, giới hạn 5 GB, dấu tệp chống xử lý trùng, đường dẫn công khai có hạn cho Đăng bài.
 *
 * Module khác chỉ được dùng module này qua `index.ts` (quy tắc no-internal-cross-module) và chỉ khi
 * có `media` trong `allowedDeps` của mình ở modules.manifest.json. KHÔNG thao tác nào nhận mã tài khoản – luôn lấy từ
 * ngữ cảnh (phiên / việc nền); gọi ngoài ngữ cảnh ⇒ `TenantContextError`.
 */

export type MediaKind = 'image' | 'video';
export type MediaStatusPublic = 'processing' | 'ready' | 'unprocessable';

/** Thuộc tính media để bộ chuyển đổi nền tảng so với quy tắc kênh (FR-016); chưa ready thì kích thước là null. */
export interface MediaSummary {
  mediaId: string;
  kind: MediaKind;
  displayName: string;
  status: MediaStatusPublic;
  originalBytes: number;
  /** Ảnh: kích thước bản JPEG chuẩn hóa; video: null. */
  normalizedBytes: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  /** Loại của thứ sẽ được đăng: `image/jpeg` cho ảnh; loại gốc cho video. */
  contentType: string;
}

export type DescribeResult =
  | { kind: 'ok'; media: MediaSummary }
  /** Xóa mềm HOẶC đã xóa hẳn: giao diện bài hiện "Media đã bị xóa". */
  | { kind: 'deleted' }
  /** Không thuộc tài khoản / mã không có (không phân biệt hai trường hợp). */
  | { kind: 'not_found' };

export type AttachResult =
  | { kind: 'ok'; media: MediaSummary }
  | { kind: 'not_ready' | 'unprocessable' | 'deleted' | 'not_found'; mediaId: string };

export type PublicUrlResult =
  | { kind: 'ok'; url: string; expiresAt: Date; media: MediaSummary }
  /** processing → Đăng bài coi là chưa sẵn sàng, KHÔNG đăng ảnh gốc sai định dạng. */
  | { kind: 'not_ready' }
  /** → lỗi "cần người dùng": chọn media khác. */
  | { kind: 'unprocessable' }
  | { kind: 'deleted' }
  | { kind: 'not_found' };

/** Một tệp media đã sẵn sàng đăng (tương thích bước 2 của 013). */
export interface PublishableMedia {
  mediaId: string;
  kind: MediaKind;
  url: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
  durationSec?: number;
}

export type PublishableMediaFailure = 'not_found' | 'deleted' | 'not_ready' | 'conversion_failed';

export type PublishableMediaResult =
  | { kind: 'ok'; items: PublishableMedia[] }
  /** Có tệp không còn/không đăng được (đã xóa, chưa xử lý xong…) – 013 báo "vui lòng chọn ảnh khác". */
  | {
      kind: 'unavailable';
      mediaIds: string[];
      /** Lý do từng tệp (cùng thứ tự `mediaIds`): `conversion_failed` = chuẩn hóa/chuyển đổi thất bại (`unprocessable`). */
      reasons?: { mediaId: string; reason: PublishableMediaFailure }[];
    };

export interface MediaPublicApi {
  /** Thuộc tính của nhiều media (≤ 100 mã), giữ nguyên thứ tự đầu vào. */
  describe(mediaIds: readonly string[]): Promise<DescribeResult[]>;

  /** Dùng khi ĐÍNH media vào bài (012): chỉ `ok` khi `status = 'ready'` và chưa xóa (FR-013). */
  assertAttachable(mediaIds: readonly string[]): Promise<AttachResult[]>;

  /** Ảnh xem trước ngắn hạn (≤ 1 giờ) cho giao diện soạn bài; chỉ media của tài khoản trong ngữ cảnh. */
  getPreviewUrls(
    mediaIds: readonly string[],
  ): Promise<{ mediaId: string; thumbUrl: string | null; expiresAt: Date | null }[]>;

  /**
   * Đường dẫn CÔNG KHAI có hạn cho nền tảng tải (FR-015/016). Ảnh ⇒ bản JPEG chuẩn hóa; video ⇒ tệp gốc.
   * `ttlSec` mặc định 86.400; > 86.400 ⇒ `InvalidRequestError` (không âm thầm cắt). Chỉ `publishing` được gọi;
   * không điểm cuối HTTP nào gọi hàm này.
   */
  issuePublicUrl(mediaId: string, opts?: { ttlSec?: number }): Promise<PublicUrlResult>;

  /**
   * 013 – bước 2 "chuẩn bị media": bọc `issuePublicUrl` cho nhiều tệp. Danh sách rỗng → `{ kind: 'ok', items: [] }`.
   * Có tệp không cấp được → `unavailable` kèm mã các tệp đó.
   */
  getPublishableMedia(
    mediaIds: readonly string[],
    options: { ttlSec: number },
  ): Promise<PublishableMediaResult>;
}

/** Token NestJS của MediaPublicApi. */
export const MEDIA_PUBLIC_API = Symbol('MEDIA_PUBLIC_API');
