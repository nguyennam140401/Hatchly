import { executionStorage } from '../context/execution-storage';
import { currentTx } from '../db/transaction';
import { TenantContextError } from '../db/errors';
import { uuidV7 } from '../ids/uuid-v7';

// HÀM HẠN CHẾ (004, research R4, contracts/authz-api.md mục 5): chạy `fn` trong ngữ cảnh thực thi CON
// có `accountId` để `tenantTx` dùng được, KHÔNG sửa ngữ cảnh yêu cầu gốc. `accountId` PHẢI đến từ
// CSDL sau khi danh tính đã được xác minh (mật khẩu, mã phiên, mã một lần) – không bao giờ từ đầu vào
// người dùng (nguyên tắc I). Quy tắc ranh giới `account-scope-restricted`: chỉ
// modules/account/internal/auth/** được nhập.

/**
 * Ném `TENANT_CONTEXT_CONFLICT` khi yêu cầu đã gắn một tài khoản khác, hoặc khi đang trong một giao
 * dịch (không đổi tài khoản giữa giao dịch).
 */
export function runInAccountScope<T>(accountId: string, fn: () => Promise<T>): Promise<T> {
  const parent = executionStorage.getStore();
  if (parent?.accountId !== undefined && parent.accountId !== accountId) {
    return Promise.reject(new TenantContextError('TENANT_CONTEXT_CONFLICT'));
  }
  if (currentTx() !== undefined) {
    return Promise.reject(new TenantContextError('TENANT_CONTEXT_CONFLICT'));
  }
  return executionStorage.run(
    {
      traceId: parent?.traceId ?? uuidV7(),
      source: parent?.source ?? 'system',
      accountId,
      ...(parent?.actor !== undefined ? { actor: parent.actor } : {}),
    },
    fn,
  );
}
