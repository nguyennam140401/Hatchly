import { cva, type VariantProps } from 'class-variance-authority';
import { useId, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { formatDate } from '../../lib/format/datetime';
import { t } from '../../lib/i18n/t';
import { Icon, type IconName } from '../icons/Icon';
import { cn } from '../util/cn';

const button = cva(
  'inline-flex min-h-touch min-w-touch items-center justify-center gap-2 rounded-md px-4 text-label ' +
    'focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ' +
    'motion-safe:transition-colors motion-safe:duration-fast',
  {
    variants: {
      variant: {
        primary: 'bg-brand text-on-brand hover:bg-brand-strong',
        secondary: 'border border-line-strong bg-surface-0 text-ink hover:bg-surface-100',
        ghost: 'bg-transparent text-brand hover:bg-brand-soft',
        danger: 'bg-danger text-on-brand hover:opacity-90',
      },
      locked: { true: 'cursor-not-allowed opacity-60', false: '' },
      fullWidth: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', locked: false, fullWidth: false },
  },
);

export interface ButtonProps
  extends
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'>,
    Pick<VariantProps<typeof button>, 'variant' | 'fullWidth'> {
  /** Đang lưu: hiện "Đang lưu…", `aria-busy`, không nhận bấm thêm (chống gửi trùng). */
  loading?: boolean | undefined;
  /** Khóa có lý do: dùng `aria-disabled` (vẫn focus được để đọc lý do), KHÔNG `disabled` thuần. */
  locked?: boolean | undefined;
  lockedReason?: string | undefined;
  reopensAt?: Date | undefined;
  icon?: IconName | undefined;
  children?: ReactNode;
}

export function Button({
  variant,
  fullWidth,
  loading = false,
  locked = false,
  lockedReason,
  reopensAt,
  icon,
  className,
  children,
  onClick,
  type = 'button',
  ...rest
}: ButtonProps) {
  const reasonId = useId();
  const blocked = locked || loading;
  const reason =
    locked && lockedReason !== undefined
      ? reopensAt !== undefined
        ? `${lockedReason} ${t('state.reopensAt', { date: formatDate(reopensAt.toISOString()) })}`
        : lockedReason
      : undefined;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (blocked) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <span className={cn('inline-flex flex-col gap-1', fullWidth === true && 'w-full')}>
      <button
        {...rest}
        type={type}
        aria-disabled={blocked || undefined}
        aria-busy={loading || undefined}
        aria-describedby={reason !== undefined ? reasonId : rest['aria-describedby']}
        className={cn(button({ variant, locked: blocked, fullWidth }), className)}
        onClick={handleClick}
      >
        {icon !== undefined && <Icon name={icon} />}
        {loading ? t('common.saving') : children}
      </button>
      {reason !== undefined && (
        <span id={reasonId} className="text-caption text-ink-muted">
          {reason}
        </span>
      )}
    </span>
  );
}
