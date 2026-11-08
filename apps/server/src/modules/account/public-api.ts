/**
 * Giao diện công khai của module Tài khoản & Gói (`account`) – giữ chỗ, chưa có thao tác.
 *
 * Trách nhiệm (ADD mục 6): Đăng ký/đăng nhập (email, Google, Facebook), chủ tài khoản và tối đa 2 cộng tác viên, gói và chu kỳ, hạn mức (100 bài/chu kỳ, 5 GB), kích hoạt/gia hạn/tạm dừng gói bởi quản trị nội bộ.
 *
 * Module khác chỉ được dùng module này qua `index.ts` (quy tắc no-internal-cross-module) và chỉ khi
 * có `account` trong `allowedDeps` của mình ở modules.manifest.json.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- giữ chỗ tới khi có thao tác đầu tiên
export interface AccountPublicApi {}
