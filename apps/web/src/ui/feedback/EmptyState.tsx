import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons/Icon';
import { cn } from '../util/cn';

export interface EmptyStateProps {
  /** Lời nhắn đời thường. */
  message: string;
  /** Một hành động gợi ý (nút/liên kết). */
  action?: ReactNode;
  icon?: IconName;
  className?: string;
}

export function EmptyState({ message, action, icon = 'info', className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-lg border border-dashed border-line-strong p-8 text-center',
        className,
      )}
    >
      <Icon name={icon} className="text-ink-muted" />
      <p className="text-body text-ink">{message}</p>
      {action}
    </div>
  );
}
