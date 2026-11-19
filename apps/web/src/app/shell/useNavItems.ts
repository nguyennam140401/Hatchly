import { useMemo } from 'react';
import { t } from '../../lib/i18n/t';
import { useSession } from '../../lib/session/context';
import type { NavItemView } from '../../ui/nav/nav-types';
import { NAV_ITEMS, type NavItem } from './nav-registry';

export interface NavCounts {
  pendingReviewCount?: number | undefined;
  unreadCount?: number | undefined;
  /** 010: số kênh cần chú ý (từ `overview.attention`). */
  channelAttentionCount?: number | undefined;
}

export interface NavItems {
  sidebar: NavItemView[];
  bottom: NavItemView[];
  /** Mục của trang "Thêm" trên điện thoại. */
  more: NavItemView[];
}

/** Lọc `NAV_ITEMS` theo quyền (từ `me.permissions`) và khu vực; hàm thuần để kiểm thử ma trận quyền. */
export function selectNavItems(
  permissions: readonly string[],
  counts: NavCounts = {},
  items: readonly NavItem[] = NAV_ITEMS,
): NavItems {
  const visible = items
    // Mục nội bộ luôn khai báo quyền; mục khách hàng không khai báo quyền thì ai đăng nhập cũng thấy.
    .filter((item) => item.permission === undefined || permissions.includes(item.permission))
    .sort((a, b) => a.order - b.order);

  const view = (item: NavItem): NavItemView => ({
    id: item.id,
    label: t(item.labelKey),
    icon: item.icon,
    href: item.path,
    badge: item.badge !== undefined ? counts[item.badge] : undefined,
    featured: item.featured,
  });

  return {
    sidebar: visible.filter((i) => i.placement.sidebar).map(view),
    bottom: visible.filter((i) => i.placement.mobile === 'bottom').map(view),
    more: visible.filter((i) => i.placement.mobile === 'more').map(view),
  };
}

export function useNavItems(counts: NavCounts = {}): NavItems {
  const { permissions } = useSession().me;
  const { pendingReviewCount, unreadCount, channelAttentionCount } = counts;
  return useMemo(
    () => selectNavItems(permissions, { pendingReviewCount, unreadCount, channelAttentionCount }),
    [permissions, pendingReviewCount, unreadCount, channelAttentionCount],
  );
}
