// Màn hình "Thư viện ảnh & video" (014 contracts/media-ui.md mục 7): lưới, dung lượng, bộ lọc, chi tiết, hộp xóa.
// Mỗi dòng của bảng trạng thái là một ca: chữ + biểu tượng, axe 0 vi phạm, dùng được bằng bàn phím.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, fakeApi, keyboardReachable, me, renderAt } from '../auth/helpers';
import { LIST, listOf, mediaItem, quota, uuid } from './helpers';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const base = (
  list: unknown,
  extra: Record<string, () => { status: number; body?: unknown }> = {},
) => ({
  'GET /api/v1/auth/me': () => ({ status: 200, body: me() }),
  [`GET ${LIST}`]: () => ({ status: 200, body: list }),
  ...extra,
});

const fetchCalls = (): string[] =>
  (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls.map(
    ([input, init]) => `${init?.method ?? 'GET'} ${input}`,
  );

describe('MediaLibraryPage – lưới và trạng thái', () => {
  it('đang tải → aria-busy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) =>
        input.startsWith('/api/v1/auth/me')
          ? Promise.resolve(new Response(JSON.stringify(me()), { status: 200 }))
          : new Promise<Response>(() => undefined),
      ),
    );
    renderAt('/media');
    const heading = await screen.findByRole('heading', { name: 'Thư viện ảnh & video' });
    expect(heading.closest('main')).toHaveAttribute('aria-busy', 'true');
  });

  it('thư viện trống → lời mời tải tệp đầu tiên kèm giới hạn; vẫn có khu tải lên', async () => {
    fakeApi(base(listOf([], quota(0))));
    renderAt('/media');
    expect(await screen.findByText(/Chưa có ảnh\/video nào/)).toHaveTextContent(
      'ảnh ≤ 20 MB, video ≤ 500 MB',
    );
    expect(screen.getByRole('button', { name: 'Chọn tệp' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chụp ảnh' })).toBeInTheDocument();
  });

  it('hiện từng ô bằng CHỮ + biểu tượng: Sẵn sàng, Đang xử lý, Không xử lý được (+ cách khắc phục + nút Xóa); 0 vi phạm axe', async () => {
    fakeApi(
      base(
        listOf([
          mediaItem(1),
          mediaItem(2, { status: 'processing', thumbUrl: null, displayName: 'dang-xu-ly.jpg' }),
          mediaItem(3, {
            status: 'unprocessable',
            thumbUrl: null,
            displayName: 'hong.jpg',
            failure: {
              code: 'corrupt',
              title: 'Không xử lý được',
              action: 'Hãy thử xuất lại ảnh từ máy rồi tải lên lại.',
            },
          }),
          mediaItem(4, {
            kind: 'video',
            durationMs: 75_000,
            displayName: 'clip.mp4',
            thumbUrl: null,
          }),
        ]),
      ),
    );
    const { container } = renderAt('/media');
    const grid = await screen.findByRole('list', { name: 'Ảnh và video' });
    const cards = within(grid).getAllByRole('listitem');
    expect(cards).toHaveLength(4);
    expect(within(cards[0]!).getByText('Sẵn sàng')).toBeInTheDocument();
    expect(within(cards[1]!).getByText('Đang xử lý')).toBeInTheDocument();
    expect(within(cards[2]!).getByText('Không xử lý được')).toBeInTheDocument();
    expect(within(cards[2]!).getByText(/Hãy thử xuất lại ảnh từ máy/)).toBeInTheDocument();
    expect(within(cards[2]!).getByRole('button', { name: 'Xóa hong.jpg' })).toBeInTheDocument();
    expect(within(cards[3]!).getByText('1:15')).toBeInTheDocument();
    // tên truy cập = tên + loại + trạng thái
    expect(
      screen.getByRole('button', { name: 'dang-xu-ly.jpg, Ảnh, Đang xử lý' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'clip.mp4, Video, Sẵn sàng' })).toBeInTheDocument();
    // ảnh thu nhỏ nạp lười, kích thước ô cố định
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(await axe(container)).toHaveNoViolations();
    // Input chọn tệp thật được ẩn (sr-only, tabIndex -1) – nút "Chọn tệp"/"Chụp ảnh" là lối vào bằng bàn phím.
    const visible = container.cloneNode(true) as HTMLElement;
    visible.querySelectorAll('input.sr-only').forEach((el) => {
      el.remove();
    });
    expect(keyboardReachable(visible)).toBe(true);
  });

  it('cộng tác viên: không thấy nút Xóa trên tệp của người khác (canDelete=false)', async () => {
    fakeApi(base(listOf([mediaItem(1, { canDelete: false, displayName: 'cua-chu.jpg' })])));
    renderAt('/media');
    await screen.findByRole('button', { name: /^cua-chu\.jpg, / });
    expect(screen.queryByRole('button', { name: 'Xóa cua-chu.jpg' })).toBeNull();
  });

  it('lỗi máy chủ → thông báo + nút thử lại (không trắng trang)', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: me() }),
      [`GET ${LIST}`]: () => ({ status: 503, body: apiError('SERVICE_UNAVAILABLE') }),
    });
    renderAt('/media');
    expect(
      await screen.findByRole('button', { name: /Thử lại/ }, { timeout: 8000 }),
    ).toBeInTheDocument();
  });

  it('"Xem thêm" nạp trang kế bằng con trỏ', async () => {
    const api = fakeApi(base(listOf([mediaItem(1)], quota(0.1), 'CURSOR1')));
    renderAt('/media');
    await screen.findByRole('button', { name: /^anh-1\.jpg, / });
    api.on(`GET ${LIST}`, () => ({ status: 200, body: listOf([mediaItem(2)], quota(0.1)) }));
    fireEvent.click(await screen.findByRole('button', { name: 'Xem thêm' }));
    expect(await screen.findByRole('button', { name: /^anh-2\.jpg, / })).toBeInTheDocument();
    expect(fetchCalls().some((c) => c.includes('cursor=CURSOR1'))).toBe(true);
  });
});

