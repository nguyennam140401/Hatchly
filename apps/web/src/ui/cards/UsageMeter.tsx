import { formatCount } from '../../lib/format/number';
import { t } from '../../lib/i18n/t';
import { Icon } from '../icons/Icon';
import { cn } from '../util/cn';

export interface UsageMeterProps {
  label: string;
  /** Số đã dùng. CHỈ nhận số đếm/phần trăm – KHÔNG bao giờ nhận số tiền (hiến pháp III). */
  value: number;
  limit: number;
  level: 'normal' | 'warning' | 'exhausted';
  /** Hiện "value/limit" (số đếm) hay "%" (mặc định đếm). */
  unit?: 'count' | 'percent';
  className?: string;
}

const BAR: Record<UsageMeterProps['level'], string> = {
  normal: 'bg-brand',
  warning: 'bg-warning',
  exhausted: 'bg-danger',
};

export function UsageMeter({
  label,
  value,
  limit,
  level,
  unit = 'count',
  className,
}: UsageMeterProps) {
  const percent = limit > 0 ? Math.min(100, Math.max(0, (value / limit) * 100)) : 0;
  // Phần trăm làm tròn XUỐNG, khớp server getUsage (FR-029/SC-004); epsilon chặn lỗi số thực (29/100*100).
  const text =
    unit === 'percent'
      ? `${String(Math.floor(percent + 1e-9))}%`
      : `${formatCount(value)}/${formatCount(limit)}`;
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between gap-2 text-body-sm">
        <span className="min-w-0 truncate text-ink">{label}</span>
        <span className="flex items-center gap-1 text-label text-ink">
          {level !== 'normal' && <Icon name="alert" className="size-4" />}
          {level === 'warning' && <span>{t('usage.near')}</span>}
          {level === 'exhausted' && <span>{t('usage.exhausted')}</span>}
          <span>{text}</span>
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(value, limit)}
        aria-valuetext={text}
        className="h-2 w-full overflow-hidden rounded-pill bg-surface-200"
      >
        <div
          className={cn('h-full w-(--meter) rounded-pill', BAR[level])}
          style={{ '--meter': `${String(percent)}%` } as React.CSSProperties}
        />
      </div>
    </div>
  );
}
