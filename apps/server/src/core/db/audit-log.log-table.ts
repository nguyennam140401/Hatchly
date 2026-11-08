// Định nghĩa Drizzle của `infra.audit_log` (data-model mục 7) CHỈ để chèn có kiểu. DDL thật (phân
// vùng theo tháng, RLS chỉ-thêm, quyền) ở migration tay 0003_audit_log.sql. Tên tệp `*.log-table.ts`
// nằm ngoài glob của drizzle.config.ts nên drizzle-kit không sinh CREATE TABLE thường.
import { jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidV7 } from '../ids/uuid-v7';
import { moduleSchema } from './module-schema';
import { partitionedLogTable } from './table-builders';

export const auditLog = partitionedLogTable(
  moduleSchema('infra'),
  'audit_log',
  {
    id: uuid('id')
      .notNull()
      .$defaultFn(() => uuidV7()),
    occurred_at: timestamp('occurred_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    /** NULL cho lần tìm kiếm xuyên tài khoản. Không khóa ngoại (giữ sau khi xóa tài khoản). */
    account_id: uuid('account_id'),
    actor_type: text('actor_type', { enum: ['support', 'admin', 'system'] }).notNull(),
    actor_id: text('actor_id').notNull(),
    action: text('action').notNull(),
    /** Loại từ khóa tìm kiếm – KHÔNG lưu giá trị từ khóa. */
    keyword_type: text('keyword_type'),
    reason: text('reason'),
    trace_id: text('trace_id'),
    metadata: jsonb('metadata'),
  },
  { partitionBy: 'occurred_at' },
);
