import type { ConfirmResponse, SelectionResponse } from '@app/shared/platform_gateway';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { AsyncBoundary } from '../../app/AsyncBoundary';
import { channelsApi } from '../../lib/api/endpoints/channels';
import { ErrorNotice } from '../../lib/api/ErrorNotice';
import { useApiMutation, useApiQuery } from '../../lib/api/hooks';
import { MUTATIONS } from '../../lib/api/mutations';
import { queryKeys } from '../../lib/api/query-keys';
import { t } from '../../lib/i18n/t';
import { InlineAlert } from '../../ui/alert/InlineAlert';
import { Button } from '../../ui/button/Button';
import { Page } from '../../ui/layout/Page';
import { PageHeader } from '../../ui/layout/PageHeader';
import { platformLabel } from './channel-state';
import { InstagramBlockedHelp } from './InstagramBlockedHelp';

// Chọn Page/tài khoản sau khi cấp quyền (010 US1, contracts/web-ui.md mục 4): danh sách ứng viên có ảnh + tên; MỘT ứng viên chọn được
// thì chọn sẵn; chọn nhiều tới `remainingSlots` (nút "Xác nhận" khóa kèm giải thích khi vượt); ứng viên `blocked` hiện lý do +
// hành động (Instagram cá nhân → hướng dẫn 3 bước + "Kiểm tra lại"); kết quả TỪNG Page hiện riêng sau xác nhận.
// Quyền chỉ để ẩn/hiện (cộng tác viên không tới được đây); API tự chặn.

type Candidate = SelectionResponse['candidates'][number];

const OUTCOME_TEXT: Record<ConfirmResponse['results'][number]['outcome'], string> = {
  created: 'Đã kết nối',
  already_connected: 'Đã kết nối từ trước',
  owned_by_another_account: 'Kênh này đang được dùng ở một tài khoản khác',
  ineligible: 'Chưa đủ điều kiện',
  limit_reached: 'Đã đủ số kênh cho nền tảng này',
  not_in_selection: 'Không có trong danh sách đã chọn',
};

export interface SelectChannelsPageProps {
  navigate?: (url: string) => void;
}

export function SelectChannelsPage({
  navigate = (url) => {
    window.location.assign(url);
  },
}: SelectChannelsPageProps) {
  const { selectionId = '' } = useParams();
  const go = useNavigate();
  const query = useApiQuery(
    queryKeys.channels.selection(selectionId),
    () => channelsApi.selection(selectionId),
    { freshness: 'volatile' },
  );
  return (
    <Page busy={query.isFetching}>
      <PageHeader title={t('channels.select.title')} />
      <AsyncBoundary
        query={query}
        isEmpty={(d) => d.candidates.length === 0}
        empty={{
          message: t('channels.error.NO_CANDIDATES'),
          action: (
            <Button
              onClick={() => {
                void go('/channels');
              }}
            >
              Về Kênh kết nối
            </Button>
          ),
        }}
      >
        {(data) => (
          <SelectionForm
            selectionId={selectionId}
            data={data}
            navigate={navigate}
            onDone={() => {
              void go('/channels');
            }}
          />
        )}
      </AsyncBoundary>
    </Page>
  );
}

