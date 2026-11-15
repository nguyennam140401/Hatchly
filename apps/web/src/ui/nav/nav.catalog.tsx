import type { CatalogEntry } from '../catalog-types';
import type { NavItemView } from './nav-types';
import { NavBar } from './NavBar';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export const SIDEBAR_SAMPLE: NavItemView[] = [
  { id: 'overview', label: 'Tổng quan', icon: 'home', href: '/' },
  { id: 'calendar', label: 'Lịch đăng', icon: 'calendar', href: '/calendar' },
  { id: 'posts', label: 'Bài viết', icon: 'list', href: '/posts', badge: 3 },
  { id: 'media', label: 'Thư viện', icon: 'image', href: '/media' },
  { id: 'business-profile', label: 'Hồ sơ kinh doanh', icon: 'store', href: '/business-profile' },
  { id: 'channels-plan', label: 'Kênh & gói', icon: 'link', href: '/channels' },
  { id: 'settings', label: 'Cài đặt', icon: 'gear', href: '/settings' },
];

export const NAVBAR_SAMPLE: NavItemView[] = [
  { id: 'overview', label: 'Tổng quan', icon: 'home', href: '/' },
  { id: 'calendar', label: 'Lịch đăng', icon: 'calendar', href: '/calendar' },
  { id: 'create-post', label: 'Tạo bài', icon: 'plus', href: '/posts/new', featured: true },
  { id: 'posts', label: 'Bài viết', icon: 'list', href: '/posts', badge: 3 },
  { id: 'more', label: 'Thêm', icon: 'more', href: '/more' },
];

// Mục đang chọn do đường dẫn hiện tại quyết định: catalog dựng trong MemoryRouter ở đúng mục.
export const navCatalog: CatalogEntry = {
  name: 'Navigation',
  description: 'Thanh bên (7 mục), thanh dưới (5 ô, "Tạo bài" nổi bật), thanh trên (logo/quay lại).',
  a11yNotes: 'Mục hiện tại: aria-current="page" + chữ đậm; huy hiệu đếm có chữ số.',
  variants: [
    { label: 'Sidebar', render: () => <Sidebar items={SIDEBAR_SAMPLE} appName="Ứng dụng" /> },
    { label: 'NavBar', render: () => <NavBar items={NAVBAR_SAMPLE} /> },
    { label: 'TopBar – logo', render: () => <TopBar kind="logo" title="Tổng quan" /> },
    { label: 'TopBar – quay lại', render: () => <TopBar kind="back" title="Soạn bài" onBack={() => undefined} /> },
  ],
};
