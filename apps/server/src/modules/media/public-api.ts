/**
 * Giao diện công khai của module Thư viện media (`media`) – giữ chỗ, chưa có thao tác.
 *
 * Trách nhiệm (ADD mục 6): Tải ảnh/video thẳng lên kho tệp bằng đường dẫn ký sẵn (tenants/{mã}/), dấu tệp chống xử lý trùng, gán nhãn tự động (qua Cổng AI) và gán nhãn tay, dung lượng.
 *
 * Module khác chỉ được dùng module này qua `index.ts` (quy tắc no-internal-cross-module) và chỉ khi
 * có `media` trong `allowedDeps` của mình ở modules.manifest.json.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- giữ chỗ tới khi có thao tác đầu tiên
export interface MediaPublicApi {}
