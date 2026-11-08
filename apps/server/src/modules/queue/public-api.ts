/**
 * Giao diện công khai của module Hàng chờ (hạ tầng) (`queue`) – giữ chỗ, chưa có thao tác.
 *
 * Trách nhiệm (ADD mục 6): Hàng chờ bền vững pg-boss trong PostgreSQL (WBS 1.3): tách theo loại việc, giới hạn đồng thời theo tenant, ghi sự kiện cùng giao dịch. Module hạ tầng – KHÔNG phụ thuộc module nghiệp vụ nào (schema `infra`).
 *
 * Module khác chỉ được dùng module này qua `index.ts` (quy tắc no-internal-cross-module) và chỉ khi
 * có `queue` trong `allowedDeps` của mình ở modules.manifest.json.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- giữ chỗ tới khi có thao tác đầu tiên
export interface QueuePublicApi {}
