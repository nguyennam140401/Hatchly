// Nhật ký kiểm toán cho thao duyệt/lịch (012, research R12; cùng khuôn với content/internal/audit.ts): ghi cùng giao dịch với thao tác. `metadata` CHỈ
// có mã (postId, phiên bản, submissionId, số lượng) – KHÔNG BAO GIỜ có chữ, hashtag hay nội dung bài.
import { auditLog } from '../../../core/db/audit-log.log-table';
import { currentAccountId, getExecutionContext, type Db } from '../../../core';

export type PostAuditAction =
  | 'post.submit'
  | 'post.withdraw'
  | 'post.approve'
  | 'post.return'
  | 'post.unschedule'
  | 'post.reschedule'
  | 'post.edit_after_approval'
  | 'post.delete_draft';

export interface PostAuditMetadata {
  postId: string;
  fromVersion?: number;
  toVersion?: number;
  submissionId?: string;
  count?: number;
}

export async function writePostAudit(
  db: Db,
  actorUserId: string,
  action: PostAuditAction,
  metadata: PostAuditMetadata,
): Promise<void> {
  await db.insert(auditLog).values({
    account_id: currentAccountId(),
    actor_type: 'user',
    actor_id: actorUserId,
    action,
    trace_id: getExecutionContext()?.traceId ?? null,
    metadata,
  });
}
