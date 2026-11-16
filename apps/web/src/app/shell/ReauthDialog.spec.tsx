import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, fakeApi, me } from '../../../test/auth/helpers';
import { apiClient } from '../../lib/api/client';
import { SessionGate } from '../SessionGate';
import { AppShell } from './AppShell';

// Hết phiên giữa chừng: hộp thoại đăng nhập lại TẠI CHỖ, gộp nhiều lời gọi 401, phát lại GET một lần (FR-011a).

const Thing = {
  safeParse: (v: unknown) =>
    typeof v === 'object' && v !== null && 'value' in v
      ? { success: true as const, data: v as { value: string } }
      : { success: false as const },
};

function Probe() {
  const [text, setText] = useState('chưa tải');
  const [draft, setDraft] = useState('');
  const load = () => {
    for (let i = 0; i < 3; i += 1) {
      apiClient
        .request('GET', '/api/v1/thing', { schema: Thing })
        .then((r) => {
          setText(r.value);
        })
        .catch(() => {
          setText('lỗi');
        });
    }
  };
  return (
    <section>
      <button type="button" onClick={load}>
        Tải
      </button>
      <label>
        Bản nháp
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
        />
      </label>
      <p>{text}</p>
    </section>
  );
}

function setup() {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <h1>Trang đăng nhập</h1> },
      {
        element: <SessionGate />,
        children: [{ element: <AppShell />, children: [{ path: '/', element: <Probe /> }] }],
      },
    ],
    { initialEntries: ['/'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ReauthDialog + AuthGate', () => {
  it('3 lời gọi 401 cùng lúc → MỘT hộp thoại; đăng nhập lại cùng người → GET phát lại, bản nháp còn nguyên', async () => {
    let authed = false;
    const api = fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: me() }),
      'GET /api/v1/thing': () =>
        authed
          ? { status: 200, body: { value: 'đã có dữ liệu' } }
          : { status: 401, body: apiError('UNAUTHENTICATED') },
      'POST /api/v1/auth/login': () => {
        authed = true;
        return { status: 200, body: me() };
      },
    });
    setup();
    fireEvent.change(await screen.findByLabelText('Bản nháp'), {
      target: { value: 'nội dung đang gõ dở' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tải' }));

    const dialog = await screen.findByRole('dialog', { name: 'Phiên đã hết hạn' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    // Màn hình và bản nháp phía sau còn nguyên.
    expect(screen.getByLabelText('Bản nháp')).toHaveValue('nội dung đang gõ dở');

    fireEvent.change(screen.getByLabelText(/Mật khẩu/), { target: { value: 'mat-khau-dung' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập lại' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(await screen.findByText('đã có dữ liệu')).toBeInTheDocument();
    expect(dialog).not.toBeInTheDocument();
    expect(screen.getByLabelText('Bản nháp')).toHaveValue('nội dung đang gõ dở');
    expect(api.calls.filter((c) => c.path === '/api/v1/auth/login')).toHaveLength(1);
    // 3 lần đầu + đúng 3 lần phát lại (mỗi lời gọi MỘT lần).
    expect(api.calls.filter((c) => c.path === '/api/v1/thing')).toHaveLength(6);
  });

  it('đăng nhập sai → lỗi có hành động, hộp thoại còn đó', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: me() }),
      'GET /api/v1/thing': () => ({ status: 401, body: apiError('UNAUTHENTICATED') }),
      'POST /api/v1/auth/login': () => ({ status: 401, body: apiError('INVALID_CREDENTIALS') }),
    });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Tải' }));
    await screen.findByRole('dialog', { name: 'Phiên đã hết hạn' });
    fireEvent.change(screen.getByLabelText(/Mật khẩu/), { target: { value: 'sai' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập lại' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Phiên đã hết hạn' })).toBeInTheDocument();
  });

  it('đăng nhập bằng người khác → dọn dữ liệu, về Tổng quan, KHÔNG hiện dữ liệu tài khoản kia', async () => {
    const other = {
      ...me(),
      user: { id: 'u-2', displayName: 'Người lạ', email: 'la@example.vn', emailVerified: true },
      account: { id: 'a-2', status: 'active' },
    };
    let current = me();
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: current }),
      'GET /api/v1/thing': () => ({ status: 401, body: apiError('UNAUTHENTICATED') }),
      'POST /api/v1/auth/login': () => {
        current = other;
        return { status: 200, body: other };
      },
    });
    const router = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Tải' }));
    await screen.findByRole('dialog', { name: 'Phiên đã hết hạn' });
    fireEvent.change(screen.getByLabelText(/Mật khẩu/), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập lại' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(router.state.location.pathname).toBe('/');
    expect(screen.queryByText(/Người lạ|la@example/)).toBeNull();
  });

  it('reason=password_changed → màn kết thúc, KHÔNG có ô mật khẩu; nút về trang đăng nhập', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: me() }),
      'GET /api/v1/thing': () => ({
        status: 401,
        body: {
          error: { ...apiError('UNAUTHENTICATED').error, reason: 'password_changed' },
        },
      }),
    });
    const router = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Tải' }));
    expect(await screen.findByText(/Mật khẩu đã được đổi ở nơi khác/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Mật khẩu/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Về trang đăng nhập' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });
  });
});
