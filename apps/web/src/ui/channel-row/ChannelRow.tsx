import type { ReactNode } from 'react';
import { channelLabel } from '../../lib/catalogs/channels';
import { t } from '../../lib/i18n/t';
import { Icon, type IconName } from '../icons/Icon';
import { cn } from '../util/cn';

export interface ChannelRowProps {
  channel: string;
  state: 'connected' | 'expiring' | 'disconnected' | 'manual';
  detail?: string;
  /** Nút hành động (Kết nối / Kết nối lại / Ngắt). */
  action?: ReactNode;
}

const META: Record<ChannelRowProps['state'], { icon: IconName; tone: string }> = {
  connected: { icon: 'check', tone: 'bg-success-soft text-success' },
  expiring: { icon: 'clock', tone: 'bg-warning-soft text-warning' },
  disconnected: { icon: 'alert', tone: 'bg-danger-soft text-danger' },
  manual: { icon: 'pencil', tone: 'bg-surface-200 text-ink' },
};

export function ChannelRow({ channel, state, detail, action }: ChannelRowProps) {
  const meta = META[state];
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-0 p-4">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-heading text-ink">{channelLabel(channel)}</span>
        {detail !== undefined && <span className="text-body-sm text-ink-muted">{detail}</span>}
      </div>
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-pill px-3 text-label font-semibold',
            meta.tone,
          )}
        >
          <Icon name={meta.icon} className="size-4" />
          {t(`channel.${state}`)}
        </span>
        {action}
      </div>
    </div>
  );
}
