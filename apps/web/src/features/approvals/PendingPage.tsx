import type { BulkResult, PendingItem } from '@app/shared/approval';
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
import { useCan } from '../../lib/session/permissions';
import { InlineAlert } from '../../ui/alert/InlineAlert';
import { Modal, ModalClose } from '../../ui/alert/Modal';
import { Button } from '../../ui/button/Button';
import { Page } from '../../ui/layout/Page';
import { PageHeader } from '../../ui/layout/PageHeader';
import { CHANNEL_TYPE_LABELS } from '../posts/ChannelPreview';

// Màn hình Chờ duyệt (012 US3) – chỉ chủ tài khoản: xem nhanh, chọn nhiều, duyệt/trả lại hàng loạt (mỗi bài độc lập),
// "Dời tất cả bài quá giờ về giờ gợi ý" (chỉ khi chủ xác nhận), kết quả "Đã duyệt N bài, M bài chưa duyệt được" kèm cách xử lý.
// Nhãn trạng thái bằng CHỮ + biểu tượng; quyền ẩn/hiện ở đây, API vẫn tự chặn.

const typeLabel = (t: string) => CHANNEL_TYPE_LABELS[t as keyof typeof CHANNEL_TYPE_LABELS];

function Labels({ item }: { item: PendingItem }) {
  return (
    <ul className="flex flex-wrap gap-2 text-caption text-ink">
      {item.timePassed && <li>⏰ Giờ đã qua</li>}
      {item.returned && <li>↩ Bị trả lại</li>}
      {item.editedAfterApproval && <li>✎ Đã sửa sau khi duyệt</li>}
    </ul>
  );
}

function ResultPanel({ result }: { result: BulkResult }) {
  return (
    <InlineAlert tone={result.failed > 0 ? 'warning' : 'info'} title="Kết quả">
      <p>
        Đã xử lý {result.succeeded} bài
        {result.failed > 0 ? `, ${result.failed} bài chưa xử lý được` : ''}.
      </p>
      {result.failed > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {result.results
            .filter((r) => r.status === 'failed')
            .map((r) => (
              <li key={r.postId}>
                <Link className="underline" to={`/posts/${r.postId}`}>
                  Mở bài
                </Link>
                : {r.error?.message}
              </li>
            ))}
        </ul>
      )}
    </InlineAlert>
  );
}

interface Done {
  onSuccess: (result?: BulkResult) => void;
  onError: (error: AppError) => void;
}

