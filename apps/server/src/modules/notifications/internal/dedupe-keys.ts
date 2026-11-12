import type { NotificationEvent, NotificationType, RefsOf } from '@app/shared/notifications';

// Khóa chống trùng theo loại (005, data-model.md mục 3) – do Thông báo dựng, bên phát không truyền được.
// Kiểu `Record<NotificationType, …>`: thiếu loại hoặc dùng trường ngoài `refs` là lỗi biên dịch.

const KEYS: { [T in NotificationType]: (refs: RefsOf<T>) => string } = {
  post_pending_review: (r) => `post_pending_review:${r.submissionId}`,
  post_returned: (r) => `post_returned:${r.postId}:${r.postVersion}`,
  approved_post_rescheduled: (r) => `approved_post_rescheduled:${r.postId}:${r.postVersion}`,
  batch_generation_done: (r) => `batch_generation_done:${r.planId}:${r.batchId}`,
  publish_needs_action: (r) => `publish_needs_action:${r.attemptId}:${r.state}`,
  channel_token_expiring: (r) => `channel_token_expiring:${r.connectionId}:${r.expiresOn}`,
  ai_usage_80: (r) => `ai_usage_80:${r.cycleStart}`,
  ai_usage_100: (r) => `ai_usage_100:${r.cycleStart}`,
  plan_expiring: (r) => `plan_expiring:${r.subscriptionId}:${r.expiresOn}`,
  data_deletion_scheduled: (r) => `data_deletion_scheduled:${r.deleteOn}`,
};

export function dedupeKey(event: NotificationEvent): string {
  return (KEYS[event.type] as (refs: unknown) => string)(event.refs);
}
