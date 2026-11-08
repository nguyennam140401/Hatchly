// Hàm dựng bảng (data-model mục 5–6, research R8, R14). Lập trình viên KHÔNG tự viết câu điều kiện
// chính sách: `tenantTable` thêm bộ cột chuẩn, khóa ngoại cascade, chỉ mục `(account_id)` và chính
// sách `tenant_isolation`; drizzle-kit sinh sẵn `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY`.
import { sql, type BuildExtraConfigColumns } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgPolicy,
  timestamp,
  uuid,
  type PgColumnBuilderBase,
  type PgSchema,
  type PgTableExtraConfigValue,
} from 'drizzle-orm/pg-core';
import { uuidV7 } from '../ids/uuid-v7';
import { appRole, systemRole } from './roles';
import { registerTable } from './table-registry';
import { accounts, CURRENT_ACCOUNT_ID } from './tenant-root';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

function standardColumns() {
  return {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidV7()),
    account_id: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    created_at: timestamptz('created_at').notNull().defaultNow(),
    updated_at: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => sql`now()`),
  };
}
function softDeleteColumns() {
  return { deleted_at: timestamptz('deleted_at') };
}
function versionColumns() {
  return { version: integer('version').notNull().default(1) };
}

type StandardColumns = ReturnType<typeof standardColumns>;
type SoftDeleteColumns = ReturnType<typeof softDeleteColumns>;
type VersionColumns = ReturnType<typeof versionColumns>;

export interface TenantTableOptions {
  /** Thêm `deleted_at` (xóa mềm 30 ngày). */
  softDelete?: boolean;
  /** Thêm `version` cho khóa lạc quan (`updateVersioned`). */
  versioned?: boolean;
  /** Tên chỉ mục → lý do chỉ mục không bắt đầu bằng `account_id` (quy tắc d). */
  indexExceptions?: Record<string, string>;
}

/** Bộ cột của bảng `tenant` theo tùy chọn. */
export type TenantColumns<C, O extends TenantTableOptions> = StandardColumns &
  C &
  (O extends { softDelete: true } ? SoftDeleteColumns : unknown) &
  (O extends { versioned: true } ? VersionColumns : unknown);

type Extra<TName extends string, C extends Record<string, PgColumnBuilderBase>> = (
  self: BuildExtraConfigColumns<TName, C, 'pg'>,
) => PgTableExtraConfigValue[];

/**
 * Bảng khách hàng: bộ cột chuẩn (`id` UUID v7, `account_id` NOT NULL FK cascade, `created_at`,
 * `updated_at`, tùy chọn `deleted_at`/`version`) + chỉ mục `<bảng>_account_id_idx` + chính sách
 * `tenant_isolation` cho `app`, `system` (USING và WITH CHECK `account_id = current_account_id()`).
 */
export function tenantTable<
  TName extends string,
  C extends Record<string, PgColumnBuilderBase>,
  const O extends TenantTableOptions = TenantTableOptions,
>(schema: PgSchema, name: TName, columns: C, extra?: Extra<TName, TenantColumns<C, O>>, opts?: O) {
  const all = {
    ...standardColumns(),
    ...(opts?.softDelete === true ? softDeleteColumns() : {}),
    ...(opts?.versioned === true ? versionColumns() : {}),
    ...columns,
  } as TenantColumns<C, O>;

  const table = schema.table(name, all, (self) => [
    index(`${name}_account_id_idx`).on(self.account_id),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: [appRole, systemRole],
      using: sql`account_id = ${CURRENT_ACCOUNT_ID}`,
      withCheck: sql`account_id = ${CURRENT_ACCOUNT_ID}`,
    }),
    ...(extra ? extra(self) : []),
  ]);

  registerTable({
    schema: schema.schemaName,
    name,
    kind: 'tenant',
    tenantColumn: 'account_id',
    indexExceptions: { ...(opts?.indexExceptions ?? {}) },
  });
  return table;
}

/** Bảng dùng chung (không `account_id`, không RLS) – PHẢI ghi lý do (quy tắc b). */
export function sharedTable<TName extends string, C extends Record<string, PgColumnBuilderBase>>(
  schema: PgSchema,
  name: TName,
  columns: C,
  extra: Extra<TName, C> | undefined,
  opts: { reason: string },
) {
  if (opts.reason.trim() === '') {
    throw new Error(`Bảng dùng chung ${schema.schemaName}.${name} phải có lý do (reason)`);
  }
  const table = schema.table(name, columns, (self) => (extra ? extra(self) : []));
  registerTable({
    schema: schema.schemaName,
    name,
    kind: 'shared',
    tenantColumn: null,
    indexExceptions: {},
    reason: opts.reason,
  });
  return table;
}

/**
 * Bảng nhật ký phân vùng: định nghĩa CHỈ để truy vấn có kiểu. DDL (PARTITION BY, phân vùng, RLS,
 * quyền) viết tay trong migration; tệp định nghĩa đặt tên `*.log-table.ts` (ngoài glob drizzle-kit).
 */
export function partitionedLogTable<
  TName extends string,
  C extends Record<string, PgColumnBuilderBase>,
>(schema: PgSchema, name: TName, columns: C, opts: { partitionBy: keyof C & string }) {
  if (!(opts.partitionBy in columns)) {
    throw new Error(
      `Cột phân vùng ${opts.partitionBy} không có trong ${schema.schemaName}.${name}`,
    );
  }
  const table = schema.table(name, columns);
  registerTable({
    schema: schema.schemaName,
    name,
    kind: 'partitioned_log',
    tenantColumn: 'account_id' in columns ? 'account_id' : null,
    indexExceptions: {},
  });
  return table;
}

/**
 * Cột tiền micro-USD: `bigint` chế độ `bigint` (không mất chính xác; số thực bị cấm – quy tắc e).
 * `nonNegative` → dùng kèm `microUsdCheck()` trong `extra` để thêm `CHECK (<cột> >= 0)`.
 */
export function microUsd(name: string) {
  return bigint(name, { mode: 'bigint' });
}

/** Ràng buộc `CHECK (<cột> >= 0)` cho cột tiền. */
export function nonNegativeCheck(table: string, column: string) {
  return check(`${table}_${column}_non_negative`, sql.raw(`"${column}" >= 0`));
}