export function PendingPage() {
  const canApprove = useCan('post.approve');
  const query = useApiQuery(queryKeys.approvals.pending(), () => postsApi.pending(), {
    freshness: 'volatile',
    enabled: canApprove,
  });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState('');

  const approve = useApiMutation({
    operation: MUTATIONS.approvePosts.operation,
    fn: (items: PendingItem[]) =>
      postsApi.approveBatch(items.map((i) => ({ postId: i.postId, expectedVersion: i.version }))),
    invalidates: MUTATIONS.approvePosts.invalidates,
  });
  const giveBack = useApiMutation({
    operation: MUTATIONS.returnPosts.operation,
    fn: (v: { items: PendingItem[]; note: string }) =>
      postsApi.returnBatch(
        v.items.map((i) => ({ postId: i.postId, expectedVersion: i.version })),
        v.note,
      ),
    invalidates: MUTATIONS.returnPosts.invalidates,
  });
  const reschedule = useApiMutation({
    operation: MUTATIONS.reschedule.operation,
    fn: async (items: PendingItem[]) => {
      // Mỗi bài nhận MỘT giờ gợi ý khác nhau; chỉ chạy khi chủ bấm xác nhận.
      const { times } = await postsApi.suggestTimes(items.length);
      let moved = 0;
      for (const [i, item] of items.entries()) {
        const at = times[i];
        if (at === undefined) break;
        await postsApi.reschedule(item.postId, { expectedVersion: item.version, scheduledAt: at });
        moved++;
      }
      return moved;
    },
    invalidates: () => [
      queryKeys.approvals.pending(),
      queryKeys.posts.lists(),
      queryKeys.calendar.all(),
    ],
  });

  if (!canApprove) {
    return (
      <Page>
        <PageHeader title="Chờ duyệt" />
        <InlineAlert tone="info">
          Chỉ chủ tài khoản mới duyệt được bài. Bạn vẫn gửi duyệt được từ màn hình soạn bài.
        </InlineAlert>
      </Page>
    );
  }

  const items = query.data?.items ?? [];
  const chosen = items.filter((i) => selected.has(i.postId));
  const overdue = items.filter((i) => i.timePassed);
  const toggle = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const run = (mutate: (done: Done) => void) => {
    setError(null);
    mutate({
      onSuccess: (r) => {
        setSelected(new Set());
        if (r !== undefined) setResult(r);
      },
      onError: setError,
    });
  };
  const busy = approve.isPending || giveBack.isPending || reschedule.isPending;

  return (
    <div className="mx-auto w-full max-w-3xl px-gutter py-6">
      <Page busy={query.isPending}>
        <PageHeader
          title="Chờ duyệt"
          description="Xem nhanh, duyệt hoặc trả lại bài do cộng tác viên gửi lên."
        />
        {result !== null && <ResultPanel result={result} />}
        {error !== null && <ErrorNotice error={error} />}

        <AsyncBoundary
          query={query}
          isEmpty={(d) => d.items.length === 0}
          empty={{ message: 'Không có bài chờ duyệt.' }}
        >
          {() => (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex min-h-touch items-center gap-2 text-label text-ink">
                  <input
                    type="checkbox"
                    checked={chosen.length === items.length && items.length > 0}
                    onChange={(e) => {
                      setSelected(
                        e.target.checked ? new Set(items.map((i) => i.postId)) : new Set(),
                      );
                    }}
                  />
                  Chọn tất cả
                </label>
                <Button
                  variant="primary"
                  loading={approve.isPending}
                  locked={chosen.length === 0 || busy}
                  lockedReason="Hãy chọn ít nhất một bài."
                  onClick={() => {
                    run((done) => {
                      approve.mutate(chosen, done);
                    });
                  }}
                >
                  Duyệt đã chọn ({chosen.length})
                </Button>
                <Button
                  variant="secondary"
                  locked={chosen.length === 0 || busy}
                  lockedReason="Hãy chọn ít nhất một bài."
                  onClick={() => {
                    setReturning(true);
                  }}
                >
                  Trả lại đã chọn
                </Button>
                {overdue.length > 0 && (
                  <Button
                    variant="ghost"
                    loading={reschedule.isPending}
                    locked={busy}
                    onClick={() => {
                      run((done) => {
                        reschedule.mutate(overdue, {
                          onSuccess: () => {
                            setSelected(new Set());
                            done.onSuccess();
                          },
                          onError: done.onError,
                        });
                      });
                    }}
                  >
                    Dời tất cả bài quá giờ về giờ gợi ý ({overdue.length})
                  </Button>
                )}
              </div>
              <ul className="flex flex-col gap-3">
                {items.map((item) => (
                  <li
                    key={item.postId}
                    className="flex gap-3 rounded-md border border-line bg-surface-0 p-4"
                  >
                    <input
                      type="checkbox"
                      aria-label={`Chọn ${item.title}`}
                      className="mt-1 size-5"
                      checked={selected.has(item.postId)}
                      onChange={() => {
                        toggle(item.postId);
                      }}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <Link
                        className="text-label text-brand underline"
                        to={`/posts/${item.postId}`}
                      >
                        {item.title}
                      </Link>
                      <p className="text-body text-ink">{item.excerpt}</p>
                      <p className="text-caption text-ink-muted">
                        {item.channelTypes.map(typeLabel).join(', ')} · {item.authorDisplayName} ·{' '}
                        {item.scheduledAt === null
                          ? 'Chưa chọn giờ'
                          : formatDateTime(item.scheduledAt)}
                      </p>
                      <Labels item={item} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </AsyncBoundary>

        <Modal
          open={returning}
          onOpenChange={setReturning}
          title="Trả lại bài"
          description="Ghi chú giúp người soạn biết cần sửa gì."
        >
          <label className="flex flex-col gap-1 text-label text-ink">
            Ghi chú (bắt buộc, tối đa 500 ký tự)
            <textarea
              className="min-h-24 rounded-md border border-line-strong bg-surface-0 p-3 text-body text-ink"
              value={note}
              maxLength={500}
              onChange={(e) => {
                setNote(e.target.value);
              }}
            />
          </label>
          <div className="mt-4 flex gap-2">
            <Button
              variant="primary"
              loading={giveBack.isPending}
              locked={note.trim() === ''}
              lockedReason="Hãy nhập ghi chú trả lại."
              onClick={() => {
                run((done) => {
                  giveBack.mutate(
                    { items: chosen, note: note.trim() },
                    {
                      onSuccess: (r) => {
                        setReturning(false);
                        setNote('');
                        done.onSuccess(r);
                      },
                      onError: done.onError,
                    },
                  );
                });
              }}
            >
              Trả lại
            </Button>
            <ModalClose asChild>
              <Button variant="secondary">Hủy</Button>
            </ModalClose>
          </div>
        </Modal>
      </Page>
    </div>
  );
}
