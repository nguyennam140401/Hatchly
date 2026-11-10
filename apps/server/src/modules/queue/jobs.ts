// Loại việc + lịch nội bộ của module `queue` (data-model mục 8). Đều là việc hệ thống trên hàng chờ
// `scheduled`; bộ xử lý đăng ký bởi InternalJobsService khi Worker khởi động.
import { z } from 'zod';
import { defineJobType } from './job-types';
import { defineSchedule } from './schedules';

const empty = z.strictObject({});

const internalJob = (name: string) =>
  defineJobType({ name, queue: 'scheduled', scope: 'system', version: 1, payload: empty });

/** Dọn việc hỏng > 90 ngày và khung lịch > 90 ngày (việc xong > 30 ngày do pg-boss tự dọn). */
export const cleanupJob = internalJob('queue.cleanup');
/** Tạo trước phân vùng nhật ký theo tháng; bỏ phân vùng quá thời gian giữ. */
export const partitionsJob = internalJob('queue.partitions');
/** Chôn việc pg-boss `failed` (Worker chết hết lượt) + gọi lại onFinalFailure chưa thành công (R8). */
export const sweepFailedJob = internalJob('queue.sweep_failed');
/** Thực hiện yêu cầu chạy lại việc hỏng của hỗ trợ (R14). */
export const deadJobRetriesJob = internalJob('queue.dead_job_retries');

export const INTERNAL_SCHEDULES = [
  defineSchedule({ name: 'queue.cleanup', cron: '30 3 * * *', jobType: cleanupJob }),
  defineSchedule({ name: 'queue.partitions', cron: '0 4 1 * *', jobType: partitionsJob }),
  defineSchedule({ name: 'queue.sweep_failed', cron: '* * * * *', jobType: sweepFailedJob }),
  defineSchedule({ name: 'queue.dead_job_retries', cron: '* * * * *', jobType: deadJobRetriesJob }),
];

/** Số ngày giữ việc hỏng và khung lịch (FR-029). */
export const DEAD_JOB_RETENTION_DAYS = 90;
