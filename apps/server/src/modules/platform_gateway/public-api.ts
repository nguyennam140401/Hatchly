/**
 * Giao diện công khai của module Cổng nền tảng (`platform_gateway`) – giữ chỗ, chưa có thao tác.
 *
 * Trách nhiệm (ADD mục 6): Kết nối kênh (Facebook Page, Instagram, Zalo OA), mã quyền truy cập mã hóa bằng KMS (chỉ module này giải mã), bộ chuyển đổi mỗi nền tảng sau giao diện chung (ADR-05).
 *
 * Module khác chỉ được dùng module này qua `index.ts` (quy tắc no-internal-cross-module) và chỉ khi
 * có `platform_gateway` trong `allowedDeps` của mình ở modules.manifest.json.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- giữ chỗ tới khi có thao tác đầu tiên
export interface PlatformGatewayPublicApi {}
