import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeNext } from '../../src/features/auth/auth-api';
import { apiError, fakeApi, healthy, me, renderAt } from './helpers';

// T040: cổng phiên – chuyển tới đăng nhập/xác nhận email; `next` chỉ nhận đường dẫn nội bộ.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('safeNext (chống chuyển hướng mở)', () => {
  it.each([
    ['/settings/security', '/settings/security'],
    ['/a?b=1#c', '/a?b=1#c'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['https://evil.example/x', '/'],
    ['javascript:alert(1)', '/'],
    ['', '/'],
    [null, '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});

describe('SessionGate', () => {
  it('chưa đăng nhập → /login?next=<đường dẫn hiện tại>', async () => {
    fakeApi({ 'GET /api/v1/auth/me': () => ({ status: 401, body: apiError('UNAUTHENTICATED') }) });
    const { router } = renderAt('/settings/security');
    expect(await screen.findByRole('heading', { name: 'Đăng nhập' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe('?next=%2Fsettings%2Fsecurity');
  });

  it('email chưa xác nhận → /verify-email', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: me({ emailVerified: false }) }),
    });
    const { router } = renderAt('/');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/verify-email');
    });
    expect(await screen.findByRole('heading', { name: 'Hãy xác nhận email' })).toBeInTheDocument();
  });

  it('đã đăng nhập → trang chính có lời chào và nút Đăng xuất', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: me() }),
      'GET /healthz': () => ({ status: 200, body: healthy }),
    });
    renderAt('/');
    expect(await screen.findByText('Xin chào, Chủ tiệm hoa')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đăng xuất' })).toBeInTheDocument();
  });

  it('đăng nhập với next=//evil.example → về "/" chứ không ra ngoài', async () => {
    const api = fakeApi({
      'POST /api/v1/auth/login': () => ({ status: 200, body: me() }),
      'GET /api/v1/auth/me': () => ({ status: 200, body: me() }),
      'GET /healthz': () => ({ status: 200, body: healthy }),
    });
    const { router } = renderAt('/login?next=%2F%2Fevil.example');
    fireEvent.change(await screen.findByLabelText('Email'), {
      target: { value: 'lan@example.vn' },
    });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'mat-khau-dung' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
    expect(api.calls.some((c) => c.path === '/api/v1/auth/login')).toBe(true);
  });
});
