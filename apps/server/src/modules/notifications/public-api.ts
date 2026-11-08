/**
 * Giao diện công khai của module Thông báo (`notifications`) – giữ chỗ, chưa có thao tác.
 *
 * Trách nhiệm (ADD mục 6): Thông báo trong ứng dụng và email (SMTP) kèm cách khắc phục; nhắc quyền truy cập sắp hết hạn.
 *
 * Module khác chỉ được dùng module này qua `index.ts` (quy tắc no-internal-cross-module) và chỉ khi
 * có `notifications` trong `allowedDeps` của mình ở modules.manifest.json.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- giữ chỗ tới khi có thao tác đầu tiên
export interface NotificationsPublicApi {}
