import {
  CheckEmailResponse,
  DataDeletionStatusResponse,
  InvitationPreviewResponse,
  LoginMethodsResponse,
  MeResponse,
  MyInvitationsResponse,
  OAuthPendingResponse,
  OAuthSignupResponse,
  OAuthStartResponse,
  StaffMeResponse,
  type LoginInput,
  type RegisterInput,
} from '@app/shared/auth';
import { endLocalSession } from '../../session/clear-account-data';
import { apiClient } from '../client';

// Điểm cuối xác thực + đăng nhập qua Google/Facebook + lời mời (004, 009). Đường dẫn API CHỈ khai báo ở thư mục
// `endpoints/` (FR-029); phản hồi kiểm bằng lược đồ dùng chung; lỗi là `AppError`. Mã một lần luôn đi trong THÂN yêu cầu.

/** Tùy chọn đọc: chỉ cần hủy được lời gọi. */
export interface ReadOptions {
  signal?: AbortSignal;
  /** Không đưa 401 vào AuthGate (trang công khai tự xử lý). */
  silentAuth?: boolean;
}

const A = '/api/v1/auth';

export const authApi = {
  me: (o?: ReadOptions) => apiClient.request('GET', `${A}/me`, { ...o, schema: MeResponse }),
  register: (body: RegisterInput) =>
    apiClient.request('POST', `${A}/register`, { body, schema: CheckEmailResponse }),
  verifyEmail: (token: string) =>
    apiClient.request('POST', `${A}/email/verify`, {
      body: { token },
      schema: MeResponse,
      silentAuth: true,
    }),
  resend: (email?: string) =>
    apiClient.request('POST', `${A}/email/resend`, {
      body: email === undefined ? {} : { email },
      schema: CheckEmailResponse,
    }),
  changeEmail: (email: string) =>
    apiClient.request('PATCH', `${A}/email`, { body: { email }, schema: CheckEmailResponse }),
  login: (body: LoginInput) =>
    apiClient.request('POST', `${A}/login`, { body, schema: MeResponse, silentAuth: true }),
  logout: () => apiClient.request<undefined>('POST', `${A}/logout`).finally(endLocalSession),
  logoutAll: () => apiClient.request<undefined>('POST', `${A}/logout-all`).finally(endLocalSession),
  forgot: (email: string) =>
    apiClient.request('POST', `${A}/password/forgot`, {
      body: { email },
      schema: CheckEmailResponse,
    }),
  reset: (token: string, newPassword: string) =>
    apiClient.request('POST', `${A}/password/reset`, {
      body: { token, newPassword },
      schema: MeResponse,
      silentAuth: true,
    }),
  change: (currentPassword: string, newPassword: string) =>
    apiClient.request<undefined>('POST', `${A}/password/change`, {
      body: { currentPassword, newPassword },
    }),
  staffLogin: (body: LoginInput) =>
    apiClient.request('POST', '/api/v1/internal/auth/login', {
      body,
      schema: StaffMeResponse,
      silentAuth: true,
    }),
};

/**
 * Đích quay về sau đăng nhập: chỉ đường dẫn NỘI BỘ – bắt đầu bằng "/" nhưng không "//" hay "/\"
 * (chống chuyển hướng mở sang trang khác).
 */
