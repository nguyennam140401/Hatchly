import type { UploadItem } from '../../lib/upload/queue';
import { formatBytes } from '../../lib/format/number';
import { t } from '../../lib/i18n/t';
import { Button } from '../button/Button';
import { Icon } from '../icons/Icon';
import { Tooltip } from '../tooltip/Tooltip';
import { cn } from '../util/cn';

export interface UploadQueueProps {
  items: readonly UploadItem[];
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  /** Liên kết "Xóa bớt tệp" khi kho đầy (tới Thư viện). */
  freeUpHref?: string;
}

const STATUS_TEXT: Record<UploadItem['status'], string> = {
  queued: 'Đang chờ',
  uploading: 'Đang tải',
  done: 'Đã xong',
  error: 'Lỗi',
  canceled: 'Đã hủy',
};

export function UploadQueue({ items, onCancel, onRetry, freeUpHref }: UploadQueueProps) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col gap-3" aria-label="Tệp đang tải lên">
      {items.map((item) => {
        const full = item.errorKind === 'storage_full';
        return (
          <li key={item.id} className="flex flex-col gap-2 rounded-md border border-line bg-surface-0 p-3">
            <div className="flex items-center justify-between gap-2">
              <Tooltip content={item.name}>
                <span className="min-w-0 truncate text-body-sm text-ink">{item.name}</span>
              </Tooltip>
              <span className="shrink-0 text-caption text-ink-muted">{formatBytes(item.size)}</span>
            </div>
            <div className="flex items-center gap-2">
              <div
                role="progressbar"
                aria-label={item.name}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={item.progress}
                aria-valuetext={`${String(item.progress)}%`}
                className="h-2 flex-1 overflow-hidden rounded-pill bg-surface-200"
              >
                <div
                  className={cn('h-full w-(--progress) rounded-pill', item.status === 'error' ? 'bg-danger' : 'bg-brand')}
                  style={{ '--progress': `${String(item.progress)}%` } as React.CSSProperties}
                />
              </div>
              <span className="w-12 text-right text-caption text-ink">{item.progress}%</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-caption text-ink-muted">
                <Icon name={item.status === 'done' ? 'check' : item.status === 'error' ? 'alert' : 'clock'} className="size-4" />
                {STATUS_TEXT[item.status]}
              </span>
              <span className="flex flex-wrap gap-2">
                {(item.status === 'uploading' || item.status === 'queued') && (
                  <Button variant="ghost" onClick={() => { onCancel(item.id); }}>
                    {t('upload.cancel')}
                  </Button>
                )}
                {(item.status === 'canceled' || (item.status === 'error' && item.errorKind !== 'invalid' && !full)) && (
                  <Button variant="secondary" onClick={() => { onRetry(item.id); }}>
                    {t('upload.retry')}
                  </Button>
                )}
                {full && freeUpHref !== undefined && (
                  <a
                    href={freeUpHref}
                    className="inline-flex min-h-touch items-center rounded-md border border-line-strong px-4 text-label text-brand focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    {t('upload.freeUp')}
                  </a>
                )}
              </span>
            </div>
            {item.status === 'error' && (
              <p role="alert" className="text-body-sm text-danger">
                {full ? t('upload.full') : item.error}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
