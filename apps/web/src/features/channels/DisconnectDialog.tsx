import type { ChannelOverviewItem, DisconnectResponse } from '@app/shared/platform_gateway';
import { channelsApi } from '../../lib/api/endpoints/channels';
import { ErrorNotice } from '../../lib/api/ErrorNotice';
import { useApiMutation, useApiQuery } from '../../lib/api/hooks';
import { MUTATIONS } from '../../lib/api/mutations';
import { queryKeys } from '../../lib/api/query-keys';
import { t } from '../../lib/i18n/t';
import { Modal, ModalClose } from '../../ui/alert/Modal';
import { Button } from '../../ui/button/Button';
import { platformLabel } from './channel-state';

// Hộp xác nhận ngắt kết nối (US7): mở bằng `disconnect-preview` → nêu số bài đã lên lịch cho RIÊNG kênh này + Instagram phụ thuộc
// (FR-042) + "bài và lịch sử đã đăng vẫn được giữ"; nút mô tả hậu quả ("Ngắt và xóa quyền"). Bẫy tiêu điểm + Esc do Modal (Radix).

export interface DisconnectDialogProps {
  item: ChannelOverviewItem;
  onClose: () => void;
  /** Gọi sau khi ngắt xong, kèm kết quả (`revoked='failed'` ⇒ cha hiện `hintVi`). */
  onDisconnected: (result: DisconnectResponse) => void;
}

export function DisconnectDialog({ item, onClose, onDisconnected }: DisconnectDialogProps) {
  const preview = useApiQuery(
    queryKeys.channels.disconnectPreview(item.connectionId),
    () => channelsApi.disconnectPreview(item.connectionId),
    { freshness: 'volatile' },
  );
  const remove = useApiMutation({
    operation: MUTATIONS.disconnectChannel.operation,
    fn: () => channelsApi.disconnect(item.connectionId),
    invalidates: () => MUTATIONS.disconnectChannel.invalidates(undefined, undefined),
  });
  const data = preview.data;

  return (
    <Modal
      open
      role="alertdialog"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Ngắt kết nối ${platformLabel(item.channelType)} "${item.displayName}"?`}
      description="Ứng dụng sẽ xóa quyền đăng bài của kênh này ngay."
    >
      <div className="flex flex-col gap-3">
        {preview.isPending && <p aria-busy="true">Đang kiểm tra ảnh hưởng…</p>}
        {preview.error !== null && (
          <ErrorNotice
            error={preview.error}
            actions={[{ kind: 'retry', label: 'Thử lại' }]}
            onRetry={() => {
              void preview.refetch();
            }}
          />
        )}
        {data !== undefined && (
          <ul className="flex flex-col gap-2 text-body">
            {data.scheduledImpact.count > 0 && (
              <li>{t('channels.disconnect.scheduled', { count: data.scheduledImpact.count })}</li>
            )}
            {data.dependents.map((d) => (
              <li key={d.connectionId}>
                {t('channels.disconnect.dependent', { name: d.displayName })}
              </li>
            ))}
            <li>{t('channels.disconnect.kept')}</li>
          </ul>
        )}
        {remove.error !== null && (
          <ErrorNotice
            error={remove.error}
            actions={[{ kind: 'retry', label: 'Thử lại' }]}
            onRetry={() => {
              remove.reset();
            }}
          />
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <ModalClose asChild>
            <Button variant="secondary">{t('channels.disconnect.keep')}</Button>
          </ModalClose>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() => {
              remove.mutate(undefined, { onSuccess: onDisconnected });
            }}
          >
            {t('channels.disconnect.confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
