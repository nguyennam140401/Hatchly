import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from '../../src/lib/api/endpoints/auth';
import { apiError, fakeApi, healthy, keyboardReachable, me, renderAt } from '../auth/helpers';

// T050 + T064 (009 – US3, US4): Cài đặt → Thành viên và trang mở từ thư mời.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

const owner = () => ({ ...me(), permissions: ['post.edit', 'members.manage'] });
const MEMBERS = 'GET /api/v1/members';
const members = (overrides: Record<string, unknown> = {}) => ({
  owner: { userId: 'u-1', displayName: 'Chị Lan', email: 'lan@example.vn' },
  collaborators: [
    {
      userId: 'u-2',
      displayName: 'Minh',
      email: 'minh@example.vn',
      joinedAt: '2026-11-01T00:00:00.000Z',
    },
  ],
  invitations: [
    {
      id: 'inv-1',
      email: 'ha@example.vn',
      sentAt: '2026-11-05T00:00:00.000Z',
      expiresAt: '2026-11-12T00:00:00.000Z',
    },
  ],
  seats: { used: 2, total: 2 },
  ...overrides,
});

describe('MembersPage', () => {
  it('danh sách chủ / cộng tác viên / lời mời "Đang chờ" bằng chữ; đủ chỗ → nút Mời khóa kèm giải thích', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: owner() }),
      [MEMBERS]: () => ({ status: 200, body: members() }),
    });
    const { container } = renderAt('/settings/members');
    expect(await screen.findByText('Còn 0/2 chỗ cho cộng tác viên.')).toBeInTheDocument();
    expect(screen.getByText(/Chủ tài khoản · lan@example\.vn/)).toBeInTheDocument();
    expect(screen.getByText(/Cộng tác viên · minh@example\.vn/)).toBeInTheDocument();
    expect(screen.getByText(/Đang chờ · hết hạn/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mời' })).toHaveAttribute('aria-disabled', 'true'); // khóa kèm lý do (chuẩn 011)
    expect(screen.getByText(/Đã đủ 2 cộng tác viên/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gửi lại' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hủy lời mời' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    expect(keyboardReachable(container)).toBe(true);
  });

  it('mời, gửi lại, hủy gọi đúng API; lỗi mời chính mình hiện cạnh ô', async () => {
    let self = true;
    const api = fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: owner() }),
      [MEMBERS]: () => ({
        status: 200,
        body: members({ collaborators: [], seats: { used: 1, total: 2 } }),
      }),
      'POST /api/v1/members/invitations': () =>
        self
          ? {
              status: 400,
              body: apiError('INVITE_SELF', { message: 'Bạn đang là chủ tài khoản này.' }),
            }
          : {
              status: 201,
              body: {
                id: 'inv-2',
                email: 'tu@example.vn',
                sentAt: '2026-11-06T00:00:00.000Z',
                expiresAt: '2026-11-13T00:00:00.000Z',
              },
            },
      'POST /api/v1/members/invitations/inv-1/resend': () => ({
        status: 200,
        body: {
          id: 'inv-1',
          email: 'ha@example.vn',
          sentAt: '2026-11-06T00:00:00.000Z',
          expiresAt: '2026-11-13T00:00:00.000Z',
        },
      }),
      'DELETE /api/v1/members/invitations/inv-1': () => ({ status: 204 }),
    });
    renderAt('/settings/members');
    expect(await screen.findByText('Còn 1/2 chỗ cho cộng tác viên.')).toBeInTheDocument();
    const input = screen.getByLabelText('Email của người được mời');
    fireEvent.change(input, { target: { value: 'lan@example.vn' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mời' }));
    expect(await screen.findByText('Bạn đang là chủ tài khoản này.')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    self = false;
    fireEvent.change(input, { target: { value: 'tu@example.vn' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mời' }));
    expect(await screen.findByText('Đã gửi lời mời tới tu@example.vn.')).toBeInTheDocument();
    expect(api.calls.filter((c) => c.path === '/api/v1/members/invitations').at(-1)?.body).toEqual({
      email: 'tu@example.vn',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Gửi lại' }));
    expect(await screen.findByText('Đã gửi lại lời mời tới ha@example.vn.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hủy lời mời' }));
    expect(await screen.findByText('Đã hủy lời mời tới ha@example.vn.')).toBeInTheDocument();
  });

  it('gỡ: hộp xác nhận nêu hệ quả; xác nhận → DELETE /members/{userId}', async () => {
    const api = fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: owner() }),
      [MEMBERS]: () => ({ status: 200, body: members() }),
      'DELETE /api/v1/members/u-2': () => ({ status: 204 }),
    });
    const { container } = renderAt('/settings/members');
    fireEvent.click(await screen.findByRole('button', { name: 'Gỡ Minh' }));
    const dialog = screen.getByRole('alertdialog');
    expect(
      within(dialog).getByText(
        /Minh sẽ không vào được tài khoản này nữa\. Bài và media họ đã tạo vẫn được giữ lại\./,
      ),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gỡ khỏi tài khoản' }));
    expect(await screen.findByText('Đã gỡ Minh khỏi tài khoản.')).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === 'DELETE' && c.path === '/api/v1/members/u-2')).toBe(
      true,
    );
  });

  it('cộng tác viên: không thấy mục Thành viên ở trang chính; vào thẳng route bị từ chối, không gọi API', async () => {
    const api = fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: me({ role: 'collaborator' }) }),
      'GET /healthz': () => ({ status: 200, body: healthy }),
    });
    renderAt('/');
    await screen.findByText('Xin chào, Chủ tiệm hoa');
    expect(screen.queryByRole('link', { name: 'Thành viên' })).toBeNull();
    cleanup();
    renderAt('/settings/members');
    expect(
      await screen.findByText('Chỉ chủ tài khoản mới mời hoặc gỡ được cộng tác viên.'),
    ).toBeInTheDocument();
    expect(api.calls.some((c) => c.path === '/api/v1/members')).toBe(false);
  });

  it('chủ tài khoản thấy liên kết Thành viên ở trang chính', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: owner() }),
      'GET /healthz': () => ({ status: 200, body: healthy }),
    });
    renderAt('/');
    expect(await screen.findByRole('link', { name: 'Thành viên' })).toHaveAttribute(
      'href',
      '/settings/members',
    );
  });
});

