import { useApiQuery } from '../api/hooks';
import { queryKeys } from '../api/query-keys';

// Số đếm trên huy hiệu điều hướng (chờ duyệt, thông báo chưa đọc): lớp `counter` (15 giây). Điểm cuối do tính năng sở hữu
// cung cấp – tính năng đó đăng ký nguồn bằng `setCountSources`; chưa đăng ký → không gọi mạng, huy hiệu ẩn.

export interface CountSources {
  pendingReview?: () => Promise<number>;
  unread?: () => Promise<number>;
}

let sources: CountSources = {};

export function setCountSources(next: CountSources): void {
  sources = next;
}

export function useNavCounts(): {
  pendingReviewCount: number | undefined;
  unreadCount: number | undefined;
} {
  const pending = useApiQuery(
    queryKeys.counters.pendingReview(),
    () => sources.pendingReview?.() ?? Promise.resolve(0),
    {
      freshness: 'counter',
      enabled: sources.pendingReview !== undefined,
    },
  );
  const unread = useApiQuery(
    queryKeys.notifications.unread(),
    () => sources.unread?.() ?? Promise.resolve(0),
    {
      freshness: 'counter',
      enabled: sources.unread !== undefined,
    },
  );
  return { pendingReviewCount: pending.data, unreadCount: unread.data };
}
