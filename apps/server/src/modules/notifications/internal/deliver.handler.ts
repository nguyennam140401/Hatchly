import { NOTIFICATION_RULES } from '@app/shared/notifications';
import type { Mailer } from '../../../core';
import { withGatewayOp } from '../../../core/gateways/op-log';
import { prepareEvent } from './prepare';
import { resolveRecipients, type MembersDirectory } from './recipients';
import type { NotificationStore } from './store';
import { render } from './templates';

// Bộ xử lý việc `notifications.deliver` (005, contracts/notifications.md mục 4) – chạy trong ngữ cảnh tài
// khoản của việc. Idempotent: sự kiện + (người nhận × kênh) duy nhất trong CSDL; chạy lại chỉ gửi email
// chưa gửi. Email `transient` → ném để hàng chờ thử lại (chỉ phần email còn thiếu); `permanent` → ghi
// nhận, không thử lại. Gộp email 10 phút là việc của bản thật (WBS 4.3) – bản ghi giữ `emailBatch`.

export class EmailTransientError extends Error {
  constructor(readonly code: string) {
    super(`EMAIL_TRANSIENT:${code}`);
    this.name = 'EmailTransientError';
  }
}

export interface DeliverDeps {
  store: NotificationStore;
  members: MembersDirectory;
  mailer: Mailer;
  webBaseUrl: string;
}

export async function deliverNotification(raw: unknown, deps: DeliverDeps): Promise<void> {
  // Dữ liệu từ hàng chờ không được tin: kiểm lại khuôn + trường bị cấm.
  const { event, dedupeKey } = prepareEvent(raw);
  const attrs: Record<string, unknown> = { kind: event.type, event_type: event.type };
  await withGatewayOp('notifications', 'deliver', attrs, async () => {
    await deps.store.insertEvent({ dedupeKey, type: event.type, refs: event.refs as Record<string, unknown> });
    const rule = NOTIFICATION_RULES[event.type];
    const recipients = await resolveRecipients(event, deps.members);
    attrs.recipients = recipients.length;
    const rendered = render(event, deps.webBaseUrl);
    let transient: string | undefined;
    for (const member of recipients) {
      for (const channel of rule.channels) {
        const row = await deps.store.ensureNotification({
          type: event.type,
          dedupeKey,
          recipientUserId: member.userId,
          channel,
          emailBatch: channel === 'email' ? rule.emailBatch : null,
          titleVi: rendered.titleVi,
          bodyVi: rendered.bodyVi,
          actions: rendered.actions,
          refs: event.refs as Record<string, unknown>,
        });
        if (channel !== 'email' || row.emailResult === 'sent' || row.emailResult === 'permanent') continue;
        const links = rendered.actions.map((a) => `${a.labelVi}: ${a.url}`).join('\n');
        const result = await deps.mailer.deliver({
          to: member.email,
          subject: rendered.titleVi,
          text: `${rendered.bodyVi}\n\n${links}`,
          html: `<p>${rendered.bodyVi}</p>${rendered.actions.map((a) => `<p><a href="${a.url}">${a.labelVi}</a></p>`).join('')}`,
        });
        await deps.store.setEmailResult(row.id, result.kind);
        if (result.kind === 'transient') transient = result.code;
      }
    }
    if (transient !== undefined) throw new EmailTransientError(transient);
  });
}
