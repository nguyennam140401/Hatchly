import type { ChannelOverviewItem, DisconnectResponse } from '@app/shared/platform_gateway';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AsyncBoundary } from '../../app/AsyncBoundary';
import { channelsApi } from '../../lib/api/endpoints/channels';
import { ErrorNotice } from '../../lib/api/ErrorNotice';
import { useApiMutation, useApiQuery } from '../../lib/api/hooks';
import { MUTATIONS } from '../../lib/api/mutations';
import { queryKeys } from '../../lib/api/query-keys';
import { t } from '../../lib/i18n/t';
import type { ViKey } from '../../lib/i18n/vi';
import { InlineAlert } from '../../ui/alert/InlineAlert';
import { EmptyState } from '../../ui/feedback/EmptyState';
import { Page } from '../../ui/layout/Page';
import { PageHeader } from '../../ui/layout/PageHeader';
import { AttentionBanner } from './AttentionBanner';
import { ChannelGroup } from './ChannelGroup';
import { ConnectMenu } from './ConnectMenu';
import { DisconnectDialog } from './DisconnectDialog';
import { applyFilter, FilterBar, NO_FILTER, type ChannelFilter } from './FilterBar';

// Màn hình "Kênh kết nối" (010 US6, contracts/web-ui.md mục 2): đọc dữ liệu ĐÃ LƯU qua `GET /channels/overview` (không gọi nền tảng,
// ≤ 1 giây), nhóm theo nền tảng, biểu ngữ liệt kê từng kênh cần chú ý, lọc bằng chip. Quyền chỉ để ẩn/hiện nút: cộng tác viên xem
// được nhưng KHÔNG có nút Kết nối/Kết nối lại/Kiểm tra lại/Ngắt; API vẫn tự chặn (403). Không thông tin giá AI nào ở màn này.

const ERROR_CODES = new Set<string>([
  'CONNECT_CANCELLED',
  'STATE_INVALID',
  'STATE_EXPIRED',
  'WRONG_CHANNEL',
  'FEATURE_NOT_ENABLED',
  'PROVIDER_UNAVAILABLE',
  'SCOPE_MISSING',
  'NO_CANDIDATES',
]);

export interface ChannelsPageProps {
  /** Điều hướng tới trang ủy quyền (kiểm thử thay thế). */
  navigate?: (url: string) => void;
}

