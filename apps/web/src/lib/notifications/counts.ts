import { channelsApi } from '../api/endpoints/channels';
import { useApiQuery } from '../api/hooks';
import { useSession } from '../session/context';
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
  channelAttentionCount: number | undefined;
} {
  const { permissions } = useSession().me;
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
  // 010 (FR-026): dấu chỉ báo kênh cần chú ý ở mọi màn hình – dùng lại khóa `channels.overview()` của màn hình Kênh kết nối
  // (cùng một lần tải), làm mới mỗi 60 giây khi tab đang hiện. Chỉ ai có `channel.view` mới gọi.
  const channels = useApiQuery(
    queryKeys.channels.overview(),
    ({ signal }) => channelsApi.overview(signal),
    {
      freshness: 'counter',
      enabled: permissions.includes('channel.view'),
      refetchInterval: 60_000,
    },
  );
  return {
    pendingReviewCount: pending.data,
    unreadCount: unread.data,
    channelAttentionCount: channels.data?.attention.length,
  };
}
