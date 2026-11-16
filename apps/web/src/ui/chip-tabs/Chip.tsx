import { t } from '../../lib/i18n/t';
import { Icon } from '../icons/Icon';
import { cn } from '../util/cn';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onClick?: () => void;
  /** Có nút bỏ chip (thẻ từ khóa/hashtag). */
  onRemove?: () => void;
  className?: string;
}

export function Chip({ label, selected = false, onClick, onRemove, className }: ChipProps) {
  const base =
    'inline-flex min-h-touch items-center gap-2 rounded-pill border px-4 text-label focus-visible:ring-2 focus-visible:ring-brand';
  const tone = selected
    ? 'border-brand bg-brand-soft text-brand'
    : 'border-line-strong bg-surface-0 text-ink';
  return (
    <span className={cn('inline-flex items-center', className)}>
      {onClick !== undefined ? (
        <button type="button" aria-pressed={selected} onClick={onClick} className={cn(base, tone)}>
          {selected && <Icon name="check" className="size-4" />}
          {label}
        </button>
      ) : (
        <span className={cn(base, tone)}>
          {selected && <Icon name="check" className="size-4" />}
          {label}
        </span>
      )}
      {onRemove !== undefined && (
        <button
          type="button"
          aria-label={`${t('common.remove')}: ${label}`}
          onClick={onRemove}
          className="flex size-touch items-center justify-center rounded-md text-ink-muted focus-visible:ring-2 focus-visible:ring-brand"
        >
          <Icon name="x" className="size-4" />
        </button>
      )}
    </span>
  );
}
