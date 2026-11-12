import type { NotificationType } from '@app/shared/notifications';
import { and, asc, eq } from 'drizzle-orm';
import { tenantTx, type MailDeliveryResult } from '../../../../core';
import { uuidV7 } from '../../../../core/ids/uuid-v7';
import { requireFakeAccount } from '../../../../dev/fake-components';
import { ntfFakeEvents, ntfFakeNotifications } from '../../../../dev/sandbox/schema';
import type { DeliveredNotification, NewNotification, NotificationStore } from '../store';

// Kho thông báo chế độ `sandbox` (005) – `INSERT … ON CONFLICT DO NOTHING` trên chỉ mục duy nhất quyết
// định chống trùng (chạy lại an toàn – nguyên tắc V). API và Worker thấy chung.

type Row = typeof ntfFakeNotifications.$inferSelect;

function toDelivered(r: Row): DeliveredNotification {
  return {
    id: r.id,
    accountId: r.account_id,
    type: r.type as NotificationType,
    dedupeKey: r.dedupe_key,
    recipientUserId: r.recipient_user_id,
    channel: r.channel,
    emailBatch: r.email_batch,
    titleVi: r.title_vi,
    bodyVi: r.body_vi,
    actions: r.actions as DeliveredNotification['actions'],
    refs: r.refs as Record<string, unknown>,
    createdAt: r.created_at,
    emailResult: r.email_result as DeliveredNotification['emailResult'],
  };
}

export class SandboxNotificationStore implements NotificationStore {
  async insertEvent(e: {
    dedupeKey: string;
    type: NotificationType;
    refs: Record<string, unknown>;
  }): Promise<boolean> {
    const accountId = requireFakeAccount();
    const rows = await tenantTx((db) =>
      db
        .insert(ntfFakeEvents)
        .values({
          id: uuidV7(),
          account_id: accountId,
          dedupe_key: e.dedupeKey,
          type: e.type,
          refs: e.refs,
        })
        .onConflictDoNothing({ target: [ntfFakeEvents.account_id, ntfFakeEvents.dedupe_key] })
        .returning({ id: ntfFakeEvents.id }),
    );
    return rows.length > 0;
  }

  ensureNotification(n: NewNotification): Promise<DeliveredNotification> {
    const accountId = requireFakeAccount();
    return tenantTx(async (db) => {
      await db
        .insert(ntfFakeNotifications)
        .values({
          id: uuidV7(),
          account_id: accountId,
          dedupe_key: n.dedupeKey,
          type: n.type,
          recipient_user_id: n.recipientUserId,
          channel: n.channel,
          email_batch: n.emailBatch,
          title_vi: n.titleVi,
          body_vi: n.bodyVi,
          actions: n.actions,
          refs: n.refs,
        })
        .onConflictDoNothing({
          target: [
            ntfFakeNotifications.account_id,
            ntfFakeNotifications.dedupe_key,
            ntfFakeNotifications.recipient_user_id,
            ntfFakeNotifications.channel,
          ],
        });
      const [row] = await db
        .select()
        .from(ntfFakeNotifications)
        .where(
          and(
            eq(ntfFakeNotifications.dedupe_key, n.dedupeKey),
            eq(ntfFakeNotifications.recipient_user_id, n.recipientUserId),
            eq(ntfFakeNotifications.channel, n.channel),
          ),
        )
        .limit(1);
      if (row === undefined) throw new Error('Không đọc lại được thông báo vừa ghi');
      return toDelivered(row);
    });
  }

  async setEmailResult(id: string, result: MailDeliveryResult['kind']): Promise<void> {
    await tenantTx((db) =>
      db
        .update(ntfFakeNotifications)
        .set({ email_result: result })
        .where(eq(ntfFakeNotifications.id, id)),
    );
  }

  async delivered(filter?: { type?: NotificationType }): Promise<DeliveredNotification[]> {
    const rows = await tenantTx((db) =>
      db
        .select()
        .from(ntfFakeNotifications)
        .where(filter?.type === undefined ? undefined : eq(ntfFakeNotifications.type, filter.type))
        .orderBy(asc(ntfFakeNotifications.created_at), asc(ntfFakeNotifications.id)),
    );
    return rows.map(toDelivered);
  }

  async events(): Promise<
    { dedupeKey: string; type: NotificationType; refs: Record<string, unknown> }[]
  > {
    const rows = await tenantTx((db) =>
      db.select().from(ntfFakeEvents).orderBy(asc(ntfFakeEvents.created_at)),
    );
    return rows.map((r) => ({
      dedupeKey: r.dedupe_key,
      type: r.type as NotificationType,
      refs: r.refs as Record<string, unknown>,
    }));
  }

  async reset(): Promise<void> {
    await tenantTx(async (db) => {
      await db.delete(ntfFakeNotifications);
      await db.delete(ntfFakeEvents);
    });
  }
}
