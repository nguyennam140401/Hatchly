import type { AttemptAction, ChannelProgressView } from '@app/shared/publishing';
import { useState } from 'react';
import { Link } from 'react-router';
import { AsyncBoundary } from '../../app/AsyncBoundary';
import { publishingApi } from '../../lib/api/endpoints/publishing';
import type { AppError } from '../../lib/api/errors';
import { ErrorNotice } from '../../lib/api/ErrorNotice';
import { useApiMutation } from '../../lib/api/hooks';
import { MUTATIONS } from '../../lib/api/mutations';
import { formatDateTime } from '../../lib/format/datetime';
import { ConfirmDialog } from '../../ui/alert/ConfirmDialog';
import { InlineAlert } from '../../ui/alert/InlineAlert';
import { Button } from '../../ui/button/Button';
import { CHANNEL_TYPE_LABELS } from '../posts/ChannelPreview';
import { ChannelStatusBadge } from './ChannelStatusBadge';
import { StepTimeline } from './StepTimeline';
import { SupportDetails } from './SupportDetails';
import { usePublishProgress } from './usePublishProgress';

// Khu vực "Tiến trình đăng" của một bài (013 US5): theo từng kênh – trạng thái (chữ + biểu tượng), dòng thời gian 5 bước,
// lời giải thích + cách khắc phục, nút hành động theo quyền, "Chi tiết cho hỗ trợ" thu gọn. Quyền ẩn/hiện ở đây dựa trên
// `allowedActions` do máy chủ lọc; API vẫn tự chặn.

const linkClass =
  'inline-flex min-h-touch min-w-touch items-center rounded-md border border-line-strong bg-surface-0 px-4 text-label text-brand focus-visible:ring-2 focus-visible:ring-brand';

const channelLabel = (c: ChannelProgressView) =>
  (CHANNEL_TYPE_LABELS as Record<string, string | undefined>)[c.channelType] ?? 'Kênh';

interface ActionVars {
  postId: string;
  attemptId: string;
  version: number;
}

