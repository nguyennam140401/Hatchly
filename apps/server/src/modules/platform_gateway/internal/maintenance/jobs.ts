// Loại việc nền của Cổng nền tảng (010 contracts/jobs-and-notifications.md mục 1, T058). Khai báo dùng ở cả API và Worker;
// bộ xử lý chỉ đăng ký ở Worker (platform_gateway.module.ts). Payload CHỈ có mã tham chiếu – không mã quyền, không tên Page,
// không `code` OAuth; `accountId` đi theo phong bì (không nằm trong payload).
// Lưu ý thử lại: hàng chờ `scheduled` có mặc định 0 lần thử lại (loại việc chỉ được ghi đè THẤP hơn) nên `check_connection`
// không tự thử lại trong ngày – kết nối chưa kiểm tra được vẫn "đến hạn" ở lần quét hằng ngày kế tiếp (last_checked_at
// không đổi, FR-012); lỗi tạm thời của nền tảng là kết quả `deferred`, không phải lỗi việc.
import { z } from 'zod';
import { defineJobType, defineSchedule } from '../../../queue';

/** Quét hằng ngày (03:00 UTC+7): liệt kê kết nối đến hạn rồi tạo `check_connection` theo từng kết nối. */
export const channelMaintenance = defineJobType({
  name: 'platform_gateway.channel_maintenance',
  queue: 'scheduled',
  scope: 'system',
  version: 1,
  payload: z.strictObject({}),
});

/** Kiểm tra/làm mới/nhắc hạn MỘT kết nối (chạy lại an toàn). */
export const checkConnection = defineJobType({
  name: 'platform_gateway.check_connection',
  queue: 'scheduled',
  scope: 'tenant',
  version: 1,
  payload: z.strictObject({ connectionId: z.uuid() }),
});

/** Dọn trạng thái OAuth/phiên chọn Page đã dùng hoặc hết hạn (hằng giờ). */
export const cleanupConnectData = defineJobType({
  name: 'platform_gateway.cleanup_connect_data',
  queue: 'scheduled',
  scope: 'system',
  version: 1,
  payload: z.strictObject({}),
});

/**
 * Ngắt MỌI kết nối của một tài khoản (luồng xóa tài khoản FR-14 – tính năng khác, chưa có; điểm nối ghi ở docs/wiki). Idempotent:
 * gọi lại ⇒ không còn gì để làm. Hàng chờ `scheduled` không tự thử lại; bên tạo việc (luồng xóa tài khoản) tạo lại với khóa
 * chống trùng `disconnect_all:{accountId}` cho tới khi hết kết nối.
 */
export const disconnectAll = defineJobType({
  name: 'platform_gateway.disconnect_all',
  queue: 'scheduled',
  scope: 'tenant',
  version: 1,
  payload: z.strictObject({}),
});

export const disconnectAllDedupeKey = (accountId: string): string => `disconnect_all:${accountId}`;

const yyyymmdd = (d: Date): string => d.toISOString().slice(0, 10).replaceAll('-', '');

/** Khóa chống trùng hằng ngày: mỗi kết nối chỉ một lần kiểm tra mỗi ngày UTC. */
export const checkDedupeKey = (connectionId: string, now: Date): string =>
  `check_connection:${connectionId}:${yyyymmdd(now)}`;

/** Khóa chống trùng khi kiểm tra lại do công tắc/gia hạn (`recheck_required`) – theo phiên bản bản ghi. */
export const recheckDedupeKey = (connectionId: string, version: number): string =>
  `check_connection:${connectionId}:recheck:${version}`;

let schedulesDefined = false;
/** Khai báo lịch định kỳ – gọi MỘT lần ở Worker trước khi QueueRuntime chạy. */
export function defineChannelSchedules(): void {
  if (schedulesDefined) return;
  schedulesDefined = true;
  // 20:00 UTC = 03:00 UTC+7 hằng ngày.
  defineSchedule({
    name: 'platform_gateway.channel_maintenance',
    cron: '0 20 * * *',
    tz: 'UTC',
    jobType: channelMaintenance,
  });
  defineSchedule({
    name: 'platform_gateway.cleanup_connect_data',
    cron: '15 * * * *',
    tz: 'UTC',
    jobType: cleanupConnectData,
  });
}
