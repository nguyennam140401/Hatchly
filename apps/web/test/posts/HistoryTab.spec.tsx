// T066 (bổ sung, 012 US3/US4, FR-025) – tab "Lịch sử bài": mới nhất trước, tên người thao tác, giờ UTC+7, đổi giờ "Từ… sang…",
// trả lại kèm lý do, trạng thái tải/rỗng/lỗi + thử lại, 0 vi phạm axe, bố cục 360 px (không tràn ngang).
import { QueryClient } from '@tanstack/react-query';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { HistoryTab } from '../../src/features/posts/HistoryTab';
import { apiError, fakeApi } from '../auth/helpers';
import { renderWithProviders } from '../helpers/render';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const POST_ID = '0190a000-0000-7000-8000-0000000000d1';
const PATH = `GET /api/v1/posts/${POST_ID}/history`;

const ev = (
  type: string,
  at: string,
  actorDisplayName: string,
  data: Record<string, unknown> = {},
) => ({ type, actorUserId: `u-${actorDisplayName}`, actorDisplayName, at, data });

// Tạo ClientQuery không thử lại để kiểm thử lỗi 5xx không chờ 1 giây.
const noRetryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe('HistoryTab', () => {
  it('sắp mới nhất trước, hiện tên người thao tác và giờ UTC+7 (03:00Z → 10:00)', async () => {
    fakeApi({
      [PATH]: () => ({
        status: 200,
        body: {
          events: [
            ev('created', '2026-11-16T01:00:00.000Z', 'Cộng tác viên An'),
            ev('approved', '2026-11-18T03:00:00.000Z', 'Chủ Tiệm'),
            ev('submitted', '2026-11-17T08:30:00.000Z', 'Cộng tác viên An'),
          ],
        },
      }),
    });
    const { container } = renderWithProviders(<HistoryTab postId={POST_ID} />);
    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Chủ Tiệm đã duyệt và lên lịch');
    expect(items[0]).toHaveTextContent('10:00 18/11/2026 (UTC+7)');
    expect(items[1]).toHaveTextContent('Cộng tác viên An đã gửi duyệt');
    expect(items[1]).toHaveTextContent('15:30 17/11/2026 (UTC+7)');
    expect(items[2]).toHaveTextContent('Cộng tác viên An đã tạo bài');
    // Giờ gốc UTC giữ ở thuộc tính dateTime, không hiện thô cho người dùng.
    expect(container.querySelector('time')).toHaveAttribute('datetime', '2026-11-18T03:00:00.000Z');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('đổi giờ: "Từ <giờ cũ> sang <giờ mới>"; chưa có giờ cũ → "Sang <giờ mới>"', async () => {
    fakeApi({
      [PATH]: () => ({
        status: 200,
        body: {
          events: [
            ev('rescheduled', '2026-11-19T02:00:00.000Z', 'Chủ Tiệm', {
              fromAt: '2026-11-20T03:00:00.000Z',
              toAt: '2026-11-21T05:30:00.000Z',
            }),
            ev('rescheduled', '2026-11-18T02:00:00.000Z', 'Chủ Tiệm', {
              fromAt: null,
              toAt: '2026-11-20T03:00:00.000Z',
            }),
          ],
        },
      }),
    });
    renderWithProviders(<HistoryTab postId={POST_ID} />);
    expect(
      await screen.findByText('Từ 10:00 20/11/2026 sang 12:30 21/11/2026'),
    ).toBeInTheDocument();
    expect(screen.getByText('Sang 10:00 20/11/2026')).toBeInTheDocument();
    expect(screen.getAllByText(/đã đổi giờ đăng/)).toHaveLength(2);
  });

  it('trả lại hiện lý do; không có ghi chú thì không có dòng "Lý do"', async () => {
    fakeApi({
      [PATH]: () => ({
        status: 200,
        body: {
          events: [
            ev('returned', '2026-11-19T02:00:00.000Z', 'Chủ Tiệm', { note: 'Đổi ảnh bìa' }),
            ev('returned', '2026-11-18T02:00:00.000Z', 'Chủ Tiệm', { note: '' }),
          ],
        },
      }),
    });
    renderWithProviders(<HistoryTab postId={POST_ID} />);
    expect(await screen.findByText('Lý do: Đổi ảnh bìa')).toBeInTheDocument();
    expect(screen.getAllByText(/đã trả lại để sửa/)).toHaveLength(2);
    expect(screen.getAllByText(/Lý do:/)).toHaveLength(1);
  });

  it('đang tải: thông báo trạng thái có aria-busy', () => {
    fakeApi({ [PATH]: () => ({ status: 200, body: { events: [] } }) });
    renderWithProviders(<HistoryTab postId={POST_ID} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Đang tải lịch sử');
    expect(status).toHaveAttribute('aria-busy', 'true');
  });

  it('rỗng: có lời hướng dẫn, không có danh sách', async () => {
    fakeApi({ [PATH]: () => ({ status: 200, body: { events: [] } }) });
    renderWithProviders(<HistoryTab postId={POST_ID} />);
    expect(await screen.findByText(/Chưa có hoạt động nào/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('lỗi máy chủ: có nút "Thử lại", bấm là gọi lại và hiện danh sách', async () => {
    let calls = 0;
    fakeApi({
      [PATH]: () => {
        calls += 1;
        return calls === 1
          ? { status: 500, body: apiError('INTERNAL_ERROR') }
          : {
              status: 200,
              body: { events: [ev('created', '2026-11-16T01:00:00.000Z', 'Chủ Tiệm')] },
            };
      },
    });
    const { container } = renderWithProviders(<HistoryTab postId={POST_ID} />, {
      queryClient: noRetryClient(),
    });
    const retry = await screen.findByRole('button', { name: /Thử lại/ });
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(retry);
    expect(await screen.findByText(/Chủ Tiệm đã tạo bài/)).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it('chỉ đọc và không lộ nội dung bài: không có nút sửa, chỉ có đúng một yêu cầu GET', async () => {
    const api = fakeApi({
      [PATH]: () => ({
        status: 200,
        body: { events: [ev('created', '2026-11-16T01:00:00.000Z', 'Chủ Tiệm')] },
      }),
    });
    renderWithProviders(<HistoryTab postId={POST_ID} />);
    await screen.findByRole('listitem');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(api.calls.every((c) => c.method === 'GET')).toBe(true);
    });
  });

  it('360 px: tên dài không tràn (khối chữ cho phép xuống dòng), mục cao ≥ 44 px (min-h-11), 0 vi phạm axe', async () => {
    const original = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
    try {
      fakeApi({
        [PATH]: () => ({
          status: 200,
          body: {
            events: [
              ev(
                'rescheduled',
                '2026-11-19T02:00:00.000Z',
                'Nguyễn Thị Hoàng Thùy Dương Kim Ngân Bảo Châu',
                {
                  fromAt: '2026-11-20T03:00:00.000Z',
                  toAt: '2026-11-21T05:30:00.000Z',
                },
              ),
            ],
          },
        }),
      });
      const { container } = renderWithProviders(<HistoryTab postId={POST_ID} />);
      const item = await screen.findByRole('listitem');
      expect(item.className).toContain('min-h-11');
      const textBlock = item.querySelector('div');
      expect(textBlock?.className).toContain('min-w-0');
      expect(textBlock?.className).toContain('break-words');
      // Biểu tượng là trang trí; nghĩa nằm ở chữ (không chỉ dựa vào biểu tượng/màu).
      expect(item.querySelector('[aria-hidden="true"]')).not.toBeNull();
      expect(await axe(container)).toHaveNoViolations();
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: original });
    }
  });
});
