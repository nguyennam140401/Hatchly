import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { apiError, fakeApi, keyboardReachable, me, renderAt } from '../../../test/auth/helpers';

// 010 T048/T065/T075/T083 (US6, US5, US7, US9): màn hình "Kênh kết nối" – trạng thái trống có "chỉ đăng bài khi bạn bấm Duyệt", đủ
// trạng thái chữ + biểu tượng, cộng tác viên không có nút, TikTok vô hình khi công tắc tắt, Kiểm tra lại (429 đếm ngược), hộp ngắt.

/** Phần tử đầu của danh sách (báo lỗi rõ khi trống) – tránh khẳng định `!`/`as` rải rác. */
const first = (els: HTMLElement[]): HTMLElement => {
  const [el] = els;
  if (el === undefined) throw new Error('Không tìm thấy phần tử');
  return el;
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

const OVERVIEW = 'GET /api/v1/channels/overview';
const ownerMe = () => ({
  ...me(),
  permissions: ['post.edit', 'status.view', 'channel.view', 'channel.manage'],
});
const collabMe = () => ({
  ...me({ role: 'collaborator' }),
  permissions: ['post.edit', 'status.view', 'channel.view'],
});

const item = (over: Record<string, unknown> = {}) => ({
  connectionId: '0198a1b2-0000-7000-8000-000000000001',
  channelType: 'facebook_page',
  displayName: 'Tiệm hoa Lan',
  shortCode: 'a1b2c3',
  avatarUrl: null,
  state: 'active',
  reasonCode: null,
  reasonVi: null,
  actionsVi: [],
  expiry: { kind: 'none', expiresAt: null, daysLeft: null },
  conditions: {
    accountType: 'page',
    scopes: [{ nameVi: 'Đăng bài', granted: true }],
    quotaRemaining: null,
  },
  sourceConnectionId: null,
  sourceDisplayName: null,
  scheduledImpact: { count: 0, nextAt: null },
  lastCheckedAt: '2026-11-19T03:00:00.000Z',
  connectedAt: '2026-11-01T03:00:00.000Z',
  supportDetails: { lastErrorCode: null },
  ...over,
});

const overview = (over: Record<string, unknown> = {}) => ({
  features: { tiktok: false },
  limits: { perPlatform: 5 },
  platforms: [
    { channelType: 'facebook_page', used: 0, limit: 5, canAdd: true },
    { channelType: 'instagram', used: 0, limit: 5, canAdd: true },
  ],
  connections: [],
  attention: [],
  planActive: true,
  viewerCanManage: true,
  ...over,
});

const FB = '0198a1b2-0000-7000-8000-000000000001';
const FB2 = '0198a1b2-0000-7000-8000-000000000002';
const IG = '0198a1b2-0000-7000-8000-000000000003';
const full = () =>
  overview({
    platforms: [
      { channelType: 'facebook_page', used: 3, limit: 5, canAdd: true },
      { channelType: 'instagram', used: 1, limit: 5, canAdd: true },
    ],
    connections: [
      item({ connectionId: FB, displayName: 'Tiệm hoa Lan', shortCode: 'a1b2c3' }),
      item({
        connectionId: FB2,
        displayName: 'Tiệm hoa Lan',
        shortCode: 'd4e5f6',
        state: 'expiring',
        reasonVi: 'Quyền sắp hết hạn.',
        expiry: { kind: 'token', expiresAt: '2026-11-24T03:00:00.000Z', daysLeft: 5 },
        scheduledImpact: { count: 3, nextAt: '2026-11-21T03:00:00.000Z' },
      }),
      item({
        connectionId: IG,
        channelType: 'instagram',
        displayName: '@tiemhoa',
        shortCode: '9z8y7x',
        state: 'needs_reconnect',
        reasonCode: 'SOURCE_PAGE_LOST',
        reasonVi: 'Page nguồn cần kết nối lại.',
        sourceConnectionId: FB2,
        sourceDisplayName: 'Tiệm hoa Lan',
        supportDetails: { lastErrorCode: 'FB:190' },
      }),
      item({
        connectionId: '0198a1b2-0000-7000-8000-000000000004',
        displayName: 'Cửa hàng B',
        shortCode: 'q1w2e3',
        state: 'ineligible',
        reasonVi: 'Bạn cần vai trò biên tập viên.',
      }),
    ],
    attention: [
      { connectionId: FB2, kind: 'expiring', daysLeft: 5 },
      { connectionId: IG, kind: 'needs_reconnect' },
    ],
  });

describe('ChannelsPage', () => {
  it('trạng thái trống: nêu "chỉ đăng bài khi bạn bấm Duyệt", có nút Kết nối kênh', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: ownerMe() }),
      [OVERVIEW]: () => ({ status: 200, body: overview() }),
    });
    const { container } = renderAt('/channels');
    expect(await screen.findByText(/Chưa có kênh nào được kết nối/)).toBeInTheDocument();
    expect(screen.getByText(/Ứng dụng chỉ đăng bài khi bạn bấm Duyệt/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Kết nối kênh' }).length).toBeGreaterThan(0);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('nhiều kết nối đủ trạng thái: chữ + biểu tượng, nhóm "Facebook Page (3/5)", mã rút gọn phân biệt trùng tên, biểu ngữ liệt kê từng kênh', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: ownerMe() }),
      [OVERVIEW]: () => ({ status: 200, body: full() }),
    });
    const { container } = renderAt('/channels');
    expect(await screen.findByRole('heading', { name: 'Facebook Page (3/5)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Instagram (1/5)' })).toBeInTheDocument();
    for (const text of ['Đang hoạt động', 'Sắp hết hạn', 'Cần kết nối lại', 'Chưa đủ điều kiện']) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText(/#a1b2c3/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/#d4e5f6/).length).toBeGreaterThan(0); // hai kênh trùng tên phân biệt bằng mã
    expect(
      screen.getByText(/Quyền có hiệu lực đến 24\/11\/2026 \(còn 5 ngày\)/),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Không có ngày hết hạn cố định/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Liên kết qua Page: Tiệm hoa Lan/)).toBeInTheDocument();
    expect(screen.getByText(/Có 3 bài đã lên lịch dùng kênh này/)).toBeInTheDocument();
    // Biểu ngữ liệt kê TỪNG kênh cần chú ý.
    const banner = screen.getByRole('region', { name: /Có kênh cần bạn xử lý/ });
    expect(within(banner).getAllByRole('listitem')).toHaveLength(2);
    expect(await axe(container)).toHaveNoViolations();
    expect(keyboardReachable(container)).toBe(true);
  });

  it('lọc bằng chip theo nền tảng', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: ownerMe() }),
      [OVERVIEW]: () => ({ status: 200, body: full() }),
    });
    renderAt('/channels');
    await screen.findByRole('heading', { name: 'Facebook Page (3/5)' });
    fireEvent.click(screen.getByRole('button', { name: 'Instagram' }));
    await waitFor(() => {
      expect(
        screen.queryByRole('heading', { name: 'Facebook Page (3/5)' }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'Instagram (1/5)' })).toBeInTheDocument();
  });

  it('cộng tác viên chỉ xem: không có nút Kết nối/Kết nối lại/Kiểm tra lại/Ngắt, có dòng giải thích', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: collabMe() }),
      [OVERVIEW]: () => ({ status: 200, body: { ...full(), viewerCanManage: false } }),
    });
    renderAt('/channels');
    await screen.findByRole('heading', { name: 'Facebook Page (3/5)' });
    for (const name of ['Kết nối kênh', 'Kết nối lại', 'Kiểm tra lại', 'Ngắt kết nối']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.getAllByText(/Chỉ chủ tài khoản mới kết nối được kênh/).length).toBeGreaterThan(
      0,
    );
  });

  it('TikTok vô hình khi công tắc tắt: 0 chữ "TikTok" ở trang', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: ownerMe() }),
      [OVERVIEW]: () => ({ status: 200, body: full() }),
    });
    const { container } = renderAt('/channels');
    await screen.findByRole('heading', { name: 'Facebook Page (3/5)' });
    fireEvent.click(screen.getByRole('button', { name: 'Kết nối kênh' }));
    expect(container.textContent).not.toMatch(/TikTok/i);
  });

  it('TikTok có kết nối từ trước nhưng công tắc tắt: thẻ "Tạm tắt" chỉ có Ngắt kết nối, kèm chú thích', async () => {
    const tiktokItem = item({
      connectionId: '0198a1b2-0000-7000-8000-000000000009',
      channelType: 'tiktok',
      displayName: 'TikTok shop',
      shortCode: 'tt0001',
      state: 'suspended',
      reasonCode: 'FEATURE_OFF',
    });
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: ownerMe() }),
      [OVERVIEW]: () => ({ status: 200, body: overview({ connections: [tiktokItem] }) }),
    });
    renderAt('/channels');
    expect(await screen.findByText('Tính năng đang tạm tắt')).toBeInTheDocument();
    expect(screen.getAllByText('Tạm tắt').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Ngắt kết nối' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kiểm tra lại' })).not.toBeInTheDocument();
  });

  it('TikTok bật: có nút kết nối kèm "TikTok chỉ đăng video" và nhãn đang thử nghiệm', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: ownerMe() }),
      [OVERVIEW]: () => ({
        status: 200,
        body: overview({
          features: { tiktok: true },
          platforms: [
            { channelType: 'facebook_page', used: 0, limit: 5, canAdd: true },
            { channelType: 'instagram', used: 0, limit: 5, canAdd: true },
            {
              channelType: 'tiktok',
              used: 0,
              limit: 5,
              canAdd: true,
              experimental: true,
              note: 'TikTok chỉ đăng video',
            },
          ],
        }),
      }),
    });
    renderAt('/channels');
    fireEvent.click(first(await screen.findAllByRole('button', { name: 'Kết nối kênh' })));
    expect(screen.getByText(/TikTok chỉ đăng video/)).toBeInTheDocument();
    expect(screen.getByText(/đang thử nghiệm/)).toBeInTheDocument();
  });

  it('đủ giới hạn ⇒ nút nền tảng khóa kèm lý do; gói hết hạn ⇒ có dòng giải thích', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: ownerMe() }),
      [OVERVIEW]: () => ({
        status: 200,
        body: overview({
          planActive: false,
          platforms: [{ channelType: 'facebook_page', used: 5, limit: 5, canAdd: false }],
          connections: [item()],
        }),
      }),
    });
    renderAt('/channels');
    fireEvent.click(first(await screen.findAllByRole('button', { name: 'Kết nối kênh' })));
    expect(screen.getAllByText(/Gói đã hết hạn/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Facebook Page · Đã kết nối 5\/5/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('lỗi tải ⇒ ErrorNotice có nút Thử lại; bấm tải lại thành công', async () => {
    let fail = true;
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: ownerMe() }),
      [OVERVIEW]: () =>
        fail
          ? { status: 503, body: apiError('SERVICE_UNAVAILABLE') }
          : { status: 200, body: overview() },
    });
    renderAt('/channels');
    const retry = await screen.findByRole('button', { name: /Thử lại/ }, { timeout: 4000 });
    fail = false;
    fireEvent.click(retry);
    expect(await screen.findByText(/Chưa có kênh nào được kết nối/)).toBeInTheDocument();
  });

  it('Kiểm tra lại: 429 ⇒ nút khóa và đếm ngược', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: ownerMe() }),
      [OVERVIEW]: () => ({ status: 200, body: overview({ connections: [item()] }) }),
      [`POST /api/v1/channels/${FB}/recheck`]: () => ({
        status: 429,
        body: {
          error: {
            code: 'RECHECK_TOO_SOON',
            message: 'Bạn vừa kiểm tra xong, hãy thử lại sau ít giây.',
            actions: [{ kind: 'retry', label: 'Chờ' }],
            retryAfterSeconds: 7,
            support: { traceId: 't' },
          },
        },
      }),
    });
    renderAt('/channels');
    fireEvent.click(await screen.findByRole('button', { name: 'Kiểm tra lại' }));
    expect(await screen.findByRole('button', { name: /Chờ 7 giây/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('Kiểm tra lại: "unavailable" ⇒ thông báo "Chưa kiểm tra được", thẻ không đổi', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: ownerMe() }),
      [OVERVIEW]: () => ({ status: 200, body: overview({ connections: [item()] }) }),
      [`POST /api/v1/channels/${FB}/recheck`]: () => ({
        status: 200,
        body: {
          connection: item(),
          result: 'unavailable',
          messageVi: 'Chưa kiểm tra được, thử lại sau.',
        },
      }),
    });
    renderAt('/channels');
    fireEvent.click(await screen.findByRole('button', { name: 'Kiểm tra lại' }));
    expect(await screen.findByText('Chưa kiểm tra được, thử lại sau.')).toBeInTheDocument();
    expect(screen.getAllByText('Đang hoạt động').length).toBeGreaterThan(0);
  });

  it('hộp ngắt kết nối: nêu số bài đã lên lịch + Instagram phụ thuộc + "bài và lịch sử vẫn được giữ"; xác nhận gọi DELETE', async () => {
    const api = fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: ownerMe() }),
      [OVERVIEW]: () => ({ status: 200, body: full() }),
      [`GET /api/v1/channels/${FB2}/disconnect-preview`]: () => ({
        status: 200,
        body: {
          connectionId: FB2,
          displayName: 'Tiệm hoa Lan',
          scheduledImpact: { count: 3, nextAt: null },
          dependents: [{ connectionId: IG, displayName: '@tiemhoa', channelType: 'instagram' }],
        },
      }),
      [`DELETE /api/v1/channels/${FB2}`]: () => ({
        status: 200,
        body: {
          disconnected: true,
          revoked: 'failed',
          hintVi: 'Bạn có thể gỡ ứng dụng trong cài đặt Facebook.',
          cancelledAttempts: 3,
        },
      }),
    });
    renderAt('/channels');
    await screen.findByRole('heading', { name: 'Facebook Page (3/5)' });
    const card = first(
      screen.getAllByRole('listitem', { name: /Facebook Page Tiệm hoa Lan/ }).slice(1),
    );
    fireEvent.click(within(card).getByRole('button', { name: 'Ngắt kết nối' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      await within(dialog).findByText(/Có 3 bài đã lên lịch cho kênh này sẽ bị hủy/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Instagram @tiemhoa liên kết với Page này sẽ cần kết nối lại/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Bài và lịch sử đã đăng vẫn được giữ/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ngắt và xóa quyền' }));
    await waitFor(() => {
      expect(api.calls.some((c) => c.method === 'DELETE' && c.path.endsWith(FB2))).toBe(true);
    });
    expect(
      await screen.findByText(/Bạn có thể gỡ ứng dụng trong cài đặt Facebook/),
    ).toBeInTheDocument();
  });

  it('quay về với ?error=WRONG_CHANNEL: hiện thông điệp rồi xóa tham số khỏi URL', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: ownerMe() }),
      [OVERVIEW]: () => ({ status: 200, body: overview() }),
    });
    const { router } = renderAt('/channels?error=WRONG_CHANNEL');
    expect(await screen.findByText(/Bạn đã chọn một kênh khác/)).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.search).toBe('');
    });
  });
});
