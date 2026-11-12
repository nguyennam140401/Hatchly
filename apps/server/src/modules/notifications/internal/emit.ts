import type { NotificationEvent } from '@app/shared/notifications';
import { currentAccountId, TenantContextError, type Db } from '../../../core';
import { enqueue } from '../../queue';
import { notifyDeliverJob } from '../jobs';
import type { NotificationsPublicApi } from '../public-api';
import { prepareEvent } from './prepare';

// `emit` bản thật (005, contracts/notifications.md mục 2): kiểm khuôn + trường bị cấm + dựng khóa, rồi tạo
// việc `notifications.deliver` TRONG giao dịch hiện tại (003 – `enqueue` ghi trên kết nối của giao dịch;
// ngoài giao dịch → QUEUE_TX_REQUIRED). Giao dịch hủy → không việc, không thông báo. Không biết gì về chế
// độ `memory` của bản giả lập.

export class QueueEmitter implements NotificationsPublicApi {
  async emit(
    _tx: Db,
    event: NotificationEvent,
  ): Promise<{ status: 'queued' | 'duplicate_pending' }> {
    const prepared = prepareEvent(event);
    const accountId = currentAccountId();
    if (accountId === null) throw new TenantContextError('TENANT_CONTEXT_MISSING');
    // Khóa chống trùng của hàng chờ là TOÀN hàng chờ (không theo tài khoản), còn khóa sự kiện theo tài
    // khoản (vd `ai_usage_80:{cycleStart}` trùng giữa hai tài khoản cùng chu kỳ) → phải gắn mã tài khoản,
    // nếu không tài khoản thứ hai bị QUEUE_DEDUPE_KEY_CONFLICT (việc của tenant kia bị RLS che).
    const r = await enqueue(
      notifyDeliverJob,
      { event: prepared.event },
      { dedupeKey: `notify:${accountId}:${prepared.dedupeKey}` },
    );
    return { status: r.status === 'created' ? 'queued' : 'duplicate_pending' };
  }
}
