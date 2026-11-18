import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, fakeApi, keyboardReachable, renderAt } from './helpers';

// T049 (US1): đăng ký – trợ năng, bàn phím, ô đồng ý không đặt sẵn, lỗi qua aria-describedby.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fill(password = 'Hoa-sen-no-2026') {
  fireEvent.change(screen.getByLabelText('Tên hiển thị'), { target: { value: 'Tiệm hoa Lan' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'lan@example.vn' } });
  fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: password } });
}

describe('RegisterPage', () => {
  it('không lỗi trợ năng, dùng được bằng bàn phím, ô đồng ý mặc định không tích', async () => {
    fakeApi();
    const { container } = renderAt('/register');
    await screen.findByRole('heading', { name: 'Tạo tài khoản' });
    expect(await axe(container)).toHaveNoViolations();
    expect(keyboardReachable(container)).toBe(true);
    const terms = screen.getByRole('checkbox');
    expect(terms).not.toBeChecked();
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('autocomplete', 'new-password');
  });

  it('chưa tích đồng ý → báo lỗi gắn với ô, không gọi API', async () => {
    const api = fakeApi();
    renderAt('/register');
    await screen.findByRole('heading', { name: 'Tạo tài khoản' });
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));
    const terms = screen.getByRole('checkbox');
    // Kiểm tra của react-hook-form chạy bất đồng bộ: chờ lỗi hiện ra (kỳ vọng không đổi).
    await waitFor(() => {
      expect(terms).toHaveAttribute('aria-invalid', 'true');
    });
    expect(terms).toHaveAccessibleDescription(/Bạn cần đồng ý điều khoản/);
    expect(api.calls).toHaveLength(0);
  });

  it('mật khẩu yếu từ máy chủ → lỗi ở ô mật khẩu qua aria-describedby', async () => {
    fakeApi({
      'POST /api/v1/auth/register': () => ({
        status: 400,
        body: apiError('VALIDATION_FAILED', {
          fieldErrors: [{ path: ['password'], message: 'Mật khẩu này quá phổ biến, dễ bị đoán.' }],
        }),
      }),
    });
    const { container } = renderAt('/register');
    await screen.findByRole('heading', { name: 'Tạo tài khoản' });
    fill('matkhau123');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));
    const pw = screen.getByLabelText('Mật khẩu');
    expect(await screen.findByText('Mật khẩu này quá phổ biến, dễ bị đoán.')).toBeInTheDocument();
    expect(pw).toHaveAccessibleDescription(/quá phổ biến/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('thành công → "Hãy kiểm tra email", nút Gửi lại thư gọi resend với email vừa nhập', async () => {
    const api = fakeApi({
      'POST /api/v1/auth/register': () => ({ status: 202, body: { status: 'check_email' } }),
      'POST /api/v1/auth/email/resend': () => ({ status: 202, body: { status: 'check_email' } }),
    });
    renderAt('/register');
    await screen.findByRole('heading', { name: 'Tạo tài khoản' });
    fill();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));
    expect(await screen.findByRole('heading', { name: 'Hãy kiểm tra email' })).toBeInTheDocument();
    expect(api.calls[0]?.body).toMatchObject({ acceptTerms: true, termsVersion: '2026-11' });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi lại thư' }));
    expect(await screen.findByText(/Đã gửi lại thư/)).toBeInTheDocument();
    expect(api.calls.at(-1)).toMatchObject({
      path: '/api/v1/auth/email/resend',
      body: { email: 'lan@example.vn' },
    });
  });
});
