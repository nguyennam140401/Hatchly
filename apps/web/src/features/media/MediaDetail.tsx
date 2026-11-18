import type { MediaItem } from '@app/shared/media';
import { useEffect } from 'react';
import { mediaApi } from '../../lib/api/endpoints/media';
import { ErrorNotice } from '../../lib/api/ErrorNotice';
import { useApiQuery } from '../../lib/api/hooks';
import { queryKeys } from '../../lib/api/query-keys';
import { formatDateTime } from '../../lib/format/datetime';
import { formatBytes } from '../../lib/format/number';
import { Button } from '../../ui/button/Button';
import { Modal, ModalClose } from '../../ui/alert/Modal';
import { Skeleton } from '../../ui/feedback/Skeleton';
import { formatDuration, MEDIA_KIND_LABELS, MEDIA_STATUS_LABELS } from './labels';

// Hộp chi tiết (014 contracts/media-ui.md mục 1, 6): mở bằng `/media?item=<mediaId>` (chia sẻ được). Ảnh dùng bản chuẩn hóa,
// video dùng `<video controls preload="metadata">`; đường dẫn xem trước hết hạn ≤ 1 giờ ⇒ tự gọi lại, không hiện lỗi.

// Làm mới trước khi hết hạn xem trước (1 giờ): 50 phút.
const PREVIEW_REFRESH_MS = 50 * 60_000;

export function MediaDetail({
  mediaId,
  onClose,
  onDelete,
}: {
  mediaId: string;
  onClose: () => void;
  onDelete: (item: MediaItem) => void;
}) {
  const query = useApiQuery(queryKeys.media.detail(mediaId), () => mediaApi.get(mediaId), {
    freshness: 'entity',
    refetchInterval: PREVIEW_REFRESH_MS,
  });
  const detail = query.data;

  // Đường dẫn xem trước lỗi (hết hạn) ⇒ lấy lại âm thầm.
  const refetch = query.refetch;
  useEffect(() => {
    if (detail === undefined) return;
    const timer = setTimeout(() => {
      void refetch();
    }, PREVIEW_REFRESH_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [detail, refetch]);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={detail?.displayName ?? 'Chi tiết ảnh/video'}
    >
      {query.isPending && <Skeleton />}
      {query.isError && detail === undefined && (
        <ErrorNotice error={query.error} onRetry={() => void refetch()} />
      )}
      {detail !== undefined && (
        <div className="flex flex-col gap-3">
          {detail.previewUrl !== null &&
            (detail.kind === 'image' ? (
              <img
                src={detail.previewUrl}
                alt={detail.displayName}
                className="max-h-96 w-full rounded-md object-contain"
                onError={() => void refetch()}
              />
            ) : (
              <video
                src={detail.previewUrl}
                controls
                preload="metadata"
                className="max-h-96 w-full rounded-md"
                onError={() => void refetch()}
              >
                <track kind="captions" />
              </video>
            ))}
          {detail.previewUrl === null && (
            <p className="text-body text-ink-muted">
              {detail.status === 'processing'
                ? 'Đang xử lý – ảnh xem trước sẽ có sau ít phút.'
                : (detail.failure?.action ?? 'Không có ảnh xem trước.')}
            </p>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body-sm">
            <dt className="text-ink-muted">Loại</dt>
            <dd className="text-ink">{MEDIA_KIND_LABELS[detail.kind]}</dd>
            <dt className="text-ink-muted">Trạng thái</dt>
            <dd className="text-ink">{MEDIA_STATUS_LABELS[detail.status].text}</dd>
            <dt className="text-ink-muted">Dung lượng</dt>
            <dd className="text-ink">{formatBytes(detail.originalBytes)}</dd>
            {detail.width !== null && detail.height !== null && (
              <>
                <dt className="text-ink-muted">Kích thước</dt>
                <dd className="text-ink">
                  {detail.width} × {detail.height} điểm ảnh
                </dd>
              </>
            )}
            {detail.durationMs !== null && (
              <>
                <dt className="text-ink-muted">Thời lượng</dt>
                <dd className="text-ink">{formatDuration(detail.durationMs)}</dd>
              </>
            )}
            <dt className="text-ink-muted">Ngày tải</dt>
            <dd className="text-ink">{formatDateTime(detail.createdAt)}</dd>
            <dt className="text-ink-muted">Người tải</dt>
            <dd className="text-ink">{detail.uploadedBy.displayName ?? 'Thành viên đã rời'}</dd>
          </dl>
          <div className="flex flex-wrap justify-end gap-2">
            {detail.canDelete && (
              <Button
                variant="secondary"
                onClick={() => {
                  onDelete(detail);
                }}
              >
                Xóa
              </Button>
            )}
            <ModalClose asChild>
              <Button variant="primary">Đóng</Button>
            </ModalClose>
          </div>
        </div>
      )}
    </Modal>
  );
}
