/**
 * Giao diện công khai của module Cổng AI (`ai_gateway`) – giữ chỗ, chưa có thao tác.
 *
 * Trách nhiệm (ADD mục 6): Điểm duy nhất gọi nhà cung cấp AI/chuyển giọng nói: giữ chỗ ngân sách trước khi gọi, quyết toán sau khi gọi, chuyển mô hình rẻ ở 2 USD, chặn ở 4 USD, sổ chi phí micro-USD (nguyên tắc III).
 *
 * Module khác chỉ được dùng module này qua `index.ts` (quy tắc no-internal-cross-module) và chỉ khi
 * có `ai_gateway` trong `allowedDeps` của mình ở modules.manifest.json.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- giữ chỗ tới khi có thao tác đầu tiên
export interface AiGatewayPublicApi {}
