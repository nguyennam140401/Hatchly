import { MEDIA_LIMITS, type Quota } from '@app/shared/media';
import { useMemo, useRef } from 'react';
import { formatBytes } from '../../lib/format/number';
import { useUploadQueue } from '../../lib/upload/useUploadQueue';
import type { UploadItem } from '../../lib/upload/queue';
import { InlineAlert } from '../../ui/alert/InlineAlert';
import { Button } from '../../ui/button/Button';
import { UploadQueue } from '../../ui/upload/UploadQueue';
import { FileField } from '../../ui/upload/FileField';
import { createMediaTransport } from './upload-transport';

// Khu tải lên (014 contracts/media-ui.md mục 2, 5): nút "Chọn tệp" + "Chụp ảnh" + kéo thả (luôn có nút thay thế bàn phím),
// hàng đợi tiến độ từng tệp, lý do + cách khắc phục theo từng tệp. Tệp tải THẲNG lên kho; ở đây chỉ điều phối.

const ACCEPT =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,video/mp4,video/quicktime';

export interface UploadPanelProps {
  quota: Quota | undefined;
  /** Một tệp kết thúc (xong hoặc trùng) – để làm mới lưới và dung lượng, không tải lại cả trang. */
  onSettled: (item: UploadItem) => void;
  /** Mở một tệp đã có trong thư viện (tệp trùng nội dung). */
  onOpenExisting: (mediaId: string) => void;
}

export function UploadPanel({ quota, onSettled, onOpenExisting }: UploadPanelProps) {
  const transport = useMemo(() => createMediaTransport(), []);
  const { queue, items } = useUploadQueue({ transport, onSettled });
  const cameraRef = useRef<HTMLInputElement>(null);
  const full = quota?.state === 'full';

  return (
    <section
      aria-label="Tải lên"
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface-0 p-4"
    >
      {full && (
        <InlineAlert tone="warning" title="Thư viện đã đầy">
          Bạn chưa tải thêm được. Hãy xóa bớt ảnh/video cũ rồi tải lại; xem, xóa, soạn và đăng bài
          vẫn dùng bình thường.{' '}
          <a href="#media-grid" className="underline">
            Xem danh sách để xóa
          </a>
        </InlineAlert>
      )}
      <FileField
        label="Tải ảnh hoặc video lên"
        help={`Ảnh ≤ ${formatBytes(MEDIA_LIMITS.imageMaxBytes)} · video ≤ ${formatBytes(MEDIA_LIMITS.videoMaxBytes)}`}
        accept={ACCEPT}
        disabled={full}
        buttonLabel="Chọn tệp"
        onFiles={(files) => {
          queue.add(files);
        }}
      />
      <div>
        <Button
          variant="secondary"
          locked={full}
          lockedReason={full ? 'Thư viện đã đầy' : undefined}
          onClick={() => {
            cameraRef.current?.click();
          }}
        >
          Chụp ảnh
        </Button>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-label="Chụp ảnh bằng camera"
          onChange={(event) => {
            queue.add([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
      </div>
      <UploadQueue
        items={items}
        onCancel={queue.cancel}
        onRetry={queue.retry}
        onDismiss={queue.dismiss}
        onOpenExisting={onOpenExisting}
        freeUpHref="#media-grid"
        renewHref="/settings"
      />
    </section>
  );
}
