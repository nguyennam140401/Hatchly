import {
  GetProfileResponse,
  SaveProfileResponse,
  VersionDetailResponse,
  VersionListResponse,
  type SaveProfileRequestInput,
} from '@app/shared/context';
import { apiRequest } from '../../lib/api-client';

// Lời gọi API hồ sơ kinh doanh (006 contracts/context-http-api.md) – MẪU cho `features/<module>/`:
// mọi phản hồi kiểm bằng lược đồ dùng chung `@app/shared/<module>`; lỗi thành ApiError (thông điệp +
// hành động của máy chủ). Không bao giờ gửi mã tài khoản – máy chủ lấy từ phiên.

const P = '/api/v1/context/profile';

export const contextApi = {
  getProfile: () => apiRequest('GET', P, { schema: GetProfileResponse }),
  saveProfile: (body: SaveProfileRequestInput) =>
    apiRequest('PUT', P, { body, schema: SaveProfileResponse }),
  listVersions: (page = 1) =>
    apiRequest('GET', `${P}/versions?page=${page}`, { schema: VersionListResponse }),
  getVersion: (versionId: string) =>
    apiRequest('GET', `${P}/versions/${encodeURIComponent(versionId)}`, {
      schema: VersionDetailResponse,
    }),
};

const VN_TIME = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hourCycle: 'h23',
});

/** Thời điểm UTC (ISO) → "HH:mm dd/MM/yyyy" giờ Việt Nam (UTC+7). */
export function formatVnTime(iso: string): string {
  const parts = Object.fromEntries(
    VN_TIME.formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return `${parts.hour ?? ''}:${parts.minute ?? ''} ${parts.day ?? ''}/${parts.month ?? ''}/${parts.year ?? ''}`;
}

/** Tên người lưu hiển thị. */
export function savedByLabel(savedBy: {
  displayName: string | null;
  memberStatus: string;
}): string {
  return savedBy.memberStatus === 'left' || savedBy.displayName === null
    ? 'Thành viên đã rời'
    : savedBy.displayName;
}
