import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

// Lớp bọc Radix Tooltip (FR-038): chữ dài bị cắt gọn vẫn đọc được đầy đủ khi rê chuột/tiêu điểm.
export interface TooltipProps {
  content: string;
  children: ReactNode;
}

export function Tooltip({ content, children }: TooltipProps) {
  return (
    <RadixTooltip.Provider delayDuration={200}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            sideOffset={4}
            className="z-50 max-w-phone rounded-sm bg-ink px-3 py-2 text-body-sm text-surface-0"
          >
            {content}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