export function safeNext(next: string | null | undefined): string {
  if (typeof next !== 'string' || next === '') return '/';
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  try {
    // Tên miền khác lọt qua dạng mã hóa → từ chối.
    const url = new URL(next, 'http://noi-bo.invalid');
    if (url.origin !== 'http://noi-bo.invalid') return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

/** Đọc mã một lần từ `#token=…` rồi XÓA khỏi thanh địa chỉ trước khi dùng (không lộ qua lịch sử). */
export function takeFragmentToken(): string | null {
  const match = /(?:^#|&)token=([A-Za-z0-9_-]+)/.exec(window.location.hash);
  if (window.location.hash !== '') {
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}`,
    );
  }
  return match?.[1] ?? null;
}

// ----- 009: Google/Facebook, cách đăng nhập, lời mời -----
const I = '/api/v1/invitations';

export type Provider = 'google' | 'facebook';
export const PROVIDER_LABELS: Record<Provider, string> = { google: 'Google', facebook: 'Facebook' };

/** Phiên bản điều khoản người dùng đang xem (máy chủ ghi phiên bản hiện hành của nó). */
export const TERMS_VERSION = '2026-11';
const terms = { acceptTerms: true as const, termsVersion: TERMS_VERSION };

export const socialApi = {
  // ----- Đăng nhập qua nhà cung cấp -----
  oauthStart: (provider: Provider) =>
    apiClient.request('POST', `${A}/oauth/${provider}/start`, {
      body: { purpose: 'login' },
      schema: OAuthStartResponse,
      silentAuth: true,
    }),
  oauthStartInvite: (provider: Provider, invitationToken: string) =>
    apiClient.request('POST', `${A}/oauth/${provider}/start`, {
      body: { purpose: 'invite', invitationToken, ...terms },
      schema: OAuthStartResponse,
      silentAuth: true,
    }),
  oauthPending: (o?: ReadOptions) =>
    apiClient.request('GET', `${A}/oauth/pending`, {
      ...o,
      schema: OAuthPendingResponse,
      silentAuth: true,
    }),
  oauthSignup: (body: { displayName: string; email?: string }) =>
    apiClient.request('POST', `${A}/oauth/signup`, {
      body: { ...body, ...terms },
      schema: OAuthSignupResponse,
      silentAuth: true,
    }),
  oauthLinkPassword: (password: string) =>
    apiClient.request('POST', `${A}/oauth/link/password`, {
      body: { password },
      schema: MeResponse,
      silentAuth: true,
    }),
  oauthLinkSendEmail: () =>
    apiClient.request('POST', `${A}/oauth/link/send-email`, {
      body: {},
      schema: CheckEmailResponse,
      silentAuth: true,
    }),
  oauthConfirm: (token: string) =>
    apiClient.request('POST', `${A}/oauth/confirm`, {
      body: { token },
      schema: MeResponse,
      silentAuth: true,
    }),

  // ----- Cách đăng nhập của tôi -----
  loginMethods: () =>
    apiClient.request('GET', `${A}/login-methods`, { schema: LoginMethodsResponse }),
  reauth: (password: string) =>
    apiClient.request<undefined>('POST', `${A}/reauth`, { body: { password }, silentAuth: true }),
  loginMethodStart: (provider: Provider, purpose: 'link' | 'reauth') =>
    apiClient.request('POST', `${A}/login-methods/${provider}/start`, {
      body: { purpose },
      schema: OAuthStartResponse,
    }),
  removeLoginMethod: (kind: 'password' | Provider) =>
    apiClient.request<undefined>('DELETE', `${A}/login-methods/${kind}`),
  requestPassword: () =>
    apiClient.request('POST', `${A}/login-methods/password/request`, {
      body: {},
      schema: CheckEmailResponse,
    }),

  // ----- Lời mời (phía người được mời) và tài khoản chờ -----
  invitationPreview: (token: string) =>
    apiClient.request('POST', `${I}/preview`, {
      body: { token },
      schema: InvitationPreviewResponse,
      silentAuth: true,
    }),
  invitationAccept: (body: { token: string; displayName: string; password: string }) =>
    apiClient.request('POST', `${I}/accept`, {
      body: { ...body, ...terms },
      schema: MeResponse,
      silentAuth: true,
    }),
  myInvitations: () => apiClient.request('GET', `${I}/mine`, { schema: MyInvitationsResponse }),
  acceptExistingInvitation: (body: { token: string } | { invitationId: string }) =>
    apiClient.request('POST', `${I}/accept-existing`, {
      body,
      schema: MeResponse,
      silentAuth: true,
    }),
  claimAccount: () =>
    apiClient.request('POST', '/api/v1/account/claim', { body: terms, schema: MeResponse }),

  // ----- Trang trạng thái công khai của yêu cầu xóa dữ liệu từ Meta -----
  dataDeletionStatus: (code: string) =>
    apiClient.request('GET', `/api/v1/public/data-deletion/${encodeURIComponent(code)}`, {
      schema: DataDeletionStatusResponse,
      silentAuth: true,
    }),
};

/** Chuyển trình duyệt sang nhà cung cấp (tách riêng để kiểm thử thay được). */
export const browser = {
  assign(url: string): void {
    window.location.assign(url);
  },
};
