// Kiểm tra sẵn sàng `queue` của Worker (research R16, FR-019): phiên bản schema pgboss đúng, lần lấy
// việc / heartbeat thành công gần nhất < 30 giây, không đang tắt. Dùng bởi `GET /readyz`.
import type { ReadinessCheck } from '../../../core';
import type { QueueRuntime } from './runtime/queue-runtime';

export function queueReadinessCheck(getRuntime: () => QueueRuntime | undefined): ReadinessCheck {
  return {
    name: 'queue',
    check: () => Promise.resolve(getRuntime()?.isReady() ?? false),
  };
}
