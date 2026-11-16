// T085 (012 US7) – danh sách Bài viết: bộ lọc trạng thái (chữ + biểu tượng), tìm từ khóa, xóa Nháp có xác nhận, trạng thái rỗng
// kèm "Thêm bài", lối vào "Chờ duyệt" chỉ cho chủ; 0 vi phạm axe.
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
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

const post = (n: number, status: string, over: Record<string, unknown> = {}) => ({
  id: `0190a000-0000-7000-8000-0000000000d${String(n)}`,
  status,
  title: `Bài ${String(n)}`,
  scheduledAt: null,
  version: 1,
  labels: { returned: null, editedAfterApproval: false, timePassed: false },
  channelTypes: ['facebook_page', 'instagram'],
  updatedAt: '2026-11-16T00:00:00.000Z',
  ...over,
});

const list = (items: unknown[], meBody = ownerMe()) => ({
  'GET /api/v1/auth/me': () => ({ status: 200, body: meBody }),
  'GET /api/v1/posts': () => ({ status: 200, body: { items, nextCursor: null } }),
});

describe('PostsListPage', () => {
  it('liệt kê bài với trạng thái bằng chữ và nhãn "Bị trả lại"; 0 vi phạm axe', async () => {
    fakeApi(
      list([
        post(1, 'draft', {
          labels: { returned: { note: 'x' }, editedAfterApproval: false, timePassed: false },
        }),
        post(2, 'pending_review'),
        post(3, 'approved', { scheduledAt: '2026-11-20T03:00:00.000Z' }),
      ]),
    );
    const { container } = renderAt('/posts');
    expect(await screen.findByText('Bài 1')).toBeInTheDocument();
    expect(screen.getAllByText('Nháp').length).toBeGreaterThanOrEqual(2); // bộ lọc + nhãn trạng thái
    expect(screen.getAllByText('Chờ duyệt').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Đã lên lịch').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Bị trả lại/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('lọc theo trạng thái và tìm từ khóa → gọi API với status và q', async () => {
    const api = fakeApi(list([post(1, 'draft')]));
    renderAt('/posts');
    await screen.findByText('Bài 1');
    fireEvent.click(screen.getByRole('button', { name: /^Nháp$/ }));
    fireEvent.change(screen.getByLabelText('Tìm theo từ khóa'), { target: { value: 'áo dài' } });
    await waitFor(() => {
      expect(api.calls.some((c) => c.path === '/api/v1/posts' && c.method === 'GET')).toBe(true);
    });
  });

  it('chưa có bài → "Chưa có bài nào." kèm "Thêm bài"', async () => {
    fakeApi(list([]));
    renderAt('/posts');
    expect(await screen.findByText('Chưa có bài nào.')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Thêm bài' }).length).toBeGreaterThan(0);
  });

  it('xóa nháp có hộp xác nhận → DELETE đúng phiên bản', async () => {
    const draft = post(1, 'draft');
    const api = fakeApi({
      ...list([draft]),
      [`DELETE /api/v1/posts/${draft.id}`]: () => ({ status: 204 }),
    });
    renderAt('/posts');
    await screen.findByText('Bài 1');
    fireEvent.click(screen.getByRole('button', { name: 'Xóa nháp' }));
    expect(await screen.findByText('Xóa bài nháp?')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Xóa nháp' }).at(-1)!);
    await waitFor(() => {
      expect(api.calls.some((c) => c.method === 'DELETE')).toBe(true);
    });
  });

  it('chỉ chủ thấy lối vào "Chờ duyệt"; cộng tác viên không thấy', async () => {
    fakeApi(list([post(1, 'draft')]));
    renderAt('/posts');
    await screen.findByText('Bài 1');
    expect(screen.getByRole('link', { name: 'Chờ duyệt' })).toHaveAttribute('href', '/approvals');
    cleanup();
    fakeApi(list([post(1, 'draft')], collabMe()));
    renderAt('/posts');
    await screen.findByText('Bài 1');
    expect(screen.queryByRole('link', { name: 'Chờ duyệt' })).not.toBeInTheDocument();
  });
});
