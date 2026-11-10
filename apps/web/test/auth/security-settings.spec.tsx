import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, fakeApi, keyboardReachable, me, renderAt } from './helpers';

// T055 (US2) + T078 (US5): trang bảo mật – đăng xuất, đăng xuất mọi thiết bị có xác nhận, đổi mật khẩu.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const base = {
  'GET /api/v1/auth/me': () => ({ status: 200, body: me() }),
  'POST /api/v1/auth/logout': () => ({ status: 204 }),
  'POST /api/v1/auth/logout-all': () => ({ status: 204 }),
};

describe('SecuritySettingsPage', () => {
  it('không lỗi trợ năng, dùng được bằng bàn phím', async () => {
    fakeApi(base);
    const { container } = renderAt('/settings/security');
    await screen.findByRole('heading', { name: 'Bảo mật tài khoản' });
    expect(await axe(container)).toHaveNoViolations();
    expect(keyboardReachable(container)).toBe(true);
    expect(screen.getByLabelText('Mật khẩu hiện tại')).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
    expect(screen.getByLabelText('Mật khẩu mới')).toHaveAttribute('autocomplete', 'new-password');
  });

  it('đăng xuất → gọi API rồi về /login', async () => {
    const api = fakeApi(base);
    const { router } = renderAt('/settings/security');
    fireEvent.click(await screen.findByRole('button', { name: 'Đăng xuất' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });
    expect(api.calls.some((c) => c.path === '/api/v1/auth/logout')).toBe(true);
  });

  it('đăng xuất mọi thiết bị cần xác nhận; Hủy thì không gọi API', async () => {
    const api = fakeApi(base);
    const { router } = renderAt('/settings/security');
    fireEvent.click(await screen.findByRole('button', { name: 'Đăng xuất khỏi mọi thiết bị' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(api.calls.some((c) => c.path === '/api/v1/auth/logout-all')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất khỏi mọi thiết bị' }));
    fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất tất cả' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });
    expect(api.calls.some((c) => c.path === '/api/v1/auth/logout-all')).toBe(true);
  });

  it('đổi mật khẩu: sai mật khẩu hiện tại → lỗi ở ô; đúng → thông báo thành công', async () => {
    const api = fakeApi({
      ...base,
      'POST /api/v1/auth/password/change': () => ({
        status: 401,
        body: apiError('INVALID_CREDENTIALS', {
          fieldErrors: [{ path: ['currentPassword'], message: 'Mật khẩu hiện tại chưa đúng.' }],
        }),
      }),
    });
    const { container } = renderAt('/settings/security');
    fireEvent.change(await screen.findByLabelText('Mật khẩu hiện tại'), {
      target: { value: 'sai' },
    });
    fireEvent.change(screen.getByLabelText('Mật khẩu mới'), {
      target: { value: 'Mat-khau-moi-99' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Mật khẩu hiện tại')).toHaveAccessibleDescription(/chưa đúng/),
    );
    expect(await axe(container)).toHaveNoViolations();
    api.on('POST /api/v1/auth/password/change', () => ({ status: 204 }));
    fireEvent.change(screen.getByLabelText('Mật khẩu hiện tại'), { target: { value: 'dung-roi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));
    expect(await screen.findByText(/Đã đổi mật khẩu/)).toBeInTheDocument();
  });
});
