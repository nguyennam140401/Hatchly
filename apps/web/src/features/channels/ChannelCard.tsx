import type { ChannelOverviewItem } from '@app/shared/platform_gateway';
import { formatDateTime } from '../../lib/format/datetime';
import { t } from '../../lib/i18n/t';
import { Button } from '../../ui/button/Button';
import {
  checkedLine,
  connectedLine,
  expiryLine,
  platformLabel,
  shortCodeLabel,
} from './channel-state';
import { ChannelStateBadge } from './ChannelStateBadge';
import { ConditionsPanel } from './ConditionsPanel';
import { RecheckButton } from './RecheckButton';
import { SourcePageNote } from './SourcePageNote';
import { SupportDetails } from './SupportDetails';

// Thẻ MỘT kết nối kênh (010 contracts/web-ui.md mục 3). Tên cắt gọn bằng `line-clamp` và render VĂN BẢN THUẦN (không HTML);
// trạng thái chữ + biểu tượng; nút theo trạng thái và quyền (cộng tác viên KHÔNG có nút). Ảnh có alt = tên kênh.

export interface ChannelCardProps {
  item: ChannelOverviewItem;
  /** Chủ tài khoản (`channel.manage`) – cộng tác viên chỉ xem. */
  viewerCanManage: boolean;
  onReconnect: (item: ChannelOverviewItem) => void;
  onDisconnect: (item: ChannelOverviewItem) => void;
}

export function ChannelCard({
  item,
  viewerCanManage,
  onReconnect,
  onDisconnect,
}: ChannelCardProps) {
  const suspended = item.state === 'suspended';
  const needsAttention = item.state === 'needs_reconnect' || item.state === 'expiring';
  const impact = item.scheduledImpact;
  const checked = checkedLine(item.lastCheckedAt);

  return (
    <li
      id={`channel-${item.connectionId}`}
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface-0 p-4"
      aria-label={`${platformLabel(item.channelType)} ${item.displayName}`}
    >
      <div className="flex items-start gap-3">
        {item.avatarUrl !== null ? (
          <img
            src={item.avatarUrl}
            alt={item.displayName}
            className="size-12 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface-200 text-label"
          >
            {item.displayName.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="line-clamp-2 break-words text-label text-ink">{item.displayName}</p>
          <p className="text-caption text-ink-muted">
            {platformLabel(item.channelType)} · {shortCodeLabel(item.shortCode)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ChannelStateBadge state={item.state} />
        {item.channelType === 'tiktok' && (
          <span className="text-caption text-ink-muted">{t('channels.experimental')}</span>
        )}
      </div>

      {suspended ? (
        <p role="note" className="text-body">
          {t('channels.suspended.note')}
        </p>
      ) : (
        <>
          {item.reasonVi !== null && <p className="text-body">{item.reasonVi}</p>}
          <p className="text-body">{expiryLine(item.expiry)}</p>
          {needsAttention && impact.count > 0 && (
            <p className="text-body">
              Có {impact.count} bài đã lên lịch dùng kênh này
              {impact.nextAt !== null ? `, gần nhất ${formatDateTime(impact.nextAt)}` : ''}.
            </p>
          )}
          <SourcePageNote item={item} />
          <ConditionsPanel item={item} />
          {item.channelType === 'tiktok' && (
            <p className="text-caption text-ink-muted">{t('channels.tiktok.videoOnly')}</p>
          )}
        </>
      )}

      <p className="text-caption text-ink-muted">
        {checked !== null && <>{checked} · </>}
        {connectedLine(item.connectedAt)}
      </p>

      {viewerCanManage && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {item.state === 'needs_reconnect' && (
            <Button
              icon="link"
              onClick={() => {
                onReconnect(item);
              }}
            >
              {t('channels.reconnect')}
            </Button>
          )}
          {!suspended && item.state !== 'needs_reconnect' && (
            <RecheckButton connectionId={item.connectionId} />
          )}
          <Button
            variant="secondary"
            onClick={() => {
              onDisconnect(item);
            }}
          >
            {t('channels.disconnect')}
          </Button>
        </div>
      )}

      <SupportDetails item={item} />
    </li>
  );
}
