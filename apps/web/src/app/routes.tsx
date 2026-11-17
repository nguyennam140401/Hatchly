import { createBrowserRouter, type RouteObject } from 'react-router';
import { DataDeletionStatusPage } from '../features/auth/DataDeletionStatusPage';
import { ForgotPasswordPage } from '../features/auth/ForgotPasswordPage';
import { LoginPage } from '../features/auth/LoginPage';
import { NoAccountPage } from '../features/auth/NoAccountPage';
import { OAuthConfirmPage } from '../features/auth/OAuthConfirmPage';
import { OAuthResultPage } from '../features/auth/OAuthResultPage';
import { RegisterPage } from '../features/auth/RegisterPage';
import { ResetPasswordPage } from '../features/auth/ResetPasswordPage';
import { StaffLoginPage } from '../features/auth/StaffLoginPage';
import { VerifyEmailPage } from '../features/auth/VerifyEmailPage';
import { JoinPage } from '../features/members/JoinPage';
import { t } from '../lib/i18n/t';
import { ErrorPage, Forbidden, NotFound } from './errors/ErrorScreens';
import { SessionGate } from './SessionGate';
import { AppShell } from './shell/AppShell';
import { ComingSoon } from './shell/ComingSoon';
import { MorePage } from './shell/MorePage';
import { StartPage } from './StartPage';

// Định tuyến của web (004 → 011). Trang công khai: đăng nhập, đăng ký, xác nhận email, quên/đặt lại mật khẩu, lối vào
// nội bộ. Mọi trang khác nằm sau cổng phiên + khung ứng dụng. Nhóm tuyến trong khung tải lười (`lazy`) để gói khởi đầu nhỏ.

const comingSoon = (title: string) => <ComingSoon title={title} />;

/** Danh mục thành phần: chỉ khi chạy dev hoặc VITE_ENABLE_CATALOG=1; bản sản xuất mặc định không chứa mã này. */
const catalogRoutes: RouteObject[] =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_CATALOG === '1'
    ? [
        {
          path: '/_catalog/sample',
          lazy: async () => ({
            Component: (await import('../catalog/sample/SampleScreen')).SampleScreen,
          }),
        },
        {
          path: '/_catalog/*',
          lazy: async () => ({ Component: (await import('../catalog')).CatalogPage }),
        },
      ]
    : [];

export const appRoutes: RouteObject[] = [
  {
    errorElement: <ErrorPage />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/verify-email', element: <VerifyEmailPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
      { path: '/internal/login', element: <StaffLoginPage /> },
      // 009: kết quả đăng nhập Google/Facebook, liên kết trong thư, thư mời, trang trạng thái của Meta –
      // đều công khai (người mở chưa chắc đã đăng nhập).
      { path: '/oauth/result', element: <OAuthResultPage /> },
      { path: '/oauth/confirm', element: <OAuthConfirmPage /> },
      { path: '/join', element: <JoinPage /> },
      { path: '/data-deletion/:code', element: <DataDeletionStatusPage /> },
      ...catalogRoutes,
      // Khu vực nhân viên: gói riêng, không nằm trong gói khởi đầu của khách hàng.
      {
        path: '/internal/*',
        lazy: async () => ({ Component: (await import('../internal/InternalApp')).InternalApp }),
      },
      {
        element: <SessionGate />,
        children: [
          {
            element: <AppShell />,
            errorElement: <ErrorPage />,
            children: [
              { path: '/', element: <StartPage /> },
              // 012: Lịch tuần/tháng (tải lười).
              {
                path: '/calendar',
                lazy: async () => ({
                  Component: (await import('../features/calendar/CalendarPage')).CalendarPage,
                }),
              },
              // 012: danh sách Bài viết (tải lười).
              {
                path: '/posts',
                lazy: async () => ({
                  Component: (await import('../features/posts/PostsListPage')).PostsListPage,
                }),
              },
              // 012: soạn / xem bài (tải lười).
              {
                path: '/posts/new',
                lazy: async () => ({
                  Component: (await import('../features/posts/ComposePage')).ComposePage,
                }),
              },
              // 012: Chờ duyệt (chỉ chủ – trang tự chặn theo quyền, API vẫn chặn).
              {
                path: '/approvals',
                lazy: async () => ({
                  Component: (await import('../features/approvals/PendingPage')).PendingPage,
                }),
              },
              // 013: Tiến trình đăng của một bài (5 bước theo kênh).
              {
                path: '/posts/:id/progress',
                lazy: async () => ({
                  Component: (await import('../features/publish-progress/PublishProgressPage'))
                    .PublishProgressPage,
                }),
              },
              {
                path: '/posts/:id',
                lazy: async () => ({
                  Component: (await import('../features/posts/ComposePage')).ComposePage,
                }),
              },
              { path: '/media', element: comingSoon(t('nav.media')) },
              { path: '/channels', element: comingSoon(t('nav.channelsPlan')) },
              { path: '/settings', element: comingSoon(t('nav.settings')) },
              { path: '/more', element: <MorePage /> },
              {
                path: '/settings/security',
                lazy: async () => ({
                  Component: (await import('../features/auth/SecuritySettingsPage'))
                    .SecuritySettingsPage,
                }),
              },
              // 009: cách đăng nhập (mọi người, kể cả người ở tài khoản chờ); thành viên (chỉ chủ – trang tự
              // chặn theo quyền, API vẫn chặn); màn hình của người không thuộc tài khoản nào.
              {
                path: '/settings/login-methods',
                lazy: async () => ({
                  Component: (await import('../features/auth/LoginMethodsPage')).LoginMethodsPage,
                }),
              },
              {
                path: '/settings/members',
                lazy: async () => ({
                  Component: (await import('../features/members/MembersPage')).MembersPage,
                }),
              },
              { path: '/no-account', element: <NoAccountPage /> },
              // 006: hồ sơ kinh doanh (quyền context.view; sửa khi có context.edit – API tự chặn).
              {
                path: '/business-profile',
                lazy: async () => ({
                  Component: (await import('../features/context/BusinessProfilePage'))
                    .BusinessProfilePage,
                }),
              },
              {
                path: '/business-profile/versions/:versionId',
                lazy: async () => ({
                  Component: (await import('../features/context/VersionDetailPage'))
                    .VersionDetailPage,
                }),
              },
              { path: '/forbidden', element: <Forbidden /> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(appRoutes);
}
