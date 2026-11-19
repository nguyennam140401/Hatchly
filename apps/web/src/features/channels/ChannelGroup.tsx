import type { ChannelOverviewItem, OverviewResponse } from '@app/shared/platform_gateway';
import { platformLabel } from './channel-state';
import { ChannelCard } from './ChannelCard';

// Nhóm kênh theo nền tảng: tiêu đề "Facebook Page (2/5)" (đã dùng / giới hạn) + các thẻ. Nhóm không còn thẻ sau khi lọc thì ẩn.

export interface ChannelGroupProps {
  platform: OverviewResponse['platforms'][number];
  items: ChannelOverviewItem[];
  viewerCanManage: boolean;
  onReconnect: (item: ChannelOverviewItem) => void;
  onDisconnect: (item: ChannelOverviewItem) => void;
}

export function ChannelGroup({
  platform,
  items,
  viewerCanManage,
  onReconnect,
  onDisconnect,
}: ChannelGroupProps) {
  if (items.length === 0) return null;
  return (
    <section aria-label={platformLabel(platform.channelType)} className="flex flex-col gap-3">
      <h2 className="text-label text-ink">
        {platformLabel(platform.channelType)} ({platform.used}/{platform.limit})
      </h2>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {items.map((item) => (
          <ChannelCard
            key={item.connectionId}
            item={item}
            viewerCanManage={viewerCanManage}
            onReconnect={onReconnect}
            onDisconnect={onDisconnect}
          />
        ))}
      </ul>
    </section>
  );
}
