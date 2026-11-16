import { t } from '../../lib/i18n/t';
import { cn } from '../util/cn';

export interface DayCellProps {
  /** Thứ viết tắt (T2…CN) do nơi gọi truyền. */
  weekday: string;
  day: number;
  today?: boolean;
  selected?: boolean;
  /** Số bài trong ngày. */
  count?: number;
  onSelect?: () => void;
}

export function DayCell({
  weekday,
  day,
  today = false,
  selected = false,
  count = 0,
  onSelect,
}: DayCellProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-current={today ? 'date' : undefined}
      onClick={onSelect}
      className={cn(
        'flex min-h-touch min-w-touch flex-col items-center justify-center gap-1 rounded-md border px-2 py-2 focus-visible:ring-2 focus-visible:ring-brand',
        selected ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface-0 text-ink',
      )}
    >
      <span className="text-caption text-ink-muted">{weekday}</span>
      <span className={cn('text-heading', today && 'underline')}>{day}</span>
      {count > 0 && (
        <span className="text-caption">
          {count} {t('calendar.posts')}
        </span>
      )}
    </button>
  );
}
