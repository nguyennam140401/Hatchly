// T072 (012 US5) – màn hình Lịch: chế độ tuần/tháng, "Hôm nay", chuyển tuần, "+N bài nữa", thẻ không đổi được có giải thích,
// "Đổi giờ" (đường chính, dùng bàn phím) gọi PUT /posts/:id/schedule; lỗi → thẻ KHÔNG đổi chỗ + thông điệp kèm cách xử lý; axe.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { apiError, fakeApi, me, renderAt } from '../auth/helpers';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ownerMe = () => ({
  ...me({ role: 'owner' }),
  permissions: ['post.edit', 'post.approve', 'post.reschedule', 'status.view'],
});
const viewerMe = () => ({ ...me({ role: 'collaborator' }), permissions: ['status.view'] });

/** Mốc "hôm nay 10:00 giờ Việt Nam" (03:00 UTC) để thẻ luôn rơi vào tuần đang xem. */
const today10 = () => {
  const d = new Date(Date.now() + 7 * 3_600_000);
  d.setUTCHours(10, 0, 0, 0);
  return new Date(d.getTime() - 7 * 3_600_000).toISOString();
};

const card = (n: number, over: Record<string, unknown> = {}) => ({
  postId: `0190a000-0000-7000-8000-0000000000e${String(n)}`,
  title: `Bài lịch ${String(n)}`,
  scheduledAt: today10(),
  status: 'approved',
  version: 4,
  labels: { returned: null, editedAfterApproval: false, timePassed: false },
  channels: [{ channelType: 'facebook_page', displayName: 'Tiệm', attemptStatus: 'scheduled' }],
  movable: true,
  movableReason: null,
  ...over,
});

const calendar = (items: unknown[], meBody = ownerMe()) => ({
  'GET /api/v1/auth/me': () => ({ status: 200, body: meBody }),
  'GET /api/v1/calendar': () => ({ status: 200, body: { items } }),
});

describe('CalendarPage', () => {
  it('hiện bài theo ngày giờ Việt Nam, trạng thái bằng chữ; chuyển tuần/tháng; 0 vi phạm axe', async () => {
    const api = fakeApi(calendar([card(1)]));
    const { container } = renderAt('/calendar');
    expect(await screen.findByText('Bài lịch 1')).toBeInTheDocument();
    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(screen.getByText(/Đã lên lịch/)).toBeInTheDocument();
    expect(screen.getByText(/Hôm nay/, { selector: 'h3' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    const before = api.calls.filter((c) => c.path === '/api/v1/calendar').length;
    fireEvent.click(screen.getByRole('button', { name: 'Tháng' }));
    await waitFor(() => {
      expect(api.calls.filter((c) => c.path === '/api/v1/calendar').length).toBeGreaterThan(before);
    });
    expect(screen.getByRole('button', { name: 'Tháng' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('thẻ không đổi được (đã bắt đầu đăng) có giải thích ngắn và không có nút "Đổi giờ"', async () => {
    fakeApi(
      calendar([
        card(1, {
          movable: false,
          movableReason: 'Bài đã bắt đầu đăng hoặc đã đăng nên không đổi giờ được.',
        }),
      ]),
    );
    renderAt('/calendar');
    expect(
      await screen.findByText(/đã bắt đầu đăng hoặc đã đăng nên không đổi giờ được/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đổi giờ' })).not.toBeInTheDocument();
  });

  it('"Đổi giờ": hộp chọn giờ → PUT đúng phiên bản và giờ UTC; không cần kéo thả', async () => {
    const item = card(1);
    const api = fakeApi({
      ...calendar([item]),
      [`PUT /api/v1/posts/${item.postId}/schedule`]: () => ({
        status: 200,
        body: { id: item.postId, status: 'approved', version: 5 },
      }),
    });
    renderAt('/calendar');
    await screen.findByText('Bài lịch 1');
    fireEvent.click(screen.getByRole('button', { name: 'Đổi giờ' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Giờ đăng mới/), {
      target: { value: '2099-01-02T09:30' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu giờ mới' }));
    await waitFor(() => {
      expect(api.calls.some((c) => c.method === 'PUT')).toBe(true);
    });
    const put = api.calls.find((c) => c.method === 'PUT');
    expect(put?.body).toEqual({ expectedVersion: 4, scheduledAt: '2099-01-02T02:30:00.000Z' });
  });

  it('máy chủ từ chối (giờ quá khứ) → thông điệp kèm cách xử lý, thẻ vẫn ở chỗ cũ', async () => {
    const item = card(1);
    fakeApi({
      ...calendar([item]),
      [`PUT /api/v1/posts/${item.postId}/schedule`]: () => ({
        status: 422,
        body: apiError('TIME_IN_PAST'),
      }),
    });
    renderAt('/calendar');
    await screen.findByText('Bài lịch 1');
    fireEvent.click(screen.getByRole('button', { name: 'Đổi giờ' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Giờ đăng mới/), {
      target: { value: '2020-01-01T09:00' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu giờ mới' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Bài lịch 1')).toBeInTheDocument();
    expect(screen.getByText('10:00')).toBeInTheDocument();
  });

  it('người chỉ xem (không có quyền đổi giờ): không có nút "Đổi giờ"', async () => {
    fakeApi(calendar([card(1)], viewerMe()));
    renderAt('/calendar');
    await screen.findByText('Bài lịch 1');
    expect(screen.queryByRole('button', { name: 'Đổi giờ' })).not.toBeInTheDocument();
  });

  it('chế độ tháng: quá 3 bài trong ngày → "+N bài nữa" mở đủ danh sách', async () => {
    fakeApi(calendar([card(1), card(2), card(3), card(4), card(5)]));
    renderAt('/calendar');
    await screen.findByText('Bài lịch 1');
    fireEvent.click(screen.getByRole('button', { name: 'Tháng' }));
    const more = await screen.findByRole('button', { name: '+2 bài nữa' });
    expect(screen.queryByText('Bài lịch 5')).not.toBeInTheDocument();
    fireEvent.click(more);
    expect(await screen.findByText('Bài lịch 5')).toBeInTheDocument();
  });
});
