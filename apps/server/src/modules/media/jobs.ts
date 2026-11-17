// Loại việc của module Thư viện media (014 data-model.md mục 3). Khai báo dùng ở cả API (tạo việc trong cùng
// giao dịch) và Worker (xử lý). KHÔNG xuất qua index.ts: không module nào khác được tạo các việc này.
// Payload CHỈ có mã tham chiếu – không accountId (đi theo phong bì), không tên tệp (FR-023).
import { z } from 'zod';
import { defineJobType, defineSchedule } from '../queue';

/** Xử lý một media vừa tải xong: dấu tệp, chuẩn hóa JPEG, ảnh thu nhỏ, thời lượng video. Tạo cùng giao dịch với `complete`. */
export const processMedia = defineJobType({
  name: 'media.process',
  queue: 'media',
  scope: 'tenant',
  version: 1,
  payload: z.strictObject({ mediaId: z.uuid() }),
});

/** Xóa tệp thật (gốc, chuẩn hóa, thu nhỏ) sau khi media bị xóa mềm. Tạo cùng giao dịch với lần xóa. */
export const purgeMediaFiles = defineJobType({
  name: 'media.purge_files',
  queue: 'media',
  scope: 'tenant',
  version: 1,
  payload: z.strictObject({ mediaId: z.uuid() }),
});

/** Dọn dẹp một tài khoản: `stale` = phiên tải quá hạn; `full` = xóa hẳn > 30 ngày, tệp mồ côi, đối soát bộ đếm. */
export const cleanupMedia = defineJobType({
  name: 'media.cleanup',
  queue: 'media',
  scope: 'tenant',
  version: 1,
  payload: z.strictObject({ scope: z.enum(['stale', 'full']) }),
});

/** Quét định kỳ (việc hệ thống, payload rỗng): chỉ liệt kê tài khoản cần dọn rồi tạo `media.cleanup` theo từng tài khoản. */
export const sweepMedia = defineJobType({
  name: 'media.sweep',
  queue: 'scheduled',
  scope: 'system',
  version: 1,
  payload: z.strictObject({}),
});

/** Khóa chống trùng. */
export const processDedupeKey = (mediaId: string): string => `media_process:${mediaId}`;
export const purgeDedupeKey = (mediaId: string): string => `media_purge:${mediaId}`;
export const cleanupDedupeKey = (accountId: string, scope: 'stale' | 'full'): string =>
  `media_cleanup:${accountId}:${scope}`;

let schedulesDefined = false;
/** Khai báo lịch định kỳ – gọi MỘT lần ở Worker trước khi QueueRuntime chạy. */
export function defineMediaSchedules(): void {
  if (schedulesDefined) return;
  schedulesDefined = true;
  // Hằng giờ (phút 07, UTC): dọn phiên tải quá hạn + xóa tệp của media đã xóa mềm. Việc `full` mỗi Chủ nhật được
  // `sweep` tự quyết theo ngày trong tuần (một lịch, một loại việc – cùng dedupe theo tài khoản).
  defineSchedule({ name: 'media.sweep', cron: '7 * * * *', tz: 'UTC', jobType: sweepMedia });
}
