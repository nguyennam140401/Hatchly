import { createBrowserRouter, type RouteObject } from 'react-router';
import { ForgotPasswordPage } from '../features/auth/ForgotPasswordPage';
import { LoginPage } from '../features/auth/LoginPage';
import { RegisterPage } from '../features/auth/RegisterPage';
import { ResetPasswordPage } from '../features/auth/ResetPasswordPage';
import { SecuritySettingsPage } from '../features/auth/SecuritySettingsPage';
import { StaffLoginPage } from '../features/auth/StaffLoginPage';
import { VerifyEmailPage } from '../features/auth/VerifyEmailPage';
import { DataDeletionStatusPage } from '../features/auth/DataDeletionStatusPage';
import { LoginMethodsPage } from '../features/auth/LoginMethodsPage';
import { NoAccountPage } from '../features/auth/NoAccountPage';
import { OAuthConfirmPage } from '../features/auth/OAuthConfirmPage';
import { OAuthResultPage } from '../features/auth/OAuthResultPage';
import { JoinPage } from '../features/members/JoinPage';
import { MembersPage } from '../features/members/MembersPage';
import { BusinessProfilePage } from '../features/context/BusinessProfilePage';
import { VersionDetailPage } from '../features/context/VersionDetailPage';
import { SessionGate } from './SessionGate';
import { StartPage } from './StartPage';

// Định tuyến của web (004). Trang công khai: đăng nhập, đăng ký, xác nhận email, quên/đặt lại mật
// khẩu, lối vào nội bộ. Mọi trang khác nằm sau cổng phiên.

export const appRoutes: RouteObject[] = [
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
  {
    element: <SessionGate />,
    children: [
      { path: '/', element: <StartPage /> },
      { path: '/settings/security', element: <SecuritySettingsPage /> },
      // 009: cách đăng nhập (mọi người, kể cả người ở tài khoản chờ); thành viên (chỉ chủ – trang tự
      // chặn theo quyền, API vẫn chặn); màn hình của người không thuộc tài khoản nào.
      { path: '/settings/login-methods', element: <LoginMethodsPage /> },
      { path: '/settings/members', element: <MembersPage /> },
      { path: '/no-account', element: <NoAccountPage /> },
      // 006: hồ sơ kinh doanh (quyền context.view; sửa khi có context.edit – API tự chặn).
      { path: '/business-profile', element: <BusinessProfilePage /> },
      { path: '/business-profile/versions/:versionId', element: <VersionDetailPage /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(appRoutes);
}
