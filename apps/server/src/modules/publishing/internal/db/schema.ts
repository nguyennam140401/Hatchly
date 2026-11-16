// Bảng của module Đăng bài – phần 012 (data-model.md mục 2): mục lịch đăng. 013 bổ sung cột và bảng
// `publish_steps` bằng migration chỉ thêm; KHÔNG đổi các cột/CHECK dưới đây (đã đủ bộ trạng thái ADD §7.1).
//
// `post_id` và `channel_connection_id` là MÃ THAM CHIẾU tới module khác, KHÔNG khóa ngoại (ADR-09).
import { sql } from 'drizzle-orm';
import { check, index, integer, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { moduleSchema, tenantTable } from '../../../../core/db';

const publishing = moduleSchema('publishing');
const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const ATTEMPT_STATUS_LIST = [
  'scheduled',
  'processing',
  'retry_wait',
  'needs_user',
  'unknown',
  'needs_check',
  'succeeded',
  'cancelled',
] as const;

/**
 * Lượt đăng (mục lịch đăng) – tối đa MỘT lượt hiệu lực cho mỗi cặp (bài, kênh): chỉ mục duy nhất có
 * điều kiện là chốt chặn cuối cùng chống đăng trùng (Hiến pháp II).
 */
export const publishAttempts = tenantTable(
  publishing,
  'publish_attempts',
  {
    post_id: uuid('post_id').notNull(),
    channel_connection_id: uuid('channel_connection_id').notNull(),
    channel_type: text('channel_type').notNull(),
    status: text('status').notNull(),
    scheduled_at: timestamptz('scheduled_at').notNull(),
    /** `posts.version` đã duyệt – 013 dùng để so khớp nội dung. */
    content_version: integer('content_version').notNull(),
  },
  (t) => [
    check(
      'publish_attempts_status_check',
      sql`${t.status} IN ('scheduled', 'processing', 'retry_wait', 'needs_user', 'unknown', 'needs_check', 'succeeded', 'cancelled')`,
    ),
    check('publish_attempts_content_version_check', sql`${t.content_version} >= 1`),
    uniqueIndex('publish_attempts_effective_key')
      .on(t.account_id, t.post_id, t.channel_connection_id)
      .where(sql`${t.status} <> 'cancelled'`),
    index('publish_attempts_scheduled_idx')
      .on(t.account_id, t.scheduled_at)
      .where(sql`${t.status} = 'scheduled'`),
    index('publish_attempts_post_idx').on(t.account_id, t.post_id),
    index('publish_attempts_quota_idx')
      .on(t.account_id, t.channel_connection_id, t.scheduled_at)
      .where(sql`${t.status} <> 'cancelled'`),
  ],
  { versioned: true },
);

export type PublishAttemptRow = typeof publishAttempts.$inferSelect;
