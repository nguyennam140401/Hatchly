import type { Db } from '../../../../core/db';
import type { NotificationsPublicApi } from '../../../notifications';

// Thông báo kênh (010 T062). Phát bằng `notifications.emit(tx, …)` TRONG giao dịch ghi trạng thái: giao dịch hủy thì
// không có thông báo (FR-042); khóa chống trùng do module Thông báo dựng từ `refs` (dedupe-keys.ts). Không có mã quyền,
// không số tiền, không nội dung bài trong sự kiện.

export type NeedsReconnectReason =
  'token_expired' | 'token_revoked' | 'scope_missing' | 'source_page_lost' | 'not_eligible';

/** Tên hiển thị ≤ 120 ký tự; nhiều kênh ⇒ "tên kênh đầu và N kênh khác" (gom một thông báo). */
export function groupedChannelName(names: readonly string[]): string {
  const first = names[0] ?? 'kênh';
  const label = names.length > 1 ? `${first} và ${names.length - 1} kênh khác` : first;
  return label.length > 120 ? `${label.slice(0, 119)}…` : label;
}

/** Ngày UTC `YYYY-MM-DD` – thành phần khóa chống trùng "một thông báo/ngày/lý do". */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export type TokenStage = 'd7' | 'd1' | 'expired';

/**
 * Nhắc hạn quyền (FR-020): mốc `d7 → d1 → expired`, GỘP các kênh cùng tài khoản cùng mốc thành MỘT thông báo
 * (`connectionIds` ≤ 10). Phát trong giao dịch ghi `last_notified_stage` – hủy giao dịch ⇒ không có thông báo.
 */
export async function emitTokenExpiring(
  notifications: NotificationsPublicApi,
  tx: Db,
  input: {
    connectionIds: readonly string[];
    channelNames: readonly string[];
    /** Ngày hết hạn theo lịch UTC+7 (`YYYY-MM-DD`). */
    expiresOn: string;
    stage: TokenStage;
    affectedPosts?: number | undefined;
  },
): Promise<void> {
  const [first, ...rest] = input.connectionIds;
  if (first === undefined) return;
  await notifications.emit(tx, {
    type: 'channel_token_expiring',
    refs: {
      connectionId: first,
      expiresOn: input.expiresOn,
      stage: input.stage,
      ...(rest.length > 0 ? { connectionIds: input.connectionIds.slice(0, 10) } : {}),
    },
    params: {
      channelDisplayName: groupedChannelName(input.channelNames),
      ...(input.affectedPosts !== undefined ? { affectedPosts: input.affectedPosts } : {}),
    },
  });
}

export async function emitNeedsReconnect(
  notifications: NotificationsPublicApi,
  tx: Db,
  input: {
    connectionIds: readonly string[];
    channelNames: readonly string[];
    reason: NeedsReconnectReason;
    affectedPosts?: number | undefined;
    now: Date;
  },
): Promise<void> {
  const [first, ...rest] = input.connectionIds;
  if (first === undefined) return;
  await notifications.emit(tx, {
    type: 'channel_needs_reconnect',
    refs: {
      connectionId: first,
      day: utcDay(input.now),
      reason: input.reason,
      ...(rest.length > 0 ? { connectionIds: input.connectionIds.slice(0, 10) } : {}),
    },
    params: {
      channelDisplayName: groupedChannelName(input.channelNames),
      ...(input.affectedPosts !== undefined ? { affectedPosts: input.affectedPosts } : {}),
    },
  });
}
