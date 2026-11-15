import { InvitationView, MembersResponse } from '@app/shared/auth';
import { apiRequest } from '../../lib/api-client';

// Lời gọi API thành viên của chủ tài khoản (009, contracts/auth-http-api.md mục 3). Tài khoản luôn lấy
// từ phiên – web không bao giờ gửi mã tài khoản.

const M = '/api/v1/members';

export const membersApi = {
  list: () => apiRequest('GET', M, { schema: MembersResponse }),
  invite: (email: string) =>
    apiRequest('POST', `${M}/invitations`, { body: { email }, schema: InvitationView }),
  resend: (id: string) =>
    apiRequest('POST', `${M}/invitations/${encodeURIComponent(id)}/resend`, {
      body: {},
      schema: InvitationView,
    }),
  cancel: (id: string) =>
    apiRequest<undefined>('DELETE', `${M}/invitations/${encodeURIComponent(id)}`),
  remove: (userId: string) => apiRequest<undefined>('DELETE', `${M}/${encodeURIComponent(userId)}`),
};
