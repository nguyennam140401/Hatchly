import type { Quota } from '@app/shared/media';
import { formatBytes } from '../../lib/format/number';
import { Icon } from '../../ui/icons/Icon';
import { cn } from '../../ui/util/cn';

// Thanh dung lượng (014 FR-010): "Đã dùng 1,2 / 5 GB", cảnh báo "Sắp đầy" ≥ 80% và "Đầy" ở 100% bằng chữ + biểu tượng.
// CHỈ hiện dung lượng (MB/GB cơ số 1024) – không số tiền nào (hiến pháp III; tính năng này không gọi AI).

const BAR = { ok: 'bg-brand', near_full: 'bg-warning', full: 'bg-danger' } as const;

export function QuotaMeter({ quota }: { quota: Quota }) {
  const used = quota.usedBytes + quota.reservedBytes;
  const limit = formatBytes(quota.limitBytes).replace(/\s*GB$/, '');
  const text = `Đã dùng ${formatBytes(used)} / ${limit} GB`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-body-sm">
        <span className="text-ink">{text}</span>
        {quota.state !== 'ok' && (
          <span className="flex items-center gap-1 text-label text-ink">
            <Icon name="alert" className="size-4" />
            {quota.state === 'full' ? 'Đầy' : 'Sắp đầy'}
          </span>
        )}
      </div>
      <div
        role="progressbar"
        aria-label="Dung lượng thư viện đã dùng"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={quota.percent}
        aria-valuetext={`${String(quota.percent)}% – ${text}`}
        className="h-2 w-full overflow-hidden rounded-pill bg-surface-200"
      >
        <div
          className={cn('h-full w-(--meter) rounded-pill', BAR[quota.state])}
          style={{ '--meter': `${String(quota.percent)}%` } as React.CSSProperties}
        />
      </div>
    </div>
  );
}
