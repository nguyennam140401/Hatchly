import type { Post, ValidationIssue } from '@app/shared/content';
import { POST_LIMITS } from '@app/shared/content';
import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { postsApi } from '../../lib/api/endpoints/posts';
import type { AppError } from '../../lib/api/errors';
import { ErrorNotice } from '../../lib/api/ErrorNotice';
import { useApiMutation, useApiQuery } from '../../lib/api/hooks';
import { MUTATIONS } from '../../lib/api/mutations';
import { queryKeys } from '../../lib/api/query-keys';
import { useUnsavedChangesGuard } from '../../lib/forms/useUnsavedChangesGuard';
import { formatDateTime, fromLocalInput, toLocalInput } from '../../lib/format/datetime';
import { toDisplayStatus } from '../../lib/catalogs/post-status';
import { useCan } from '../../lib/session/permissions';
import { InlineAlert } from '../../ui/alert/InlineAlert';
import { ConfirmDialog } from '../../ui/alert/ConfirmDialog';
import { StatusBadge } from '../../ui/badge/StatusBadge';
import { Button } from '../../ui/button/Button';
import { ChannelTabs } from '../../ui/chip-tabs/ChannelTabs';
import { EmptyState } from '../../ui/feedback/EmptyState';
import { Page } from '../../ui/layout/Page';
import { PageHeader } from '../../ui/layout/PageHeader';
import { CHANNEL_TYPE_LABELS, ChannelPreview } from './ChannelPreview';

// Màn hình Soạn / xem bài (012 US1, US2, US4, US6) – nội dung chung + bản riêng từng kênh, kiểm tra giới hạn kênh (cảnh báo
// bằng CHỮ + biểu tượng, vẫn lưu được), lưu nháp, gửi duyệt, duyệt và lên lịch, rút lại, hủy lịch. Quyền chỉ để ẩn/hiện; API
// vẫn tự chặn. Thời gian hiển thị UTC+7. Khóa lạc quan: lệch phiên bản → thông báo "xem bản mới" (không ghi đè).

interface VariantForm {
  customized: boolean;
  text: string;
  hashtags: string;
}

interface FormState {
  name: string;
  shared: string;
  scheduled: string;
  selected: string[];
  variants: Record<string, VariantForm>;
}

const EMPTY: FormState = { name: '', shared: '', scheduled: '', selected: [], variants: {} };

