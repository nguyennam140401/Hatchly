import type { NotificationEvent } from '@app/shared/notifications';
import type { Db } from '../../../../core';
import { requireFakeAccount } from '../../../../dev/fake-components';
import { isMemoryTx } from '../../../../dev/memory-tx';
import type { NotificationsPublicApi } from '../../public-api';
import { NotificationEventInvalidError } from '../forbidden';
import { prepareEvent } from '../prepare';

// `emit` chế độ `memory` (005, research R9b): nhận `memoryTx()` (tx khác → ném), kiểm y như bản thật
// (`prepareEvent`), đưa vào hàng chờ trong bộ nhớ theo tài khoản. Không có Worker: `flush()` chạy bộ xử lý.
// Khóa `notify:` đang chờ → `duplicate_pending`.

export interface PendingNotify {
  accountId: string;
  key: string;
  event: NotificationEvent;
}

export class MemoryEmitter implements NotificationsPublicApi {
  private readonly pending: PendingNotify[] = [];

  emit(tx: Db, event: NotificationEvent): Promise<{ status: 'queued' | 'duplicate_pending' }> {
    try {
      if (!isMemoryTx(tx)) throw new NotificationEventInvalidError('tx');
      const prepared = prepareEvent(event);
      const accountId = requireFakeAccount();
      const key = `notify:${prepared.dedupeKey}`;
      if (this.pending.some((p) => p.accountId === accountId && p.key === key)) {
        return Promise.resolve({ status: 'duplicate_pending' });
      }
      this.pending.push({ accountId, key, event: prepared.event });
      return Promise.resolve({ status: 'queued' });
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** Lấy và xóa các việc đang chờ của tài khoản trong ngữ cảnh. */
  drain(): PendingNotify[] {
    const accountId = requireFakeAccount();
    const mine = this.pending.filter((p) => p.accountId === accountId);
    for (const p of mine) this.pending.splice(this.pending.indexOf(p), 1);
    return mine;
  }

  /** Số việc đang chờ của tài khoản trong ngữ cảnh. */
  pendingCount(): number {
    const accountId = requireFakeAccount();
    return this.pending.filter((p) => p.accountId === accountId).length;
  }
}
