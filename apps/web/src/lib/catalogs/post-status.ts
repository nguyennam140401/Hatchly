import type { IconName } from '../../ui/icons/Icon';

// Danh mục trạng thái hiển thị của bài (UI/UX mục 7). Là dữ liệu tĩnh: nhãn + biểu tượng + token màu.
// Trạng thái luôn hiện bằng CHỮ + BIỂU TƯỢNG, không chỉ màu (nguyên tắc VI).

export const POST_DISPLAY_STATUSES = [
  'draft',
  'review',
  'scheduled',
  'publishing',
  'published',
  'attention',
  'cancelled',
  'unknown',
] as const;
export type PostDisplayStatus = (typeof POST_DISPLAY_STATUSES)[number];

export type StatusTone = 'neutral' | 'info' | 'brand' | 'warning' | 'success' | 'danger';

export interface PostStatusMeta {
  label: string;
  icon: IconName;
  tone: StatusTone;
  /** Biến thể chưa có trong Figma – dựng theo token (SC-001). */
  designPending?: boolean;
}

export const POST_STATUS_META: Record<PostDisplayStatus, PostStatusMeta> = {
  draft: { label: 'Nháp', icon: 'pencil', tone: 'neutral' },
  review: { label: 'Chờ duyệt', icon: 'clock', tone: 'warning' },
  scheduled: { label: 'Đã lên lịch', icon: 'calendar', tone: 'brand', designPending: true },
  publishing: { label: 'Đang đăng', icon: 'send', tone: 'info' },
  published: { label: 'Đã đăng', icon: 'check', tone: 'success' },
  attention: { label: 'Cần bạn xử lý', icon: 'alert', tone: 'danger' },
  cancelled: { label: 'Đã hủy', icon: 'x', tone: 'neutral', designPending: true },
  unknown: { label: 'Đang cập nhật', icon: 'refresh', tone: 'neutral' },
};

/** Trạng thái hệ thống (chuỗi từ máy chủ) → trạng thái hiển thị. Giá trị lạ → `unknown`, không ném lỗi. */
const SYSTEM_TO_DISPLAY: Record<string, PostDisplayStatus> = {
  draft: 'draft',
  pending_review: 'review',
  review: 'review',
  approved: 'scheduled',
  scheduled: 'scheduled',
  queued: 'publishing',
  sending: 'publishing',
  sent_awaiting: 'publishing',
  publishing: 'publishing',
  // Chờ thử lại → vẫn "Đang đăng" (tự thử lại, người dùng không phải làm gì).
  retry_wait: 'publishing',
  published: 'published',
  failed: 'attention',
  needs_user_action: 'attention',
  // Không xác định/Cần kiểm tra → người dùng chọn "Đã đăng" hoặc "Đăng lại".
  unknown_outcome: 'attention',
  needs_check: 'attention',
  cancelled: 'cancelled',
  canceled: 'cancelled',
};

/** Độ "xấu" khi gộp nhiều kênh: càng lớn càng được ưu tiên hiện. */
const SEVERITY: Partial<Record<PostDisplayStatus, number>> = {
  attention: 4,
  publishing: 3,
  scheduled: 2,
  published: 1,
};

function one(system: string): PostDisplayStatus {
  return SYSTEM_TO_DISPLAY[system] ?? 'unknown';
}

/**
 * Trạng thái tổng của bài. Bài nhiều kênh lấy trạng thái XẤU NHẤT theo thứ tự
 * `attention > publishing > scheduled > published`; các trạng thái trước khi lên lịch lấy từ bài.
 */
export function toDisplayStatus(system: string, channels?: readonly string[]): PostDisplayStatus {
  const base = one(system);
  if (channels === undefined || channels.length === 0) return base;
  let worst: PostDisplayStatus | null = null;
  for (const channel of channels) {
    const status = one(channel);
    const rank = SEVERITY[status];
    if (rank === undefined) continue;
    if (worst === null || rank > (SEVERITY[worst] ?? 0)) worst = status;
  }
  return worst ?? base;
}
