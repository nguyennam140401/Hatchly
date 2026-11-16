import { formatCount } from '../../lib/format/number';
import { cn } from '../util/cn';

export interface ProgressRowProps {
  label: string;
  done: number;
  total: number;
  className?: string;
}

export function ProgressRow({ label, done, total, className }: ProgressRowProps) {
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const text = `${formatCount(done)}/${formatCount(total)} (${String(percent)}%)`;
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between text-body-sm">
        <span className="min-w-0 truncate text-ink">{label}</span>
        <span className="text-label text-ink">{text}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={Math.min(done, total)}
        aria-valuetext={text}
        className="h-2 w-full overflow-hidden rounded-pill bg-surface-200"
      >
        <div
          className="h-full w-(--progress) rounded-pill bg-brand"
          style={{ '--progress': `${String(percent)}%` } as React.CSSProperties}
        />
      </div>
    </div>
  );
}
