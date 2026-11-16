import type { PublishProgressView } from '@app/shared/publishing';
import { publishingApi } from '../../lib/api/endpoints/publishing';
import { useApiQuery, type ApiQueryResult } from '../../lib/api/hooks';
import { queryKeys } from '../../lib/api/query-keys';

// Thăm dò Tiến trình đăng (013 R8, SC-011): KHÔNG thêm hạ tầng đẩy (Hiến pháp IX) – hỏi định kỳ.
//  - còn lượt chưa kết thúc (`scheduled`/`publishing`) → hỏi mỗi 5 giây, giãn dần tới 30 giây;
//  - mọi kênh đã kết thúc hoặc đang chờ người dùng (`published`/`needs_action`/`cancelled`) → DỪNG;
//  - tab ẩn → tự dừng (react-query không hỏi nền); quay lại tab → hỏi lại ngay.
// Trình duyệt tự gửi `If-None-Match` theo `ETag` của máy chủ nên phản hồi không đổi rất nhẹ.

const FIRST_MS = 5_000;
const MAX_MS = 30_000;

/** Chu kỳ hỏi kế tiếp theo số lần đã hỏi; `false` = dừng. Hàm thuần để kiểm thử. */
export function nextPollMs(
  data: PublishProgressView | undefined,
  updateCount: number,
): number | false {
  if (data === undefined) return FIRST_MS;
  const active = data.channels.some((c) => c.status === 'scheduled' || c.status === 'publishing');
  if (!active) return false;
  // 12 lần đầu (1 phút) mỗi 5 giây, sau đó tăng dần mỗi 12 lần thêm 5 giây, tối đa 30 giây.
  return Math.min(MAX_MS, FIRST_MS * (1 + Math.floor(updateCount / 12)));
}

export function usePublishProgress(postId: string): ApiQueryResult<PublishProgressView> {
  return useApiQuery(queryKeys.publishing.progress(postId), () => publishingApi.progress(postId), {
    freshness: 'volatile',
    refetchInterval: nextPollMs,
  });
}
