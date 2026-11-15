import { POST_STATUS_META, type PostDisplayStatus } from '../../lib/catalogs/post-status';
import { Icon } from '../icons/Icon';
import { cn } from '../util/cn';
import { TONE_CLASSES } from '../util/tone';

export interface StatusBadgeProps {
  /** Trạng thái hiển thị; chuỗi lạ → "Đang cập nhật" (không bao giờ ném lỗi hay trắng trang). */
  status: PostDisplayStatus | (string & {});
  size?: 'sm' | 'md';
  className?: string;
}

/** Luôn hiện CHỮ + BIỂU TƯỢNG, không chỉ dựa vào màu (nguyên tắc VI). */
export function StatusBadge({ status, size = 'md', className }: StatusBadgeProps) {
  const meta =
    (POST_STATUS_META as Record<string, (typeof POST_STATUS_META)[PostDisplayStatus] | undefined>)[
      status
    ] ?? POST_STATUS_META.unknown;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-pill font-semibold',
        size === 'sm' ? 'px-2 text-caption' : 'px-3 text-label',
        TONE_CLASSES[meta.tone],
        className,
      )}
    >
      <Icon name={meta.icon} className="size-4" />
      <span>{meta.label}</span>
    </span>
  );
}
