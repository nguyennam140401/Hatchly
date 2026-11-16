import { Outlet, useLocation, useNavigate } from 'react-router';
import { useRefreshAll } from '../../lib/api/hooks';
import { t } from '../../lib/i18n/t';
import { useNavCounts } from '../../lib/notifications/counts';
import { NavBar } from '../../ui/nav/NavBar';
import { Sidebar } from '../../ui/nav/Sidebar';
import { TopBar } from '../../ui/nav/TopBar';
import { Toaster } from '../../ui/toast/Toaster';
import { RegionBoundary } from '../errors/RegionBoundary';
import { NAV_ITEMS } from './nav-registry';
import { OfflineBanner } from './OfflineBanner';
import { ReauthDialog } from './ReauthDialog';
import { useIsDesktop } from './useIsDesktop';
import { useNavItems } from './useNavItems';

/** Đường dẫn cấp gốc của điều hướng: ở đây TopBar hiện logo; màn con hiện nút quay lại. */
const ROOT_PATHS = new Set<string>(['/', '/more', ...NAV_ITEMS.map((i) => i.path)]);

/**
 * Khung ứng dụng: ≥ 1024 px → thanh bên (7 mục); < 1024 px → thanh trên + thanh dưới (5 ô).
 * Hai thanh sinh từ cùng `NAV_ITEMS`; lỗi trong vùng nội dung không làm mất khung điều hướng.
 */
export function AppShell() {
  const desktop = useIsDesktop();
  const { sidebar, bottom } = useNavItems(useNavCounts());
  const refresh = useRefreshAll();
  const location = useLocation();
  const navigate = useNavigate();
  const isRoot = ROOT_PATHS.has(location.pathname);
  const current = [...sidebar, ...bottom].find((i) => i.href === location.pathname);

  return (
    <div className="flex min-h-dvh bg-surface-100 text-ink">
      {desktop && <Sidebar items={sidebar} appName={t('app.name')} />}
      <div className="flex min-w-0 flex-1 flex-col">
        {!desktop && (
          <TopBar
            kind={isRoot ? 'logo' : 'back'}
            title={current?.label ?? t('app.name')}
            onBack={() => {
              void navigate(-1);
            }}
          />
        )}
        <OfflineBanner onRetry={refresh} />
        <div className="mx-auto w-full min-w-0 max-w-4xl flex-1 p-gutter lg:p-8">
          <RegionBoundary>
            <Outlet />
          </RegionBoundary>
        </div>
        {!desktop && <NavBar items={bottom} className="sticky bottom-0" />}
      </div>
      <ReauthDialog />
      <Toaster />
    </div>
  );
}
