import type { ReactNode } from 'react';
import { t } from '../../lib/i18n/t';
import { Icon } from '../icons/Icon';
import { cn } from '../util/cn';
import { Logo } from './Logo';

export interface TopBarProps {
  kind: 'logo' | 'back';
  title: string;
  onBack?: () => void;
  actions?: ReactNode;
  className?: string;
}

export function TopBar({ kind, title, onBack, actions, className }: TopBarProps) {
  return (
    <header
      className={cn(
        'flex h-topbar items-center gap-2 border-b border-line bg-surface-0 px-gutter',
        className,
      )}
    >
      {kind === 'back' ? (
        <button
          type="button"
          aria-label={t('common.back')}
          onClick={onBack}
          className="flex size-touch items-center justify-center rounded-md text-ink focus-visible:ring-2 focus-visible:ring-brand"
        >
          <Icon name="back" />
        </button>
      ) : (
        <Logo />
      )}
      <span className="min-w-0 flex-1 truncate text-heading text-ink">{title}</span>
      {actions}
    </header>
  );
}
