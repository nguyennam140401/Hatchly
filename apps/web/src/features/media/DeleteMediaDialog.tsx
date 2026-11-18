import type { MediaItem, MediaUsage } from '@app/shared/media';
import { Link } from 'react-router';
import { mediaApi } from '../../lib/api/endpoints/media';
import { ErrorNotice } from '../../lib/api/ErrorNotice';
import { useApiMutation, useApiQuery } from '../../lib/api/hooks';
import { MUTATIONS } from '../../lib/api/mutations';
import { queryKeys } from '../../lib/api/query-keys';
import { toDisplayStatus } from '../../lib/catalogs/post-status';
import { StatusBadge } from '../../ui/badge/StatusBadge';
import { Button } from '../../ui/button/Button';
import { Modal, ModalClose } from '../../ui/alert/Modal';
import { Skeleton } from '../../ui/feedback/Skeleton';

// Hộp xác nhận xóa (014 FR-021, contracts/media-ui.md mục 4): luôn tra "bài nào đang dùng" TRƯỚC khi cho xóa.
//  - có bài đã duyệt/đã lên lịch ⇒ CHỈ thông báo, KHÔNG có nút xóa, kèm hướng dẫn đổi media ở bài;
//  - chỉ có bài nháp/chờ duyệt/đã đăng ⇒ liệt kê TỪNG bài + hậu quả, hai nút "Xóa" / "Giữ lại";
//  - không bài nào ⇒ xác nhận ngắn "Dung lượng sẽ được trả lại ngay".

const BLOCKING = ['approved', 'scheduled'];

function UsageList({ usages }: { usages: readonly MediaUsage[] }) {
  return (
    <ul className="flex flex-col gap-2" aria-label="Bài đang dùng ảnh/video này">
      {usages.map((u) => (
        <li
          key={u.postId}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line p-2"
        >
          <Link className="text-label text-brand underline" to={`/posts/${u.postId}`}>
            {u.postTitle}
          </Link>
          <StatusBadge status={toDisplayStatus(u.postStatus)} size="sm" />
        </li>
      ))}
    </ul>
  );
}

export function DeleteMediaDialog({
  item,
  onClose,
  onDeleted,
}: {
  item: Pick<MediaItem, 'id' | 'displayName' | 'kind'>;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const usages = useApiQuery(queryKeys.media.usages(item.id), () => mediaApi.usages(item.id), {
    freshness: 'entity',
  });
  const remove = useApiMutation({
    operation: MUTATIONS.deleteMedia.operation,
    fn: (confirm: boolean) => mediaApi.remove(item.id, confirm),
    invalidates: () => MUTATIONS.deleteMedia.invalidates(undefined, undefined),
  });
  const what = item.kind === 'video' ? 'video' : 'ảnh';
  const data = usages.data;
  const blocking = data?.blocking === true;
  const used = (data?.usages.length ?? 0) > 0;
  const blockingCount = data?.usages.filter((u) => BLOCKING.includes(u.postStatus)).length ?? 0;

  const confirmDelete = (confirm: boolean) => {
    remove.mutate(confirm, { onSuccess: onDeleted });
  };

  return (
    <Modal
      open
      role="alertdialog"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={blocking ? `Chưa xóa được ${what} này` : `Xóa ${what} này?`}
      description={item.displayName}
    >
      {usages.isPending && <Skeleton />}
      {usages.isError && data === undefined && (
        <ErrorNotice error={usages.error} onRetry={() => void usages.refetch()} />
      )}
      {data !== undefined && blocking && (
        <div className="flex flex-col gap-3">
          <p className="text-body text-ink">
            {`${what === 'ảnh' ? 'Ảnh' : 'Video'} đang dùng trong ${String(blockingCount)} bài đã duyệt hoặc đã lên lịch.`}
          </p>
          <UsageList usages={data.usages} />
          <p className="text-body-sm text-ink-muted">Mở bài để đổi ảnh/video rồi quay lại xóa.</p>
          <div className="flex justify-end">
            <ModalClose asChild>
              <Button variant="primary">Đóng</Button>
            </ModalClose>
          </div>
        </div>
      )}
      {data !== undefined && !blocking && (
        <div className="flex flex-col gap-3">
          {used ? (
            <>
              <p className="text-body text-ink">
                {`${what === 'ảnh' ? 'Ảnh' : 'Video'} đang dùng trong ${String(data.usages.length)} bài. Bài nháp sẽ mất ${what} và cần chọn lại trước khi gửi duyệt; bài đã đăng không bị ảnh hưởng.`}
              </p>
              <UsageList usages={data.usages} />
            </>
          ) : (
            <p className="text-body text-ink">{`Xóa ${what} này? Dung lượng sẽ được trả lại ngay.`}</p>
          )}
          {remove.isError && <ErrorNotice error={remove.error} />}
          <div className="flex flex-wrap justify-end gap-2">
            <ModalClose asChild>
              <Button variant="secondary">Giữ lại</Button>
            </ModalClose>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                confirmDelete(used);
              }}
            >
              Xóa
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
