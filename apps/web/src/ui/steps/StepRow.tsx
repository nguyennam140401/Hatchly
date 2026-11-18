import { t } from '../../lib/i18n/t';
import { Icon, type IconName } from '../icons/Icon';
import { cn } from '../util/cn';

export interface StepRowProps {
  state: 'done' | 'error' | 'pending';
  /** Bước đang chạy (nhấp nháy bằng `motion-safe`; giảm chuyển động vẫn còn chữ "Đang xử lý"). */
  running?: boolean;
  title: string;
  time?: string;
  explanation?: string;
  /** Cách khắc phục (bước lỗi). */
  remedy?: string;
}

const META: Record<StepRowProps['state'], { icon: IconName; tone: string }> = {
  done: { icon: 'check', tone: 'bg-success-soft text-success' },
  error: { icon: 'alert', tone: 'bg-danger-soft text-danger' },
  pending: { icon: 'clock', tone: 'bg-surface-200 text-ink-muted' },
};

export function StepRow({
  state,
  running = false,
  title,
  time,
  explanation,
  remedy,
}: StepRowProps) {
  const meta = META[state];
  const stateText =
    running && state === 'pending' ? t('step.running') : t(`step.${state}` as 'step.done');
  return (
    <div className="flex gap-3 py-3">
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-pill',
          meta.tone,
          running && 'motion-safe:animate-pulse',
        )}
      >
        <Icon name={meta.icon} className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-label text-ink">{title}</span>
          <span className="text-caption text-ink-muted">
            {stateText}
            {time !== undefined && ` · ${time}`}
          </span>
        </div>
        {explanation !== undefined && <p className="text-body-sm text-ink-muted">{explanation}</p>}
        {remedy !== undefined && <p className="text-body-sm text-ink">{remedy}</p>}
      </div>
    </div>
  );
}
