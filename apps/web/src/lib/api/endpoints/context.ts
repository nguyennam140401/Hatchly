import {
  GetProfileResponse,
  SaveProfileResponse,
  VersionDetailResponse,
  VersionListResponse,
  type SaveProfileRequestInput,
} from '@app/shared/context';
import { apiClient } from '../client';

// Lời gọi API hồ sơ kinh doanh (006 contracts/context-http-api.md) – MẪU cho `features/<module>/`:
// mọi phản hồi kiểm bằng lược đồ dùng chung `@app/shared/<module>`; lỗi thành AppError (thông điệp +
// hành động của máy chủ). Không bao giờ gửi mã tài khoản – máy chủ lấy từ phiên.

const P = '/api/v1/context/profile';

export const contextApi = {
  getProfile: () => apiClient.request('GET', P, { schema: GetProfileResponse }),
  saveProfile: (body: SaveProfileRequestInput) =>
    apiClient.request('PUT', P, { body, schema: SaveProfileResponse }),
  listVersions: (page = 1) =>
    apiClient.request('GET', `${P}/versions?page=${page}`, { schema: VersionListResponse }),
  getVersion: (versionId: string) =>
    apiClient.request('GET', `${P}/versions/${encodeURIComponent(versionId)}`, {
      schema: VersionDetailResponse,
    }),
};
