/**
 * Giao diện công khai của module Thư viện media (`media`).
 *
 * Trách nhiệm (ADD mục 6): Tải ảnh/video thẳng lên kho tệp bằng đường dẫn ký sẵn (tenants/{mã}/), dấu tệp chống xử lý trùng, gán nhãn tự động (qua Cổng AI) và gán nhãn tay, dung lượng.
 *
 * Module khác chỉ được dùng module này qua `index.ts` (quy tắc no-internal-cross-module) và chỉ khi
 * có `media` trong `allowedDeps` của mình ở modules.manifest.json.
 */

/** Một tệp media đã sẵn sàng đăng: đường dẫn ký sẵn đúng tiền tố `tenants/{mã tài khoản}/`, hạn ≤ 24 giờ. */
export interface PublishableMedia {
  mediaId: string;
  kind: 'image' | 'video';
  url: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
  durationSec?: number;
}

export type PublishableMediaResult =
  | { kind: 'ok'; items: PublishableMedia[] }
  /** Có tệp không còn/không đăng được (đã xóa, chưa xử lý xong…) – 013 báo "vui lòng chọn ảnh khác". */
  | { kind: 'unavailable'; mediaIds: string[] };

export interface MediaPublicApi {
  /**
   * 013 – bước 2 "chuẩn bị media": đường dẫn ký sẵn để nền tảng tự tải về. KHÔNG nhận mã tài khoản (lấy từ ngữ
   * cảnh). Danh sách rỗng → `{ kind: 'ok', items: [] }`. `ttlSec` tối đa 86 400.
   */
  getPublishableMedia(
    mediaIds: readonly string[],
    options: { ttlSec: number },
  ): Promise<PublishableMediaResult>;
}

/** Token NestJS của MediaPublicApi. */
export const MEDIA_PUBLIC_API = Symbol('MEDIA_PUBLIC_API');
