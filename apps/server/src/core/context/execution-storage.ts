import { AsyncLocalStorage } from 'node:async_hooks';

// Kho ngữ cảnh thực thi dùng chung giữa request-context.ts và bind-account.ts. Nhập bị giới hạn bởi
// quy tắc ranh giới `bind-account-restricted` – module nghiệp vụ KHÔNG có đường ghi `accountId`.

export type ExecutionSource = 'request' | 'job' | 'system';

/** Bản ghi có thể ghi của ngữ cảnh – chỉ bind-account.ts được đặt `accountId`. */
export interface MutableExecutionContext {
  traceId: string;
  accountId?: string;
  source: ExecutionSource;
}

export const executionStorage = new AsyncLocalStorage<MutableExecutionContext>();
