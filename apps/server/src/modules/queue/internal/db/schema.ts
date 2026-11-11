// Bảng của module `queue` trong schema `infra` (003 data-model mục 4–6). drizzle-kit đọc tệp này
// (glob `src/modules/*/internal/db/schema.ts`). Bảng của thư viện (schema `pgboss`) KHÔNG khai báo ở đây
// – cài bằng migration tay 0005.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgPolicy,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts, CURRENT_ACCOUNT_ID, moduleSchema, sharedTable } from '../../../../core/db';
import { appRole, systemRole } from '../../../../core/db/roles';
import { registerTable } from '../../../../core/db/table-registry';

const infra = moduleSchema('infra');
const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Tên 6 hàng chờ – trùng `QueueName` của public-api.ts. */
export const QUEUE_NAMES_SQL = sql.raw(
  `('publish', 'media', 'ai_batch', 'trends', 'notify', 'scheduled')`,
);

/** Thông số vận hành của 6 hàng chờ (R10) – 6 dòng do migration khởi tạo, Worker đọc lại mỗi 60 giây. */
export const queueSettings = sharedTable(
  infra,
  'queue_settings',
  {
    queue: text('queue').primaryKey(),
    concurrency_per_worker: integer('concurrency_per_worker').notNull(),
    max_per_tenant: integer('max_per_tenant'),
    lock_seconds: integer('lock_seconds').notNull(),
    heartbeat_seconds: integer('heartbeat_seconds').notNull(),
    retry_mode: text('retry_mode', { enum: ['schedule', 'handler', 'none'] }).notNull(),
    max_retries: integer('max_retries').notNull(),
    retry_delays_seconds: integer('retry_delays_seconds').array().notNull(),
    poll_interval_ms: integer('poll_interval_ms').notNull(),
    updated_at: timestamptz('updated_at').notNull().defaultNow(),
    updated_by: text('updated_by'),
  },
  (t) => [
    check('queue_settings_queue_check', sql`${t.queue} IN ${QUEUE_NAMES_SQL}`),
    check(
      'queue_settings_concurrency_check',
      sql`${t.concurrency_per_worker} >= 1 AND ${t.concurrency_per_worker} <= 50`,
    ),
    check(
      'queue_settings_max_per_tenant_check',
      sql`${t.max_per_tenant} IS NULL OR (${t.max_per_tenant} >= 1 AND ${t.max_per_tenant} <= ${t.concurrency_per_worker} * 10)`,
    ),
    check(
      'queue_settings_lock_seconds_check',
      sql`${t.lock_seconds} >= 30 AND ${t.lock_seconds} <= 3600`,
    ),
    check(
      'queue_settings_heartbeat_seconds_check',
      sql`${t.heartbeat_seconds} >= 10 AND ${t.heartbeat_seconds} < ${t.lock_seconds}`,
    ),
    check(
      'queue_settings_retry_mode_check',
      sql`${t.retry_mode} IN ('schedule', 'handler', 'none')`,
    ),
    check(
      'queue_settings_max_retries_check',
      sql`${t.max_retries} >= 0 AND ${t.max_retries} <= 20 AND (${t.retry_mode} <> 'none' OR ${t.max_retries} = 0)`,
    ),
    check(
      'queue_settings_retry_delays_check',
      sql`cardinality(${t.retry_delays_seconds}) >= 1 AND array_position(${t.retry_delays_seconds}, NULL) IS NULL AND 1 <= ALL(${t.retry_delays_seconds}) AND 86400 >= ALL(${t.retry_delays_seconds})`,
    ),
    check(
      'queue_settings_poll_interval_check',
      sql`${t.poll_interval_ms} >= 200 AND ${t.poll_interval_ms} <= 60000`,
    ),
  ],
  { reason: 'Thông số vận hành của 6 hàng chờ, không thuộc tài khoản nào' },
);

/**
 * Khung chạy của việc định kỳ (data-model mục 6, research R9): PK (name, slot) → đúng một việc mỗi khung
 * trên mọi bản Worker (FR-027). Chỉ `system` có quyền.
 */
export const scheduleSlots = sharedTable(
  infra,
  'schedule_slots',
  {
    name: text('name').notNull(),
    slot: text('slot').notNull(),
    slot_at: timestamptz('slot_at').notNull(),
    status: text('status', { enum: ['enqueued', 'skipped_overlap'] }).notNull(),
    job_id: uuid('job_id'),
    late_seconds: integer('late_seconds').notNull(),
    created_at: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'schedule_slots_pkey', columns: [t.name, t.slot] }),
    index('schedule_slots_slot_at_idx').on(t.slot_at),
    check('schedule_slots_status_check', sql`status IN ('enqueued', 'skipped_overlap')`),
  ],
  { reason: 'Khung chạy của việc định kỳ hệ thống' },
);

