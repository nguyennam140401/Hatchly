import type { OverviewResponse } from '@app/shared/platform_gateway';
import { t } from '../../lib/i18n/t';
import { Button } from '../../ui/button/Button';
import { Icon } from '../../ui/icons/Icon';
import { platformLabel, shortCodeLabel } from './channel-state';

// Biểu ngữ "Có kênh cần bạn xử lý": liệt kê TỪNG kết nối cần chú ý (không gộp thành một con số) + nút "Kết nối lại"/"Xem".
// Trạng thái luôn chữ + biểu tượng. Cộng tác viên chỉ thấy nút "Xem".

export interface AttentionBannerProps {
  overview: OverviewResponse;
  onReconnect: (connectionId: string) => void;
  onView: (connectionId: string) => void;
}

export function AttentionBanner({ overview, onReconnect, onView }: AttentionBannerProps) {
  if (overview.attention.length === 0) return null;
  return (
    <section
      aria-label={t('channels.attention.title')}
      className="flex flex-col gap-3 rounded-lg border border-warning bg-warning-soft p-4"
    >
      <h2 className="flex items-center gap-2 text-label text-ink">
        <Icon name="alert" className="size-5" />
        {t('channels.attention.title')} ({overview.attention.length})
      </h2>
      <ul className="flex flex-col gap-3">
        {overview.attention.map((a) => {
          const item = overview.connections.find((c) => c.connectionId === a.connectionId);
          if (item === undefined) return null;
          const expiring = a.kind === 'expiring';
          return (
            <li key={a.connectionId} className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <p className="flex-1 break-words text-body">
                <span className="text-label">
                  {platformLabel(item.channelType)} · {item.displayName}
                </span>{' '}
                <span className="text-ink-muted">{shortCodeLabel(item.shortCode)}</span> —{' '}
                {expiring
                  ? `quyền sắp hết hạn${a.daysLeft !== undefined ? ` (còn ${a.daysLeft} ngày)` : ''}`
                  : a.kind === 'needs_reconnect'
                    ? 'cần kết nối lại'
                    : 'chưa đủ điều kiện'}
              </p>
              <div className="flex gap-2">
                {overview.viewerCanManage && a.kind !== 'ineligible' && (
                  <Button
                    onClick={() => {
                      onReconnect(a.connectionId);
                    }}
                  >
                    {t('channels.reconnect')}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  onClick={() => {
                    onView(a.connectionId);
                  }}
                >
                  {t('channels.view')}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
