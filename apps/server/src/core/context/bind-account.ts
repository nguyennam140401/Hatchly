import type { Actor } from './actor.types';
import { executionStorage } from './execution-storage';

// Hai đường DUY NHẤT đặt `accountId` vào ngữ cảnh thực thi (contracts/db-layer-api.md mục 3, FR-004).
// Chỉ core/auth/access.guard.ts (guard xác thực – 004), modules/queue (WBS 1.3), core/db và kiểm thử
// được nhập tệp này (quy tắc ranh giới `bind-account-restricted`). KHÔNG xuất qua core/index.ts.
// (`runInAccountScope` của core/auth tạo ngữ cảnh CON, không sửa ngữ cảnh yêu cầu – R4.)

/** Gắn người gọi đã xác thực vào yêu cầu hiện tại (AccessGuard, 004). */
export function bindActorToRequest(actor: Actor): void {
  const store = executionStorage.getStore();
  if (store?.source !== 'request') {
    throw new Error('bindActorToRequest chỉ gọi được bên trong một yêu cầu API');
  }
  store.actor = actor;
}

/**
 * Gắn tài khoản của phiên đăng nhập vào yêu cầu hiện tại. Gọi bởi guard xác thực – `accountId`
 * lấy từ phiên, không bao giờ từ tham số/thân yêu cầu.
 */
export function bindAccountToRequest(accountId: string): void {
  const store = executionStorage.getStore();
  if (store?.source !== 'request') {
    throw new Error('bindAccountToRequest chỉ gọi được bên trong một yêu cầu API');
  }
  if (store.accountId !== undefined && store.accountId !== accountId) {
    throw new Error('Yêu cầu đã được gắn với một tài khoản khác');
  }
  store.accountId = accountId;
}

/** Chạy `fn` trong ngữ cảnh của một việc nền (Worker đặt lại ngữ cảnh tenant từ dữ liệu việc). */
export function runWithJobContext<T>(
  ctx: { traceId: string; accountId?: string | undefined; jobId?: string | undefined },
  fn: () => Promise<T>,
): Promise<T> {
  return executionStorage.run(
    {
      traceId: ctx.traceId,
      source: 'job',
      ...(ctx.accountId !== undefined ? { accountId: ctx.accountId } : {}),
      ...(ctx.jobId !== undefined ? { jobId: ctx.jobId } : {}),
    },
    fn,
  );
}
