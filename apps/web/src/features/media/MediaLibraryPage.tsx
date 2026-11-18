import type { MediaItem } from '@app/shared/media';
import { useState } from 'react';
import { AsyncBoundary } from '../../app/AsyncBoundary';
import { mediaApi, type MediaListParams } from '../../lib/api/endpoints/media';
import { ErrorNotice } from '../../lib/api/ErrorNotice';
import { useApiQuery, useInvalidate } from '../../lib/api/hooks';
import { queryKeys } from '../../lib/api/query-keys';
import { useUrlState } from '../../lib/url-state';
import { Button } from '../../ui/button/Button';
import { Page } from '../../ui/layout/Page';
import { PageHeader } from '../../ui/layout/PageHeader';
import { DeleteMediaDialog } from './DeleteMediaDialog';
import { MediaDetail } from './MediaDetail';
import {
  MediaFilters,
  endOfDayVn,
  startOfDayVn,
  type KindFilter,
  type MediaFilterValues,
} from './MediaFilters';
import { MediaGrid } from './MediaGrid';
import { QuotaMeter } from './QuotaMeter';
import { UploadPanel } from './UploadPanel';

// Màn hình "Thư viện ảnh & video" (014 contracts/media-ui.md): thanh dung lượng, khu tải lên, bộ lọc, lưới nạp dần.
// Quyền chỉ để ẩn/hiện (mục "Thư viện" trong thanh điều hướng); API tự chặn. Không số tiền nào ở màn này.

const PROCESSING_POLL_MS = 4000;

/** Một trang của lưới; trang kế được nạp khi người dùng bấm "Xem thêm" (đệ quy theo con trỏ). */
function GridPage({
  params,
  onOpen,
  onDelete,
}: {
  params: MediaListParams;
  onOpen: (item: MediaItem) => void;
  onDelete: (item: MediaItem) => void;
}) {
  const [more, setMore] = useState(false);
  const query = useApiQuery(
    queryKeys.media.list(params),
    ({ signal }) => mediaApi.list(params, signal),
    {
      freshness: 'entity',
      // Còn ô "Đang xử lý" ⇒ hỏi lại định kỳ để chuyển sang "Sẵn sàng" mà không phải tải lại trang.
      refetchInterval: (data) =>
        data?.items.some((i) => i.status === 'processing') === true ? PROCESSING_POLL_MS : false,
    },
  );
  const isFirst = params.cursor === undefined;
  return (
    <>
      <AsyncBoundary
        query={query}
        isEmpty={(d) => isFirst && d.items.length === 0}
        empty={{
          message:
            'Chưa có ảnh/video nào. Tải ảnh/video đầu tiên ở trên (ảnh ≤ 20 MB, video ≤ 500 MB).',
        }}
      >
        {(data) => (
          <div className="flex flex-col gap-3">
            <MediaGrid items={data.items} onOpen={onOpen} onDelete={onDelete} />
            {data.nextCursor !== null && !more && (
              <div className="flex justify-center">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setMore(true);
                  }}
                >
                  Xem thêm
                </Button>
              </div>
            )}
            {data.nextCursor !== null && more && (
              <GridPage
                params={{ ...params, cursor: data.nextCursor }}
                onOpen={onOpen}
                onDelete={onDelete}
              />
            )}
          </div>
        )}
      </AsyncBoundary>
    </>
  );
}

export function MediaLibraryPage() {
  const [kind, setKind] = useUrlState('kind', 'all');
  const [from, setFrom] = useUrlState('from', '');
  const [to, setTo] = useUrlState('to', '');
  const [q, setQ] = useUrlState('q', '');
  const [item, setItem] = useUrlState('item', '');
  const [toDelete, setToDelete] = useState<Pick<MediaItem, 'id' | 'displayName' | 'kind'> | null>(
    null,
  );
  const invalidate = useInvalidate();

  const values: MediaFilterValues = { kind: kind as KindFilter, from, to, q };
  const params: MediaListParams = {
    ...(kind === 'image' || kind === 'video' ? { kind } : {}),
    ...(from !== '' ? { from: startOfDayVn(from) } : {}),
    ...(to !== '' ? { to: endOfDayVn(to) } : {}),
    ...(q.trim() !== '' ? { q: q.trim() } : {}),
  };
  // Trang đầu cũng dùng để lấy dung lượng (kèm trong phản hồi danh sách).
  const first = useApiQuery(
    queryKeys.media.list(params),
    ({ signal }) => mediaApi.list(params, signal),
    {
      freshness: 'entity',
    },
  );

  const onChange = (key: keyof MediaFilterValues, value: string) => {
    const set = { kind: setKind, from: setFrom, to: setTo, q: setQ }[key];
    set(value === '' ? null : value);
  };
  const refresh = () => {
    invalidate(queryKeys.media.lists());
  };
  const openItem = (media: MediaItem) => {
    setItem(media.id);
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-gutter py-6">
      <Page busy={first.isPending}>
        <PageHeader
          title="Thư viện ảnh & video"
          description="Tải lên, xem và quản lý ảnh, video của bạn."
        />
        {first.data !== undefined && <QuotaMeter quota={first.data.quota} />}
        <UploadPanel
          quota={first.data?.quota}
          onSettled={refresh}
          onOpenExisting={(id) => {
            setItem(id);
          }}
        />
        <MediaFilters values={values} onChange={onChange} />
        <div id="media-grid">
          {first.isError && first.data === undefined ? (
            <ErrorNotice
              error={first.error}
              onRetry={() => {
                void first.refetch();
              }}
            />
          ) : (
            <GridPage params={params} onOpen={openItem} onDelete={setToDelete} />
          )}
        </div>
        {item !== '' && (
          <MediaDetail
            mediaId={item}
            onClose={() => {
              setItem(null);
            }}
            onDelete={(m) => {
              setToDelete(m);
            }}
          />
        )}
        {toDelete !== null && (
          <DeleteMediaDialog
            item={toDelete}
            onClose={() => {
              setToDelete(null);
            }}
            onDeleted={() => {
              setToDelete(null);
              if (item === toDelete.id) setItem(null);
            }}
          />
        )}
      </Page>
    </div>
  );
}
