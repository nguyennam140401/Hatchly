import type { ChannelOverviewItem } from '@app/shared/platform_gateway';
import { t } from '../../lib/i18n/t';

/**
 * Instagram: "Liên kết qua Page: *tên Page*" + cảnh báo khi Page nguồn hỏng (FR-042). Tên Page là văn bản thuần.
 * Instagram không có Page nguồn (liên kết sau) → không vẽ gì.
 */
export function SourcePageNote({ item }: { item: ChannelOverviewItem }) {
  if (item.channelType !== 'instagram' || item.sourceConnectionId === null) return null;
  const lost = item.reasonCode === 'SOURCE_PAGE_LOST';
  return (
    <div className="flex flex-col gap-1 text-body">
      <p>{t('channels.sourcePage', { name: item.sourceDisplayName ?? '—' })}</p>
      {lost && (
        <p role="note" className="text-danger">
          <span aria-hidden="true">⚠ </span>
          Page này đang cần kết nối lại nên Instagram chưa đăng bài được.
        </p>
      )}
    </div>
  );
}
