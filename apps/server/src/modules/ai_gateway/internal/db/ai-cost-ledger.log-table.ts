// Định nghĩa Drizzle của `ai_gateway.ai_cost_ledger` CHỈ để chèn/đọc có kiểu. DDL thật (phân vùng theo tháng, RLS,
// quyền chỉ-thêm) ở migration tay 0029. Tên `*.log-table.ts` nằm ngoài glob của drizzle.config.ts.
// Sổ CHỈ THÊM: mỗi lời gọi đã quyết toán một dòng (data-model.md mục 2.3).
import { bigint, date, integer, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { moduleSchema, partitionedLogTable } from '../../../../core/db';
import { uuidV7 } from '../../../../core/ids/uuid-v7';

export const aiCostLedger = partitionedLogTable(
  moduleSchema('ai_gateway'),
  'ai_cost_ledger',
  {
    id: uuid('id')
      .notNull()
      .$defaultFn(() => uuidV7()),
    /** Không khóa ngoại: sổ giữ lại sau khi xóa tài khoản (như `audit_log`). */
    account_id: uuid('account_id').notNull(),
    cycle_start: date('cycle_start', { mode: 'string' }).notNull(),
    /** Tham chiếu `ai_reservations` (không FK vì bảng phân vùng). */
    reservation_id: uuid('reservation_id').notNull(),
    request_id: text('request_id'),
    task: text('task').notNull(),
    model_tier: text('model_tier').notNull(),
    model_id: text('model_id').notNull(),
    provider: text('provider').notNull(),
    input_tokens: integer('input_tokens').notNull().default(0),
    output_tokens: integer('output_tokens').notNull().default(0),
    cached_input_tokens: integer('cached_input_tokens').notNull().default(0),
    audio_seconds: integer('audio_seconds'),
    cost_micro_usd: bigint('cost_micro_usd', { mode: 'bigint' }).notNull(),
    estimate_micro_usd: bigint('estimate_micro_usd', { mode: 'bigint' }).notNull(),
    anomaly: text('anomaly'),
    over_cap_micro_usd: bigint('over_cap_micro_usd', { mode: 'bigint' }).notNull().default(0n),
    trace_id: text('trace_id'),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  { partitionBy: 'created_at' },
);

export type AiCostLedgerRow = typeof aiCostLedger.$inferSelect;