export function ChannelsPage({
  navigate = (url) => {
    window.location.assign(url);
  },
}: ChannelsPageProps) {
  const [params, setParams] = useSearchParams();
  const [banner, setBanner] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [filter, setFilter] = useState<ChannelFilter>(NO_FILTER);
  const [disconnecting, setDisconnecting] = useState<ChannelOverviewItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Kết quả sau khi quay về từ trang ủy quyền: hiện rồi xóa tham số khỏi URL.
  useEffect(() => {
    const reconnected = params.get('reconnected');
    const error = params.get('error');
    if (reconnected === null && error === null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- đọc tham số URL một lần rồi xóa
    if (reconnected !== null) setBanner({ tone: 'info', text: t('channels.reconnected') });
    else if (error !== null) {
      const key = `channels.error.${error}` as ViKey;
      const known = ERROR_CODES.has(error);
      setBanner({
        tone: 'error',
        text: known ? t(key) : t('channels.error.PROVIDER_UNAVAILABLE'),
      });
    }
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('reconnected');
        next.delete('error');
        return next;
      },
      { replace: true },
    );
  }, [params, setParams]);

  const overview = useApiQuery(
    queryKeys.channels.overview(),
    ({ signal }) => channelsApi.overview(signal),
    {
      freshness: 'entity',
    },
  );

  const reconnect = useApiMutation({
    operation: MUTATIONS.connectChannel.operation,
    fn: (item: ChannelOverviewItem) =>
      channelsApi.connect(
        item.channelType as 'facebook_page' | 'instagram' | 'tiktok',
        item.connectionId,
      ),
    invalidates: () => [],
  });
  const startReconnect = (item: ChannelOverviewItem) => {
    reconnect.mutate(item, {
      onSuccess: (res) => {
        navigate(res.authorizeUrl);
      },
    });
  };

  const onDisconnected = (result: DisconnectResponse) => {
    setDisconnecting(null);
    setNotice(
      result.revoked === 'done'
        ? 'Đã ngắt kết nối và xóa quyền đăng bài của kênh này.'
        : `Đã ngắt kết nối. ${result.hintVi ?? ''}`.trim(),
    );
  };

  return (
    <Page busy={overview.isFetching}>
      <PageHeader
        title={t('channels.title')}
        actions={
          overview.data !== undefined ? (
            <ConnectMenu overview={overview.data} navigate={navigate} />
          ) : undefined
        }
      />
      <div aria-live="polite" className="flex flex-col gap-2">
        {banner?.tone === 'error' && (
          <InlineAlert
            tone="error"
            actions={[{ kind: 'navigate', label: 'Kết nối lại từ đầu', href: '/channels' }]}
          >
            {banner.text}
          </InlineAlert>
        )}
        {banner?.tone === 'info' && <InlineAlert tone="info">{banner.text}</InlineAlert>}
        {notice !== null && <InlineAlert tone="info">{notice}</InlineAlert>}
      </div>
      {reconnect.error !== null && (
        <ErrorNotice
          error={reconnect.error}
          actions={[{ kind: 'retry', label: 'Thử lại' }]}
          onRetry={() => {
            reconnect.reset();
          }}
        />
      )}
      <AsyncBoundary
        query={overview}
        isEmpty={() => false}
        empty={{ message: '' }}
        skeleton={{ shape: 'card', count: 3 }}
      >
        {(data) => {
          const hasAny = data.connections.length > 0;
          const filtered = applyFilter(data.connections, filter);
          return (
            <>
              {!hasAny && (
                <EmptyState
                  icon="link"
                  message={`${t('channels.empty.title')}. ${t('channels.empty.body')}`}
                  action={
                    data.viewerCanManage ? (
                      <ConnectMenu overview={data} navigate={navigate} />
                    ) : (
                      <p className="text-body">{t('channels.collaborator.note')}</p>
                    )
                  }
                />
              )}
              {hasAny && (
                <>
                  <AttentionBanner
                    overview={data}
                    onReconnect={(id) => {
                      const item = data.connections.find((c) => c.connectionId === id);
                      if (item !== undefined) startReconnect(item);
                    }}
                    onView={(id) => {
                      document.getElementById(`channel-${id}`)?.scrollIntoView({ block: 'center' });
                      setFilter(NO_FILTER);
                    }}
                  />
                  <FilterBar
                    platforms={data.platforms.map((p) => p.channelType)}
                    items={data.connections}
                    value={filter}
                    onChange={setFilter}
                  />
                  {filtered.length === 0 && (
                    <p className="text-body">Không có kênh nào khớp bộ lọc.</p>
                  )}
                  {data.platforms.map((platform) => (
                    <ChannelGroup
                      key={platform.channelType}
                      platform={platform}
                      items={filtered.filter((c) => c.channelType === platform.channelType)}
                      viewerCanManage={data.viewerCanManage}
                      onReconnect={startReconnect}
                      onDisconnect={setDisconnecting}
                    />
                  ))}
                  {/* Kết nối TikTok ĐÃ CÓ khi công tắc tắt: hiện dạng "Tạm tắt" (chỉ Xem/Ngắt). */}
                  {!data.platforms.some((p) => p.channelType === 'tiktok') &&
                    filtered.some((c) => c.channelType === 'tiktok') && (
                      <ChannelGroup
                        platform={{
                          channelType: 'tiktok',
                          used: filtered.filter((c) => c.channelType === 'tiktok').length,
                          limit: data.limits.perPlatform,
                          canAdd: false,
                        }}
                        items={filtered.filter((c) => c.channelType === 'tiktok')}
                        viewerCanManage={data.viewerCanManage}
                        onReconnect={startReconnect}
                        onDisconnect={setDisconnecting}
                      />
                    )}
                  {!data.viewerCanManage && (
                    <p className="text-body">{t('channels.collaborator.note')}</p>
                  )}
                </>
              )}
            </>
          );
        }}
      </AsyncBoundary>
      {disconnecting !== null && (
        <DisconnectDialog
          item={disconnecting}
          onClose={() => {
            setDisconnecting(null);
          }}
          onDisconnected={onDisconnected}
        />
      )}
    </Page>
  );
}
