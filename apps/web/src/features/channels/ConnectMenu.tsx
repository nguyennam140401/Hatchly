import type { ConnectableChannelType, OverviewResponse } from '@app/shared/platform_gateway';
import { useState } from 'react';
import { channelsApi } from '../../lib/api/endpoints/channels';
import { ErrorNotice } from '../../lib/api/ErrorNotice';
import { useApiMutation } from '../../lib/api/hooks';
import { MUTATIONS } from '../../lib/api/mutations';
import { t } from '../../lib/i18n/t';
import { Button } from '../../ui/button/Button';
import { platformLabel } from './channel-state';

// "Kết nối kênh": chọn nền tảng → thấy `đã dùng/giới hạn` → `POST /connect` → chuyển trình duyệt tới trang ủy quyền của nền tảng.
// `canAdd=false` (đủ giới hạn / gói hết hạn / không phải chủ) ⇒ nút khóa kèm LÝ DO (không chỉ ẩn). TikTok chỉ có khi máy chủ trả
// nó trong `platforms` (công tắc bật).

export interface ConnectMenuProps {
  overview: OverviewResponse;
  /** Điều hướng tới trang ủy quyền; mặc định `window.location.assign` (kiểm thử thay thế). */
  navigate?: (url: string) => void;
}

export function ConnectMenu({
  overview,
  navigate = (url) => {
    window.location.assign(url);
  },
}: ConnectMenuProps) {
  const [open, setOpen] = useState(false);
  const connect = useApiMutation({
    operation: MUTATIONS.connectChannel.operation,
    fn: (channelType: ConnectableChannelType) => channelsApi.connect(channelType),
    invalidates: () => [],
  });

  if (!overview.viewerCanManage)
    return <p className="text-body">{t('channels.collaborator.note')}</p>;

  const reasonFor = (p: OverviewResponse['platforms'][number]): string | undefined => {
    if (p.canAdd) return undefined;
    if (!overview.planActive) return t('channels.planExpired.note');
    return t('channels.connect.limitReached', { limit: p.limit });
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        icon="plus"
        onClick={() => {
          setOpen((v) => !v);
        }}
        aria-expanded={open}
      >
        {t('channels.connect')}
      </Button>
      {!overview.planActive && <p className="text-body">{t('channels.planExpired.note')}</p>}
      {open && (
        <ul className="flex flex-col gap-2" aria-label="Chọn nền tảng để kết nối">
          {overview.platforms.map((p) => {
            const reason = reasonFor(p);
            return (
              <li key={p.channelType} className="flex flex-col gap-1">
                <Button
                  variant="secondary"
                  loading={connect.isPending && connect.variables === p.channelType}
                  locked={!p.canAdd}
                  lockedReason={reason}
                  onClick={() => {
                    if (!p.canAdd) return;
                    connect.mutate(p.channelType, {
                      onSuccess: (res) => {
                        navigate(res.authorizeUrl);
                      },
                    });
                  }}
                >
                  {platformLabel(p.channelType)} ·{' '}
                  {t('channels.connect.used', { used: p.used, limit: p.limit })}
                </Button>
                {p.channelType === 'tiktok' && (
                  <p className="text-caption text-ink-muted">
                    {t('channels.tiktok.videoOnly')} · {t('channels.experimental')}
                  </p>
                )}
                {reason !== undefined && <p className="text-caption text-ink-muted">{reason}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {connect.error !== null && (
        <ErrorNotice
          error={connect.error}
          actions={[{ kind: 'retry', label: 'Thử lại' }]}
          onRetry={() => {
            connect.reset();
          }}
        />
      )}
    </div>
  );
}
