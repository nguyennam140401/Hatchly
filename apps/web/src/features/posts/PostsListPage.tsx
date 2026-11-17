import type { PostStatus, PostSummary } from '@app/shared/content';
import { useState } from 'react';
import { Link } from 'react-router';
import { AsyncBoundary } from '../../app/AsyncBoundary';
import { postsApi } from '../../lib/api/endpoints/posts';
import type { AppError } from '../../lib/api/errors';
import { ErrorNotice } from '../../lib/api/ErrorNotice';
import { useApiMutation, useApiQuery } from '../../lib/api/hooks';
import { MUTATIONS } from '../../lib/api/mutations';
import { queryKeys } from '../../lib/api/query-keys';
import { formatDateTime } from '../../lib/format/datetime';
import { toDisplayStatus } from '../../lib/catalogs/post-status';
import { useCan } from '../../lib/session/permissions';
import { ConfirmDialog } from '../../ui/alert/ConfirmDialog';
import { StatusBadge } from '../../ui/badge/StatusBadge';
import { Button } from '../../ui/button/Button';
import { Chip } from '../../ui/chip-tabs/Chip';
import { Page } from '../../ui/layout/Page';
import { PageHeader } from '../../ui/layout/PageHeader';
import { CHANNEL_TYPE_LABELS } from './ChannelPreview';

// Màn hình Bài viết (012 US7): một chỗ thấy mọi bài, lọc theo trạng thái, tìm theo từ khóa, xóa mềm bài Nháp. Trạng thái luôn
// hiện bằng CHỮ + biểu tượng. Chủ có thêm lối vào "Chờ duyệt". Quyền chỉ để ẩn/hiện; API vẫn tự chặn.

const FILTERS: { id: PostStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'draft', label: 'Nháp' },
  { id: 'pending_review', label: 'Chờ duyệt' },
  { id: 'approved', label: 'Đã lên lịch' },
];

const linkButton =
  'inline-flex min-h-touch items-center rounded-md bg-brand px-4 text-label text-on-brand focus-visible:ring-2 focus-visible:ring-brand';

function Row({ post, onDelete }: { post: PostSummary; onDelete: (post: PostSummary) => void }) {
  return (
    <li className="flex flex-col gap-2 rounded-md border border-line bg-surface-0 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link className="text-label text-brand underline" to={`/posts/${post.id}`}>
          {post.title === '' ? 'Bài chưa có nội dung' : post.title}
        </Link>
        <StatusBadge status={toDisplayStatus(post.status)} size="sm" />
      </div>
      <p className="text-caption text-ink-muted">
        {post.channelTypes.map((t) => CHANNEL_TYPE_LABELS[t]).join(', ') || 'Chưa chọn kênh'} ·{' '}
        {post.scheduledAt === null ? 'Chưa chọn giờ' : formatDateTime(post.scheduledAt)}
      </p>
      <ul className="flex flex-wrap gap-2 text-caption text-ink">
        {post.labels.returned !== null && <li>↩ Bị trả lại</li>}
        {post.labels.editedAfterApproval && <li>✎ Đã sửa sau khi duyệt</li>}
        {post.labels.timePassed && <li>⏰ Giờ đã qua</li>}
      </ul>
      {post.status === 'approved' && (
        <div>
          <Link
            className="inline-flex min-h-touch items-center text-label text-brand underline"
            to={`/posts/${post.id}/progress`}
          >
            Xem tiến trình đăng
          </Link>
        </div>
      )}
      {post.status === 'draft' && (
        <div>
          <Button
            variant="ghost"
            onClick={() => {
              onDelete(post);
            }}
          >
            Xóa nháp
          </Button>
        </div>
      )}
    </li>
  );
}

export function PostsListPage() {
  const canEdit = useCan('post.edit');
  const canApprove = useCan('post.approve');
  const [status, setStatus] = useState<PostStatus | 'all'>('all');
  const [q, setQ] = useState('');
  const [toDelete, setToDelete] = useState<PostSummary | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const filter = {
    ...(status === 'all' ? {} : { status }),
    ...(q.trim() === '' ? {} : { q: q.trim() }),
  };
  const query = useApiQuery(queryKeys.posts.list(filter), () => postsApi.list(filter), {
    freshness: 'entity',
  });
  const remove = useApiMutation({
    operation: MUTATIONS.deleteDraft.operation,
    fn: (post: PostSummary) => postsApi.remove(post.id, post.version),
    invalidates: (post: PostSummary) =>
      MUTATIONS.deleteDraft.invalidates({ id: post.id }, undefined),
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-gutter py-6">
      <Page busy={query.isPending}>
        <PageHeader
          title="Bài viết"
          description="Tìm và mở lại mọi bài của bạn."
          actions={
            <>
              {canApprove && (
                <Link
                  className="inline-flex min-h-touch items-center text-label text-brand underline"
                  to="/approvals"
                >
                  Chờ duyệt
                </Link>
              )}
              {canEdit && (
                <Link className={linkButton} to="/posts/new">
                  Thêm bài
                </Link>
              )}
            </>
          }
        />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc theo trạng thái">
          {FILTERS.map((f) => (
            <Chip
              key={f.id}
              label={f.label}
              selected={status === f.id}
              onClick={() => {
                setStatus(f.id);
              }}
            />
          ))}
        </div>
        <label className="flex flex-col gap-1 text-label text-ink">
          Tìm theo từ khóa
          <input
            type="search"
            className="min-h-touch rounded-md border border-line-strong bg-surface-0 px-3 text-body text-ink"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
            }}
          />
        </label>
        {error !== null && <ErrorNotice error={error} />}
        <AsyncBoundary
          query={query}
          isEmpty={(d) => d.items.length === 0}
          empty={{
            message: 'Chưa có bài nào.',
            ...(canEdit
              ? {
                  action: (
                    <Link className={linkButton} to="/posts/new">
                      Thêm bài
                    </Link>
                  ),
                }
              : {}),
          }}
        >
          {(data) => (
            <ul className="flex flex-col gap-3">
              {data.items.map((post) => (
                <Row key={post.id} post={post} onDelete={setToDelete} />
              ))}
            </ul>
          )}
        </AsyncBoundary>
        <ConfirmDialog
          open={toDelete !== null}
          onOpenChange={(open) => {
            if (!open) setToDelete(null);
          }}
          tone="danger"
          title="Xóa bài nháp?"
          body="Bài sẽ biến khỏi danh sách. Chỉ xóa được bài đang ở trạng thái Nháp."
          confirmLabel="Xóa nháp"
          loading={remove.isPending}
          onConfirm={() => {
            if (toDelete === null) return;
            setError(null);
            remove.mutate(toDelete, {
              onSuccess: () => {
                setToDelete(null);
              },
              onError: (e) => {
                setToDelete(null);
                setError(e);
              },
            });
          }}
        />
      </Page>
    </div>
  );
}
