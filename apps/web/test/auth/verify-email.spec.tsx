import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, fakeApi, healthy, keyboardReachable, me, renderAt } from './helpers';

// T049 (US1): xác nhận email – mã trong #token= bị xóa khỏi thanh địa chỉ TRƯỚC khi gọi API.

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('VerifyEmailPage', () => {
  it('có mã → xóa fragment trước khi gọi API, thành công thì vào "/"', async () => {
    window.history.replaceState(null, '', '/verify-email#token=abcDEF123_-xyz');
    const api = fakeApi({
      'POST /api/v1/auth/email/verify': () => ({ status: 200, body: me() }),
      'GET /api/v1/auth/me': () => ({ status: 200, body: me() }),
      'GET /healthz': () => ({ status: 200, body: healthy }),
    });
    const { router } = renderAt('/verify-email');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
    const call = api.calls.find((c) => c.path === '/api/v1/auth/email/verify');
    expect(call?.body).toEqual({ token: 'abcDEF123_-xyz' });
    expect(call?.hashAtCall).toBe('');
    expect(window.location.hash).toBe('');
  });

  it('mã không dùng được → thông báo + hành động, không lỗi trợ năng', async () => {
    window.history.replaceState(null, '', '/verify-email#token=cu-roi-0000000');
    fakeApi({
      'POST /api/v1/auth/email/verify': () => ({
        status: 400,
        body: apiError('TOKEN_INVALID', { message: 'Liên kết đã hết hạn hoặc đã được dùng.' }),
      }),
    });
    const { container } = renderAt('/verify-email');
    expect(await screen.findByText('Liên kết đã hết hạn hoặc đã được dùng.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Đăng nhập để gửi lại thư' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('đang đăng nhập chưa xác nhận → gửi lại thư, sửa email, đăng xuất', async () => {
    const api = fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: me({ emailVerified: false }) }),
      'POST /api/v1/auth/email/resend': () => ({ status: 202, body: { status: 'check_email' } }),
      'PATCH /api/v1/auth/email': () => ({ status: 202, body: { status: 'check_email' } }),
    });
    const { container } = renderAt('/verify-email');
    expect(await screen.findByRole('heading', { name: 'Hãy xác nhận email' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    expect(keyboardReachable(container)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Gửi lại thư' }));
    expect(await screen.findByText(/Đã gửi lại thư xác nhận/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Email mới'), { target: { value: 'moi@example.vn' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu và gửi thư mới' }));
    expect(await screen.findByText(/Đã gửi thư xác nhận tới moi@example.vn/)).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ email: 'moi@example.vn' });
    expect(screen.getByRole('button', { name: 'Đăng xuất' })).toBeInTheDocument();
  });
});
