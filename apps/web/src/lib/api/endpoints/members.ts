import { InvitationView, MembersResponse } from '@app/shared/auth';
import { apiClient } from '../client';

// Lời gọi API thành viên của chủ tài khoản (009, contracts/auth-http-api.md mục 3). Tài khoản luôn lấy
// từ phiên – web không bao giờ gửi mã tài khoản.

const M = '/api/v1/members';

export const membersApi = {
  list: () => apiClient.request('GET', M, { schema: MembersResponse }),
  invite: (email: string) =>
    apiClient.request('POST', `${M}/invitations`, { body: { email }, schema: InvitationView }),
  resend: (id: string) =>
    apiClient.request('POST', `${M}/invitations/${encodeURIComponent(id)}/resend`, {
      body: {},
      schema: InvitationView,
    }),
  cancel: (id: string) =>
    apiClient.request<undefined>('DELETE', `${M}/invitations/${encodeURIComponent(id)}`),
  remove: (userId: string) =>
    apiClient.request<undefined>('DELETE', `${M}/${encodeURIComponent(userId)}`),
};
