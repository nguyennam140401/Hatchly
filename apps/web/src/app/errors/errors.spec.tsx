import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '../../../test/helpers/axe';
import { Forbidden, NotFound, ErrorPage } from './ErrorScreens';

function renderRoutes(routes: Parameters<typeof createMemoryRouter>[0], path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return { router, ...render(<RouterProvider router={router} />) };
}

describe('trang lỗi', () => {
  it('NotFound: đường dẫn lạ → có nút "Về Tổng quan", không trang trắng', async () => {
    const { router, container } = renderRoutes(
      [
        { path: '/', element: <p>Tổng quan</p> },
        { path: '*', element: <NotFound /> },
      ],
      '/khong-co',
    );
    expect(
      await screen.findByRole('heading', { name: 'Không tìm thấy trang' }),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    screen.getByRole('button', { name: 'Về Tổng quan' }).click();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
  });

  it('Forbidden: "Bạn không có quyền" + lối về + "Nhờ chủ tài khoản"', async () => {
    const { container } = renderRoutes([{ path: '/x', element: <Forbidden /> }], '/x');
    expect(await screen.findByRole('heading', { name: 'Bạn không có quyền' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Về Tổng quan' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Nhờ chủ tài khoản' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('ErrorPage (errorElement): lỗi ở màn → "Tải lại" + về Tổng quan; mã gốc trong "Chi tiết cho hỗ trợ"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Boom = () => {
      throw new Error('LỖI_KỸ_THUẬT_123');
    };
    renderRoutes([{ path: '/', element: <Boom />, errorElement: <ErrorPage /> }], '/');
    expect(await screen.findByRole('heading', { name: 'Có lỗi xảy ra' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tải lại' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Về Tổng quan' })).toBeInTheDocument();
    const details = screen.getByText('Chi tiết cho hỗ trợ').closest('details');
    expect(details).toContainElement(screen.getByText('LỖI_KỸ_THUẬT_123'));
    vi.restoreAllMocks();
  });
});
