// Đường công khai để một việc HỆ THỐNG (Worker, scope 'system') chạy một đoạn mã trong ngữ cảnh của MỘT tài khoản
// (vd phân bổ chi phí xu hướng cho từng tài khoản – 015 US7). Hiến pháp I, V: việc nền đặt lại ngữ cảnh tenant trước khi xử lý.
// Mã tài khoản PHẢI đến từ truy vấn hệ thống/giao diện công khai của module sở hữu, không từ đầu vào người dùng.
// Bên trong `fn` dùng `tenantTx` hoặc `systemTx(..., { tenant: 'from-context' })`; RLS vẫn áp dụng (WITH CHECK buộc khớp ngữ cảnh).
import { executionStorage } from '../../core/context/execution-storage';
import { runWithJobContext } from '../../core/context/bind-account';
import { TenantContextError } from '../../core/db/errors';
import { currentTx } from '../../core/db/transaction';

/**
 * Ném `TENANT_CONTEXT_CONFLICT` khi ngữ cảnh hiện tại đã gắn tài khoản khác hoặc đang trong một giao dịch
 * (không đổi tài khoản giữa giao dịch). Giữ mã theo dõi (`traceId`) của ngữ cảnh cha nếu có.
 */
export function runForAccount<T>(accountId: string, fn: () => Promise<T>): Promise<T> {
  const parent = executionStorage.getStore();
  // Hiến pháp I, V: chỉ việc nền (Worker, source 'job') được đặt lại ngữ cảnh tenant; luồng API/request
  // không được mượn hàm này để đặt tài khoản tùy ý. Đây là lỗi lập trình, không phải lỗi người dùng.
  if (parent?.source !== 'job') {
    return Promise.reject(new TenantContextError('TENANT_CONTEXT_FORBIDDEN'));
  }
  if (parent.accountId !== undefined && parent.accountId !== accountId) {
    return Promise.reject(new TenantContextError('TENANT_CONTEXT_CONFLICT'));
  }
  if (currentTx() !== undefined) {
    return Promise.reject(new TenantContextError('TENANT_CONTEXT_CONFLICT'));
  }
  return runWithJobContext(
    {
      traceId: parent.traceId,
      accountId,
      ...(parent.jobId !== undefined ? { jobId: parent.jobId } : {}),
    },
    fn,
  );
}
