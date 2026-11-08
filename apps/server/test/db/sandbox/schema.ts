// Bảng mẫu CHỈ cho dev/test (FR-017, data-model mục 8). Sinh migration bằng `pnpm db:generate:dev`
// vào drizzle/migrations-dev – không bao giờ lọt vào migration chính.
import { sql } from 'drizzle-orm';
import { index, text } from 'drizzle-orm/pg-core';
import { moduleSchema } from '../../../src/core/db/module-schema';
import { microUsd, nonNegativeCheck, tenantTable } from '../../../src/core/db/table-builders';

const sandbox = moduleSchema('sandbox');

export const tenantNotes = tenantTable(
  sandbox,
  'tenant_notes',
  {
    title: text('title').notNull(),
    status: text('status').notNull().default('draft'),
    /** Cột "bí mật" mẫu – không xuất hiện ở bất kỳ khung nhìn hỗ trợ nào. */
    secret_note: text('secret_note'),
    cost_micro_usd: microUsd('cost_micro_usd')
      .notNull()
      .default(sql`0`),
  },
  (t) => [
    index('tenant_notes_account_id_status_idx').on(t.account_id, t.status),
    nonNegativeCheck('tenant_notes', 'cost_micro_usd'),
  ],
  { softDelete: true, versioned: true },
);
