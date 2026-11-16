// Loại việc của module Đăng bài (012 contracts/module-api.md mục 4). Khai báo dùng ở cả API (tạo việc,
// trong giao dịch duyệt) và Worker (xử lý). Chưa xuất qua index.ts ngoài `runAttemptJobName`.
import { z } from 'zod';
import { defineJobType } from '../queue';

/**
 * "Chạy một lượt đăng" – tạo trong CÙNG giao dịch với duyệt + mục lịch đăng, `runAfter = scheduled_at`.
 * Payload CHỈ có mã tham chiếu (không nội dung bài, không accountId – tài khoản đi theo phong bì việc).
 * `allowGenericRetry: false`: hỗ trợ không chạy lại chung được – đăng lại có kiểm soát thuộc 013.
 * Hợp đồng ổn định mà 013 giữ nguyên: tên loại việc, payload `{ attemptId }`, `dedupeKey = publish:{attemptId}`.
 */
export const runAttemptJob = defineJobType({
  name: 'publishing.run_attempt',
  queue: 'publish',
  scope: 'tenant',
  version: 1,
  payload: z.strictObject({ attemptId: z.uuid() }),
  allowGenericRetry: false,
});

/** Khóa chống trùng: một việc cho mỗi mục lịch đăng. */
export function runAttemptDedupeKey(attemptId: string): string {
  return `publish:${attemptId}`;
}
