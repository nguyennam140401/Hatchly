/**
 * Giao diện công khai của module Ngữ cảnh kinh doanh (`context`) – giữ chỗ, chưa có thao tác.
 *
 * Trách nhiệm (ADD mục 6): Hồ sơ kinh doanh, sản phẩm/dịch vụ, giọng văn, đối tượng khách hàng – đầu vào cho tạo nội dung bằng AI.
 *
 * Module khác chỉ được dùng module này qua `index.ts` (quy tắc no-internal-cross-module) và chỉ khi
 * có `context` trong `allowedDeps` của mình ở modules.manifest.json.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- giữ chỗ tới khi có thao tác đầu tiên
export interface ContextPublicApi {}
