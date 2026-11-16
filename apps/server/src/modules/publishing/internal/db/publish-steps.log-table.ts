// Định nghĩa Drizzle của `publishing.publish_steps` CHỈ để chèn/đọc có kiểu. DDL thật (phân vùng theo tháng,
// RLS, quyền chỉ-thêm) ở migration tay. Tên `*.log-table.ts` nằm ngoài glob của drizzle.config.ts.
// Nhật ký CHỈ THÊM: mỗi sự kiện một dòng (`started` | `finished`) – research R13.
import { jsonb, smallint, integer, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { moduleSchema, partitionedLogTable } from '../../../../core/db';
import { uuidV7 } from '../../../../core/ids/uuid-v7';

export const publishSteps = partitionedLogTable(
  moduleSchema('publishing'),
  'publish_steps',
  {
    id: uuid('id')
      .notNull()
      .$defaultFn(() => uuidV7()),
    account_id: uuid('account_id').notNull(),
    /** Tham chiếu `publish_attempts` (không khóa ngoại vì bảng phân vùng). */
    attempt_id: uuid('attempt_id').notNull(),
    run_no: integer('run_no').notNull(),
    step_no: smallint('step_no').notNull(),
    step_key: text('step_key').notNull(),
    event: text('event').notNull(),
    outcome: text('outcome'),
    error_category: text('error_category'),
    raw_code: text('raw_code'),
    message_vi: text('message_vi'),
    remedies: jsonb('remedies'),
    note: text('note'),
    occurred_at: timestamp('occurred_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    trace_id: text('trace_id').notNull(),
  },
  { partitionBy: 'occurred_at' },
);

export type PublishStepRow = typeof publishSteps.$inferSelect;