describe('MediaLibraryPage – bộ lọc trên URL', () => {
  it('chọn "Video" và gõ tên ⇒ gọi API với kind/q và ghi lên URL', async () => {
    fakeApi(base(listOf([mediaItem(1)])));
    const { router } = renderAt('/media');
    await screen.findByRole('button', { name: /^anh-1\.jpg, / });
    fireEvent.click(screen.getByRole('button', { name: 'Video' }));
    await waitFor(() => {
      expect(router.state.location.search).toContain('kind=video');
    });
    fireEvent.change(screen.getByLabelText('Tìm theo tên tệp'), { target: { value: 'áo dài' } });
    await waitFor(() => {
      expect(new URLSearchParams(router.state.location.search).get('q')).toBe('áo dài');
    });
    await waitFor(() => {
      expect(fetchCalls().some((c) => c.includes('kind=video') && c.includes('q='))).toBe(true);
    });
  });

  it('khoảng ngày chọn theo giờ Việt Nam được đổi sang UTC khi gọi API', async () => {
    fakeApi(base(listOf([mediaItem(1)])));
    renderAt('/media?from=2026-11-10&to=2026-11-11');
    await screen.findByRole('button', { name: /^anh-1\.jpg, / });
    const call = fetchCalls().find((c) => c.includes('from='));
    expect(call).toBeDefined();
    // 2026-11-10 00:00 (UTC+7) = 2026-11-09T17:00:00.000Z
    expect(decodeURIComponent(call!)).toContain('from=2026-11-09T17:00:00.000Z');
    expect(decodeURIComponent(call!)).toContain('to=2026-11-11T16:59:59.999Z');
  });
});

describe('MediaLibraryPage – chi tiết', () => {
  it('bấm ô ⇒ hộp chi tiết (mở được bằng ?item=), ảnh dùng bản chuẩn hóa, có thông tin', async () => {
    const detail = {
      ...mediaItem(1),
      previewUrl: 'https://cdn.example.test/norm-1.jpg',
      mimeType: 'image/jpeg',
    };
    fakeApi(
      base(listOf([mediaItem(1)]), {
        [`GET ${LIST}/${uuid(1)}`]: () => ({ status: 200, body: detail }),
      }),
    );
    const { router } = renderAt('/media');
    fireEvent.click(await screen.findByRole('button', { name: /^anh-1\.jpg, / }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('img', { name: 'anh-1.jpg' })).toHaveAttribute(
      'src',
      detail.previewUrl,
    );
    expect(within(dialog).getByText('1600 × 1200 điểm ảnh')).toBeInTheDocument();
    expect(within(dialog).getByText('Chủ tiệm hoa')).toBeInTheDocument();
    expect(router.state.location.search).toContain(`item=${uuid(1)}`);
    expect(await axe(dialog)).toHaveNoViolations();
  });

  it('mở trực tiếp bằng đường dẫn ?item=<mã>', async () => {
    const detail = {
      ...mediaItem(1),
      previewUrl: null,
      mimeType: 'image/jpeg',
      status: 'processing' as const,
    };
    fakeApi(
      base(listOf([mediaItem(1)]), {
        [`GET ${LIST}/${uuid(1)}`]: () => ({ status: 200, body: detail }),
      }),
    );
    renderAt(`/media?item=${uuid(1)}`);
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText(/Đang xử lý – ảnh xem trước sẽ có sau ít phút/),
    ).toBeInTheDocument();
  });

  it('video dùng thẻ <video controls preload="metadata">', async () => {
    const v = mediaItem(5, { kind: 'video', durationMs: 5000, displayName: 'v.mp4' });
    const detail = { ...v, previewUrl: 'https://cdn.example.test/v.mp4', mimeType: 'video/mp4' };
    fakeApi(
      base(listOf([v]), { [`GET ${LIST}/${uuid(5)}`]: () => ({ status: 200, body: detail }) }),
    );
    renderAt(`/media?item=${uuid(5)}`);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(dialog.querySelector('video')).not.toBeNull();
    });
    const video = dialog.querySelector('video');
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('preload', 'metadata');
  });
});

