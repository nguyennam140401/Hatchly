import { auditLog } from '../../../../core/db/audit-log.log-table';
import { getExecutionContext, type Db } from '../../../../core';

// Nhật ký kiểm toán cho sự kiện xác thực (FR-018, R11). `metadata` CHỈ có { ip, ua_family, reason, provider } –
// KHÔNG BAO GIỜ có email, mật khẩu, mã hay băm. Ghi trong cùng giao dịch với thao tác khi có
// (tenantTx), còn sự kiện không có giao dịch nghiệp vụ (đăng nhập thất bại) ghi qua authTx.

export const AUTH_AUDIT_ACTIONS = [
  'auth.register',
  'auth.login.succeeded',
  'auth.login.failed',
  'auth.login.throttled',
  'auth.logout_all',
  'auth.password.reset',
  'auth.password.changed',
  'auth.email.verified',
  'auth.email.changed',
  'account.member.added',
  'account.member.removed',
  'account.member.disabled',
  'account.member.enabled',
  'staff.login.succeeded',
  'staff.login.failed',
  'staff.login.denied_ip',
  'staff.created',
  'staff.disabled',
  'staff.password_reset',
  'staff.request',
  // 009 (data-model mục 7). `account.member.removed` đã có ở trên.
  'auth.oauth.succeeded',
  'auth.oauth.failed',
  'auth.register.oauth',
  'auth.identity.link_requested',
  'auth.identity.link_confirmed',
  'auth.identity.link_denied',
  'auth.identity.linked',
  'auth.identity.unlinked',
  'auth.identity.unlinked_by_provider',
  'auth.password.set',
  'auth.reauth',
  'account.invitation.sent',
  'account.invitation.resent',
  'account.invitation.cancelled',
  'account.invitation.accepted',
  'account.invitation.expired',
  'account.claimed',
  'account.user.purged',
] as const;

/** Lý do của `auth.oauth.failed` (data-model mục 7). */
export type OAuthFailureReason =
  'cancelled' | 'state_mismatch' | 'expired' | 'provider_error' | 'account_unavailable';
export type AuthAuditAction = (typeof AUTH_AUDIT_ACTIONS)[number];

export interface AuthAuditEntry {
  actorType: 'user' | 'support' | 'admin' | 'system' | 'anonymous';
  /** Mã người dùng/nhân viên; 'anonymous' khi chưa biết; 'ops-cli' cho lệnh vận hành. */
  actorId: string;
  action: AuthAuditAction;
  accountId?: string | null | undefined;
  ip?: string | null | undefined;
  uaFamily?: string | null | undefined;
  /** Mã lý do dạng máy đọc (vd `bad_password`, `unknown_email`, `blocked`). */
  reason?: string | null | undefined;
  /** 009: nhà cung cấp đăng nhập liên quan (`google` | `facebook`). */
  provider?: 'google' | 'facebook' | null | undefined;
}

/** Ghi một dòng infra.audit_log trong giao dịch `db` (tenantTx hoặc authTx). */
export async function writeAuthAudit(db: Db, entry: AuthAuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    account_id: entry.accountId ?? null,
    actor_type: entry.actorType,
    actor_id: entry.actorId,
    action: entry.action,
    trace_id: getExecutionContext()?.traceId ?? null,
    metadata: {
      ip: entry.ip ?? null,
      ua_family: entry.uaFamily ?? null,
      reason: entry.reason ?? null,
      // Chỉ thêm khóa khi có – dòng của 004 giữ nguyên hình dạng { ip, ua_family, reason }.
      ...(entry.provider != null ? { provider: entry.provider } : {}),
    },
  });
}
