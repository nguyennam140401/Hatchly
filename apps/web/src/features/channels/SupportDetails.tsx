import type { ChannelOverviewItem } from '@app/shared/platform_gateway';
import { t } from '../../lib/i18n/t';

/** "Chi tiết cho hỗ trợ": thu gọn mặc định; mã lỗi gốc CHỈ hiện ở đây (nguyên tắc VI). Không bí mật nào có ở dữ liệu này. */
export function SupportDetails({ item }: { item: ChannelOverviewItem }) {
  return (
    <details className="text-caption text-ink-muted">
      <summary className="min-h-touch cursor-pointer py-3">{t('channels.supportDetails')}</summary>
      <dl className="flex flex-col gap-1 pb-2">
        <div className="flex gap-2">
          <dt>Mã kênh:</dt>
          <dd>{item.shortCode}</dd>
        </div>
        <div className="flex gap-2">
          <dt>Mã lỗi gần nhất:</dt>
          <dd>{item.supportDetails.lastErrorCode ?? 'không có'}</dd>
        </div>
        {item.reasonCode !== null && (
          <div className="flex gap-2">
            <dt>Lý do:</dt>
            <dd>{item.reasonCode}</dd>
          </div>
        )}
      </dl>
    </details>
  );
}
