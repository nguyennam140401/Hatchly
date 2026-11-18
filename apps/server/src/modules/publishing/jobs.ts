// Loại việc của module Đăng bài (012 contracts/module-api.md mục 4). Khai báo dùng ở cả API (tạo việc,
// trong giao dịch duyệt) và Worker (xử lý). Chưa xuất qua index.ts ngoài `runAttemptJobName`.
import { z } from 'zod';
import { defineJobType, defineSchedule, registerPartitionedLog } from '../queue';

// Nhật ký 5 bước (013): phân vùng theo tháng, tạo trước 2 tháng, giữ 12 tháng (Hiến pháp VII).
registerPartitionedLog({
  table: 'publishing.publish_steps',
  ensureFunction: 'publishing.ensure_publish_steps_partitions',
  monthsAhead: 2,
  retentionMonths: 12,
  dropFunction: 'publishing.drop_publish_steps_partitions_before',
});

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

/**
 * Quét định kỳ mỗi phút (013 R14): CHỈ phát hiện và cảnh báo (lượt `scheduled` quá giờ > 5 phút chưa được lấy, số lượt
 * `unknown`/"Cần kiểm tra"); KHÔNG đổi trạng thái, KHÔNG gửi bài. Việc hệ thống, payload rỗng.
 */
export const sweepOverdueJob = defineJobType({
  name: 'publishing.sweep_overdue',
  queue: 'scheduled',
  scope: 'system',
  version: 1,
  payload: z.strictObject({}),
});

let schedulesDefined = false;
/** Khai báo lịch định kỳ – gọi MỘT lần ở Worker trước khi QueueRuntime chạy. */
export function definePublishingSchedules(): void {
  if (schedulesDefined) return;
  schedulesDefined = true;
  defineSchedule({
    name: 'publishing.sweep_overdue',
    cron: '* * * * *',
    tz: 'UTC',
    jobType: sweepOverdueJob,
  });
}

/** Khóa chống trùng: một việc cho mỗi mục lịch đăng. */
export function runAttemptDedupeKey(attemptId: string): string {
  return `publish:${attemptId}`;
}
