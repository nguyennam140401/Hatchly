import { useMemo } from 'react';
import type { PostEvent, PostEventType } from '@app/shared/content';
import { postsApi } from '../../lib/api/endpoints/posts';
import { ErrorNotice } from '../../lib/api/ErrorNotice';
import { useApiQuery } from '../../lib/api/hooks';
import { queryKeys } from '../../lib/api/query-keys';
import { formatDateTime } from '../../lib/format/datetime';
import { EmptyState } from '../../ui/feedback/EmptyState';

// Lịch sử bài (012 US3/US4, FR-025): chỉ đọc, mới nhất trước; hiện người thao tác + giờ UTC+7. Không hiện nội dung bài.

const EVENT_LABELS: Record<PostEventType, { icon: string; label: string }> = {
  created: { icon: '✚', label: 'tạo bài' },
  submitted: { icon: '➤', label: 'gửi duyệt' },
  withdrawn: { icon: '↩', label: 'rút lại bài' },
  approved: { icon: '✔', label: 'duyệt và lên lịch' },
  returned: { icon: '⟲', label: 'trả lại để sửa' },
  unscheduled: { icon: '✖', label: 'hủy lịch đăng' },
  rescheduled: { icon: '⏱', label: 'đổi giờ đăng' },
  edited_after_approval: { icon: '✎', label: 'sửa bài đã duyệt (cần duyệt lại)' },
  channels_changed: { icon: '⇄', label: 'đổi kênh đăng' },
};

function detail(event: PostEvent): string | null {
  const { data } = event;
  if (event.type === 'rescheduled' && data.toAt != null) {
    return data.fromAt != null
      ? `Từ ${formatDateTime(data.fromAt)} sang ${formatDateTime(data.toAt)}`
      : `Sang ${formatDateTime(data.toAt)}`;
  }
  if (event.type === 'returned' && data.note !== undefined && data.note !== '') {
    return `Lý do: ${data.note}`;
  }
  return null;
}

export function HistoryTab({ postId }: { postId: string }) {
  // Khóa nằm dưới `detail(id)` nên mọi thao tác làm mất hiệu lực bài cũng làm mới lịch sử.
  const query = useApiQuery(queryKeys.posts.history(postId), () => postsApi.history(postId), {
    freshness: 'entity',
  });
  const events = useMemo(
    () => [...(query.data?.events ?? [])].sort((a, b) => b.at.localeCompare(a.at)),
    [query.data],
  );
  return (
    <section aria-labelledby="post-history-title" className="flex flex-col gap-3">
      <h2 id="post-history-title" className="text-lg font-semibold">
        Lịch sử bài
      </h2>
      {query.isError ? (
        <ErrorNotice error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data === undefined ? (
        <p role="status" aria-busy="true" className="text-sm text-ink-muted">
          Đang tải lịch sử…
        </p>
      ) : query.data.events.length === 0 ? (
        <EmptyState message="Chưa có hoạt động nào. Các bước gửi duyệt, duyệt, đổi giờ sẽ hiện ở đây." />
      ) : (
        <ol className="flex flex-col gap-2">
          {events.map((e, i) => {
            const meta = EVENT_LABELS[e.type];
            const extra = detail(e);
            return (
              <li
                key={`${e.at}:${e.type}:${String(i)}`}
                className="flex min-h-11 items-start gap-3 rounded-lg border border-line bg-surface-0 p-3"
              >
                <span aria-hidden="true" className="w-5 text-center">
                  {meta.icon}
                </span>
                <div className="min-w-0 flex-1 break-words">
                  <p className="text-sm font-medium">
                    {e.actorDisplayName} đã {meta.label}
                  </p>
                  {extra !== null && <p className="text-sm text-ink-muted">{extra}</p>}
                  <time dateTime={e.at} className="text-xs text-ink-muted">
                    {formatDateTime(e.at)} (UTC+7)
                  </time>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
