import type { NotificationType } from '@app/shared/notifications';
import type { FakeStateStore } from '../../../../dev/fake-components';
import { deliverNotification, type DeliverDeps } from '../deliver.handler';
import type { DeliveredNotification, NotificationStore } from '../store';
import { MemoryEmitter } from './memory-emitter';
import { MemoryNotificationStore } from './store.memory';

// Lối vào bản giả lập Thông báo (005) – kho theo chế độ, bộ phát bộ nhớ, API lập trình `fakeNotify`.
// CHỈ development/test.

let memoryStore: MemoryNotificationStore | undefined;
let sandboxStore: Promise<NotificationStore> | undefined;
let memoryEmitter: MemoryEmitter | undefined;

export function getNotificationStore(mode: FakeStateStore): Promise<NotificationStore> {
  if (mode === 'memory') return Promise.resolve((memoryStore ??= new MemoryNotificationStore()));
  sandboxStore ??= import('./store.sandbox.js').then((m) => new m.SandboxNotificationStore());
  return sandboxStore;
}

export function getMemoryEmitter(): MemoryEmitter {
  return (memoryEmitter ??= new MemoryEmitter());
}

export interface FakeNotifyControl {
  delivered(filter?: { type?: NotificationType }): Promise<DeliveredNotification[]>;
  events(): ReturnType<NotificationStore['events']>;
  /** memory: chạy bộ xử lý cho các sự kiện đang chờ của tài khoản trong ngữ cảnh. */
  flush(): Promise<void>;
  reset(): Promise<void>;
}

export function fakeNotify(
  store: NotificationStore,
  deps: Omit<DeliverDeps, 'store'>,
): FakeNotifyControl {
  return {
    delivered: (f) => store.delivered(f),
    events: () => store.events(),
    async flush() {
      for (const p of getMemoryEmitter().drain()) {
        // Như hàng chờ: email tạm lỗi → thử lại (tối đa 5 lần như hàng chờ `notify`).
        for (let attempt = 1; ; attempt++) {
          try {
            await deliverNotification({ ...p.event }, { ...deps, store });
            break;
          } catch (err) {
            if ((err as Error).name !== 'EmailTransientError' || attempt >= 6) throw err;
          }
        }
      }
    },
    reset: () => store.reset(),
  };
}

export { FakeAccountMembers } from './fake-members';
export { MemoryEmitter } from './memory-emitter';
