/**
 * Giao diện công khai của module Nội dung (`content`) – giữ chỗ, chưa có thao tác.
 *
 * Trách nhiệm (ADD mục 6): Kế hoạch nội dung, bài và phiên bản theo kênh, bản nháp AI, trạng thái duyệt (Chờ duyệt / Đã duyệt), số lần tạo lại, cột phiên bản chống ghi đè.
 *
 * Module khác chỉ được dùng module này qua `index.ts` (quy tắc no-internal-cross-module) và chỉ khi
 * có `content` trong `allowedDeps` của mình ở modules.manifest.json.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- giữ chỗ tới khi có thao tác đầu tiên
export interface ContentPublicApi {}
