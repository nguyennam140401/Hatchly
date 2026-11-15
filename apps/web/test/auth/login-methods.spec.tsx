import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from '../../src/features/auth/social-api';
import { apiError, fakeApi, keyboardReachable, me, renderAt } from './helpers';

// T073 (009 – US5): Cài đặt → Cách đăng nhập.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const METHODS = 'GET /api/v1/auth/login-methods';
const list = (google = false) => ({
  methods: [
    { kind: 'password', linked: true, linkedAt: '2026-11-01T00:00:00.000Z' },
    google
      ? {
          kind: 'google',
          linked: true,
          providerEmail: 'lan.g@example.vn',
          providerDisplayName: 'Lan G',
          linkedAt: '2026-11-02T00:00:00.000Z',
        }
      : { kind: 'google', linked: false },
    { kind: 'facebook', linked: false },
  ],
  reauthFresh: true,
});
const session = { 'GET /api/v1/auth/me': () => ({ status: 200, body: me() }) };

describe('LoginMethodsPage', () => {
  it('ba dòng với trạng thái bằng chữ; không lỗi trợ năng; dùng được bằng bàn phím', async () => {
    fakeApi({ ...session, [METHODS]: () => ({ status: 200, body: list(true) }) });
    const { container } = renderAt('/settings/login-methods');
    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText(/Đã liên kết/)).toBeInTheDocument();
    expect(
      within(rows[1]!).getByText(/Đã liên kết · Lan G – lan\.g@example\.vn/),
    ).toBeInTheDocument();
    expect(within(rows[2]!).getByText(/Chưa liên kết/)).toBeInTheDocument();
    expect(within(rows[1]!).getByRole('button', { name: 'Gỡ Google' })).toBeInTheDocument();
    expect(within(rows[2]!).getByRole('button', { name: 'Liên kết Facebook' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    expect(keyboardReachable(container)).toBe(true);
  });

  it('người chỉ có Google thấy nút "Tạo mật khẩu" → báo đã gửi thư', async () => {
    fakeApi({
      ...session,
      [METHODS]: () => ({
        status: 200,
        body: {
          methods: [
            { kind: 'password', linked: false },
            { kind: 'google', linked: true, providerEmail: 'a@example.vn' },
            { kind: 'facebook', linked: false },
          ],
          reauthFresh: true,
        },
      }),
      'POST /api/v1/auth/login-methods/password/request': () => ({
        status: 202,
        body: { status: 'check_email' },
      }),
    });
    renderAt('/settings/login-methods');
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo mật khẩu' }));
    expect(await screen.findByText(/đã gửi thư tạo mật khẩu/)).toBeInTheDocument();
  });

  it('REAUTH_REQUIRED → mở hộp xác nhận lại; đúng mật khẩu → TỰ làm lại thao tác đang dở', async () => {
    let fresh = false;
    const api = fakeApi({
      ...session,
      [METHODS]: () => ({ status: 200, body: list(true) }),
      'DELETE /api/v1/auth/login-methods/google': () =>
        fresh
          ? { status: 204 }
          : {
              status: 403,
              body: apiError('REAUTH_REQUIRED', { message: 'Hãy xác nhận lại đây là bạn.' }),
            },
      'POST /api/v1/auth/reauth': () => {
        fresh = true;
        return { status: 204 };
      },
    });
    const { container } = renderAt('/settings/login-methods');
    fireEvent.click(await screen.findByRole('button', { name: 'Gỡ Google' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Hãy xác nhận lại đây là bạn')).toBeInTheDocument();
    // Có mật khẩu → ô mật khẩu; có Google đã liên kết → nút xác nhận bằng Google.
    expect(
      within(dialog).getByRole('button', { name: 'Xác nhận bằng Google' }),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Xác nhận bằng Facebook' })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.change(within(dialog).getByLabelText('Mật khẩu'), {
      target: { value: 'mat-khau-dung' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
    expect(await screen.findByText('Đã gỡ cách đăng nhập bằng Google.')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(
      api.calls.filter((c) => c.method === 'DELETE' && c.path.endsWith('/login-methods/google')),
    ).toHaveLength(2);
  });

  it('gỡ cách cuối → hiện "Hãy thêm cách đăng nhập khác trước khi gỡ"', async () => {
    fakeApi({
      ...session,
      [METHODS]: () => ({ status: 200, body: list(false) }),
      'DELETE /api/v1/auth/login-methods/password': () => ({
        status: 409,
        body: apiError('LAST_LOGIN_METHOD', {
          message: 'Hãy thêm cách đăng nhập khác trước khi gỡ.',
        }),
      }),
    });
    renderAt('/settings/login-methods');
    fireEvent.click(await screen.findByRole('button', { name: 'Gỡ Mật khẩu' }));
    expect(
      await screen.findByText('Hãy thêm cách đăng nhập khác trước khi gỡ.'),
    ).toBeInTheDocument();
  });

  it('liên kết → chuyển sang nhà cung cấp; quay về /oauth/result (purpose link) → trở lại kèm kết quả', async () => {
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    fakeApi({
      ...session,
      [METHODS]: () => ({ status: 200, body: list(false) }),
      'POST /api/v1/auth/login-methods/facebook/start': () => ({
        status: 200,
        body: { authorizationUrl: 'https://fb.example/dialog?state=x' },
      }),
      'GET /api/v1/auth/oauth/pending': () => ({
        status: 200,
        body: {
          provider: 'facebook',
          purpose: 'link',
          stage: 'completed',
          suggestedDisplayName: null,
          suggestedEmail: null,
          emailRequired: false,
          methods: [],
          hint: null,
          error: null,
        },
      }),
    });
    renderAt('/settings/login-methods');
    fireEvent.click(await screen.findByRole('button', { name: 'Liên kết Facebook' }));
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('https://fb.example/dialog?state=x');
    });
    cleanup();
    const back = renderAt('/oauth/result');
    await waitFor(() => {
      expect(back.router.state.location.pathname).toBe('/settings/login-methods');
    });
    expect(await screen.findByText('Đã liên kết Facebook.')).toBeInTheDocument();
  });
});
