import * as Tabs from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';
import { cn } from '../util/cn';

export interface ChannelTabItem {
  id: string;
  label: string;
}

export interface ChannelTabsProps {
  /** Danh sách kênh bất kỳ (Figma chỉ vẽ Facebook·TikTok). */
  channels: readonly ChannelTabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Nội dung của tab đang chọn (tùy chọn). */
  children?: ReactNode;
  label?: string;
}

/** Radix Tabs: mũi tên trái/phải chuyển tab, tab hiện tại có `aria-selected` + gạch chân (không chỉ màu). */
export function ChannelTabs({ channels, value, onChange, children, label }: ChannelTabsProps) {
  return (
    <Tabs.Root value={value} onValueChange={onChange}>
      <Tabs.List aria-label={label ?? 'Kênh'} className="flex gap-1 overflow-x-auto border-b border-line">
        {channels.map((channel) => (
          <Tabs.Trigger
            key={channel.id}
            value={channel.id}
            className={cn(
              'min-h-touch min-w-touch shrink-0 border-b-2 px-4 text-label focus-visible:ring-2 focus-visible:ring-brand',
              'data-[state=active]:border-brand data-[state=active]:font-bold data-[state=active]:text-brand',
              'data-[state=inactive]:border-transparent data-[state=inactive]:text-ink-muted',
            )}
          >
            {channel.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <Tabs.Content value={value} className="pt-4">
        {children}
      </Tabs.Content>
    </Tabs.Root>
  );
}
