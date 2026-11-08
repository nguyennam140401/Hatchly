/**
 * Giao diện công khai của module Đăng bài (`publishing`) – giữ chỗ, chưa có thao tác.
 *
 * Trách nhiệm (ADD mục 6): Lượt đăng (tối đa một lượt hiệu lực cho mỗi cặp bài–kênh), hẹn giờ chung của hệ thống, 5 bước đăng, phân loại lỗi, đối soát, "Cần kiểm tra". Là module duy nhất được gọi Cổng nền tảng.
 *
 * Module khác chỉ được dùng module này qua `index.ts` (quy tắc no-internal-cross-module) và chỉ khi
 * có `publishing` trong `allowedDeps` của mình ở modules.manifest.json.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- giữ chỗ tới khi có thao tác đầu tiên
export interface PublishingPublicApi {}
