import type { EmailBatch, NotificationType } from '@app/shared/notifications';
import type { MailDeliveryResult } from '../../../core';

// Kho thông báo đã gửi (005, data-model.md mục 3 "DeliveredNotification"). Bản giả lập: `fake/store.*.ts`
// (bảng sandbox.ntf_fake_*); bản thật WBS 4.3: `notifications.notifications`. Trong ngữ cảnh tenant.

export interface DeliveredNotification {
  id: string;
  accountId: string;
  type: NotificationType;
  dedupeKey: string;
  recipientUserId: string;
  channel: 'in_app' | 'email';
  emailBatch: EmailBatch | null;
  titleVi: string;
  bodyVi: string;
  actions: { kind: string; targetId?: string; labelVi: string; url: string }[];
  refs: Record<string, unknown>;
  createdAt: Date;
  emailResult: MailDeliveryResult['kind'] | null;
}

export type NewNotification = Omit<
  DeliveredNotification,
  'id' | 'accountId' | 'createdAt' | 'emailResult'
>;

export interface NotificationStore {
  /** Dòng sự kiện – `(account, dedupe_key)` duy nhất; false khi đã có. */
  insertEvent(e: {
    dedupeKey: string;
    type: NotificationType;
    refs: Record<string, unknown>;
  }): Promise<boolean>;
  /** Thêm thông báo (người nhận × kênh) nếu chưa có; trả dòng hiện có (để biết email đã gửi chưa). */
  ensureNotification(n: NewNotification): Promise<DeliveredNotification>;
  setEmailResult(id: string, result: MailDeliveryResult['kind']): Promise<void>;
  delivered(filter?: { type?: NotificationType }): Promise<DeliveredNotification[]>;
  events(): Promise<{ dedupeKey: string; type: NotificationType; refs: Record<string, unknown> }[]>;
  reset(): Promise<void>;
}
