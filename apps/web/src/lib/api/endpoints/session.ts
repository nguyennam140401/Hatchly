import { MeResponse, type LoginInput } from '@app/shared/auth';
import { apiClient } from '../client';

// Điểm cuối phiên: đường dẫn API chỉ khai báo ở thư mục `endpoints/`.
const A = '/api/v1/auth';

export const sessionApi = {
  /** Mở ứng dụng / làm mới phiên: 401 ở đây KHÔNG vào AuthGate (cổng phiên tự chuyển /login). */
  me: (opts: { signal?: AbortSignal } = {}) =>
    apiClient.request('GET', `${A}/me`, { schema: MeResponse, silentAuth: true, ...opts }),
  /** Đăng nhập lại tại chỗ (hộp thoại hết phiên). */
  login: (body: LoginInput) =>
    apiClient.request('POST', `${A}/login`, { body, schema: MeResponse, silentAuth: true }),
  logout: () => apiClient.request<undefined>('POST', `${A}/logout`, { silentAuth: true }),
};
