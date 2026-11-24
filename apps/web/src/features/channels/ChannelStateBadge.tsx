import { Icon } from '../../ui/icons/Icon';
import { cn } from '../../ui/util/cn';
import { TONE_CLASSES } from '../../ui/util/tone';
import { CHANNEL_STATE_META, type ChannelCardState } from './channel-state';

/** Trạng thái kênh: LUÔN chữ + biểu tượng (✔ ⏳ ⚠ ⛔ ⏸), không chỉ dựa vào màu. */
export function ChannelStateBadge({ state }: { state: ChannelCardState }) {
  const meta = CHANNEL_STATE_META[state];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-pill px-3 text-label font-semibold',
        TONE_CLASSES[meta.tone],
      )}
    >
      <Icon name={meta.icon} className="size-4" />
      <span>{meta.label}</span>
    </span>
  );
}
