import { cleanup, fireEvent, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, fakeApi, keyboardReachable, renderAt } from './helpers';

// T071 (US4): lối vào nội bộ – trợ năng, bàn phím, thông điệp IP_NOT_ALLOWED.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('StaffLoginPage', () => {
  it('không lỗi trợ năng; ngoài dải mạng → thông điệp của máy chủ', async () => {
    fakeApi({
      'POST /api/v1/internal/auth/login': () => ({
        status: 403,
        body: apiError('IP_NOT_ALLOWED', { message: 'Lối vào nội bộ chỉ mở từ mạng của công ty.' }),
      }),
    });
    const { container } = renderAt('/internal/login');
    await screen.findByRole('heading', { name: 'Đăng nhập nội bộ' });
    expect(await axe(container)).toHaveNoViolations();
    expect(keyboardReachable(container)).toBe(true);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nv@example.vn' } });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(
      await screen.findByText('Lối vào nội bộ chỉ mở từ mạng của công ty.'),
    ).toBeInTheDocument();
  });

  it('thành công → báo vai trò', async () => {
    fakeApi({
      'POST /api/v1/internal/auth/login': () => ({
        status: 200,
        body: {
          staff: { id: 's1', displayName: 'Minh', email: 'nv@example.vn' },
          role: 'support',
          permissions: ['support.lookup'],
        },
      }),
    });
    renderAt('/internal/login');
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'nv@example.vn' } });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'dung' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(await screen.findByText(/Đã đăng nhập: Minh \(Hỗ trợ\)\./)).toBeInTheDocument();
  });
});
