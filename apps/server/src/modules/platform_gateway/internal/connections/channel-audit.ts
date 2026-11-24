import { getExecutionContext } from '../../../../core';
import { currentAccountId, tenantTx } from '../../../../core/db';
import { auditLog } from '../../../../core/db/audit-log.log-table';

// Kiểm toán thao tác kênh (010 FR-030, T035). `metadata` CHỈ gồm { connection_id, channel_type, result, reason_code,
// trace_id } – KHÔNG mã quyền, KHÔNG tên Page, KHÔNG tham số URL. Ghi để truy vết; lỗi ghi KHÔNG làm hỏng thao tác của
// khách (nhật ký kỹ thuật tách riêng, luôn có trace_id + account_id).

export const CHANNEL_AUDIT_ACTIONS = [
  'channel.connect',
  'channel.connect_failed',
  'channel.reconnect',
  'channel.recheck',
  'channel.disconnect',
  'channel.state_changed',
] as const;
export type ChannelAuditAction = (typeof CHANNEL_AUDIT_ACTIONS)[number];

export interface ChannelAuditEntry {
  action: ChannelAuditAction;
  connectionId?: string | null;
  channelType?: string | null;
  /** Kết quả dạng máy đọc (vd `created`, `ok`, `changed`, `STATE_INVALID`). */
  result: string;
  reasonCode?: string | null;
  /** Chủ thể: người dùng (mặc định lấy từ phiên) hoặc hệ thống (việc nền). */
  actor?: { type: 'user' | 'system'; id: string };
}

export type ChannelAuditSink = (entry: ChannelAuditEntry) => Promise<void>;

/** Bản ghi mặc định: một dòng `infra.audit_log` qua `tenantTx` (cùng tài khoản của ngữ cảnh). */
export const writeChannelAudit: ChannelAuditSink = async (entry) => {
  const accountId = currentAccountId();
  if (accountId === null) return;
  const ctx = getExecutionContext();
  const actor =
    entry.actor ??
    (ctx?.actor?.kind === 'user'
      ? { type: 'user' as const, id: ctx.actor.userId }
      : { type: 'system' as const, id: 'system' });
  const traceId = ctx?.traceId ?? null;
  await tenantTx(async (db) => {
    await db.insert(auditLog).values({
      account_id: accountId,
      actor_type: actor.type,
      actor_id: actor.id,
      action: entry.action,
      trace_id: traceId,
      metadata: {
        connection_id: entry.connectionId ?? null,
        channel_type: entry.channelType ?? null,
        result: entry.result,
        reason_code: entry.reasonCode ?? null,
        trace_id: traceId,
      },
    });
  });
};
