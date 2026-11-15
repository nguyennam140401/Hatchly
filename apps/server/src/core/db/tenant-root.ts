// Bảng gốc tenant `account.accounts` (data-model mục 4, research R9).
//
// Module `account` sở hữu về nghiệp vụ, thêm cột tại đây theo hướng chỉ thêm – research R9.
// Định nghĩa nằm ở lõi vì `tenantTable` (lõi) phải tham chiếu bảng này để sinh khóa ngoại, mà lõi
// không được nhập module (quy tắc ranh giới `core-no-modules`).
import { sql } from 'drizzle-orm';
import { check, pgPolicy, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidV7 } from '../ids/uuid-v7';
import { moduleSchema } from './module-schema';
import { appRole, systemRole } from './roles';
import { registerTable } from './table-registry';

/** Điều kiện chính sách mẫu: biến phiên phạm vi giao dịch, NULL khi không có ngữ cảnh (R2). */
export const CURRENT_ACCOUNT_ID = sql`account.current_account_id()`;

// KHÔNG xuất đối tượng schema: drizzle-kit sẽ sinh `CREATE SCHEMA` trùng với migration 0000 – schema
// chỉ được tạo bằng migration tay theo modules.manifest.json.
const accountSchema = moduleSchema('account');

export const accounts = accountSchema.table(
  'accounts',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidV7()),
    status: text('status').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => sql`now()`),
    deleted_at: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  () => [
    // 'unclaimed' (009, research R6): tài khoản chờ của người không thuộc tài khoản nào – không có gói,
    // hồ sơ hay kênh. Báo cáo đếm tài khoản khách hàng PHẢI lọc trạng thái này.
    check(
      'accounts_status_check',
      sql`status IN ('active', 'suspended', 'expired', 'deleting', 'unclaimed')`,
    ),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: [appRole, systemRole],
      using: sql`id = ${CURRENT_ACCOUNT_ID}`,
      withCheck: sql`id = ${CURRENT_ACCOUNT_ID}`,
    }),
  ],
);

registerTable({
  schema: 'account',
  name: 'accounts',
  kind: 'tenant',
  tenantColumn: 'id',
  indexExceptions: {},
});
