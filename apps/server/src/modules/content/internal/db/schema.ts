// Bảng của module Nội dung (012 data-model.md mục 1): bài, phiên bản theo kênh, lịch sử sự kiện và
// bộ giới hạn theo kênh. Theo khuôn của `context/internal/db/schema.ts`: `tenantTable` tự thêm id UUID
// v7, account_id NOT NULL FK cascade, chỉ mục (account_id) và chính sách RLS `tenant_isolation`.
//
// Mã người dùng (`created_by`…), mã kênh (`connection_id`) và mã media là MÃ THAM CHIẾU, KHÔNG khóa
// ngoại tới module khác (ADR-09). Khóa ngoại chỉ trong nội bộ module và tới `account.accounts`.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
// Nhập thẳng core/db (không qua core/index.ts) để drizzle-kit nạp lược đồ không kéo theo NestJS.
import { moduleSchema, sharedTable, tenantTable } from '../../../../core/db';

const content = moduleSchema('content');
const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Bài viết. `version` (versioned) là khóa lạc quan CẤP BÀI: duyệt/đổi giờ gắn với bản đã xem. */
export const posts = tenantTable(
  content,
  'posts',
  {
    status: text('status').notNull(),
    source: text('source').notNull().default('manual'),
    internal_name: varchar('internal_name', { length: 80 }),
    shared_text: text('shared_text').notNull().default(''),
    scheduled_at: timestamptz('scheduled_at'),
    created_by: uuid('created_by').notNull(),
    submitted_by: uuid('submitted_by'),
    submitted_at: timestamptz('submitted_at'),
    submission_id: uuid('submission_id'),
    approved_by: uuid('approved_by'),
    approved_at: timestamptz('approved_at'),
    returned_note: varchar('returned_note', { length: 500 }),
    returned_by: uuid('returned_by'),
    returned_at: timestamptz('returned_at'),
    edited_after_approval: boolean('edited_after_approval').notNull().default(false),
  },
  (t) => [
    check(
      'posts_status_check',
      sql`${t.status} IN ('draft', 'pending_review', 'approved', 'cancelled')`,
    ),
    check('posts_source_check', sql`${t.source} IN ('manual', 'ai')`),
    check('posts_shared_text_length', sql`char_length(${t.shared_text}) <= 63206`),
    check(
      'posts_approved_has_schedule',
      sql`${t.status} <> 'approved' OR (${t.scheduled_at} IS NOT NULL AND ${t.approved_by} IS NOT NULL AND ${t.approved_at} IS NOT NULL)`,
    ),
    check(
      'posts_returned_note_length',
      sql`${t.returned_note} IS NULL OR char_length(btrim(${t.returned_note})) BETWEEN 1 AND 500`,
    ),
    check(
      'posts_pending_has_submitter',
      sql`${t.status} <> 'pending_review' OR ${t.submitted_by} IS NOT NULL`,
    ),
    index('posts_account_status_scheduled_idx')
      .on(t.account_id, t.status, t.scheduled_at)
      .where(sql`${t.deleted_at} IS NULL`),
    index('posts_account_scheduled_idx')
      .on(t.account_id, t.scheduled_at)
      .where(sql`${t.deleted_at} IS NULL AND ${t.scheduled_at} IS NOT NULL`),
    index('posts_account_created_idx')
      .on(t.account_id, sql`${t.created_at} DESC`, t.id)
      .where(sql`${t.deleted_at} IS NULL`),
    index('posts_account_submission_idx')
      .on(t.account_id, t.submission_id)
      .where(sql`${t.submission_id} IS NOT NULL`),
  ],
  { softDelete: true, versioned: true },
);

/** Phiên bản nội dung theo kênh – một dòng mỗi (bài, kênh). Kết quả kiểm tra giới hạn KHÔNG lưu. */
export const channelVariants = tenantTable(
  content,
  'channel_variants',
  {
    // FK NỘI BỘ module (được phép – nguyên tắc IV).
    post_id: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    connection_id: uuid('connection_id').notNull(),
    channel_type: text('channel_type').notNull(),
    customized: boolean('customized').notNull().default(false),
    text: text('text').notNull().default(''),
    hashtags: text('hashtags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    media: jsonb('media')
      .notNull()
      .default(sql`'[]'::jsonb`),
  },
  (t) => [
    uniqueIndex('channel_variants_account_post_connection_key').on(
      t.account_id,
      t.post_id,
      t.connection_id,
    ),
    index('channel_variants_account_post_idx').on(t.account_id, t.post_id),
    check(
      'channel_variants_channel_type_check',
      sql`${t.channel_type} IN ('facebook_page', 'instagram', 'zalo_oa', 'test_channel')`,
    ),
    check('channel_variants_text_length', sql`char_length(${t.text}) <= 63206`),
    check('channel_variants_hashtags_count', sql`cardinality(${t.hashtags}) <= 30`),
    // CHECK không cho truy vấn con: chỉ chặn khoảng trắng trong hashtag; độ dài từng hashtag do Zod kiểm.
    check('channel_variants_hashtags_no_space', sql`array_to_string(${t.hashtags}, ',') !~ '\\s'`),
    check(
      'channel_variants_media_shape',
      sql`jsonb_typeof(${t.media}) = 'array' AND jsonb_array_length(${t.media}) <= 20`,
    ),
  ],
  { versioned: true },
);

/**
 * Lịch sử sự kiện của bài – CHỈ THÊM (migration thu hồi UPDATE/DELETE của `app`, `system`; dòng chỉ
 * mất theo CASCADE khi bài/tài khoản bị xóa hẳn). `data` KHÔNG chứa nội dung bài.
 */
export const postEvents = tenantTable(
  content,
  'post_events',
  {
    post_id: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    actor_user_id: uuid('actor_user_id').notNull(),
    occurred_at: timestamptz('occurred_at').notNull().defaultNow(),
    data: jsonb('data')
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [
    index('post_events_account_post_occurred_idx').on(t.account_id, t.post_id, t.occurred_at),
    check(
      'post_events_type_check',
      sql`${t.type} IN ('created', 'submitted', 'withdrawn', 'approved', 'returned', 'unscheduled', 'rescheduled', 'edited_after_approval', 'channels_changed')`,
    ),
  ],
);

/** Bộ giới hạn theo kênh – cấu hình dùng chung, đổi bằng cập nhật dòng, không cần phát hành. */
export const channelRules = sharedTable(
  content,
  'channel_rules',
  {
    channel_type: text('channel_type').primaryKey(),
    max_text_length: integer('max_text_length').notNull(),
    max_hashtags: integer('max_hashtags'),
    media_required: boolean('media_required').notNull().default(false),
    max_posts_per_24h: integer('max_posts_per_24h'),
    updated_at: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('channel_rules_max_text_length_check', sql`${t.max_text_length} >= 1`),
    check(
      'channel_rules_max_hashtags_check',
      sql`${t.max_hashtags} IS NULL OR ${t.max_hashtags} >= 0`,
    ),
    check(
      'channel_rules_max_posts_check',
      sql`${t.max_posts_per_24h} IS NULL OR ${t.max_posts_per_24h} >= 1`,
    ),
  ],
  { reason: 'Giới hạn theo kênh là cấu hình chung của nền tảng, không thuộc tài khoản nào' },
);

export type PostRow = typeof posts.$inferSelect;
export type ChannelVariantRow = typeof channelVariants.$inferSelect;
export type PostEventRow = typeof postEvents.$inferSelect;
export type ChannelRuleRow = typeof channelRules.$inferSelect;
