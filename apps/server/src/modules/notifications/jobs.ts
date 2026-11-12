import { NOTIFY_DELIVER_JOB, NotificationEventSchema } from '@app/shared/notifications';
import { z } from 'zod';
import { defineJobType } from '../queue';

// Loại việc `notifications.deliver` (005) trên hàng chờ `notify`, phạm vi tenant. Khuôn dữ liệu là khuôn sự
// kiện dùng chung – qua 3 lớp kiểm của 003 (không trường nội dung/bí mật, chuỗi có giới hạn). `account`
// tạo việc này bằng tên (`enqueueRegistered`) mà không phụ thuộc module Thông báo.
export const notifyDeliverJob = defineJobType({
  name: NOTIFY_DELIVER_JOB,
  queue: 'notify',
  scope: 'tenant',
  version: 1,
  payload: z.strictObject({ event: NotificationEventSchema }),
});
