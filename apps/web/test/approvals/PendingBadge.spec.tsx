// T059 (bổ sung, 012 US3) – huy hiệu "chờ duyệt" ở menu: AppShell chỉ nối nguồn đếm khi có quyền `post.approve`.
// Chủ thấy số đúng; cộng tác viên KHÔNG gọi API đếm (tránh 403) và huy hiệu ẩn; số 0 thì ẩn.
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, me, renderAt } from '../auth/helpers';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const COUNT = 'GET /api/v1/approvals/pending/count';

const ownerMe = () => ({
  ...me({ role: 'owner' }),
  permissions: ['post.edit', 'post.approve', 'status.view'],
});
const collabMe = () => ({
  ...me({ role: 'collaborator' }),
  permissions: ['post.edit', 'status.view'],
});

const postsLink = () => screen.findByRole('link', { name: /Bài viết/ });

describe('Huy hiệu chờ duyệt ở menu', () => {
  it('chủ: gọi API đếm và hiện đúng số trên mục "Bài viết"', async () => {
    const api = fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: ownerMe() }),
      [COUNT]: () => ({ status: 200, body: { count: 7 } }),
    });
    renderAt('/');
    const link = await postsLink();
    await waitFor(() => {
      expect(within(link).getByText('7')).toBeInTheDocument();
    });
    expect(
      api.calls.filter((c) => c.path === '/api/v1/approvals/pending/count').length,
    ).toBeGreaterThan(0);
  });

  it('số lớn hơn 99 hiện "99+"', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: ownerMe() }),
      [COUNT]: () => ({ status: 200, body: { count: 250 } }),
    });
    renderAt('/');
    const link = await postsLink();
    await waitFor(() => {
      expect(within(link).getByText('99+')).toBeInTheDocument();
    });
  });

  it('chủ nhưng không có bài chờ (0): huy hiệu ẩn', async () => {
    const api = fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: ownerMe() }),
      [COUNT]: () => ({ status: 200, body: { count: 0 } }),
    });
    renderAt('/');
    const link = await postsLink();
    await waitFor(() => {
      expect(api.calls.some((c) => c.path === '/api/v1/approvals/pending/count')).toBe(true);
    });
    expect(link).toHaveTextContent(/^\s*Bài viết\s*$/);
  });

  it('cộng tác viên: KHÔNG gọi API đếm, huy hiệu ẩn', async () => {
    const api = fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: collabMe() }),
      // Nếu lỡ gọi sẽ nhận 403 như máy chủ thật; test khẳng định không có lời gọi nào.
      [COUNT]: () => ({
        status: 403,
        body: { error: { code: 'FORBIDDEN', message: 'Không đủ quyền' } },
      }),
    });
    renderAt('/');
    const link = await postsLink();
    // Chờ các truy vấn khác (me…) xong rồi mới khẳng định.
    await waitFor(() => {
      expect(api.calls.some((c) => c.path === '/api/v1/auth/me')).toBe(true);
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(api.calls.some((c) => c.path === '/api/v1/approvals/pending/count')).toBe(false);
    expect(link).toHaveTextContent(/^\s*Bài viết\s*$/);
  });

  it('mã tài khoản không bao giờ nằm trong yêu cầu đếm', async () => {
    const api = fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: ownerMe() }),
      [COUNT]: () => ({ status: 200, body: { count: 2 } }),
    });
    renderAt('/');
    await postsLink();
    await waitFor(() => {
      expect(api.calls.some((c) => c.path === '/api/v1/approvals/pending/count')).toBe(true);
    });
    expect(JSON.stringify(api.calls)).not.toMatch(/accountId|account_id/);
  });
});
