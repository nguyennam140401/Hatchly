// T057 (012 US3) – màn hình Chờ duyệt: danh sách (nhãn bằng chữ), chọn nhiều, duyệt hàng loạt có kết quả "Đã xử lý N bài, M bài
// chưa xử lý được", trả lại cần ghi chú, trạng thái rỗng, cộng tác viên không dùng được; quét axe 0 vi phạm.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { fakeApi, me, renderAt } from '../auth/helpers';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ownerMe = () => ({
  ...me({ role: 'owner' }),
  permissions: ['post.edit', 'post.approve', 'status.view'],
});
const collabMe = () => ({
  ...me({ role: 'collaborator' }),
  permissions: ['post.edit', 'status.view'],
});

const item = (n: number, over: Record<string, unknown> = {}) => ({
  postId: `0190a000-0000-7000-8000-0000000000c${String(n)}`,
  title: `Bài số ${String(n)}`,
  excerpt: `Nội dung ngắn của bài ${String(n)}`,
  channelTypes: ['facebook_page'],
  authorUserId: 'u-ctv',
  authorDisplayName: 'Cộng tác viên',
  scheduledAt: '2026-11-20T03:00:00.000Z',
  version: 2,
  timePassed: false,
  returned: false,
  editedAfterApproval: false,
  submittedAt: '2026-11-16T01:00:00.000Z',
  ...over,
});

const pending = (items: unknown[]) => ({
  'GET /api/v1/auth/me': () => ({ status: 200, body: ownerMe() }),
  'GET /api/v1/approvals/pending': () => ({ status: 200, body: { items, nextCursor: null } }),
});

describe('PendingPage', () => {
  it('liệt kê bài kèm nhãn chữ "Giờ đã qua", "Bị trả lại", "Đã sửa sau khi duyệt"; 0 vi phạm axe', async () => {
    fakeApi(
      pending([
        item(1, { timePassed: true }),
        item(2, { returned: true }),
        item(3, { editedAfterApproval: true }),
      ]),
    );
    const { container } = renderAt('/approvals');
    expect(await screen.findByText('Bài số 1')).toBeInTheDocument();
    expect(screen.getByText(/Giờ đã qua/)).toBeInTheDocument();
    expect(screen.getByText(/Bị trả lại/)).toBeInTheDocument();
    expect(screen.getByText(/Đã sửa sau khi duyệt/)).toBeInTheDocument();
    expect(screen.getAllByText(/Cộng tác viên/).length).toBeGreaterThan(0);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('không có bài → "Không có bài chờ duyệt."', async () => {
    fakeApi(pending([]));
    renderAt('/approvals');
    expect(await screen.findByText('Không có bài chờ duyệt.')).toBeInTheDocument();
  });

  it('chọn tất cả → duyệt hàng loạt; kết quả nói rõ bài chưa duyệt được kèm cách xử lý (mở bài)', async () => {
    const api = fakeApi({
      ...pending([item(1), item(2)]),
      'POST /api/v1/approvals/approve-batch': () => ({
        status: 200,
        body: {
          succeeded: 1,
          failed: 1,
          results: [
            { postId: item(1).postId, status: 'ok' },
            {
              postId: item(2).postId,
              status: 'failed',
              error: { code: 'TIME_IN_PAST', message: 'Giờ đăng đã qua hoặc quá gần.' },
            },
          ],
        },
      }),
    });
    renderAt('/approvals');
    await screen.findByText('Bài số 1');
    const approve = screen.getByRole('button', { name: /Duyệt đã chọn/ });
    expect(approve).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn tất cả' }));
    fireEvent.click(screen.getByRole('button', { name: 'Duyệt đã chọn (2)' }));
    expect(await screen.findByText(/Đã xử lý 1 bài, 1 bài chưa xử lý được/)).toBeInTheDocument();
    expect(screen.getByText(/Giờ đăng đã qua hoặc quá gần/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mở bài' })).toHaveAttribute(
      'href',
      `/posts/${item(2).postId}`,
    );
    const call = api.calls.find((c) => c.path === '/api/v1/approvals/approve-batch');
    expect(call?.body).toEqual({
      items: [
        { postId: item(1).postId, expectedVersion: 2 },
        { postId: item(2).postId, expectedVersion: 2 },
      ],
    });
    // Mã tài khoản KHÔNG bao giờ được gửi.
    expect(JSON.stringify(call?.body)).not.toMatch(/accountId/i);
  });

  it('trả lại: ghi chú bắt buộc (nút khóa tới khi nhập), gửi ghi chung cho các bài đã chọn', async () => {
    const api = fakeApi({
      ...pending([item(1)]),
      'POST /api/v1/approvals/return-batch': () => ({
        status: 200,
        body: { succeeded: 1, failed: 0, results: [{ postId: item(1).postId, status: 'ok' }] },
      }),
    });
    renderAt('/approvals');
    await screen.findByText('Bài số 1');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Bài số 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Trả lại đã chọn' }));
    const dialog = await screen.findByRole('dialog');
    const send = within(dialog).getByRole('button', { name: 'Trả lại' });
    expect(send).toHaveAttribute('aria-disabled', 'true');
    fireEvent.change(within(dialog).getByLabelText(/Ghi chú/), {
      target: { value: 'Đổi ảnh bìa' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Trả lại' }));
    await waitFor(() => {
      expect(api.calls.some((c) => c.path === '/api/v1/approvals/return-batch')).toBe(true);
    });
    const call = api.calls.find((c) => c.path === '/api/v1/approvals/return-batch');
    expect(call?.body).toMatchObject({ note: 'Đổi ảnh bìa' });
    expect(await screen.findByText(/Đã xử lý 1 bài/)).toBeInTheDocument();
  });

  it('bài quá giờ: "Dời tất cả bài quá giờ về giờ gợi ý" chỉ chạy khi chủ bấm, mỗi bài một giờ khác nhau', async () => {
    const api = fakeApi({
      ...pending([item(1, { timePassed: true }), item(2, { timePassed: true }), item(3)]),
      'POST /api/v1/approvals/suggest-times': () => ({
        status: 200,
        body: { times: ['2026-11-21T02:00:00.000Z', '2026-11-21T05:00:00.000Z'] },
      }),
      [`PUT /api/v1/posts/${item(1).postId}/schedule`]: () => ({
        status: 200,
        body: { id: item(1).postId, status: 'pending_review', version: 3 },
      }),
      [`PUT /api/v1/posts/${item(2).postId}/schedule`]: () => ({
        status: 200,
        body: { id: item(2).postId, status: 'pending_review', version: 3 },
      }),
    });
    renderAt('/approvals');
    await screen.findByText('Bài số 1');
    expect(api.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /Dời tất cả bài quá giờ/ }));
    await waitFor(() => {
      expect(api.calls.filter((c) => c.method === 'PUT')).toHaveLength(2);
    });
    const times = api.calls
      .filter((c) => c.method === 'PUT')
      .map((c) => (c.body as { scheduledAt: string }).scheduledAt);
    expect(new Set(times).size).toBe(2);
  });

  it('cộng tác viên: được giải thích, không có nút duyệt', async () => {
    fakeApi({ 'GET /api/v1/auth/me': () => ({ status: 200, body: collabMe() }) });
    renderAt('/approvals');
    expect(await screen.findByText(/Chỉ chủ tài khoản mới duyệt được bài/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Duyệt đã chọn/ })).not.toBeInTheDocument();
  });
});
