import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, fakeApi, me } from '../../test/auth/helpers';
import { appRoutes } from './routes';

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('routes', () => {
  it('đường dẫn không có → NotFound với nút về Tổng quan (không trang trắng)', async () => {
    fakeApi({ 'GET /api/v1/auth/me': () => ({ status: 200, body: me() }) });
    renderAt('/khong-co-trang-nay');
    expect(
      await screen.findByRole('heading', { name: 'Không tìm thấy trang' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Về Tổng quan' })).toBeInTheDocument();
  });

  it('trang giữ chỗ trong khung: "Sắp có" + điều hướng còn nguyên', async () => {
    fakeApi({ 'GET /api/v1/auth/me': () => ({ status: 200, body: me() }) });
    renderAt('/calendar');
    expect(await screen.findByRole('heading', { name: 'Lịch đăng' })).toBeInTheDocument();
    expect(screen.getByText('Sắp có')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Điều hướng chính' })).toBeInTheDocument();
  });

  it('nhóm tuyến tải lười (cài đặt bảo mật) vẫn dựng được trong khung', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: me() }),
      'GET /api/v1/auth/login-methods': () => ({ status: 404, body: apiError('NOT_FOUND') }),
    });
    renderAt('/settings/security');
    expect(await screen.findByRole('navigation', { name: 'Điều hướng chính' })).toBeInTheDocument();
  });

  it('khu vực nội bộ tải lười, tách khỏi khung khách hàng', async () => {
    renderAt('/internal/khu-vuc');
    expect(await screen.findByRole('heading', { name: 'Khu vực nội bộ' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Điều hướng chính' })).toBeNull();
  });

  it('chưa đăng nhập → chuyển /login?next=… (lúc MỞ ứng dụng không có gì để giữ)', async () => {
    fakeApi({ 'GET /api/v1/auth/me': () => ({ status: 401, body: apiError('UNAUTHENTICATED') }) });
    const router = renderAt('/calendar');
    expect(await screen.findByRole('heading', { name: 'Đăng nhập' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?next=%2Fcalendar');
  });
});