describe('MediaLibraryPage – hộp xóa (FR-021)', () => {
  const usagesPath = (n: number) => `GET ${LIST}/${uuid(n)}/usages`;

  it('không bài nào dùng ⇒ xác nhận ngắn; Xóa gọi DELETE (không confirm) và đóng hộp', async () => {
    const api = fakeApi(
      base(listOf([mediaItem(1)]), {
        [usagesPath(1)]: () => ({ status: 200, body: { usages: [], blocking: false } }),
        [`DELETE ${LIST}/${uuid(1)}`]: () => ({ status: 204 }),
      }),
    );
    renderAt('/media');
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa anh-1.jpg' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      await within(dialog).findByText('Xóa ảnh này? Dung lượng sẽ được trả lại ngay.'),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xóa' }));
    await waitFor(() => {
      expect(api.calls.some((c) => c.method === 'DELETE')).toBe(true);
    });
    expect(fetchCalls().find((c) => c.startsWith('DELETE'))).toBe(`DELETE ${LIST}/${uuid(1)}`);
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
  });

  it('có bài đã lên lịch ⇒ CHỈ thông báo, liệt kê từng bài + liên kết, KHÔNG có nút Xóa', async () => {
    fakeApi(
      base(listOf([mediaItem(1)]), {
        [usagesPath(1)]: () => ({
          status: 200,
          body: {
            blocking: true,
            usages: [
              { postId: uuid(11), postTitle: 'Khai trương', postStatus: 'scheduled' },
              { postId: uuid(12), postTitle: 'Giảm giá', postStatus: 'approved' },
            ],
          },
        }),
      }),
    );
    renderAt('/media');
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa anh-1.jpg' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      await within(dialog).findByText(/đang dùng trong 2 bài đã duyệt hoặc đã lên lịch/),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Khai trương' })).toHaveAttribute(
      'href',
      `/posts/${uuid(11)}`,
    );
    expect(within(dialog).getByRole('link', { name: 'Giảm giá' })).toHaveAttribute(
      'href',
      `/posts/${uuid(12)}`,
    );
    expect(
      within(dialog).getByText(/Mở bài để đổi ảnh\/video rồi quay lại xóa/),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Xóa' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Đóng' })).toBeInTheDocument();
  });

  it('chỉ bài nháp/chờ duyệt/đã đăng ⇒ liệt kê từng bài + hậu quả; "Xóa" gọi DELETE ?confirm=true', async () => {
    fakeApi(
      base(listOf([mediaItem(1)]), {
        [usagesPath(1)]: () => ({
          status: 200,
          body: {
            blocking: false,
            usages: [{ postId: uuid(11), postTitle: 'Bài nháp A', postStatus: 'draft' }],
          },
        }),
        [`DELETE ${LIST}/${uuid(1)}`]: () => ({ status: 204 }),
      }),
    );
    renderAt('/media');
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa anh-1.jpg' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      await within(dialog).findByText(/Bài nháp sẽ mất ảnh và cần chọn lại trước khi gửi duyệt/),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Bài nháp A' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Giữ lại' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xóa' }));
    await waitFor(() => {
      expect(fetchCalls().some((c) => c === `DELETE ${LIST}/${uuid(1)}?confirm=true`)).toBe(true);
    });
  });
});
