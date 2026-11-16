import { NavLink } from 'react-router';
import { t } from '../../lib/i18n/t';
import { Icon } from '../icons/Icon';
import { cn } from '../util/cn';
import { NavBadge } from './NavBadge';
import type { NavItemView } from './nav-types';

export interface NavBarProps {
  /** Thứ tự do nơi gọi quyết định; mục `featured` ("Tạo bài") nổi bật ở giữa. */
  items: readonly NavItemView[];
  className?: string;
}

/** Thanh dưới (< 1024 px), 5 ô. Chừa `--safe-bottom` cho vùng an toàn của điện thoại. */
export function NavBar({ items, className }: NavBarProps) {
  return (
    <nav
      aria-label={t('common.mainNav')}
      className={cn(
        'flex min-h-navbar items-stretch justify-around border-t border-line bg-surface-0 pb-(--safe-bottom)',
        className,
      )}
    >
      {items.map((item) => (
        <NavLink
          key={item.id}
          to={item.href}
          end={item.href === '/'}
          className={({ isActive }) =>
            cn(
              'flex min-h-touch min-w-touch flex-1 flex-col items-center justify-center gap-1 px-1 text-caption focus-visible:ring-2 focus-visible:ring-brand',
              item.featured === true
                ? 'text-brand'
                : isActive
                  ? 'font-bold text-brand'
                  : 'text-ink-muted',
            )
          }
        >
          {item.featured === true ? (
            <span className="flex size-touch items-center justify-center rounded-pill bg-brand text-on-brand">
              <Icon name={item.icon} />
            </span>
          ) : (
            <span className="relative">
              <Icon name={item.icon} />
              <NavBadge count={item.badge} />
            </span>
          )}
          <span className="max-w-full truncate">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
