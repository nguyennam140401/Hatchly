import { NOTIFICATION_RULES, type NotificationEvent } from '@app/shared/notifications';
import type { ActiveMember } from '../../account';

// Người nhận theo quy tắc (005, R9): `owner` – chủ; `post_author` – người soạn bài (`refs.authorUserId`);
// `actor_target` – người yêu cầu (`refs.requestedByUserId`). Thành viên không còn hoạt động → bỏ qua.

export interface MembersDirectory {
  listActiveMembers(): Promise<ActiveMember[]>;
}

export async function resolveRecipients(
  event: NotificationEvent,
  members: MembersDirectory,
): Promise<ActiveMember[]> {
  const active = await members.listActiveMembers();
  const refs = event.refs as Record<string, unknown>;
  const out = new Map<string, ActiveMember>();
  for (const rule of NOTIFICATION_RULES[event.type].recipients) {
    const pick =
      rule === 'owner'
        ? active.filter((m) => m.role === 'owner')
        : rule === 'post_author'
          ? active.filter((m) => m.userId === refs.authorUserId)
          : active.filter((m) => m.userId === refs.requestedByUserId);
    for (const m of pick) out.set(m.userId, m);
  }
  return [...out.values()];
}
