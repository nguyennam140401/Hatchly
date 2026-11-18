// Cổng "bài nào đang dùng media" – ĐẢO phụ thuộc (014 R10, contracts/media-public-api.md mục 2): `media` không import
// `content` (tránh vòng); module bài đăng ký MỘT nhà cung cấp lúc khởi động. Quy tắc chặn/xác nhận xóa nằm Ở ĐÂY
// (`media`), không ở nhà cung cấp.
import { MEDIA_USAGE_BLOCKING_STATUSES, type MediaUsageStatus } from '@app/shared/media';

export interface MediaUsageRef {
  mediaId: string;
  postId: string;
  /** Tiêu đề hiển thị; rỗng ⇒ "Bài chưa đặt tên". */
  postTitle: string;
  postStatus: MediaUsageStatus;
}

export interface MediaUsageProvider {
  /** Chỉ bài của tài khoản trong ngữ cảnh; ≤ 100 mã mỗi lần. */
  findUsages(mediaIds: readonly string[]): Promise<MediaUsageRef[]>;
}

export const MAX_USAGE_LOOKUP = 100;
export const UNTITLED_POST = 'Bài chưa đặt tên';

let provider: MediaUsageProvider | undefined;

/** Gọi MỘT lần lúc khởi động (module bài). Đăng ký lần hai ⇒ ném (lỗi lập trình). */
export function registerMediaUsageProvider(p: MediaUsageProvider): void {
  if (provider !== undefined) throw new Error('MediaUsageProvider đã được đăng ký');
  provider = p;
}

/** Chỉ dùng trong kiểm thử. */
export function resetMediaUsageProviderForTests(): void {
  provider = undefined;
}

/** Tra bài đang dùng; chưa có nhà cung cấp (012 chưa nối) ⇒ rỗng. Tự chia lô ≤ 100 mã. */
export async function findUsagesOrEmpty(mediaIds: readonly string[]): Promise<MediaUsageRef[]> {
  if (provider === undefined || mediaIds.length === 0) return [];
  const out: MediaUsageRef[] = [];
  for (let i = 0; i < mediaIds.length; i += MAX_USAGE_LOOKUP) {
    const rows = await provider.findUsages(mediaIds.slice(i, i + MAX_USAGE_LOOKUP));
    for (const row of rows) {
      out.push({ ...row, postTitle: row.postTitle.trim() === '' ? UNTITLED_POST : row.postTitle });
    }
  }
  return out;
}

/** Bài `approved`/`scheduled` chặn xóa; còn lại xóa được sau khi xác nhận. */
export function isBlockingUsage(status: MediaUsageStatus): boolean {
  return (MEDIA_USAGE_BLOCKING_STATUSES as readonly string[]).includes(status);
}

export function hasBlockingUsage(usages: readonly MediaUsageRef[]): boolean {
  return usages.some((u) => isBlockingUsage(u.postStatus));
}
