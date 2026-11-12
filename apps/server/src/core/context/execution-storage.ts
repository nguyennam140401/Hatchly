import { AsyncLocalStorage } from 'node:async_hooks';
import type { Actor } from './actor.types';

// Kho ngữ cảnh thực thi dùng chung giữa request-context.ts và bind-account.ts. Nhập bị giới hạn bởi
// quy tắc ranh giới `bind-account-restricted` – module nghiệp vụ KHÔNG có đường ghi `accountId`.

export type ExecutionSource = 'request' | 'job' | 'system';

/** Bản ghi có thể ghi của ngữ cảnh – chỉ bind-account.ts (và runInAccountScope) đặt `accountId`. */
export interface MutableExecutionContext {
  traceId: string;
  accountId?: string;
  source: ExecutionSource;
  /** Mã việc nền đang chạy (005 – tệp tạm `tenants/{acc}/tmp/{jobId}/…`); chỉ hàng chờ đặt. */
  jobId?: string;
  /** Người gọi đã xác thực (004) – chỉ AccessGuard đặt qua bind-account.ts. */
  actor?: Actor;
}

export const executionStorage = new AsyncLocalStorage<MutableExecutionContext>();
