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
} from '@app/shared/auth';
import { apiRequest, type RequestOptions } from '../../lib/api-client';

// Lời gọi API của 009 phía người dùng (contracts/auth-http-api.md mục 1, 2, 4, 5, 6): đăng nhập qua
// Google/Facebook, cách đăng nhập, lời mời (phía người được mời), tài khoản chờ, trang trạng thái Meta.
// Mã một lần luôn đi trong THÂN yêu cầu – không bao giờ ở đường dẫn hay truy vấn.

const A = '/api/v1/auth';
const I = '/api/v1/invitations';

export type Provider = 'google' | 'facebook';
export const PROVIDER_LABELS: Record<Provider, string> = { google: 'Google', facebook: 'Facebook' };

/** Phiên bản điều khoản người dùng đang xem (máy chủ ghi phiên bản hiện hành của nó). */
export const TERMS_VERSION = '2026-11';
const terms = { acceptTerms: true as const, termsVersion: TERMS_VERSION };

export const socialApi = {
  // ----- Đăng nhập qua nhà cung cấp -----
  oauthStart: (provider: Provider) =>
    apiRequest('POST', `${A}/oauth/${provider}/start`, {
      body: { purpose: 'login' },
      schema: OAuthStartResponse,
      silentAuth: true,
    }),
  oauthStartInvite: (provider: Provider, invitationToken: string) =>
    apiRequest('POST', `${A}/oauth/${provider}/start`, {
      body: { purpose: 'invite', invitationToken, ...terms },
      schema: OAuthStartResponse,
      silentAuth: true,
    }),
  oauthPending: (o?: RequestOptions) =>
    apiRequest('GET', `${A}/oauth/pending`, {
      ...o,
      schema: OAuthPendingResponse,
      silentAuth: true,
    }),
  oauthSignup: (body: { displayName: string; email?: string }) =>
    apiRequest('POST', `${A}/oauth/signup`, {
      body: { ...body, ...terms },
      schema: OAuthSignupResponse,
      silentAuth: true,
    }),
  oauthLinkPassword: (password: string) =>
    apiRequest('POST', `${A}/oauth/link/password`, {
      body: { password },
      schema: MeResponse,
      silentAuth: true,
    }),
  oauthLinkSendEmail: () =>
    apiRequest('POST', `${A}/oauth/link/send-email`, {
      body: {},
      schema: CheckEmailResponse,
      silentAuth: true,
    }),
  oauthConfirm: (token: string) =>
    apiRequest('POST', `${A}/oauth/confirm`, {
      body: { token },
      schema: MeResponse,
      silentAuth: true,
    }),

  // ----- Cách đăng nhập của tôi -----
  loginMethods: () => apiRequest('GET', `${A}/login-methods`, { schema: LoginMethodsResponse }),
  reauth: (password: string) =>
    apiRequest<undefined>('POST', `${A}/reauth`, { body: { password }, silentAuth: true }),
  loginMethodStart: (provider: Provider, purpose: 'link' | 'reauth') =>
    apiRequest('POST', `${A}/login-methods/${provider}/start`, {
      body: { purpose },
      schema: OAuthStartResponse,
    }),
  removeLoginMethod: (kind: 'password' | Provider) =>
    apiRequest<undefined>('DELETE', `${A}/login-methods/${kind}`),
  requestPassword: () =>
    apiRequest('POST', `${A}/login-methods/password/request`, {
      body: {},
      schema: CheckEmailResponse,
    }),

  // ----- Lời mời (phía người được mời) và tài khoản chờ -----
  invitationPreview: (token: string) =>
    apiRequest('POST', `${I}/preview`, {
      body: { token },
      schema: InvitationPreviewResponse,
      silentAuth: true,
    }),
  invitationAccept: (body: { token: string; displayName: string; password: string }) =>
    apiRequest('POST', `${I}/accept`, {
      body: { ...body, ...terms },
      schema: MeResponse,
      silentAuth: true,
    }),
  myInvitations: () => apiRequest('GET', `${I}/mine`, { schema: MyInvitationsResponse }),
  acceptExistingInvitation: (body: { token: string } | { invitationId: string }) =>
    apiRequest('POST', `${I}/accept-existing`, { body, schema: MeResponse, silentAuth: true }),
  claimAccount: () =>
    apiRequest('POST', '/api/v1/account/claim', { body: terms, schema: MeResponse }),

  // ----- Trang trạng thái công khai của yêu cầu xóa dữ liệu từ Meta -----
  dataDeletionStatus: (code: string) =>
    apiRequest('GET', `/api/v1/public/data-deletion/${encodeURIComponent(code)}`, {
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
