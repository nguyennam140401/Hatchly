import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, fakeApi, healthy, keyboardReachable, me, renderAt } from './helpers';

// T055 (US2): đăng nhập – trợ năng, bàn phím, hiện/ẩn mật khẩu, quay về `next` nội bộ.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function submit(email = 'lan@example.vn', password = 'mat-khau-thu') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
}

describe('LoginPage', () => {
  it('không lỗi trợ năng, dùng được bằng bàn phím, autocomplete đúng', async () => {
    fakeApi();
    const { container } = renderAt('/login');
    await screen.findByRole('heading', { name: 'Đăng nhập' });
    expect(await axe(container)).toHaveNoViolations();
    expect(keyboardReachable(container)).toBe(true);
    expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByRole('link', { name: 'Quên mật khẩu?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(screen.getByRole('link', { name: 'Tạo tài khoản' })).toHaveAttribute(
      'href',
      '/register',
    );
  });

  it('nút hiện/ẩn mật khẩu đổi kiểu ô và aria-pressed', async () => {
    fakeApi();
    renderAt('/login');
    const input = await screen.findByLabelText('Mật khẩu');
    const toggle = screen.getByRole('button', { name: 'Hiện mật khẩu' });
    expect(input).toHaveAttribute('type', 'password');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Ẩn mật khẩu' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('thành công → quay về next nội bộ', async () => {
    fakeApi({
      'POST /api/v1/auth/login': () => ({ status: 200, body: me() }),
      'GET /api/v1/auth/me': () => ({ status: 200, body: me() }),
    });
    const { router } = renderAt('/login?next=%2Fsettings%2Fsecurity');
    await screen.findByRole('heading', { name: 'Đăng nhập' });
    submit();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/settings/security');
    });
  });

  it('chưa xác nhận email → /verify-email', async () => {
    fakeApi({
      'POST /api/v1/auth/login': () => ({ status: 200, body: me({ emailVerified: false }) }),
      'GET /api/v1/auth/me': () => ({ status: 200, body: me({ emailVerified: false }) }),
      'GET /healthz': () => ({ status: 200, body: healthy }),
    });
    const { router } = renderAt('/login');
    await screen.findByRole('heading', { name: 'Đăng nhập' });
    submit();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/verify-email');
    });
  });

  it('sai thông tin / bị chặn → thông điệp của máy chủ + liên kết Quên mật khẩu', async () => {
    const api = fakeApi({
      'POST /api/v1/auth/login': () => ({
        status: 429,
        body: apiError('LOGIN_THROTTLED', {
          message: 'Bạn đã thử sai nhiều lần. Hãy thử lại sau 15 phút hoặc đặt lại mật khẩu.',
        }),
      }),
    });
    const { container } = renderAt('/login');
    await screen.findByRole('heading', { name: 'Đăng nhập' });
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('thử lại sau 15 phút');
    expect(screen.getByRole('link', { name: 'Quên mật khẩu' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(screen.getByLabelText('Mật khẩu')).toHaveValue('');
    expect(await axe(container)).toHaveNoViolations();
    api.on('POST /api/v1/auth/login', () => ({
      status: 401,
      body: apiError('INVALID_CREDENTIALS', { message: 'Email hoặc mật khẩu chưa đúng.' }),
    }));
    submit();
    expect(await screen.findByText('Email hoặc mật khẩu chưa đúng.')).toBeInTheDocument();
  });
});
