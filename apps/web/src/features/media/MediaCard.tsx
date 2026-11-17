import type { MediaItem } from '@app/shared/media';
import { formatBytes } from '../../lib/format/number';
import { Button } from '../../ui/button/Button';
import { Icon } from '../../ui/icons/Icon';
import { formatDuration, MEDIA_STATUS_LABELS, mediaAriaLabel } from './labels';

// Một ô của lưới thư viện (014 contracts/media-ui.md mục 3, 6): ảnh thu nhỏ có kích thước ô cố định (tránh nhảy bố cục) và
// nạp lười; video có biểu tượng + thời lượng; trạng thái bằng chữ + biểu tượng; "Đang xử lý" chưa chọn được để đính bài.

export interface MediaCardProps {
  item: MediaItem;
  onOpen: (item: MediaItem) => void;
  onDelete: (item: MediaItem) => void;
}

export function MediaCard({ item, onOpen, onDelete }: MediaCardProps) {
  const label = MEDIA_STATUS_LABELS[item.status];
  const broken = item.status === 'unprocessable';
  return (
    <li className="flex flex-col gap-2 rounded-md border border-line bg-surface-0 p-2">
      <button
        type="button"
        aria-label={mediaAriaLabel(item)}
        onClick={() => {
          onOpen(item);
        }}
        className="relative flex aspect-square min-h-touch w-full items-center justify-center overflow-hidden rounded-md bg-surface-100 focus-visible:ring-2 focus-visible:ring-brand"
      >
        {item.thumbUrl !== null && !broken ? (
          <img
            src={item.thumbUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
        ) : (
          <Icon name={item.kind === 'video' ? 'film' : 'image'} className="size-8 text-ink-muted" />
        )}
        {item.kind === 'video' && item.durationMs !== null && (
          <span className="absolute bottom-1 right-1 flex items-center gap-1 rounded-sm bg-ink px-1 text-caption text-on-brand">
            <Icon name="film" className="size-3" />
            {formatDuration(item.durationMs)}
          </span>
        )}
      </button>
      <p className="truncate text-body-sm text-ink" title={item.displayName}>
        {item.displayName}
      </p>
      <p className="flex items-center gap-1 text-caption text-ink-muted">
        <Icon name={label.icon} className="size-4" />
        <span>{label.text}</span>
        <span aria-hidden="true">·</span>
        <span>{formatBytes(item.originalBytes)}</span>
      </p>
      {broken && item.failure !== null && (
        <p className="text-caption text-danger">{item.failure.action}</p>
      )}
      {item.canDelete && (
        <Button
          variant="ghost"
          onClick={() => {
            onDelete(item);
          }}
          aria-label={`Xóa ${item.displayName}`}
        >
          Xóa
        </Button>
      )}
    </li>
  );
}
