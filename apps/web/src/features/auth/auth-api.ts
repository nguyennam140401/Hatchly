import {
  CheckEmailResponse,
  MeResponse,
  StaffMeResponse,
  type LoginInput,
  type RegisterInput,
} from '@app/shared/auth';
import { apiRequest, type RequestOptions } from '../../lib/api-client';

// Lời gọi API xác thực (contracts/auth-http-api.md). Phản hồi kiểm bằng lược đồ dùng chung.

const A = '/api/v1/auth';

export const authApi = {
  me: (o?: RequestOptions) => apiRequest('GET', `${A}/me`, { ...o, schema: MeResponse }),
  register: (body: RegisterInput) =>
    apiRequest('POST', `${A}/register`, { body, schema: CheckEmailResponse }),
  verifyEmail: (token: string) =>
    apiRequest('POST', `${A}/email/verify`, {
      body: { token },
      schema: MeResponse,
      silentAuth: true,
    }),
  resend: (email?: string) =>
    apiRequest('POST', `${A}/email/resend`, {
      body: email === undefined ? {} : { email },
      schema: CheckEmailResponse,
    }),
  changeEmail: (email: string) =>
    apiRequest('PATCH', `${A}/email`, { body: { email }, schema: CheckEmailResponse }),
  login: (body: LoginInput) =>
    apiRequest('POST', `${A}/login`, { body, schema: MeResponse, silentAuth: true }),
  logout: () => apiRequest<undefined>('POST', `${A}/logout`),
  logoutAll: () => apiRequest<undefined>('POST', `${A}/logout-all`),
  forgot: (email: string) =>
    apiRequest('POST', `${A}/password/forgot`, { body: { email }, schema: CheckEmailResponse }),
  reset: (token: string, newPassword: string) =>
    apiRequest('POST', `${A}/password/reset`, {
      body: { token, newPassword },
      schema: MeResponse,
      silentAuth: true,
    }),
  change: (currentPassword: string, newPassword: string) =>
    apiRequest<undefined>('POST', `${A}/password/change`, {
      body: { currentPassword, newPassword },
    }),
  staffLogin: (body: LoginInput) =>
    apiRequest('POST', '/api/v1/internal/auth/login', {
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
