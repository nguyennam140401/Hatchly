import { NavLink } from 'react-router';
import { t } from '../../lib/i18n/t';
import { Icon } from '../icons/Icon';
import { cn } from '../util/cn';
import { Logo } from './Logo';
import { NavBadge } from './NavBadge';
import type { NavItemView } from './nav-types';

export interface SidebarProps {
  items: readonly NavItemView[];
  appName: string;
  className?: string;
}

/** Thanh bên (≥ 1024 px): mục hiện tại có `aria-current="page"`, chữ đậm và nền – không chỉ màu. */
export function Sidebar({ items, appName, className }: SidebarProps) {
  return (
    <nav
      aria-label={t('common.mainNav')}
      className={cn('flex w-sidebar shrink-0 flex-col gap-2 border-r border-line bg-surface-0 p-4', className)}
    >
      <div className="flex items-center gap-2 px-2 pb-4">
        <Logo />
        <span className="text-heading text-ink">{appName}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.id}>
            <NavLink
              to={item.href}
              end={item.href === '/'}
              className={({ isActive }) =>
                cn(
                  'flex min-h-touch items-center gap-3 rounded-md px-3 text-body text-ink focus-visible:ring-2 focus-visible:ring-brand',
                  isActive ? 'bg-brand-soft font-bold text-brand' : 'hover:bg-surface-100',
                )
              }
            >
              <Icon name={item.icon} />
              <span className="min-w-0 truncate">{item.label}</span>
              <NavBadge count={item.badge} />
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
