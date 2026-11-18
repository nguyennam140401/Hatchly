import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, fakeApi, healthy, keyboardReachable, me, renderAt } from './helpers';

// T064 + T083 (009 – US4, FR-009a): người không thuộc tài khoản nào; trang trạng thái của Meta.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const detached = () => ({
  ...me(),
  account: { id: 'shell-1', status: 'unclaimed' },
  permissions: [],
});
const MINE = 'GET /api/v1/invitations/mine';
const invitation = {
  id: '0190a0b0-0000-7000-8000-000000000001',
  accountLabel: 'tài khoản của Chị Lan',
  inviterName: 'Chị Lan',
  expiresAt: '2026-11-20T10:00:00.000Z',
};

describe('SessionGate với người ở tài khoản chờ', () => {
  it('mọi route nghiệp vụ → /no-account; trang Cách đăng nhập vẫn vào được', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: detached() }),
      [MINE]: () => ({ status: 200, body: { invitations: [] } }),
      'GET /api/v1/auth/login-methods': () => ({
        status: 200,
        body: {
          methods: [
            { kind: 'password', linked: true },
            { kind: 'google', linked: false },
            { kind: 'facebook', linked: false },
          ],
          reauthFresh: true,
        },
      }),
    });
    for (const path of ['/', '/business-profile', '/settings/members']) {
      const { router } = renderAt(path);
      await waitFor(() => {
        expect(router.state.location.pathname, path).toBe('/no-account');
      });
      cleanup();
    }
    const { router } = renderAt('/settings/login-methods');
    expect(await screen.findByRole('heading', { name: 'Cách đăng nhập' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/settings/login-methods');
  });
});

describe('NoAccountPage', () => {
  it('hiện lời giải thích, lời mời đang chờ + "Tham gia", tạo tài khoản riêng (ô đồng ý chưa tích), lối ra', async () => {
    const api = fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: detached() }),
      [MINE]: () => ({ status: 200, body: { invitations: [invitation] } }),
      'POST /api/v1/invitations/accept-existing': () => ({
        status: 200,
        body: me({ role: 'collaborator' }),
      }),
      'GET /healthz': () => ({ status: 200, body: healthy }),
    });
    const { container } = renderAt('/no-account');
    expect(
      await screen.findByRole('heading', { name: 'Bạn không còn là thành viên của tài khoản nào' }),
    ).toBeInTheDocument();
    const join = await screen.findByRole('button', { name: 'Tham gia tài khoản của Chị Lan' });
    const claim = screen.getByRole('button', { name: 'Tạo tài khoản kinh doanh của riêng tôi' });
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(claim).toHaveAttribute('aria-disabled', 'true'); // khóa kèm lý do (chuẩn 011)
    expect(screen.getByText(/Google và Meta sẽ gửi cho chúng tôi/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cách đăng nhập' })).toHaveAttribute(
      'href',
      '/settings/login-methods',
    );
    expect(screen.getByRole('button', { name: 'Đăng xuất' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    expect(keyboardReachable(container)).toBe(true);

    fireEvent.click(join);
    await waitFor(() => {
      expect(api.calls.find((c) => c.path === '/api/v1/invitations/accept-existing')?.body).toEqual(
        { invitationId: invitation.id },
      );
    });
  });

  it('tích ô đồng ý rồi tạo tài khoản → gọi claim với acceptTerms; lỗi hiện kèm hành động', async () => {
    let fail = true;
    const api = fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: detached() }),
      [MINE]: () => ({ status: 200, body: { invitations: [] } }),
      'POST /api/v1/account/claim': () =>
        fail
          ? {
              status: 409,
              body: apiError('ALREADY_IN_ACCOUNT', {
                message: 'Bạn đang thuộc một tài khoản khác.',
              }),
            }
          : { status: 200, body: me() },
      'GET /healthz': () => ({ status: 200, body: healthy }),
    });
    renderAt('/no-account');
    expect(
      await screen.findByText('Chưa có lời mời nào gửi tới email của bạn.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    const claim = screen.getByRole('button', { name: 'Tạo tài khoản kinh doanh của riêng tôi' });
    fireEvent.click(claim);
    expect(await screen.findByText('Bạn đang thuộc một tài khoản khác.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Hành động' })).toBeInTheDocument();
    fail = false;
    fireEvent.click(claim);
    await waitFor(() => {
      expect(api.calls.filter((c) => c.path === '/api/v1/account/claim')).toHaveLength(2);
    });
    expect(api.calls.find((c) => c.path === '/api/v1/account/claim')?.body).toEqual({
      acceptTerms: true,
      termsVersion: '2026-11',
    });
  });
});

describe('DataDeletionStatusPage', () => {
  it('completed → "Đã xử lý"; no_data → "Không có dữ liệu để xóa"; mã lạ → thông báo + về trang đầu', async () => {
    fakeApi({
      'GET /api/v1/public/data-deletion/ma-xong': () => ({
        status: 200,
        body: { status: 'completed', receivedAt: '2026-11-10T03:00:00.000Z' },
      }),
      'GET /api/v1/public/data-deletion/ma-trong': () => ({
        status: 200,
        body: { status: 'no_data', receivedAt: '2026-11-10T03:00:00.000Z' },
      }),
    });
    const done = renderAt('/data-deletion/ma-xong');
    expect(await screen.findByText('Đã xử lý')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Hoàn tất' })).toBeInTheDocument();
    expect(screen.getByText(/Nhận yêu cầu lúc/)).toBeInTheDocument();
    expect(await axe(done.container)).toHaveNoViolations();
    cleanup();

    renderAt('/data-deletion/ma-trong');
    expect(await screen.findByText('Không có dữ liệu để xóa')).toBeInTheDocument();
    cleanup();

    const missing = renderAt('/data-deletion/ma-la');
    expect(await screen.findByText(/Không tìm thấy yêu cầu với mã này/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Về trang đầu' })).toHaveAttribute('href', '/');
    expect(await axe(missing.container)).toHaveNoViolations();
  });
});
