// Giao diện công khai DUY NHẤT của module Hàng chờ (hạ tầng) – contracts/queue-api.md.
// KHÔNG xuất kiểu hay đối tượng nào của pg-boss (FR-002).

// Mục 1 – khai báo loại việc (API + Worker).
export { defineJobType, type DefineJobTypeInput } from './job-types';
export * from './public-api';
// Mục 2–3 – tạo / hủy / đổi giờ việc trong giao dịch.
export { cancelJob, enqueue, enqueueMany, rescheduleJob } from './internal/producer';
export { enqueueForAccount } from './enqueue-for-account';
export { runForAccount } from './run-for-account';
// Mục 4 – bộ xử lý (chỉ Worker).
export { registerJobHandler } from './internal/handlers';
export { noRetry, PermanentJobError, retryAfter } from './results';
// Mục 5 – việc định kỳ.
export { defineSchedule, registerPartitionedLog } from './schedules';
// Mục 6 – việc hỏng (màn hình hỗ trợ WBS 4.7, chỉ API).
export { getDeadJob, requestDeadJobRetry, searchDeadJobs } from './internal/dead-jobs';
// Mục 7 – xóa mọi việc của tài khoản (luồng xóa tài khoản, Worker).
export { purgeAccountJobs } from './internal/purge';
// Tầng ghép (app/, worker.ts): module NestJS + vòng đời.
export { QueueLifecycle, QueueModule } from './queue.module';
