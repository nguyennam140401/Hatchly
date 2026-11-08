/**
 * Giao diện công khai của module Duyệt & lịch (`approval`) – giữ chỗ, chưa có thao tác.
 *
 * Trách nhiệm (ADD mục 6): Thao tác duyệt bài và xếp lịch của chủ tài khoản. Schema `approval` dành sẵn, để trống – trạng thái duyệt nằm trên `content`, giờ đăng nằm trên `publishing`; thêm bảng vào schema này cần đặc tả mới.
 *
 * Module khác chỉ được dùng module này qua `index.ts` (quy tắc no-internal-cross-module) và chỉ khi
 * có `approval` trong `allowedDeps` của mình ở modules.manifest.json.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- giữ chỗ tới khi có thao tác đầu tiên
export interface ApprovalPublicApi {}
