import type { NotificationType } from '@app/shared/notifications';
import type { MailDeliveryResult } from '../../../../core';
import { uuidV7 } from '../../../../core/ids/uuid-v7';
import { requireFakeAccount } from '../../../../dev/fake-components';
import { syncPromise } from '../../../../dev/scenarios';
import type { DeliveredNotification, NewNotification, NotificationStore } from '../store';

// Kho thông báo chế độ `memory` (005) – theo tài khoản của ngữ cảnh.

interface State {
  events: Map<string, { dedupeKey: string; type: NotificationType; refs: Record<string, unknown> }>;
  notifications: DeliveredNotification[];
}

export class MemoryNotificationStore implements NotificationStore {
  private readonly accounts = new Map<string, State>();

  private state(): { accountId: string; s: State } {
    const accountId = requireFakeAccount();
    let s = this.accounts.get(accountId);
    if (s === undefined) {
      s = { events: new Map(), notifications: [] };
      this.accounts.set(accountId, s);
    }
    return { accountId, s };
  }

  insertEvent(e: {
    dedupeKey: string;
    type: NotificationType;
    refs: Record<string, unknown>;
  }): Promise<boolean> {
    return syncPromise(() => {
      const { s } = this.state();
      if (s.events.has(e.dedupeKey)) return false;
      s.events.set(e.dedupeKey, structuredClone(e));
      return true;
    });
  }

  ensureNotification(n: NewNotification): Promise<DeliveredNotification> {
    return syncPromise(() => {
      const { accountId, s } = this.state();
      const existing = s.notifications.find(
        (x) =>
          x.dedupeKey === n.dedupeKey &&
          x.recipientUserId === n.recipientUserId &&
          x.channel === n.channel,
      );
      if (existing !== undefined) return structuredClone(existing);
      const row: DeliveredNotification = {
        ...structuredClone(n),
        id: uuidV7(),
        accountId,
        createdAt: new Date(),
        emailResult: null,
      };
      s.notifications.push(row);
      return structuredClone(row);
    });
  }

  setEmailResult(id: string, result: MailDeliveryResult['kind']): Promise<void> {
    return syncPromise(() => {
      const row = this.state().s.notifications.find((x) => x.id === id);
      if (row !== undefined) row.emailResult = result;
    });
  }

  delivered(filter?: { type?: NotificationType }): Promise<DeliveredNotification[]> {
    return syncPromise(() =>
      this.state()
        .s.notifications.filter((n) => filter?.type === undefined || n.type === filter.type)
        .map((n) => structuredClone(n)),
    );
  }

  events(): Promise<
    { dedupeKey: string; type: NotificationType; refs: Record<string, unknown> }[]
  > {
    return syncPromise(() => [...this.state().s.events.values()].map((e) => structuredClone(e)));
  }

  reset(): Promise<void> {
    return syncPromise(() => {
      this.accounts.delete(requireFakeAccount());
    });
  }
}
