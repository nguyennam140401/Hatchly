import type { ChannelOverviewItem } from '@app/shared/platform_gateway';
import { formatDate, formatDateTime } from '../../lib/format/datetime';
import { t } from '../../lib/i18n/t';
import type { IconName } from '../../ui/icons/Icon';
import type { StatusTone } from '../../lib/catalogs/post-status';

// Danh mục trạng thái hiển thị của kênh (010 contracts/web-ui.md mục 3): LUÔN chữ + biểu tượng, không chỉ dựa vào màu
// (nguyên tắc VI). Trạng thái do máy chủ dẫn xuất; web chỉ ánh xạ sang chữ/biểu tượng.

export type ChannelCardState = ChannelOverviewItem['state'];

export const CHANNEL_STATE_META: Record<
  ChannelCardState,
  { icon: IconName; tone: StatusTone; mark: string; label: string }
> = {
  active: { icon: 'check', tone: 'success', mark: '✔', label: t('channels.state.active') },
  expiring: { icon: 'clock', tone: 'warning', mark: '⏳', label: t('channels.state.expiring') },
  needs_reconnect: {
    icon: 'alert',
    tone: 'danger',
    mark: '⚠',
    label: t('channels.state.needs_reconnect'),
  },
  ineligible: { icon: 'x', tone: 'danger', mark: '⛔', label: t('channels.state.ineligible') },
  suspended: { icon: 'info', tone: 'neutral', mark: '⏸', label: t('channels.state.suspended') },
};

/** Nhãn loại kênh bằng chữ. Loại lạ → giữ nguyên (không ném lỗi). */
export function platformLabel(channelType: string): string {
  switch (channelType) {
    case 'facebook_page':
      return t('channels.platform.facebook_page');
    case 'instagram':
      return t('channels.platform.instagram');
    case 'tiktok':
      return t('channels.platform.tiktok');
    default:
      return channelType;
  }
}

/** Mã rút gọn để phân biệt các kênh trùng tên (FR-035). */
export const shortCodeLabel = (code: string): string => `#${code}`;

/** Dòng hạn quyền theo 3 dạng (`none`/`token`/`data_access`), ngày theo UTC+7. */
export function expiryLine(expiry: ChannelOverviewItem['expiry']): string {
  if (expiry.kind === 'none' || expiry.expiresAt === null) return t('channels.expiry.none');
  return t('channels.expiry.until', {
    date: formatDate(expiry.expiresAt),
    days: Math.max(0, expiry.daysLeft ?? 0),
  });
}

export const checkedLine = (iso: string | null): string | null =>
  iso === null ? null : `Kiểm tra lần cuối: ${formatDateTime(iso)}`;

export const connectedLine = (iso: string): string => `Kết nối ngày ${formatDate(iso)}`;