/** Câu điều kiện của chính sách `system_scoped` (data-model mục 5). */
const SYSTEM_SCOPED = sql`account_id = ${CURRENT_ACCOUNT_ID} OR (account_id IS NULL AND ${CURRENT_ACCOUNT_ID} IS NULL)`;

/**
 * Việc hỏng (data-model mục 5, research R8): một dòng mỗi việc đã hết lượt / lỗi vĩnh viễn. Bảng
 * `tenant` nhưng `account_id` cho phép NULL (việc hệ thống) – không dùng `tenantTable`. RLS: `app` chỉ
 * thấy tài khoản hiện hành; `system` thấy tài khoản hiện hành, hoặc dòng không tài khoản khi giao dịch
 * không có tenant. Thao tác xuyên tài khoản đi qua hàm SECURITY DEFINER (migration 0007).
 */
export const deadJobs = infra.table(
  'dead_jobs',
  {
    id: uuid('id').primaryKey(),
    account_id: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
    original_job_id: uuid('original_job_id').notNull().unique('dead_jobs_original_job_id_key'),
    queue: text('queue').notNull(),
    job_type: text('job_type').notNull(),
    payload_version: integer('payload_version').notNull(),
    payload: jsonb('payload').notNull(),
    dedupe_key: text('dedupe_key').notNull(),
    cause: text('cause', {
      enum: ['RETRIES_EXHAUSTED', 'PERMANENT_ERROR', 'NO_HANDLER', 'PAYLOAD_INVALID', 'EXPIRED'],
    }).notNull(),
    last_error: jsonb('last_error').notNull(),
    attempts: integer('attempts').notNull(),
    job_created_at: timestamptz('job_created_at').notNull(),
    failed_at: timestamptz('failed_at').notNull().defaultNow(),
    trace_id: text('trace_id').notNull(),
    generic_retry_allowed: boolean('generic_retry_allowed').notNull(),
    final_failure_notified: boolean('final_failure_notified').notNull().default(false),
    final_failure_attempts: integer('final_failure_attempts').notNull().default(0),
    retry_status: text('retry_status', {
      enum: ['none', 'requested', 'retried', 'rejected_already_active'],
    })
      .notNull()
      .default('none'),
    retry_requested_by: text('retry_requested_by'),
    retry_requested_at: timestamptz('retry_requested_at'),
    retried_at: timestamptz('retried_at'),
    new_job_id: uuid('new_job_id'),
  },
  (t) => [
    index('dead_jobs_account_id_failed_at_idx').on(t.account_id, t.failed_at),
    index('dead_jobs_queue_failed_at_idx').on(t.queue, t.failed_at),
    index('dead_jobs_retry_requested_idx')
      .on(t.retry_status)
      .where(sql`retry_status = 'requested'`),
    check('dead_jobs_queue_check', sql`queue IN ${QUEUE_NAMES_SQL}`),
    check(
      'dead_jobs_cause_check',
      sql`cause IN ('RETRIES_EXHAUSTED', 'PERMANENT_ERROR', 'NO_HANDLER', 'PAYLOAD_INVALID', 'EXPIRED')`,
    ),
    check(
      'dead_jobs_retry_status_check',
      sql`retry_status IN ('none', 'requested', 'retried', 'rejected_already_active')`,
    ),
    check('dead_jobs_last_error_size_check', sql`octet_length(last_error::text) <= 2048`),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: [appRole],
      using: sql`account_id = ${CURRENT_ACCOUNT_ID}`,
      withCheck: sql`account_id = ${CURRENT_ACCOUNT_ID}`,
    }),
    pgPolicy('system_scoped', {
      as: 'permissive',
      for: 'all',
      to: [systemRole],
      using: SYSTEM_SCOPED,
      withCheck: SYSTEM_SCOPED,
    }),
  ],
);

registerTable({
  schema: 'infra',
  name: 'dead_jobs',
  kind: 'tenant',
  tenantColumn: 'account_id',
  nullableTenant: { reason: 'Việc hệ thống không thuộc tài khoản nào' },
  indexExceptions: {
    dead_jobs_queue_failed_at_idx:
      'Tra cứu vận hành theo hàng chờ xuyên tài khoản (qua khung nhìn hỗ trợ)',
    dead_jobs_retry_requested_idx:
      'Việc định kỳ queue.dead_job_retries quét yêu cầu chạy lại xuyên tài khoản',
    dead_jobs_original_job_id_key: 'Khóa duy nhất theo mã việc gốc để chôn việc idempotent',
  },
});
