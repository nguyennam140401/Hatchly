import type { NotificationEvent } from '@app/shared/notifications';
import type { Db } from '../../../src/core';
import { MemoryMailTransport } from '../../../src/core/mail/memory.transport';
import type { ActiveMember } from '../../../src/modules/account';
import type { NotificationsPublicApi } from '../../../src/modules/notifications';
import type { DeliverDeps } from '../../../src/modules/notifications/internal/deliver.handler';
import type { DeliveredNotification, NotificationStore } from '../../../src/modules/notifications/internal/store';

// Harness của bộ kiểm thử hợp đồng Thông báo (005, R9b) – giống nhau ở `memory` và `sandbox`: phát →
// `flush()` → khẳng định. Bản thật WBS 4.3 cung cấp harness của mình.

export interface NotifyAccount {
  accountId: string;
  owner: ActiveMember;
  collaborator: ActiveMember;
}

export interface NotifyHarness {
  mode: 'memory' | 'sandbox';
  /** Có giao dịch CSDL thật (kiểm được "giao dịch hủy → không thông báo"). */
  hasRealTx: boolean;
  newAccount(): Promise<NotifyAccount>;
  inAccount<T>(accountId: string, fn: () => Promise<T>): Promise<T>;
  /** Chạy `fn` trong giao dịch nghiệp vụ (memory: memoryTx; sandbox: tenantTx thật). */
  tx<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  notifications: NotificationsPublicApi;
  flush(): Promise<void>;
  removeMember(userId: string): Promise<void>;
  store: NotificationStore;
  deps: Omit<DeliverDeps, 'store'>;
  mail: MemoryMailTransport;
  /** Số việc `notifications.deliver` đang chờ của tài khoản trong ngữ cảnh. */
  pendingJobs(): Promise<number>;
}

export type { DeliveredNotification, NotificationEvent };
