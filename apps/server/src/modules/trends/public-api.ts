/**
 * Giao diện công khai của module Xu hướng (`trends`) – giữ chỗ, chưa có thao tác.
 *
 * Trách nhiệm (ADD mục 6): Tổng hợp xu hướng theo tuần từ RSS báo chính thống + Brave Search API, tóm tắt qua Cổng AI. Không cào dữ liệu mạng xã hội.
 *
 * Module khác chỉ được dùng module này qua `index.ts` (quy tắc no-internal-cross-module) và chỉ khi
 * có `trends` trong `allowedDeps` của mình ở modules.manifest.json.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- giữ chỗ tới khi có thao tác đầu tiên
export interface TrendsPublicApi {}
