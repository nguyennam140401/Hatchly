import { DISPLAY_STATUS_LABELS, type DisplayStatus } from '@app/shared/publishing';
import { Icon, type IconName } from '../../ui/icons/Icon';
import { cn } from '../../ui/util/cn';
import { TONE_CLASSES } from '../../ui/util/tone';

const META: Record<DisplayStatus, { icon: IconName; tone: keyof typeof TONE_CLASSES }> = {
  scheduled: { icon: 'clock', tone: 'info' },
  publishing: { icon: 'refresh', tone: 'brand' },
  needs_action: { icon: 'alert', tone: 'warning' },
  published: { icon: 'check', tone: 'success' },
  cancelled: { icon: 'x', tone: 'neutral' },
};

/** Trạng thái của MỘT kênh – luôn CHỮ + BIỂU TƯỢNG, không chỉ dựa vào màu (nguyên tắc VI). Chỉ 5 giá trị hiển thị. */
export function ChannelStatusBadge({ status }: { status: DisplayStatus }) {
  const meta = META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-pill px-3 text-label font-semibold',
        TONE_CLASSES[meta.tone],
      )}
    >
      <Icon name={meta.icon} className="size-4" />
      <span>{DISPLAY_STATUS_LABELS[status].labelVi}</span>
    </span>
  );
}
