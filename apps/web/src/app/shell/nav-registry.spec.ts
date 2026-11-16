import { permissionsOf } from '@app/shared/auth';
import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from './nav-registry';
import { selectNavItems } from './useNavItems';

const ids = (views: { id: string }[]) => views.map((v) => v.id);

describe('nav-registry', () => {
  it('thanh bên đúng 7 mục và thanh dưới đúng 5 ô cho chủ tài khoản', () => {
    const nav = selectNavItems(permissionsOf('owner'));
    expect(ids(nav.sidebar)).toEqual([
      'overview',
      'calendar',
      'posts',
      'media',
      'business-profile',
      'channels-plan',
      'settings',
    ]);
    // Tạo bài nổi bật ở GIỮA.
    expect(ids(nav.bottom)).toEqual(['overview', 'calendar', 'create-post', 'posts', 'more']);
    expect(nav.bottom.find((i) => i.id === 'create-post')?.featured).toBe(true);
  });

  it('hai thanh sinh từ cùng một mảng (mọi id đều có trong NAV_ITEMS)', () => {
    const nav = selectNavItems(permissionsOf('owner'));
    const known = new Set<string>(NAV_ITEMS.map((i) => i.id));
    for (const item of [...nav.sidebar, ...nav.bottom, ...nav.more])
      expect(known.has(item.id)).toBe(true);
  });

  it('mỗi vai trò thấy đúng tập mục theo PERMISSIONS (SC-003)', () => {
    for (const role of ['owner', 'collaborator'] as const) {
      const permissions = permissionsOf(role);
      const nav = selectNavItems(permissions);
      const all = [...nav.sidebar, ...nav.bottom, ...nav.more];
      for (const item of NAV_ITEMS) {
        const shown = all.some((v) => v.id === item.id);
        const expected =
          item.area === 'customer' &&
          (item.permission === undefined || permissions.includes(item.permission)) &&
          (item.placement.sidebar || item.placement.mobile !== 'none');
        expect(shown, `${role}/${item.id}`).toBe(expected);
      }
    }
  });

  it('khách hàng không bao giờ thấy mục khu vực nội bộ', () => {
    const nav = selectNavItems(permissionsOf('owner'));
    expect(ids([...nav.sidebar, ...nav.bottom, ...nav.more])).not.toContain('support');
  });

  it('không có quyền → ẩn mục cần quyền', () => {
    const nav = selectNavItems([]);
    expect(ids(nav.sidebar)).toEqual(['overview', 'settings']);
  });

  it('huy hiệu lấy số đếm theo khóa', () => {
    const nav = selectNavItems(permissionsOf('owner'), { pendingReviewCount: 4 });
    expect(nav.sidebar.find((i) => i.id === 'posts')?.badge).toBe(4);
    expect(nav.sidebar.find((i) => i.id === 'overview')?.badge).toBeUndefined();
  });
});