function ChannelCard({ postId, channel }: { postId: string; channel: ChannelProgressView }) {
  const [confirmRepublish, setConfirmRepublish] = useState(false);
  const [confirmMark, setConfirmMark] = useState(false);
  const [permalink, setPermalink] = useState('');
  const [error, setError] = useState<AppError | null>(null);
  const progress = usePublishProgress(postId);

  const republish = useApiMutation({
    operation: MUTATIONS.republishPost.operation,
    fn: (v: ActionVars) => publishingApi.republish(v.attemptId, v.version),
    invalidates: (v: ActionVars) =>
      MUTATIONS.republishPost.invalidates({ id: v.postId }, undefined),
  });
  const mark = useApiMutation({
    operation: MUTATIONS.markPostPublished.operation,
    fn: (v: ActionVars & { permalink: string }) =>
      publishingApi.markPublished(v.attemptId, v.version, v.permalink),
    invalidates: (v: ActionVars & { permalink: string }) =>
      MUTATIONS.markPostPublished.invalidates({ id: v.postId }, undefined),
  });
  const vars: ActionVars = { postId, attemptId: channel.attemptId, version: channel.version };
  const has = (a: AttemptAction) => channel.allowedActions.includes(a);
  const onFail = (e: AppError) => {
    setError(e);
    // Lượt vừa đổi (409): tải lại để thấy đúng trạng thái hiện tại.
    void progress.refetch();
  };

  const name = `${channelLabel(channel)}${channel.displayName !== null ? ` – ${channel.displayName}` : ''}`;
  const needs = channel.status === 'needs_action';

  return (
    <section
      aria-label={`Tiến trình đăng lên ${name}`}
      className="flex flex-col gap-4 rounded-md border border-line bg-surface-0 p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-label font-semibold text-ink">{name}</h2>
        <ChannelStatusBadge status={channel.status} />
      </header>
      <p className="text-caption text-ink-muted">
        Giờ hẹn đăng: {formatDateTime(channel.scheduledAt)}
      </p>

      {channel.status === 'published' && channel.permalink !== null && (
        <a
          className="text-label text-brand underline"
          href={channel.permalink}
          rel="noreferrer noopener"
          target="_blank"
        >
          Xem bài đã đăng
        </a>
      )}

      {needs && (
        <InlineAlert
          tone="warning"
          title={
            channel.needsKind === 'needs_check'
              ? 'Chưa rõ bài đã lên hay chưa'
              : 'Bài chưa đăng được – cần bạn xử lý'
          }
        >
          <p>
            {channel.message ??
              (channel.needsKind === 'needs_check'
                ? 'Hãy kiểm tra trên trang rồi chọn "Đã đăng" hoặc "Đăng lại" để tránh đăng trùng.'
                : 'Hãy làm theo hướng dẫn bên dưới rồi đăng lại.')}
          </p>
          {channel.remedies.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {channel.remedies.map((r) => (
                <li key={`${r.action}:${r.labelVi}`}>{r.labelVi}</li>
              ))}
            </ul>
          )}
        </InlineAlert>
      )}

      <StepTimeline steps={channel.steps} label={`Các bước đăng lên ${name}`} />

      {error !== null && <ErrorNotice error={error} />}

      {(needs || channel.allowedActions.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {has('reconnect') && (
            <Link className={linkClass} to="/channels">
              Kết nối lại
            </Link>
          )}
          {has('ask_owner_to_reconnect') && (
            <p className="text-body-sm text-ink">Nhờ chủ tài khoản kết nối lại kênh này.</p>
          )}
          {has('change_time') && (
            <Link className={linkClass} to={`/posts/${postId}`}>
              Chọn giờ khác
            </Link>
          )}
          {has('edit_media') && (
            <Link className={linkClass} to={`/posts/${postId}`}>
              Chọn ảnh/video khác
            </Link>
          )}
          {has('mark_published') && (
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmMark(true);
              }}
            >
              Đã đăng
            </Button>
          )}
          {has('republish') && (
            <Button
              onClick={() => {
                setConfirmRepublish(true);
              }}
            >
              Đăng lại
            </Button>
          )}
        </div>
      )}

      <SupportDetails attemptId={channel.attemptId} />

      <ConfirmDialog
        open={confirmRepublish}
        onOpenChange={setConfirmRepublish}
        title="Đăng lại bài này?"
        body={
          channel.needsKind === 'needs_check'
            ? 'Nếu bài trước đã lên kênh, đăng lại có thể làm bài bị đăng trùng. Hãy kiểm tra trên trang trước khi đăng lại.'
            : 'Hệ thống sẽ đăng bài này lên kênh ngay.'
        }
        confirmLabel="Đăng lại"
        loading={republish.isPending}
        onConfirm={() => {
          setError(null);
          republish.mutate(vars, {
            onSuccess: () => {
              setConfirmRepublish(false);
            },
            onError: (e) => {
              setConfirmRepublish(false);
              onFail(e);
            },
          });
        }}
      />
      <ConfirmDialog
        open={confirmMark}
        onOpenChange={setConfirmMark}
        title="Bài đã lên kênh rồi?"
        body={
          <label className="flex flex-col gap-1 text-label text-ink">
            Đường dẫn bài (không bắt buộc)
            <input
              type="url"
              inputMode="url"
              placeholder="https://…"
              className="min-h-touch rounded-md border border-line-strong bg-surface-0 px-3 text-body text-ink"
              value={permalink}
              onChange={(e) => {
                setPermalink(e.target.value);
              }}
            />
          </label>
        }
        confirmLabel="Xác nhận đã đăng"
        loading={mark.isPending}
        onConfirm={() => {
          setError(null);
          mark.mutate(
            { ...vars, permalink: permalink.trim() },
            {
              onSuccess: () => {
                setConfirmMark(false);
              },
              onError: (e) => {
                setConfirmMark(false);
                onFail(e);
              },
            },
          );
        }}
      />
    </section>
  );
}

/** Khu vực Tiến trình đăng của một bài – tự cập nhật (không cần tải lại trang). */
export function PublishProgress({ postId }: { postId: string }) {
  const query = usePublishProgress(postId);
  return (
    <AsyncBoundary
      query={query}
      isEmpty={(d) => d.channels.length === 0}
      empty={{ message: 'Bài này chưa được lên lịch đăng nên chưa có tiến trình.' }}
    >
      {(data) => (
        <div className="flex flex-col gap-4">
          {data.channels.map((c) => (
            <ChannelCard key={c.attemptId} postId={postId} channel={c} />
          ))}
        </div>
      )}
    </AsyncBoundary>
  );
}
