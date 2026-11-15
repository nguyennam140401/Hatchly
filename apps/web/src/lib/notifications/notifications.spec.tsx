import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from '../../../test/helpers/axe';
import { renderWithProviders } from '../../../test/helpers/render';
import { queryKeys } from '../api/query-keys';
import { setCountSources, useNavCounts } from './counts';
import { NotificationCenter, type NotificationItem, type NotificationSource } from './NotificationCenter';

const items = (): NotificationItem[] => [
  { id: 'n1', title: 'Bài đã đăng', createdAt: '2026-11-15T01:00:00Z', read: false },
  { id: 'n2', title: 'Kênh sắp hết hạn', body: 'Còn 3 ngày', createdAt: '2026-11-14T01:00:00Z', read: true },
];

afterEach(() => {
  setCountSources({});
});

describe('NotificationCenter', () => {
  it('liệt kê thông báo; chưa đọc có chữ (không chỉ màu); không vi phạm trợ năng', async () => {
    const source: NotificationSource = { list: () => Promise.resolve(items()), markRead: () => Promise.resolve() };
    const { container } = renderWithProviders(<main><NotificationCenter source={source} /></main>);
    expect(await screen.findByText('Bài đã đăng')).toBeInTheDocument();
    expect(screen.getByText('Chưa đọc:')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('đánh dấu đã đọc: cập nhật ngay (lạc quan); máy chủ từ chối → hoàn lại', async () => {
    const markRead = vi.fn().mockRejectedValue(new Error('từ chối'));
    const source: NotificationSource = { list: () => Promise.resolve(items()), markRead };
    const { queryClient } = renderWithProviders(<main><NotificationCenter source={source} /></main>);
    await screen.findByText('Bài đã đăng');
    fireEvent.click(screen.getByRole('button', { name: 'Đã đọc' }));
    expect(queryClient.getQueryData<NotificationItem[]>(queryKeys.notifications.list())?.[0]?.read).toBe(true);
    await waitFor(() => {
      expect(queryClient.getQueryData<NotificationItem[]>(queryKeys.notifications.list())?.[0]?.read).toBe(false);
    });
  });

  it('danh sách trống → trạng thái trống', async () => {
    const source: NotificationSource = { list: () => Promise.resolve([]), markRead: () => Promise.resolve() };
    renderWithProviders(<NotificationCenter source={source} />);
    expect(await screen.findByText('Chưa có thông báo.')).toBeInTheDocument();
  });
});

describe('useNavCounts', () => {
  function Probe() {
    const c = useNavCounts();
    return <p>{`p=${String(c.pendingReviewCount)} u=${String(c.unreadCount)}`}</p>;
  }
  it('chưa đăng ký nguồn → không gọi mạng, huy hiệu ẩn', () => {
    renderWithProviders(<Probe />);
    expect(screen.getByText('p=undefined u=undefined')).toBeInTheDocument();
  });
  it('có nguồn → trả số đếm', async () => {
    setCountSources({ pendingReview: () => Promise.resolve(4), unread: () => Promise.resolve(2) });
    renderWithProviders(<Probe />);
    expect(await screen.findByText('p=4 u=2')).toBeInTheDocument();
  });
});