describe('JoinPage', () => {
  const PREVIEW = 'POST /api/v1/invitations/preview';
  const preview = (mode: string) => ({
    accountLabel: 'tài khoản của Chị Lan',
    inviterName: 'Chị Lan',
    email: 'minh@example.vn',
    expiresAt: '2026-11-12T00:00:00.000Z',
    mode,
  });
  const anonymous = {
    'GET /api/v1/auth/me': () => ({ status: 401, body: apiError('UNAUTHENTICATED') }),
  };
  const open = () => {
    window.history.replaceState(null, '', '/join#token=ma-loi-moi_1');
    return renderAt('/join');
  };

  it('new_user: tên + mật khẩu + ô đồng ý chưa tích; nút nhà cung cấp chỉ bấm được sau khi tích', async () => {
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    const api = fakeApi({
      ...anonymous,
      [PREVIEW]: () => ({ status: 200, body: preview('new_user') }),
      'POST /api/v1/auth/oauth/google/start': () => ({
        status: 200,
        body: { authorizationUrl: 'https://accounts.example/a' },
      }),
      'POST /api/v1/invitations/accept': () => ({
        status: 200,
        body: me({ role: 'collaborator' }),
      }),
    });
    const { container } = open();
    expect(await screen.findByText(/mời bạn tham gia tài khoản của Chị Lan/)).toBeInTheDocument();
    // Mã đã bị xóa khỏi thanh địa chỉ trước khi gọi API.
    expect(api.calls.find((c) => c.path === '/api/v1/invitations/preview')).toMatchObject({
      body: { token: 'ma-loi-moi_1' },
      hashAtCall: '',
    });
    const checkbox = screen.getByRole('checkbox');
    const google = screen.getByRole('button', { name: 'Tiếp tục với Google' });
    expect(checkbox).not.toBeChecked();
    expect(google).toHaveAttribute('aria-disabled', 'true'); // khóa kèm lý do (chuẩn 011)
    expect(screen.getByText(/Google và Meta sẽ gửi cho chúng tôi/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    // Chưa tích mà bấm Tham gia → lỗi cạnh ô đồng ý, không gọi API.
    fireEvent.change(screen.getByLabelText('Tên hiển thị'), { target: { value: 'Minh' } });
    fireEvent.change(screen.getByLabelText('Đặt mật khẩu'), { target: { value: 'Hoa-sen-2026!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tham gia' }));
    expect(await screen.findByText('Bạn cần đồng ý điều khoản để tham gia.')).toBeInTheDocument();
    expect(api.calls.some((c) => c.path === '/api/v1/invitations/accept')).toBe(false);

    fireEvent.click(checkbox);
    expect(google).not.toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(google);
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('https://accounts.example/a');
    });
    expect(api.calls.find((c) => c.path.endsWith('/oauth/google/start'))?.body).toEqual({
      purpose: 'invite',
      invitationToken: 'ma-loi-moi_1',
      acceptTerms: true,
      termsVersion: '2026-11',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Tham gia' }));
    await waitFor(() => {
      expect(api.calls.find((c) => c.path === '/api/v1/invitations/accept')?.body).toEqual({
        token: 'ma-loi-moi_1',
        displayName: 'Minh',
        password: 'Hoa-sen-2026!',
        acceptTerms: true,
        termsVersion: '2026-11',
      });
    });
  });

  it('login_required và in_use hiện đúng hướng dẫn', async () => {
    fakeApi({ ...anonymous, [PREVIEW]: () => ({ status: 200, body: preview('login_required') }) });
    open();
    expect(
      await screen.findByRole('heading', { name: 'Hãy đăng nhập để tham gia' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Đăng nhập' })).toBeInTheDocument();
    cleanup();
    fakeApi({ ...anonymous, [PREVIEW]: () => ({ status: 200, body: preview('in_use') }) });
    open();
    expect(
      await screen.findByText('Email này đang dùng cho một tài khoản khác nên chưa tham gia được.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Hãy nhờ Chị Lan mời bạn bằng một email khác.')).toBeInTheDocument();
  });

  it('lời mời hỏng → "Lời mời không còn hiệu lực" + gợi ý nhờ gửi lại', async () => {
    fakeApi({
      ...anonymous,
      [PREVIEW]: () => ({
        status: 400,
        body: apiError('INVITE_INVALID', {
          message: 'Lời mời không còn hiệu lực. Hãy nhờ chủ tài khoản gửi lại lời mời.',
        }),
      }),
    });
    const { container } = open();
    expect(
      await screen.findByRole('heading', { name: 'Lời mời không còn hiệu lực' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Hãy nhờ chủ tài khoản gửi lại\.$/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('người ĐANG đăng nhập: thuộc tài khoản khác → giải thích + "Đăng xuất rồi mở lại liên kết"', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: me() }),
      [PREVIEW]: () => ({ status: 200, body: preview('new_user') }),
    });
    open();
    expect(
      await screen.findByRole('heading', { name: 'Bạn đang thuộc một tài khoản khác' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Đăng xuất rồi mở lại liên kết' }),
    ).toBeInTheDocument();
  });

  it('người ở tài khoản chờ: email trùng → "Tham gia" gọi accept-existing; email khác → đăng xuất rồi mở lại', async () => {
    const shell = (email: string) => ({
      ...me(),
      user: { ...me().user, email },
      account: { id: 'shell', status: 'unclaimed' },
      permissions: [],
    });
    const api = fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: shell('minh@example.vn') }),
      [PREVIEW]: () => ({ status: 200, body: preview('login_required') }),
      'POST /api/v1/invitations/accept-existing': () => ({
        status: 200,
        body: me({ role: 'collaborator' }),
      }),
    });
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Tham gia tài khoản của Chị Lan' }));
    await waitFor(() => {
      expect(api.calls.find((c) => c.path === '/api/v1/invitations/accept-existing')?.body).toEqual(
        { token: 'ma-loi-moi_1' },
      );
    });
    cleanup();
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: shell('khac@example.vn') }),
      [PREVIEW]: () => ({ status: 200, body: preview('login_required') }),
    });
    open();
    expect(await screen.findByText(/khác với email được mời/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Đăng xuất rồi mở lại liên kết' }),
    ).toBeInTheDocument();
  });
});
