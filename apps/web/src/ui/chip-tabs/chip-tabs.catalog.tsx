import { useState } from 'react';
import { CHANNELS } from '../../lib/catalogs/channels';
import type { CatalogEntry } from '../catalog-types';
import { ChannelTabs } from './ChannelTabs';
import { Chip } from './Chip';

function TabsDemo({ channels }: { channels: typeof CHANNELS }) {
  const [value, setValue] = useState(channels[0]?.id ?? '');
  return <ChannelTabs channels={channels} value={value} onChange={setValue} />;
}

export const chipCatalog: CatalogEntry = {
  name: 'Chip',
  description: 'Chip chọn/bỏ chọn, có thể có nút bỏ.',
  a11yNotes: 'aria-pressed; chip đã chọn có dấu ✓ (không chỉ màu).',
  variants: [
    { label: 'chưa chọn', render: () => <Chip label="Khuyến mãi" onClick={() => undefined} /> },
    {
      label: 'đã chọn',
      render: () => <Chip label="Khuyến mãi" selected onClick={() => undefined} />,
    },
    { label: 'có nút bỏ', render: () => <Chip label="#giamgia" onRemove={() => undefined} /> },
  ],
};

export const channelTabsCatalog: CatalogEntry = {
  name: 'ChannelTabs',
  description: 'Tab kênh (nhận mọi kênh). Instagram/Zalo chưa có thiết kế Figma.',
  a11yNotes: 'Radix Tabs: role=tablist, mũi tên chuyển tab.',
  variants: [
    {
      label: '2 kênh (Figma)',
      render: () => (
        <TabsDemo channels={CHANNELS.filter((c) => c.id === 'facebook' || c.id === 'tiktok')} />
      ),
    },
    { label: '4 kênh', render: () => <TabsDemo channels={CHANNELS} /> },
  ],
};
