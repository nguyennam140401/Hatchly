import type { CalendarItem } from '@app/shared/content';
import { useMemo, useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import { AsyncBoundary } from '../../app/AsyncBoundary';
import { postsApi } from '../../lib/api/endpoints/posts';
import type { AppError } from '../../lib/api/errors';
import { ErrorNotice } from '../../lib/api/ErrorNotice';
import { useApiMutation, useApiQuery } from '../../lib/api/hooks';
import { MUTATIONS } from '../../lib/api/mutations';
import { queryKeys } from '../../lib/api/query-keys';
import { toDisplayStatus } from '../../lib/catalogs/post-status';
import { formatTime, fromLocalInput, toLocalInput } from '../../lib/format/datetime';
import { useCan } from '../../lib/session/permissions';
import { Modal, ModalClose } from '../../ui/alert/Modal';
import { StatusBadge } from '../../ui/badge/StatusBadge';
import { Button } from '../../ui/button/Button';
import { Page } from '../../ui/layout/Page';
import { PageHeader } from '../../ui/layout/PageHeader';
import { CHANNEL_TYPE_LABELS } from '../posts/ChannelPreview';

// Màn hình Lịch (012 US5): xem bài theo tuần/tháng (giờ Việt Nam; ranh giới ngày tính ở web rồi gửi `from/to` UTC), đổi giờ bài
// đã lên lịch KHÔNG cần duyệt lại. "Đổi giờ" (hộp chọn giờ, dùng được bằng bàn phím và trên điện thoại) là đường CHÍNH; kéo thả
// thẻ sang ngày khác (giữ nguyên giờ trong ngày) là đường phụ trên máy tính. Thẻ không đổi được có giải thích ngắn.
// Máy chủ từ chối (giờ quá khứ, đã đăng, xung đột phiên bản) → thẻ KHÔNG đổi chỗ, hiện lỗi kèm cách xử lý.

type Mode = 'week' | 'month';
/** Trạng thái mục lịch đăng (publishing) → khóa của bảng trạng thái hiển thị (UI/UX mục 7). */
const ATTEMPT_TO_SYSTEM: Record<string, string> = {
  processing: 'publishing',
  succeeded: 'published',
  needs_user: 'needs_user_action',
  unknown: 'unknown_outcome',
};
const DAY_MS = 86_400_000;
const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

/** Khóa ngày `YYYY-MM-DD` (giờ Việt Nam) của một mốc ISO UTC. */
const dayKey = (iso: string): string => toLocalInput(iso).slice(0, 10);
const keyToMs = (key: string): number => Date.parse(`${key}T00:00:00Z`);
const msToKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const todayKey = (): string => dayKey(new Date().toISOString());

/** Thứ Hai của tuần chứa `key`. */
function weekStart(key: string): string {
  const day = new Date(keyToMs(key)).getUTCDay();
  return msToKey(keyToMs(key) - ((day + 6) % 7) * DAY_MS);
}

function rangeOf(mode: Mode, anchor: string): { days: string[]; from: string; to: string } {
  const first = mode === 'week' ? weekStart(anchor) : weekStart(`${anchor.slice(0, 7)}-01`);
  const count = mode === 'week' ? 7 : 42;
  const days = Array.from({ length: count }, (_, i) => msToKey(keyToMs(first) + i * DAY_MS));
  return {
    days,
    from: fromLocalInput(`${first}T00:00`),
    to: fromLocalInput(`${msToKey(keyToMs(first) + count * DAY_MS)}T00:00`),
  };
}

function shift(mode: Mode, anchor: string, direction: 1 | -1): string {
  if (mode === 'week') return msToKey(keyToMs(anchor) + direction * 7 * DAY_MS);
  const d = new Date(keyToMs(anchor));
  d.setUTCMonth(d.getUTCMonth() + direction, 1);
  return d.toISOString().slice(0, 10);
}

const dayLabel = (key: string): string => {
  const d = new Date(keyToMs(key));
  return `${WEEKDAYS[d.getUTCDay()] ?? ''} ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

interface Pending {
  item: CalendarItem;
  /** Giờ mới đề xuất (`datetime-local`, giờ Việt Nam). */
  local: string;
}

export function CalendarPage() {
  const canReschedule = useCan('post.reschedule');
  const canEdit = useCan('post.edit');
  const [mode, setMode] = useState<Mode>('week');
  const [anchor, setAnchor] = useState(todayKey);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const { days, from, to } = useMemo(() => rangeOf(mode, anchor), [mode, anchor]);
  const query = useApiQuery(queryKeys.calendar.range(from, to), () => postsApi.calendar(from, to), {
    freshness: 'entity',
  });
  const move = useApiMutation({
    operation: MUTATIONS.reschedule.operation,
    fn: (v: { item: CalendarItem; local: string }) =>
      postsApi.reschedule(v.item.postId, {
        expectedVersion: v.item.version,
        scheduledAt: fromLocalInput(v.local),
      }),
    invalidates: (v: { item: CalendarItem; local: string }) =>
      MUTATIONS.reschedule.invalidates({ id: v.item.postId }, undefined),
  });

  const submit = (item: CalendarItem, local: string) => {
    setError(null);
    move.mutate(
      { item, local },
      {
        onSuccess: () => {
          setPending(null);
        },
        onError: (e) => {
          setPending(null);
          setError(e);
          // Xung đột phiên bản: tải lại để thấy giờ mới nhất (thẻ không đổi chỗ khi bị từ chối).
          if (e.kind === 'version_conflict') void query.refetch();
        },
      },
    );
  };

  const onDrop = (event: DragEvent, targetDay: string) => {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/plain');
    const item = query.data?.items.find((i) => i.postId === id);
    if (item === undefined || !item.movable || dayKey(item.scheduledAt) === targetDay) return;
    submit(item, `${targetDay}${toLocalInput(item.scheduledAt).slice(10)}`);
  };

  const heading =
    mode === 'week'
      ? `Tuần ${dayLabel(days[0] ?? anchor)} – ${dayLabel(days[6] ?? anchor)}`
      : `Tháng ${anchor.slice(5, 7)}/${anchor.slice(0, 4)}`;

  return (
    <div className="mx-auto w-full max-w-4xl px-gutter py-6">
      <Page busy={query.isPending}>
        <PageHeader
          title="Lịch đăng"
          description="Bài theo ngày giờ Việt Nam. Đổi giờ bài đã lên lịch không cần duyệt lại."
        />
        <div
          className="flex flex-wrap items-center gap-2"
          role="toolbar"
          aria-label="Điều khiển lịch"
        >
          <Button
            variant="secondary"
            aria-pressed={mode === 'week'}
            onClick={() => {
              setMode('week');
            }}
          >
            Tuần
          </Button>
          <Button
            variant="secondary"
            aria-pressed={mode === 'month'}
            onClick={() => {
              setMode('month');
            }}
          >
            Tháng
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setAnchor(shift(mode, anchor, -1));
            }}
          >
            Trước
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setAnchor(todayKey());
            }}
          >
            Hôm nay
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setAnchor(shift(mode, anchor, 1));
            }}
          >
            Sau
          </Button>
          <h2 className="text-label text-ink">{heading}</h2>
        </div>
        {error !== null && <ErrorNotice error={error} />}
        <AsyncBoundary
          query={query}
          isEmpty={() => false}
          empty={{ message: 'Chưa có bài nào trong khoảng này.' }}
        >
          {(data) => {
            const byDay = new Map<string, CalendarItem[]>();
            for (const item of data.items) {
              const key = dayKey(item.scheduledAt);
              byDay.set(key, [...(byDay.get(key) ?? []), item]);
            }
            return (
              <ol className="flex flex-col gap-3">
                {days.map((key) => {
                  const items = byDay.get(key) ?? [];
                  const expanded = open.has(key);
                  const shown = mode === 'month' && !expanded ? items.slice(0, 3) : items;
                  const hidden = items.length - shown.length;
                  return (
                    <li
                      key={key}
                      aria-label={dayLabel(key)}
                      onDragOver={(e) => {
                        e.preventDefault();
                      }}
                      onDrop={(e) => {
                        onDrop(e, key);
                      }}
                      className="flex flex-col gap-2 rounded-md border border-line bg-surface-0 p-3"
                    >
                      <h3 className="text-label text-ink">
                        {dayLabel(key)}
                        {key === todayKey() ? ' · Hôm nay' : ''}
                      </h3>
                      {items.length === 0 && canEdit && key >= todayKey() && (
                        <Link className="text-caption text-brand underline" to="/posts/new">
                          Thêm bài
                        </Link>
                      )}
                      <ul className="flex flex-col gap-2">
                        {shown.map((item) => (
                          <li
                            key={item.postId}
                            draggable={item.movable && canReschedule}
                            onDragStart={(e) => {
                              e.dataTransfer.setData('text/plain', item.postId);
                            }}
                            className="flex flex-wrap items-center gap-2 rounded-md border border-line p-2"
                          >
                            <span className="text-label text-ink">
                              {formatTime(item.scheduledAt)}
                            </span>
                            <Link
                              className="text-label text-brand underline"
                              to={`/posts/${item.postId}`}
                            >
                              {item.title === '' ? 'Bài chưa có nội dung' : item.title}
                            </Link>
                            <StatusBadge
                              status={toDisplayStatus(
                                item.status,
                                item.channels.map((c) =>
                                  c.attemptStatus === null
                                    ? ''
                                    : (ATTEMPT_TO_SYSTEM[c.attemptStatus] ?? c.attemptStatus),
                                ),
                              )}
                              size="sm"
                            />
                            <span className="text-caption text-ink-muted">
                              {item.channels
                                .map((c) => CHANNEL_TYPE_LABELS[c.channelType])
                                .join(', ')}
                            </span>
                            {item.movable && canReschedule ? (
                              <Button
                                variant="ghost"
                                onClick={() => {
                                  setPending({ item, local: toLocalInput(item.scheduledAt) });
                                }}
                              >
                                Đổi giờ
                              </Button>
                            ) : (
                              item.movableReason !== null && (
                                <span className="text-caption text-ink-muted">
                                  {item.movableReason}
                                </span>
                              )
                            )}
                          </li>
                        ))}
                      </ul>
                      {hidden > 0 && (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setOpen((s) => new Set(s).add(key));
                          }}
                        >
                          +{hidden} bài nữa
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ol>
            );
          }}
        </AsyncBoundary>

        <Modal
          open={pending !== null}
          onOpenChange={(o) => {
            if (!o) setPending(null);
          }}
          title="Đổi giờ đăng"
          description={pending?.item.title}
        >
          <label className="flex flex-col gap-1 text-label text-ink">
            Giờ đăng mới (giờ Việt Nam)
            <input
              type="datetime-local"
              className="min-h-touch rounded-md border border-line-strong bg-surface-0 px-3 text-body text-ink"
              value={pending?.local ?? ''}
              onChange={(e) => {
                setPending((p) => (p === null ? p : { ...p, local: e.target.value }));
              }}
            />
          </label>
          <div className="mt-4 flex gap-2">
            <Button
              variant="primary"
              loading={move.isPending}
              locked={pending === null || pending.local === ''}
              lockedReason="Hãy chọn giờ mới."
              onClick={() => {
                if (pending !== null) submit(pending.item, pending.local);
              }}
            >
              Lưu giờ mới
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
