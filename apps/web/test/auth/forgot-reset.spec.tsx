import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, fakeApi, healthy, keyboardReachable, me, renderAt } from './helpers';

// T078 (US5): quên/đặt lại mật khẩu – thông điệp không phân biệt email, fragment bị xóa trước khi gọi API.

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ForgotPasswordPage', () => {
  it('luôn cùng một thông điệp; không lỗi trợ năng', async () => {
    fakeApi({
      'POST /api/v1/auth/password/forgot': () => ({ status: 202, body: { status: 'check_email' } }),
    });
    const { container } = renderAt('/forgot-password');
    await screen.findByRole('heading', { name: 'Quên mật khẩu' });
    expect(await axe(container)).toHaveNoViolations();
    expect(keyboardReachable(container)).toBe(true);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'khong-co@example.vn' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi liên kết' }));
    expect(
      await screen.findByText(/Nếu email có tài khoản, chúng tôi đã gửi hướng dẫn/),
    ).toBeInTheDocument();
  });
});

describe('ResetPasswordPage', () => {
  it('đọc và xóa #token= trước khi gọi API; thành công vào "/"', async () => {
    window.history.replaceState(null, '', '/reset-password#token=MaDatLai_123-abc');
    const api = fakeApi({
      'POST /api/v1/auth/password/reset': () => ({ status: 200, body: me() }),
      'GET /api/v1/auth/me': () => ({ status: 200, body: me() }),
      'GET /healthz': () => ({ status: 200, body: healthy }),
    });
    const { router, container } = renderAt('/reset-password');
    const input = await screen.findByLabelText('Mật khẩu mới');
    expect(window.location.hash).toBe('');
    expect(input).toHaveAttribute('autocomplete', 'new-password');
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.change(input, { target: { value: 'Mat-khau-moi-rat-manh' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu mật khẩu mới' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
    const call = api.calls.find((c) => c.path === '/api/v1/auth/password/reset');
    expect(call).toMatchObject({
      body: { token: 'MaDatLai_123-abc', newPassword: 'Mat-khau-moi-rat-manh' },
      hashAtCall: '',
    });
  });

  it('TOKEN_INVALID → thông báo + "Gửi lại liên kết"', async () => {
    window.history.replaceState(null, '', '/reset-password#token=HetHan_0000000000');
    fakeApi({
      'POST /api/v1/auth/password/reset': () => ({
        status: 400,
        body: apiError('TOKEN_INVALID', { message: 'Liên kết đã hết hạn hoặc đã được dùng.' }),
      }),
    });
    renderAt('/reset-password');
    fireEvent.change(await screen.findByLabelText('Mật khẩu mới'), {
      target: { value: 'Mat-khau-moi-rat-manh' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu mật khẩu mới' }));
    expect(await screen.findByText('Liên kết đã hết hạn hoặc đã được dùng.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Gửi lại liên kết' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('không có mã → hướng dẫn mở lại liên kết', async () => {
    fakeApi();
    renderAt('/reset-password');
    expect(await screen.findByText(/Liên kết không đầy đủ/)).toBeInTheDocument();
  });
});
