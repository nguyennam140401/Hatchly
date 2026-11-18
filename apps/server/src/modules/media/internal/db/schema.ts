// Bảng của module Thư viện media (014 data-model.md mục 1). Theo khuôn `content/internal/db/schema.ts`:
// `tenantTable` tự thêm id UUID v7, account_id NOT NULL FK cascade, chỉ mục (account_id) và chính sách RLS
// `tenant_isolation`. Người tải (`uploaded_by_user_id`, `created_by_user_id`) là MÃ THAM CHIẾU, KHÔNG khóa
// ngoại tới `account.users` (ADR-09); khóa ngoại chỉ nội bộ module (`upload_sessions → media`) và tới `accounts`.
// Dung lượng là số nguyên byte (`bigint` chế độ `number` – tối đa 5 GiB nên an toàn trong số nguyên JS).
import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
// Nhập thẳng core/db (không qua core/index.ts) để drizzle-kit nạp lược đồ không kéo theo NestJS.
import { moduleSchema, tenantTable } from '../../../../core/db';

const media = moduleSchema('media');
const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const bytes = (name: string) => bigint(name, { mode: 'number' });

/**
 * Một ảnh/video của một tài khoản (xóa mềm 30 ngày). `status` chuyển bằng
 * `UPDATE … WHERE status = :expected RETURNING` (hiến pháp II/V).
 */
export const mediaItems = tenantTable(
  media,
  'media',
  {
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    display_name: text('display_name').notNull(),
    original_content_type: text('original_content_type').notNull(),
    original_bytes: bytes('original_bytes').notNull(),
    // Dấu tệp (SHA-256) do Worker tính (R3) – NULL tới khi xử lý.
    file_hash: char('file_hash', { length: 64 }),
    width: integer('width'),
    height: integer('height'),
    duration_ms: integer('duration_ms'),
    normalized_bytes: bytes('normalized_bytes'),
    thumb_bytes: bytes('thumb_bytes'),
    uploaded_by_user_id: uuid('uploaded_by_user_id').notNull(),
    failure_code: text('failure_code'),
    processed_at: timestamptz('processed_at'),
    files_purged_at: timestamptz('files_purged_at'),
  },
  (t) => [
    check('media_kind_check', sql`${t.kind} IN ('image', 'video')`),
    check(
      'media_status_check',
      sql`${t.status} IN ('uploading', 'processing', 'ready', 'unprocessable')`,
    ),
    check('media_display_name_length', sql`char_length(${t.display_name}) BETWEEN 1 AND 255`),
    check('media_original_bytes_positive', sql`${t.original_bytes} > 0`),
    check(
      'media_file_hash_format',
      sql`${t.file_hash} IS NULL OR ${t.file_hash} ~ '^[0-9a-f]{64}$'`,
    ),
    check('media_duration_video_only', sql`${t.kind} = 'video' OR ${t.duration_ms} IS NULL`),
    check(
      'media_ready_complete',
      sql`${t.status} <> 'ready' OR (${t.file_hash} IS NOT NULL AND ${t.width} IS NOT NULL AND ${t.height} IS NOT NULL AND ${t.processed_at} IS NOT NULL)`,
    ),
    check(
      'media_ready_image_normalized',
      sql`${t.status} <> 'ready' OR ${t.kind} <> 'image' OR ${t.normalized_bytes} IS NOT NULL`,
    ),
    check('media_ready_thumb', sql`${t.status} <> 'ready' OR ${t.thumb_bytes} IS NOT NULL`),
    check(
      'media_unprocessable_failure_code',
      sql`${t.status} <> 'unprocessable' OR ${t.failure_code} IS NOT NULL`,
    ),
    // Chống trùng nội dung trong cùng tài khoản (R3): xóa mềm / "không xử lý được" không chiếm dấu.
    uniqueIndex('media_account_file_hash_key')
      .on(t.account_id, t.file_hash)
      .where(
        sql`${t.file_hash} IS NOT NULL AND ${t.deleted_at} IS NULL AND ${t.status} IN ('processing', 'ready')`,
      ),
    index('media_account_created_idx')
      .on(t.account_id, sql`${t.created_at} DESC`, t.id)
      .where(sql`${t.deleted_at} IS NULL AND ${t.status} <> 'uploading'`),
    index('media_account_kind_created_idx')
      .on(t.account_id, t.kind, sql`${t.created_at} DESC`)
      .where(sql`${t.deleted_at} IS NULL AND ${t.status} <> 'uploading'`),
    index('media_account_uploader_idx').on(t.account_id, t.uploaded_by_user_id),
  ],
  { softDelete: true },
);

