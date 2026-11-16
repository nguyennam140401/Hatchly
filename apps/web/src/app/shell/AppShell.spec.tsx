import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from '../../../test/helpers/axe';
import { renderWithProviders } from '../../../test/helpers/render';
import { AppShell } from './AppShell';
import { ComingSoon } from './ComingSoon';
import { MorePage } from './MorePage';

function stubViewport(desktop: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: desktop,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

const tree = (
  <Routes>
    <Route element={<AppShell />}>
      <Route path="/" element={<ComingSoon title="Tổng quan" />} />
      <Route path="/calendar" element={<ComingSoon title="Lịch đăng" />} />
      <Route path="/more" element={<MorePage />} />
      <Route path="/posts/new" element={<ComingSoon title="Tạo bài" />} />
    </Route>
  </Routes>
);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AppShell', () => {
  it('≥ 1024 px: thanh bên 7 mục, không có thanh dưới; mục hiện tại aria-current', async () => {
    stubViewport(true);
    const { container } = renderWithProviders(tree, { route: '/calendar' });
    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
    expect(within(nav).getAllByRole('link')).toHaveLength(7);
    expect(within(nav).getByRole('link', { name: 'Lịch đăng' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('< 1024 px: thanh trên + thanh dưới 5 ô ("Tạo bài" nổi bật), không thanh bên', async () => {
    stubViewport(false);
    const { container } = renderWithProviders(tree, { route: '/' });
    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
    expect(within(nav).getAllByRole('link')).toHaveLength(5);
    expect(within(nav).getByRole('link', { name: 'Tạo bài' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Tổng quan' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('cộng tác viên không thấy mục cần quyền chủ; chủ thấy đủ', () => {
    stubViewport(true);
    const collab = renderWithProviders(tree, { role: 'collaborator' });
    const collabLinks = within(screen.getByRole('navigation'))
      .getAllByRole('link')
      .map((l) => l.textContent);
    collab.unmount();
    renderWithProviders(tree, { role: 'owner' });
    const ownerLinks = within(screen.getByRole('navigation'))
      .getAllByRole('link')
      .map((l) => l.textContent);
    expect(ownerLinks.length).toBeGreaterThanOrEqual(collabLinks.length);
    expect(ownerLinks).toContain('Hồ sơ kinh doanh');
  });

  it('trang "Thêm" liệt kê các mục không nằm ở thanh dưới', () => {
    stubViewport(false);
    renderWithProviders(tree, { route: '/more' });
    const main = screen.getByRole('main');
    expect(within(main).getByRole('link', { name: /Thư viện/ })).toBeInTheDocument();
    expect(within(main).getByRole('link', { name: /Cài đặt/ })).toBeInTheDocument();
  });

  it('màn con hiện nút quay lại trên thanh trên (điện thoại)', () => {
    stubViewport(false);
    renderWithProviders(
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/settings/security" element={<ComingSoon title="Bảo mật" />} />
        </Route>
      </Routes>,
      { route: '/settings/security' },
    );
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeInTheDocument();
  });

  it('chỉ có đúng một <main> cho mỗi trang', () => {
    stubViewport(false);
    renderWithProviders(tree, { route: '/' });
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });
});
