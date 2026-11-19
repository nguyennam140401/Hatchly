import type { ChannelOverviewItem } from '@app/shared/platform_gateway';
import { Chip } from '../../ui/chip-tabs/Chip';
import { CHANNEL_STATE_META, platformLabel, type ChannelCardState } from './channel-state';

// Bộ lọc dạng chip: nền tảng + trạng thái hoạt động (SC-013: tìm đúng kênh cần xử lý ≤ 10 giây). Nền tảng TikTok chỉ có chip khi
// công tắc bật (kết nối TikTok đã có vẫn lọc được qua "Tất cả").

export interface ChannelFilter {
  platform: string; // 'all' | channelType
  state: 'all' | ChannelCardState;
}

export const NO_FILTER: ChannelFilter = { platform: 'all', state: 'all' };

export function applyFilter(items: ChannelOverviewItem[], f: ChannelFilter): ChannelOverviewItem[] {
  return items.filter(
    (c) =>
      (f.platform === 'all' || c.channelType === f.platform) &&
      (f.state === 'all' || c.state === f.state),
  );
}

export interface FilterBarProps {
  platforms: readonly string[];
  items: readonly ChannelOverviewItem[];
  value: ChannelFilter;
  onChange: (next: ChannelFilter) => void;
}

export function FilterBar({ platforms, items, value, onChange }: FilterBarProps) {
  const present = new Set(items.map((c) => c.state));
  const states = (Object.keys(CHANNEL_STATE_META) as ChannelCardState[]).filter((s) =>
    present.has(s),
  );
  return (
    <div className="flex flex-col gap-2" role="group" aria-label="Lọc kênh">
      <div className="flex flex-wrap gap-2">
        <Chip
          label="Tất cả nền tảng"
          selected={value.platform === 'all'}
          onClick={() => {
            onChange({ ...value, platform: 'all' });
          }}
        />
        {platforms.map((p) => (
          <Chip
            key={p}
            label={platformLabel(p)}
            selected={value.platform === p}
            onClick={() => {
              onChange({ ...value, platform: p });
            }}
          />
        ))}
      </div>
      {states.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Chip
            label="Mọi trạng thái"
            selected={value.state === 'all'}
            onClick={() => {
              onChange({ ...value, state: 'all' });
            }}
          />
          {states.map((s) => (
            <Chip
              key={s}
              label={`${CHANNEL_STATE_META[s].mark} ${CHANNEL_STATE_META[s].label}`}
              selected={value.state === s}
              onClick={() => {
                onChange({ ...value, state: s });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
