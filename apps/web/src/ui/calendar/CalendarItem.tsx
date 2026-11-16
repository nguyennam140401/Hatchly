import { POST_STATUS_META, type PostDisplayStatus } from '../../lib/catalogs/post-status';
import { Icon } from '../icons/Icon';
import { Tooltip } from '../tooltip/Tooltip';
import { cn } from '../util/cn';
import { TONE_CLASSES } from '../util/tone';

export interface CalendarItemProps {
  status: Extract<PostDisplayStatus, 'review' | 'scheduled' | 'attention' | 'published'>;
  /** Giờ đã định dạng (UTC+7). */
  time: string;
  title: string;
  onClick?: () => void;
}

export function CalendarItem({ status, time, title, onClick }: CalendarItemProps) {
  const meta = POST_STATUS_META[status];
  const content = (
    <>
      <Icon name={meta.icon} className="size-4" />
      <span className="shrink-0 text-label">{time}</span>
      <span className="min-w-0 truncate text-body-sm">{title}</span>
      <span className="sr-only">{meta.label}</span>
    </>
  );
  const classes = cn(
    'flex min-h-touch w-full items-center gap-2 rounded-sm px-2 text-left focus-visible:ring-2 focus-visible:ring-brand',
    TONE_CLASSES[meta.tone],
  );
  return (
    <Tooltip content={`${time} · ${title} · ${meta.label}`}>
      {onClick !== undefined ? (
        <button type="button" onClick={onClick} className={classes}>
          {content}
        </button>
      ) : (
        <div className={classes}>{content}</div>
      )}
    </Tooltip>
  );
}