/** Một lần tải của một tệp: giữ phần đã giữ chỗ và cho phép tiếp tục (FR-005, FR-009). */
export const uploadSessions = tenantTable(
  media,
  'upload_sessions',
  {
    // FK NỘI BỘ module (được phép – nguyên tắc IV).
    media_id: uuid('media_id')
      .notNull()
      .references(() => mediaItems.id, { onDelete: 'cascade' }),
    created_by_user_id: uuid('created_by_user_id').notNull(),
    fingerprint: char('fingerprint', { length: 64 }).notNull(),
    mode: text('mode').notNull(),
    declared_bytes: bytes('declared_bytes').notNull(),
    declared_content_type: text('declared_content_type').notNull(),
    // Bí mật tạm thời: KHÔNG vào nhật ký/chỉ số/phản hồi ngoài `part-urls`.
    multipart_upload_id: text('multipart_upload_id'),
    part_size_bytes: integer('part_size_bytes'),
    part_count: integer('part_count'),
    state: text('state').notNull().default('open'),
    failure_code: text('failure_code'),
    // Mã tham chiếu cùng schema, KHÔNG FK (tránh khóa vòng khi xóa).
    duplicate_of_media_id: uuid('duplicate_of_media_id'),
    last_activity_at: timestamptz('last_activity_at').notNull().defaultNow(),
    expires_at: timestamptz('expires_at').notNull(),
    completed_at: timestamptz('completed_at'),
  },
  (t) => [
    check('upload_sessions_fingerprint_format', sql`${t.fingerprint} ~ '^[0-9a-f]{64}$'`),
    check('upload_sessions_mode_check', sql`${t.mode} IN ('single', 'multipart')`),
    check('upload_sessions_declared_bytes_positive', sql`${t.declared_bytes} > 0`),
    check(
      'upload_sessions_state_check',
      sql`${t.state} IN ('open', 'completing', 'completed', 'cancelled', 'expired', 'failed', 'duplicate')`,
    ),
    check(
      'upload_sessions_failure_code_check',
      sql`${t.failure_code} IS NULL OR ${t.failure_code} IN ('size_mismatch', 'type_mismatch', 'type_unsupported', 'animated', 'missing_object', 'plan_expired')`,
    ),
    check(
      'upload_sessions_multipart_shape',
      sql`(${t.mode} = 'multipart' AND ${t.part_size_bytes} IS NOT NULL AND ${t.part_count} IS NOT NULL) OR (${t.mode} = 'single' AND ${t.multipart_upload_id} IS NULL AND ${t.part_count} IS NULL)`,
    ),
    // Một phiên đang hoạt động cho mỗi (người, tệp).
    uniqueIndex('upload_sessions_active_fingerprint_key')
      .on(t.account_id, t.created_by_user_id, t.fingerprint)
      .where(sql`${t.state} IN ('open', 'completing')`),
    index('upload_sessions_account_expires_idx')
      .on(t.account_id, t.expires_at)
      .where(sql`${t.state} = 'open'`),
    index('upload_sessions_account_media_idx').on(t.account_id, t.media_id),
  ],
);

/**
 * Bộ đếm dung lượng: một dòng/tài khoản, KHÔNG cache (FR-028). Mọi thay đổi là một câu UPDATE có điều
 * kiện cùng giao dịch; CHECK là chốt chặn cuối (SC-005).
 */
export const storageQuotas = tenantTable(
  media,
  'storage_quotas',
  {
    used_bytes: bytes('used_bytes').notNull().default(0),
    reserved_bytes: bytes('reserved_bytes').notNull().default(0),
    limit_bytes: bytes('limit_bytes').notNull(),
  },
  (t) => [
    uniqueIndex('storage_quotas_account_id_key').on(t.account_id),
    check('storage_quotas_limit_positive', sql`${t.limit_bytes} > 0`),
    check(
      'storage_quotas_within_limit',
      sql`${t.used_bytes} >= 0 AND ${t.reserved_bytes} >= 0 AND ${t.used_bytes} + ${t.reserved_bytes} <= ${t.limit_bytes}`,
    ),
  ],
);

export type MediaRow = typeof mediaItems.$inferSelect;
export type UploadSessionRow = typeof uploadSessions.$inferSelect;
export type StorageQuotaRow = typeof storageQuotas.$inferSelect;
