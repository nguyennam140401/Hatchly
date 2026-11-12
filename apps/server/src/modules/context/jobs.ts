// Loại việc của module Ngữ cảnh kinh doanh (006 contracts/context-public-api.md mục 2).
// Chưa xuất qua index.ts: chưa module nào khác tạo việc này.
import { z } from 'zod';
import { defineJobType } from '../queue';

/**
 * "Hồ sơ đã thay đổi" – tạo trong CÙNG tenantTx với lần lưu tạo phiên bản mới (FR-013a). Payload
 * chỉ có mã tham chiếu: không nội dung hồ sơ, không accountId (tài khoản đi theo phong bì việc).
 */
export const profileChanged = defineJobType({
  name: 'context.profile_changed',
  queue: 'ai_batch',
  scope: 'tenant',
  version: 1,
  payload: z.strictObject({ profileId: z.uuid(), version: z.int().min(1) }),
});

/** Khóa chống trùng: một việc cho mỗi phiên bản. */
export function profileChangedDedupeKey(profileId: string, version: number): string {
  return `profile:${profileId}:v${version}`;
}
