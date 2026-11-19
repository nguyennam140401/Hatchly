import type { Permission } from '@app/shared/auth';
import type { ViKey } from '../../lib/i18n/vi';
import type { IconName } from '../../ui/icons/Icon';

// NGUỒN DUY NHẤT của điều hướng (FR-008): thanh bên 7 mục và thanh dưới 5 ô đều sinh từ mảng này; không component nào tự
// liệt kê mục. Thêm mục = thêm một phần tử + một tuyến + một hàng kiểm thử ma trận quyền (docs/ui-guide.md).

export type NavItemId =
  | 'overview'
  | 'calendar'
  | 'posts'
  | 'media'
  | 'business-profile'
  | 'channels-plan'
  | 'settings'
  | 'create-post'
  | 'more'
  | 'support';

export interface NavItem {
  id: NavItemId;
  labelKey: ViKey;
  icon: IconName;
  /** Đường dẫn tuyệt đối trong ứng dụng. */
  path: string;
  /** Quyền cần có để thấy mục (từ `@app/shared/auth`); thiếu = mọi người đã đăng nhập. */
  permission?: Permission;
  /** `internal`: khu vực nhân viên, gói riêng (R16) – không bao giờ xuất hiện ở thanh khách hàng. */
  area: 'customer' | 'internal';
  placement: { sidebar: boolean; mobile: 'bottom' | 'more' | 'none' };
  order: number;
  /** Khóa dữ liệu đếm hiển thị trên huy hiệu. */
  badge?: 'pendingReviewCount' | 'unreadCount' | 'channelAttentionCount';
  /** Nổi bật ở giữa thanh dưới. */
  featured?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: 'overview',
    labelKey: 'nav.overview',
    icon: 'home',
    path: '/',
    area: 'customer',
    placement: { sidebar: true, mobile: 'bottom' },
    order: 10,
  },
  {
    id: 'calendar',
    labelKey: 'nav.calendar',
    icon: 'calendar',
    path: '/calendar',
    permission: 'status.view',
    area: 'customer',
    placement: { sidebar: true, mobile: 'bottom' },
    order: 20,
  },
  {
    id: 'create-post',
    labelKey: 'nav.createPost',
    icon: 'plus',
    path: '/posts/new',
    permission: 'post.edit',
    area: 'customer',
    placement: { sidebar: false, mobile: 'bottom' },
    order: 30,
    featured: true,
  },
  {
    id: 'posts',
    labelKey: 'nav.posts',
    icon: 'list',
    path: '/posts',
    permission: 'status.view',
    area: 'customer',
    placement: { sidebar: true, mobile: 'bottom' },
    order: 40,
    badge: 'pendingReviewCount',
  },
  {
    id: 'media',
    labelKey: 'nav.media',
    icon: 'image',
    path: '/media',
    permission: 'media.view',
    area: 'customer',
    placement: { sidebar: true, mobile: 'more' },
    order: 50,
  },
  {
    id: 'business-profile',
    labelKey: 'nav.businessProfile',
    icon: 'store',
    path: '/business-profile',
    permission: 'context.view',
    area: 'customer',
    placement: { sidebar: true, mobile: 'more' },
    order: 60,
  },
  {
    id: 'channels-plan',
    labelKey: 'nav.channelsPlan',
    icon: 'link',
    path: '/channels',
    // 010: chủ + cộng tác viên xem được; kết nối/ngắt vẫn chỉ chủ (API tự chặn). Dấu chỉ báo kênh cần chú ý ở mọi màn hình (FR-026).
    permission: 'channel.view',
    area: 'customer',
    placement: { sidebar: true, mobile: 'more' },
    order: 70,
    badge: 'channelAttentionCount',
  },
  {
    id: 'settings',
    labelKey: 'nav.settings',
    icon: 'gear',
    path: '/settings',
    area: 'customer',
    placement: { sidebar: true, mobile: 'more' },
    order: 80,
  },
  {
    id: 'more',
    labelKey: 'nav.more',
    icon: 'more',
    path: '/more',
    area: 'customer',
    placement: { sidebar: false, mobile: 'bottom' },
    order: 45,
  },
  // Khu vực nhân viên: khung giữ chỗ; khách hàng không bao giờ có quyền này nên không thấy.
  {
    id: 'support',
    labelKey: 'nav.settings',
    icon: 'gear',
    path: '/internal',
    permission: 'support.lookup',
    area: 'internal',
    placement: { sidebar: true, mobile: 'none' },
    order: 100,
  },
];
