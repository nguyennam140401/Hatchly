import { currentAccountId, systemTx, tenantTx, type Db } from '../../../core';

/**
 * Đọc cấu hình dùng chung của Cổng AI (`model_prices`, `model_routes`, `task_fallback`, `ai_settings`) – vai trò
 * `app` được SELECT các bảng này. Có ngữ cảnh tài khoản → `tenantTx` (API và Worker); không có (việc hệ thống,
 * chỉ Worker) → `systemTx` không tenant. Mã tài khoản không bao giờ là tham số.
 */
export function readShared<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  return currentAccountId() !== null ? tenantTx(fn) : systemTx(fn, { tenant: 'none' });
}