const parseHashtags = (raw: string): string[] =>
  raw
    .split(/[\s,]+/)
    .map((h) => h.replace(/^#+/, ''))
    .filter((h) => h !== '');

function fromPost(post: Post): FormState {
  return {
    name: post.internalName ?? '',
    shared: post.sharedText,
    scheduled: post.scheduledAt === null ? '' : toLocalInput(post.scheduledAt),
    selected: post.variants.map((v) => v.connectionId),
    variants: Object.fromEntries(
      post.variants.map((v) => [
        v.connectionId,
        { customized: v.customized, text: v.text, hashtags: v.hashtags.join(' ') },
      ]),
    ),
  };
}

function Issues({ issues }: { issues: readonly ValidationIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2" aria-label="Cần sửa trước khi lên lịch">
      {issues.map((issue) => (
        <li key={issue.rule}>
          <InlineAlert tone="warning">{issue.messageVi}</InlineAlert>
        </li>
      ))}
    </ul>
  );
}

interface EditorProps {
  id: string | undefined;
  post: Post | undefined;
  /** Tải lại bài từ máy chủ (sau thao tác thành công hoặc khi xung đột phiên bản). */
  onReload: () => void;
  notice: string | null;
  setNotice: (message: string | null) => void;
}

function ComposeEditor({ id, post, onReload, notice, setNotice }: EditorProps) {
  const navigate = useNavigate();
  const canEdit = useCan('post.edit');
  const canApprove = useCan('post.approve');
  // Khởi tạo từ bài hiện có; bài đổi phiên bản → cha dựng lại bộ soạn (key) nên không cần đồng bộ bằng effect.
  const [form, setForm] = useState<FormState>(() => (post === undefined ? EMPTY : fromPost(post)));
  const [baseline, setBaseline] = useState<FormState>(() =>
    post === undefined ? EMPTY : fromPost(post),
  );
  const [tab, setTab] = useState(() => form.selected[0] ?? '');
  const [error, setError] = useState<AppError | null>(null);
  const [confirmUnschedule, setConfirmUnschedule] = useState(false);
  const submitting = useRef(false);

  const channels = useApiQuery(queryKeys.channels.list(), () => postsApi.channels(), {
    freshness: 'entity',
  });
  const rules = useApiQuery(['channel-rules'], () => postsApi.channelRules(), {
    freshness: 'catalog',
  });
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  useUnsavedChangesGuard(dirty, submitting);

  const connections = useMemo(
    () => new Map((channels.data ?? []).map((c) => [c.connectionId, c])),
    [channels.data],
  );
  const usable = (channels.data ?? []).filter(
    (c) => c.status === 'active' || c.status === 'expiring',
  );
  const status = post?.status ?? 'draft';
  const readOnly =
    !canEdit ||
    (post !== undefined && status === 'pending_review' && !canApprove) ||
    status === 'cancelled';

  const body = () => ({
    internalName: form.name.trim() === '' ? null : form.name.trim(),
    sharedText: form.shared,
    scheduledAt: form.scheduled === '' ? null : fromLocalInput(form.scheduled),
    variants: form.selected.map((connectionId) => {
      const v = form.variants[connectionId] ?? { customized: false, text: '', hashtags: '' };
      return {
        connectionId,
        customized: v.customized,
        text: v.customized ? v.text : '',
        hashtags: parseHashtags(v.hashtags),
        media: post?.variants.find((x) => x.connectionId === connectionId)?.media ?? [],
      };
    }),
  });

  const settle = (result: Post | undefined, message: string) => {
    submitting.current = false;
    setError(null);
    setNotice(message);
    if (result !== undefined) {
      const next = fromPost(result);
      setForm(next);
      setBaseline(next);
    }
  };
  const fail = (e: AppError) => {
    submitting.current = false;
    setNotice(null);
    setError(e);
  };

  const create = useApiMutation({
    operation: MUTATIONS.createPost.operation,
    fn: () => postsApi.create(body()),
    invalidates: MUTATIONS.createPost.invalidates,
  });
  const save = useApiMutation({
    operation: MUTATIONS.editPostContent.operation,
    fn: (v: { id: string; version: number }) =>
      postsApi.save(v.id, { ...body(), expectedVersion: v.version }),
    invalidates: MUTATIONS.editPostContent.invalidates,
  });
  const submit = useApiMutation({
    operation: MUTATIONS.submitPosts.operation,
    fn: (v: { id: string; version: number }) =>
      postsApi.submit([{ postId: v.id, expectedVersion: v.version }]),
    invalidates: MUTATIONS.submitPosts.invalidates,
  });
  const approve = useApiMutation({
    operation: MUTATIONS.approvePost.operation,
    fn: (v: { id: string; version: number }) =>
      postsApi.approve(v.id, {
        expectedVersion: v.version,
        scheduledAt: fromLocalInput(form.scheduled),
      }),
    invalidates: MUTATIONS.approvePost.invalidates,
  });
  const withdraw = useApiMutation({
    operation: MUTATIONS.withdrawPost.operation,
    fn: (v: { id: string; version: number }) => postsApi.withdraw(v.id, v.version),
    invalidates: MUTATIONS.withdrawPost.invalidates,
  });
  const unschedule = useApiMutation({
    operation: MUTATIONS.cancelPost.operation,
    fn: (v: { id: string; version: number }) => postsApi.unschedule(v.id, v.version),
    invalidates: MUTATIONS.cancelPost.invalidates,
  });
  const busy =
    create.isPending ||
    save.isPending ||
    submit.isPending ||
    approve.isPending ||
    withdraw.isPending ||
    unschedule.isPending;

  const onSave = () => {
    submitting.current = true;
    if (post === undefined) {
      create.mutate(undefined, {
        onSuccess: (created) => {
          // Giữ `submitting` bật để việc chuyển sang /posts/:id không bị chặn bởi cảnh báo "thay đổi chưa lưu".
          setNotice('Đã lưu nháp.');
          void navigate(`/posts/${created.id}`, { replace: true });
        },
        onError: fail,
      });
      return;
    }
    save.mutate(
      { id: post.id, version: post.version },
      {
        onSuccess: (saved) => {
          settle(saved, status === 'approved' ? 'Đã lưu. Bài về trạng thái Chờ duyệt.' : 'Đã lưu.');
        },
        onError: fail,
      },
    );
  };

  const act = (
    mutation: {
      mutate: (
        v: { id: string; version: number },
        o: { onSuccess: () => void; onError: (e: AppError) => void },
      ) => void;
    },
    message: string,
  ) => {
    if (post === undefined) return;
    submitting.current = true;
    mutation.mutate(
      { id: post.id, version: post.version },
      {
        onSuccess: () => {
          settle(undefined, message);
          onReload();
        },
        onError: fail,
      },
    );
  };

  const toggleChannel = (connectionId: string) => {
    setForm((f) => {
      const on = f.selected.includes(connectionId);
      const selected = on
        ? f.selected.filter((x) => x !== connectionId)
        : [...f.selected, connectionId];
      setTab((cur) => (selected.includes(cur) ? cur : (selected[0] ?? '')));
      return { ...f, selected };
    });
  };
  const setVariant = (connectionId: string, patch: Partial<VariantForm>) => {
    setForm((f) => ({
      ...f,
      variants: {
        ...f.variants,
        [connectionId]: {
          customized: false,
          text: '',
          hashtags: '',
          ...f.variants[connectionId],
          ...patch,
        },
      },
    }));
  };

  const tabItems = form.selected.map((cid) => ({
    id: cid,
    label:
      connections.get(cid)?.displayName ??
      CHANNEL_TYPE_LABELS[
        post?.variants.find((v) => v.connectionId === cid)?.channelType ?? 'test_channel'
      ],
  }));
  const active = tab !== '' && form.selected.includes(tab) ? tab : (form.selected[0] ?? '');
  const activeVariant = form.variants[active] ?? { customized: false, text: '', hashtags: '' };
  const activeServer = post?.variants.find((v) => v.connectionId === active);
  const activeType =
    connections.get(active)?.channelType ?? activeServer?.channelType ?? 'test_channel';
  const rule = rules.data?.rules.find((r) => r.channelType === activeType);
  const effective = activeVariant.customized ? activeVariant.text : form.shared;
  const over = rule !== undefined && Array.from(effective).length > rule.maxTextLength;

  if (channels.isSuccess && usable.length === 0 && post === undefined) {
    return (
      <Page>
        <PageHeader title="Soạn bài mới" />
        <EmptyState
          message="Kết nối kênh để bắt đầu soạn bài."
          action={
            <Button variant="primary" onClick={() => void navigate('/channels')}>
              Kết nối kênh
            </Button>
          }
        />
      </Page>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-gutter py-6">
      <Page>
        <PageHeader
          title={post === undefined ? 'Soạn bài mới' : post.title}
          {...(post?.scheduledAt != null
            ? { description: `Giờ đăng: ${formatDateTime(post.scheduledAt)}` }
            : {})}
          {...(post !== undefined
            ? {
                actions: <StatusBadge status={toDisplayStatus(post.status)} />,
              }
            : {})}
        />

        {post?.labels.returned != null && (
          <InlineAlert tone="warning" title="Bị trả lại">
            {post.labels.returned.note}
          </InlineAlert>
        )}
        {post?.labels.editedAfterApproval === true && post.status === 'pending_review' && (
          <InlineAlert tone="info" title="Đã sửa sau khi duyệt">
            Bài đã được sửa nên đang chờ duyệt lại; lịch đăng cũ đã được hủy.
          </InlineAlert>
        )}
        {status === 'approved' && !readOnly && (
          <InlineAlert tone="info">
            Sửa nội dung bài đã duyệt sẽ đưa bài về Chờ duyệt và hủy lịch đăng cũ. Đổi giờ thì không
            cần duyệt lại.
          </InlineAlert>
        )}
        {readOnly && post !== undefined && (
          <InlineAlert tone="info">
            Bài đang ở trạng thái này nên bạn chỉ xem được. Hãy rút lại bài nếu cần sửa.
          </InlineAlert>
        )}
        {notice !== null && <InlineAlert tone="info">{notice}</InlineAlert>}
        {error !== null && (
          <ErrorNotice
            error={error}
            onRetry={error.kind === 'version_conflict' ? onReload : onSave}
          />
        )}

        <fieldset className="flex flex-col gap-3" disabled={readOnly}>
          <legend className="text-label text-ink">Đăng lên kênh</legend>
          <ul className="flex flex-wrap gap-2">
            {(channels.data ?? []).map((c) => {
              const on = form.selected.includes(c.connectionId);
              const broken = c.status === 'expired' || c.status === 'disconnected';
              return (
                <li key={c.connectionId}>
                  <label className="inline-flex min-h-touch items-center gap-2 rounded-md border border-line-strong px-3 text-label text-ink">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={broken && !on}
                      onChange={() => {
                        toggleChannel(c.connectionId);
                      }}
                    />
                    <span>
                      {c.displayName} ({CHANNEL_TYPE_LABELS[c.channelType]})
                    </span>
                    {broken && (
                      <span className="text-caption text-danger">Kênh cần kết nối lại</span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>

          <label className="flex flex-col gap-1 text-label text-ink">
            Tên gợi nhớ (không đăng)
            <input
              className="min-h-touch rounded-md border border-line-strong bg-surface-0 px-3 text-body text-ink"
              value={form.name}
              maxLength={POST_LIMITS.internalNameMax}
              onChange={(e) => {
                setForm((f) => ({ ...f, name: e.target.value }));
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-label text-ink">
            Nội dung chung
            <textarea
              className="min-h-32 rounded-md border border-line-strong bg-surface-0 p-3 text-body text-ink"
              value={form.shared}
              onChange={(e) => {
                setForm((f) => ({ ...f, shared: e.target.value }));
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-label text-ink">
            Giờ đăng (giờ Việt Nam)
            <input
              type="datetime-local"
              className="min-h-touch rounded-md border border-line-strong bg-surface-0 px-3 text-body text-ink"
              value={form.scheduled}
              onChange={(e) => {
                setForm((f) => ({ ...f, scheduled: e.target.value }));
              }}
            />
          </label>
        </fieldset>

        {form.selected.length > 0 && (
          <ChannelTabs
            channels={tabItems}
            value={active}
            onChange={setTab}
            label="Nội dung theo kênh"
          >
            <div className="flex flex-col gap-3">
              <label className="inline-flex min-h-touch items-center gap-2 text-label text-ink">
                <input
                  type="checkbox"
                  checked={activeVariant.customized}
                  disabled={readOnly}
                  onChange={(e) => {
                    setVariant(active, {
                      customized: e.target.checked,
                      text:
                        e.target.checked && activeVariant.text === ''
                          ? form.shared
                          : activeVariant.text,
                    });
                  }}
                />
                Dùng nội dung riêng cho kênh này
              </label>
              {activeVariant.customized && (
                <textarea
                  aria-label="Nội dung riêng của kênh"
                  className="min-h-32 rounded-md border border-line-strong bg-surface-0 p-3 text-body text-ink"
                  value={activeVariant.text}
                  disabled={readOnly}
                  onChange={(e) => {
                    setVariant(active, { text: e.target.value });
                  }}
                />
              )}
              <label className="flex flex-col gap-1 text-label text-ink">
                Hashtag (cách nhau bằng dấu cách)
                <input
                  className="min-h-touch rounded-md border border-line-strong bg-surface-0 px-3 text-body text-ink"
                  value={activeVariant.hashtags}
                  disabled={readOnly}
                  onChange={(e) => {
                    setVariant(active, { hashtags: e.target.value });
                  }}
                />
              </label>
              {rule !== undefined && (
                <p className={over ? 'text-label text-danger' : 'text-caption text-ink-muted'}>
                  {over ? '⚠ ' : ''}
                  {Array.from(effective).length.toLocaleString('vi-VN')} /{' '}
                  {rule.maxTextLength.toLocaleString('vi-VN')} ký tự
                  {over ? ' – vượt giới hạn của kênh này, hãy rút gọn.' : ''}
                </p>
              )}
              <p className="text-caption text-ink-muted">
                Ảnh/video: chọn từ Thư viện media (sẽ có khi thư viện sẵn sàng).
                {rule?.mediaRequired === true && ' Kênh này yêu cầu có ít nhất một ảnh hoặc video.'}
              </p>
              <Issues issues={activeServer?.issues ?? []} />
              <ChannelPreview
                channelType={activeType}
                displayName={connections.get(active)?.displayName ?? null}
                text={effective}
                hashtags={parseHashtags(activeVariant.hashtags)}
                mediaCount={activeServer?.media.length ?? 0}
              />
            </div>
          </ChannelTabs>
        )}

        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              loading={busy}
              onClick={onSave}
              locked={form.selected.length === 0 && form.shared.trim() === ''}
              lockedReason="Hãy chọn kênh hoặc nhập nội dung."
            >
              Lưu nháp
            </Button>
            {post !== undefined && status === 'draft' && !canApprove && (
              <Button
                variant="primary"
                loading={busy}
                locked={dirty}
                lockedReason="Hãy lưu nháp trước khi gửi duyệt."
                onClick={() => {
                  act(submit, 'Đã gửi duyệt cho chủ tài khoản.');
                }}
              >
                Gửi duyệt
              </Button>
            )}
            {post !== undefined &&
              (status === 'draft' || status === 'pending_review') &&
              canApprove && (
                <Button
                  variant="primary"
                  loading={busy}
                  locked={dirty || form.scheduled === ''}
                  lockedReason={dirty ? 'Hãy lưu bài trước khi duyệt.' : 'Hãy chọn giờ đăng.'}
                  onClick={() => {
                    act(approve, 'Đã duyệt và lên lịch.');
                  }}
                >
                  Duyệt và lên lịch
                </Button>
              )}
            {post !== undefined &&
              status === 'pending_review' &&
              post.submittedBy !== null &&
              !canApprove && (
                <Button
                  variant="secondary"
                  loading={busy}
                  onClick={() => {
                    act(withdraw, 'Đã rút lại bài.');
                  }}
                >
                  Rút lại
                </Button>
              )}
            {post !== undefined && status === 'approved' && canApprove && (
              <Button
                variant="danger"
                loading={busy}
                onClick={() => {
                  setConfirmUnschedule(true);
                }}
              >
                Hủy lịch
              </Button>
            )}
          </div>
        )}

        <ConfirmDialog
          open={confirmUnschedule}
          onOpenChange={setConfirmUnschedule}
          tone="danger"
          title="Hủy lịch đăng?"
          body="Bài sẽ về trạng thái Nháp, nội dung vẫn được giữ nguyên."
          confirmLabel="Hủy lịch"
          loading={unschedule.isPending}
          onConfirm={() => {
            setConfirmUnschedule(false);
            act(unschedule, 'Đã hủy lịch. Bài về trạng thái Nháp.');
          }}
        />
      </Page>
    </div>
  );
}

/** Màn hình Soạn / xem bài: tải bài (nếu có `:id`) rồi dựng bộ soạn; bài đổi phiên bản → dựng lại với dữ liệu mới. */
export function ComposePage() {
  const { id } = useParams();
  const [notice, setNotice] = useState<string | null>(null);
  const detail = useApiQuery(queryKeys.posts.detail(id ?? 'new'), () => postsApi.get(id ?? ''), {
    freshness: 'entity',
    enabled: id !== undefined,
  });
  if (id !== undefined && detail.isError) {
    return (
      <Page>
        <ErrorNotice error={detail.error} onRetry={() => void detail.refetch()} />
      </Page>
    );
  }
  if (id !== undefined && detail.data === undefined) {
    return (
      <Page busy>
        <PageHeader title="Đang tải bài…" />
      </Page>
    );
  }
  const post = detail.data?.post;
  return (
    <ComposeEditor
      key={post === undefined ? 'new' : `${post.id}:${String(post.version)}`}
      id={id}
      post={post}
      onReload={() => void detail.refetch()}
      notice={notice}
      setNotice={setNotice}
    />
  );
}
