// Bảng của module Đăng bài. 012 dựng mục lịch đăng; 013 (data-model.md) BỔ SUNG cột + bảng `error_mappings`
// bằng migration chỉ thêm – KHÔNG đổi nghĩa các cột/CHECK của 012 (API/Worker cũ chạy song song vẫn đúng).
// Nhật ký `publish_steps` là bảng phân vùng: định nghĩa ở `publish-steps.log-table.ts`, DDL viết tay.
//
// `post_id` và `channel_connection_id` là MÃ THAM CHIẾU tới module khác, KHÔNG khóa ngoại (ADR-09).
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
} from 'drizzle-orm/pg-core';
import { moduleSchema, sharedTable, tenantTable } from '../../../../core/db';

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

export const ATTEMPT_PHASES = [
  'none',
  'submitted_awaiting_response',
  'awaiting_processing',
  'finished',
] as const;
export type AttemptPhase = (typeof ATTEMPT_PHASES)[number];

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
    status: text('status', { enum: ATTEMPT_STATUS_LIST }).notNull(),
    scheduled_at: timestamptz('scheduled_at').notNull(),
    /** `posts.version` đã duyệt – so khớp nội dung lúc đăng (lệch → hủy, không đăng nội dung cũ). */
    content_version: integer('content_version').notNull(),
    // ---- 013 ----
    /** Giai đoạn của lượt: quyết định bộ xử lý làm đoạn nào (research R2). */
    phase: text('phase', { enum: ATTEMPT_PHASES }).notNull().default('none'),
    /** Tăng mỗi lần luồng chạy lại (thử lại / đối soát / đăng lại). */
    run_no: integer('run_no').notNull().default(0),
    transient_attempts: integer('transient_attempts').notNull().default(0),
    transient_window_started_at: timestamptz('transient_window_started_at'),
    reconcile_retry_used: boolean('reconcile_retry_used').notNull().default(false),
    /** `ch1:…` – ghi TRƯỚC `submit` (R3), chỉ ghi một lần cho mỗi lượt gửi. */
    content_hash: text('content_hash'),
    submitted_at: timestamptz('submitted_at'),
    processing_id: text('processing_id'),
    platform_post_id: text('platform_post_id'),
    permalink: text('permalink'),
    confirmed_by: text('confirmed_by'),
    needs_reason: text('needs_reason'),
    last_error_category: text('last_error_category'),
    last_raw_code: text('last_raw_code'),
    trace_id: text('trace_id')
      .notNull()
      .default(sql`replace(gen_random_uuid()::text, '-', '')`),
  },
  (t) => [
    check(
      'publish_attempts_status_check',
      sql`${t.status} IN ('scheduled', 'processing', 'retry_wait', 'needs_user', 'unknown', 'needs_check', 'succeeded', 'cancelled')`,
    ),
    check('publish_attempts_content_version_check', sql`${t.content_version} >= 1`),
    check(
      'publish_attempts_phase_check',
      sql`${t.phase} IN ('none', 'submitted_awaiting_response', 'awaiting_processing', 'finished')`,
    ),
    check(
      'publish_attempts_transient_attempts_check',
      sql`${t.transient_attempts} BETWEEN 0 AND 5`,
    ),
    check(
      'publish_attempts_confirmed_by_check',
      sql`${t.confirmed_by} IS NULL OR ${t.confirmed_by} IN ('platform', 'reconciliation', 'user')`,
    ),
    check(
      'publish_attempts_last_error_category_check',
      sql`${t.last_error_category} IS NULL OR ${t.last_error_category} IN ('transient', 'user_action', 'unknown')`,
    ),
    check(
      'publish_attempts_permalink_length',
      sql`${t.permalink} IS NULL OR char_length(${t.permalink}) <= 2048`,
    ),
    check(
      'publish_attempts_needs_reason_check',
      sql`(${t.status} IN ('needs_user', 'needs_check')) = (${t.needs_reason} IS NOT NULL)`,
    ),
    check(
      'publish_attempts_finished_phase_check',
      sql`${t.phase} <> 'finished' OR ${t.status} IN ('succeeded', 'cancelled')`,
    ),
    check(
      'publish_attempts_succeeded_proof_check',
      sql`${t.status} <> 'succeeded' OR ${t.platform_post_id} IS NOT NULL OR ${t.confirmed_by} = 'user'`,
    ),
    check(
      'publish_attempts_submitted_stamp_check',
      sql`${t.phase} <> 'submitted_awaiting_response' OR (${t.content_hash} IS NOT NULL AND ${t.submitted_at} IS NOT NULL)`,
    ),
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
    index('publish_attempts_status_scheduled_idx').on(t.account_id, t.status, t.scheduled_at),
  ],
  { versioned: true },
);

export type PublishAttemptRow = typeof publishAttempts.$inferSelect;

/**
 * Ánh xạ lỗi nền tảng → thông điệp tiếng Việt + cách khắc phục (R11). Bảng DÙNG CHUNG (không dữ liệu tài
 * khoản); `app` chỉ đọc, ghi bằng vai trò `system` (quản trị nội bộ) và có ghi nhật ký kiểm toán.
 */
export const errorMappings = sharedTable(
  publishing,
  'error_mappings',
  {
    id: uuid('id').primaryKey(),
    channel_type: text('channel_type').notNull(),
    raw_code: text('raw_code').notNull(),
    category: text('category').notNull(),
    message_vi: text('message_vi').notNull(),
    remedies: jsonb('remedies').notNull(),
    needs_reason: text('needs_reason'),
    retry_after_sec: integer('retry_after_sec'),
    enabled: boolean('enabled').notNull().default(true),
    updated_at: timestamptz('updated_at').notNull().defaultNow(),
    updated_by: text('updated_by'),
  },
  (t) => [
    uniqueIndex('error_mappings_channel_code_key').on(t.channel_type, t.raw_code),
    check(
      'error_mappings_category_check',
      sql`${t.category} IN ('transient', 'user_action', 'unknown')`,
    ),
    check('error_mappings_message_length', sql`char_length(${t.message_vi}) <= 500`),
    check('error_mappings_remedies_nonempty', sql`jsonb_array_length(${t.remedies}) >= 1`),
    check(
      'error_mappings_retry_after_check',
      sql`${t.retry_after_sec} IS NULL OR (${t.category} = 'transient' AND ${t.retry_after_sec} > 0)`,
    ),
  ],
  { reason: 'Cấu hình ánh xạ lỗi nền tảng dùng chung mọi tài khoản; không có dữ liệu khách hàng.' },
);

export type ErrorMappingDbRow = typeof errorMappings.$inferSelect;