function SelectionForm({
  selectionId,
  data,
  navigate,
  onDone,
}: {
  selectionId: string;
  data: SelectionResponse;
  navigate: (url: string) => void;
  onDone: () => void;
}) {
  const selectable = useMemo(() => data.candidates.filter((c) => c.selectable), [data.candidates]);
  // Chỉ MỘT ứng viên chọn được ⇒ chọn sẵn (US1-3).
  const [picked, setPicked] = useState<Set<string>>(
    () =>
      new Set(
        selectable.length === 1 && selectable[0] !== undefined ? [selectable[0].externalId] : [],
      ),
  );
  const [result, setResult] = useState<ConfirmResponse | null>(null);

  const confirm = useApiMutation({
    operation: MUTATIONS.confirmChannels.operation,
    fn: (ids: string[]) => channelsApi.confirm(selectionId, ids),
    invalidates: () => MUTATIONS.confirmChannels.invalidates(undefined, undefined),
  });
  const restart = useApiMutation({
    operation: MUTATIONS.connectChannel.operation,
    fn: () => channelsApi.connect(data.channelType as 'facebook_page' | 'instagram' | 'tiktok'),
    invalidates: () => [],
  });

  const over = picked.size > data.remainingSlots;
  const toggle = (c: Candidate) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(c.externalId)) next.delete(c.externalId);
      else next.add(c.externalId);
      return next;
    });
  };

  if (result !== null) {
    return (
      <section aria-live="polite" className="flex flex-col gap-3">
        <h2 className="text-label">Kết quả từng kênh</h2>
        <ul className="flex flex-col gap-2">
          {result.results.map((r) => {
            const cand = data.candidates.find((c) => c.externalId === r.externalId);
            const ok = r.outcome === 'created' || r.outcome === 'already_connected';
            return (
              <li
                key={r.externalId}
                className="flex flex-col gap-1 rounded-lg border border-line p-3"
              >
                <p className="break-words text-label">{cand?.displayName ?? r.externalId}</p>
                <p>
                  <span aria-hidden="true">{ok ? '✔ ' : '⚠ '}</span>
                  {OUTCOME_TEXT[r.outcome]}
                </p>
                {r.error !== undefined && <p className="text-body">{r.error.messageVi}</p>}
              </li>
            );
          })}
        </ul>
        <div>
          <Button onClick={onDone}>Về Kênh kết nối</Button>
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body">
        {platformLabel(data.channelType)} ·{' '}
        {t('channels.select.remaining', { count: data.remainingSlots })}
      </p>
      <ul className="flex flex-col gap-3">
        {data.candidates.map((c) => (
          <li
            key={c.externalId}
            className="flex flex-col gap-2 rounded-lg border border-line bg-surface-0 p-3"
          >
            <label className="flex min-h-touch items-center gap-3">
              <input
                type="checkbox"
                className="size-5"
                checked={picked.has(c.externalId)}
                disabled={!c.selectable}
                onChange={() => {
                  toggle(c);
                }}
              />
              {c.avatarUrl !== null && (
                <img
                  src={c.avatarUrl}
                  alt={c.displayName}
                  className="size-10 rounded-full object-cover"
                />
              )}
              <span className="break-words text-label">{c.displayName}</span>
            </label>
            {c.blocked !== null && (
              <div className="flex flex-col gap-2 pl-8">
                <p className="text-body">
                  <span aria-hidden="true">⛔ </span>
                  {c.blocked.code === 'ALREADY_CONNECTED'
                    ? t('channels.select.alreadyConnected')
                    : c.blocked.messageVi}
                </p>
                {(c.blocked.code === 'NOT_PROFESSIONAL' ||
                  c.blocked.code === 'PAGE_NOT_LINKED') && (
                  <>
                    <InstagramBlockedHelp />
                    <div>
                      <Button
                        variant="secondary"
                        icon="refresh"
                        loading={restart.isPending}
                        onClick={() => {
                          restart.mutate(undefined, {
                            onSuccess: (res) => {
                              navigate(res.authorizeUrl);
                            },
                          });
                        }}
                      >
                        {t('channels.recheck')}
                      </Button>
                    </div>
                  </>
                )}
                {c.blocked.code !== 'ALREADY_CONNECTED' && (
                  <ul className="text-caption text-ink-muted">
                    {c.blocked.remedies.map((r) => (
                      <li key={r.action}>{r.labelVi}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {over && (
        <InlineAlert tone="warning">
          Bạn chỉ chọn thêm được {data.remainingSlots} kênh cho nền tảng này (tối đa {data.limit}).
          Hãy bỏ bớt hoặc ngắt kênh không dùng.
        </InlineAlert>
      )}
      {confirm.error !== null && (
        <ErrorNotice
          error={confirm.error}
          actions={[{ kind: 'retry', label: 'Thử lại' }]}
          onRetry={() => {
            confirm.reset();
          }}
        />
      )}
      <div>
        <Button
          loading={confirm.isPending}
          locked={picked.size === 0 || over}
          lockedReason={
            picked.size === 0
              ? 'Hãy chọn ít nhất một kênh'
              : over
                ? 'Đã chọn quá số kênh còn lại'
                : undefined
          }
          onClick={() => {
            if (picked.size === 0 || over) return;
            confirm.mutate([...picked], { onSuccess: setResult });
          }}
        >
          {t('channels.select.confirm')}
        </Button>
      </div>
    </div>
  );
}
