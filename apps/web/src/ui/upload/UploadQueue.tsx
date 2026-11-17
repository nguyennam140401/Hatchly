import type { UploadItem } from '../../lib/upload/queue';
import { formatBytes } from '../../lib/format/number';
import { t } from '../../lib/i18n/t';
import { Button } from '../button/Button';
import { Icon, type IconName } from '../icons/Icon';
import { Tooltip } from '../tooltip/Tooltip';
import { cn } from '../util/cn';

export interface UploadQueueProps {
  items: readonly UploadItem[];
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  /** Liên kết "Xóa bớt tệp" khi kho đầy (tới Thư viện). */
  freeUpHref?: string;
  /** 014: gỡ một dòng đã kết thúc khỏi hàng ("Đóng", gỡ tệp bị từ chối). */
  onDismiss?: (id: string) => void;
  /** 014: mở tệp đã có trong thư viện (tệp trùng nội dung). */
  onOpenExisting?: (mediaId: string) => void;
  /** 014: liên kết "Gia hạn gói" khi gói hết hạn. */
  renewHref?: string;
}

const STATUS_TEXT: Record<UploadItem['status'], string> = {
  queued: 'Đang chờ tải',
  uploading: 'Đang tải',
  waiting_network: 'Tạm dừng – đang chờ mạng',
  processing: 'Đang xử lý',
  done: 'Đã xong',
  duplicate: 'Tệp này đã có trong thư viện',
  error: 'Lỗi',
  canceled: 'Đã hủy',
};

const STATUS_ICON: Record<UploadItem['status'], IconName> = {
  queued: 'clock',
  uploading: 'clock',
  waiting_network: 'alert',
  processing: 'refresh',
  done: 'check',
  duplicate: 'info',
  error: 'alert',
  canceled: 'x',
};

const linkClass =
  'inline-flex min-h-touch items-center rounded-md border border-line-strong px-4 text-label text-brand focus-visible:ring-2 focus-visible:ring-brand';

function statusText(item: UploadItem): string {
  if (item.status === 'done' && item.mediaStatus === 'unprocessable') return 'Không xử lý được';
  if (item.status === 'done' && item.mediaStatus === 'ready') return 'Sẵn sàng';
  if (item.status === 'uploading') return `Đang tải ${String(item.progress)}%`;
  return STATUS_TEXT[item.status];
}

export function UploadQueue({
  items,
  onCancel,
  onRetry,
  freeUpHref,
  onDismiss,
  onOpenExisting,
  renewHref,
}: UploadQueueProps) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col gap-3" aria-label="Tệp đang tải lên">
      {items.map((item) => {
        const full = item.errorKind === 'storage_full';
        const planExpired = item.errorKind === 'plan_expired';
        const finished = item.status === 'done' || item.status === 'duplicate';
        const active =
          item.status === 'uploading' ||
          item.status === 'queued' ||
          item.status === 'waiting_network';
        return (
          <li
            key={item.id}
            className="flex flex-col gap-2 rounded-md border border-line bg-surface-0 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <Tooltip content={item.name}>
                <span className="min-w-0 truncate text-body-sm text-ink">{item.name}</span>
              </Tooltip>
              <span className="shrink-0 text-caption text-ink-muted">{formatBytes(item.size)}</span>
            </div>
            {item.status !== 'duplicate' && (
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
                    className={cn(
                      'h-full w-(--progress) rounded-pill',
                      item.status === 'error' ? 'bg-danger' : 'bg-brand',
                    )}
                    style={{ '--progress': `${String(item.progress)}%` } as React.CSSProperties}
                  />
                </div>
                <span className="w-12 text-right text-caption text-ink">{item.progress}%</span>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span
                className="flex items-center gap-1 text-caption text-ink-muted"
                aria-live="polite"
              >
                <Icon name={STATUS_ICON[item.status]} className="size-4" />
                {statusText(item)}
              </span>
              <span className="flex flex-wrap gap-2">
                {active && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      onCancel(item.id);
                    }}
                  >
                    {t('upload.cancel')}
                  </Button>
                )}
                {(item.status === 'canceled' ||
                  (item.status === 'error' &&
                    item.errorKind !== 'invalid' &&
                    !full &&
                    !planExpired)) && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      onRetry(item.id);
                    }}
                  >
                    {t('upload.retry')}
                  </Button>
                )}
                {item.status === 'duplicate' &&
                  item.duplicateOf !== undefined &&
                  onOpenExisting !== undefined && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        if (item.duplicateOf !== undefined)
                          onOpenExisting(item.duplicateOf.mediaId);
                      }}
                    >
                      Xem tệp đã có
                    </Button>
                  )}
                {full && freeUpHref !== undefined && (
                  <a href={freeUpHref} className={linkClass}>
                    Xem danh sách để xóa
                  </a>
                )}
                {planExpired && renewHref !== undefined && (
                  <a href={renewHref} className={linkClass}>
                    Gia hạn gói
                  </a>
                )}
                {onDismiss !== undefined &&
                  (finished ||
                    item.status === 'canceled' ||
                    (item.status === 'error' && item.errorKind === 'invalid')) && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        onDismiss(item.id);
                      }}
                    >
                      {item.status === 'error' ? 'Gỡ khỏi hàng' : 'Đóng'}
                    </Button>
                  )}
              </span>
            </div>
            {item.notice !== undefined && (
              <p role="status" className="text-body-sm text-ink-muted">
                {item.notice}
              </p>
            )}
            {item.status === 'done' && item.mediaStatus === 'unprocessable' && (
              <p role="alert" className="text-body-sm text-danger">
                Hãy thử xuất lại ảnh từ máy rồi tải lên lại. Tệp này có trong thư viện để bạn xóa.
              </p>
            )}
            {item.status === 'error' && (
              <p role="alert" className="text-body-sm text-danger">
                {full && (item.error === undefined || item.error === '')
                  ? t('upload.full')
                  : item.error}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
