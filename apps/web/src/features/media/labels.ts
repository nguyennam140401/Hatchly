import type { MediaStatus } from '@app/shared/media';
import type { IconName } from '../../ui/icons/Icon';

// Chữ + biểu tượng của từng trạng thái media (014 contracts/media-ui.md mục 3). Trạng thái LUÔN hiện bằng chữ + biểu tượng,
// không chỉ dựa vào màu (FR-025, WCAG 2.1 AA).

export const MEDIA_STATUS_LABELS: Record<MediaStatus, { text: string; icon: IconName }> = {
  processing: { text: 'Đang xử lý', icon: 'clock' },
  ready: { text: 'Sẵn sàng', icon: 'check' },
  unprocessable: { text: 'Không xử lý được', icon: 'alert' },
};

export const MEDIA_KIND_LABELS = { image: 'Ảnh', video: 'Video' } as const;

/** Thời lượng video dạng m:ss. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '';
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}

/** Tên truy cập của một ô: tên + loại + trạng thái. */
export function mediaAriaLabel(item: {
  displayName: string;
  kind: 'image' | 'video';
  status: MediaStatus;
}): string {
  return `${item.displayName}, ${MEDIA_KIND_LABELS[item.kind]}, ${MEDIA_STATUS_LABELS[item.status].text}`;
}
