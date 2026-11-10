// pnpm db:check – kiểm tra quy ước CSDL trên danh mục hệ thống (contracts/db-conventions.md, R12).
// Cổng CI số 2 (bảng có account_id mà chưa bật RLS) + các quy tắc a–k. Chạy bằng DATABASE_OWNER_URL.
//   --json                       in { violations, checked }
//   --registry-extra <tệp.json>  bổ sung mục sổ đăng ký (mẫu kiểm thử)
// Mã thoát: 0 đạt · 1 có vi phạm · 2 không kết nối được / thiếu cấu hình.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { ConfigError } from '../core/config/load-config';
import { normalizePgError } from '../core/db/errors';
import { manifestModules, SANDBOX_SCHEMA } from '../core/db/module-schema';
import { tableRegistry, type TableRegistration } from '../core/db/table-registry';
import { loadCheckConfig } from './script-config';
import { describeError } from './script-utils';

export type RuleCode =
  | 'a-rls-missing'
  | 'b-tenant-column-missing'
  | 'c-cross-schema-fk'
  | 'd-index-not-tenant-first'
  | 'e-money-float'
  | 'f-not-owned-by-owner'
  | 'g-app-privileges'
  | 'h-fk-delete-rule'
  | 'i-support-view-leak'
  | 'j-unregistered-table'
  | 'k-reserved-schema-not-empty'
  | 'l-nullable-tenant-without-reason';

/**
 * Schema của thư viện ngoài module (003 research R12): không áp quy tắc b, j (bảng của thư viện không
 * khai báo bằng tenantTable/sharedTable); áp f (mọi đối tượng thuộc owner), g (không CREATE cho vai trò
 * ứng dụng) và kiểm bảng việc có RLS + chính sách (a).
 */
export const LIBRARY_SCHEMAS = ['pgboss'] as const;
/** Bảng của thư viện BẮT BUỘC bật RLS (việc mang group_id = mã tài khoản). */
const LIBRARY_RLS_TABLES = ['pgboss.job', 'pgboss.job_common'];

export interface Violation {
  schema: string;
  table: string;
  rule: RuleCode;
  detail: string;
}

export interface CheckResult {
  violations: Violation[];
  checked: { schemas: number; tables: number; views: number };
}

export interface ManifestInfo {
  schemas: string[];
  reservedSchemas: string[];
}

export interface CheckOptions {
  registry: ReadonlyMap<string, TableRegistration>;
  manifest: ManifestInfo;
}

const APP_ROLES = ['app', 'system', 'support'] as const;
const MIGRATION_TABLES = new Set(['infra.schema_migrations', 'infra.schema_migrations_dev']);
const MONEY_COLUMN = /(_micro_usd|_usd|cost|price|amount)/;
const FLOAT_TYPES = new Set(['real', 'double precision', 'numeric']);

interface TableRow {
  oid: number;
  schema: string;
  name: string;
  relkind: string;
  rls: boolean;
  policies: number;
  has_account_id: boolean;
  account_id_attnum: number | null;
  account_id_nullable: boolean;
}

/** Chạy mọi quy tắc trên CSDL mà `client` đang kết nối. */
export async function checkConventions(
  client: Client,
  options: CheckOptions,
): Promise<CheckResult> {
  const present = new Set(
    (await client.query<{ nspname: string }>('SELECT nspname FROM pg_namespace')).rows.map(
      (r) => r.nspname,
    ),
  );
  const scope = [
    ...options.manifest.schemas,
    ...(present.has(SANDBOX_SCHEMA) ? [SANDBOX_SCHEMA] : []),
  ];
  const violations: Violation[] = [];
  const add = (schema: string, table: string, rule: RuleCode, detail: string) =>
    violations.push({ schema, table, rule, detail });
  const reg = (schema: string, name: string) => options.registry.get(`${schema}.${name}`);

  // Bảng (thường + phân vùng gốc; bỏ bảng con phân vùng – kiểm qua bảng cha).
  const tables = (
    await client.query<TableRow>(
      `SELECT c.oid::int AS oid, n.nspname AS schema, c.relname AS name, c.relkind::text AS relkind,
              c.relrowsecurity AS rls,
              (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
              a.attnum IS NOT NULL AS has_account_id, a.attnum::int AS account_id_attnum,
              coalesce(NOT a.attnotnull, false) AS account_id_nullable
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'account_id' AND NOT a.attisdropped
        WHERE n.nspname = ANY($1) AND c.relkind IN ('r', 'p') AND NOT c.relispartition
        ORDER BY 2, 3`,
      [scope],
    )
  ).rows.filter((t) => !MIGRATION_TABLES.has(`${t.schema}.${t.name}`));

  const isRoot = (t: TableRow) => t.schema === 'account' && t.name === 'accounts';
  /** Bảng coi là `tenant`: đăng ký tenant, hoặc chưa đăng ký mà có account_id. */
  const isTenant = (t: TableRow) => {
    const r = reg(t.schema, t.name);
    return r ? r.kind === 'tenant' : t.has_account_id;
  };

  for (const t of tables) {
    const r = reg(t.schema, t.name);
    // (a) bảng có account_id (hoặc bảng gốc) chưa bật RLS / không có chính sách.
    if ((t.has_account_id || isRoot(t)) && (!t.rls || t.policies === 0)) {
      add(
        t.schema,
        t.name,
        'a-rls-missing',
        t.rls ? 'đã bật RLS nhưng không có chính sách' : 'bảng có account_id nhưng chưa bật RLS',
      );
    }
    // (b) không có account_id mà không phải bảng dùng chung / nhật ký phân vùng / bảng gốc.
    if (!t.has_account_id && !isRoot(t) && r?.kind !== 'shared' && r?.kind !== 'partitioned_log') {
      add(
        t.schema,
        t.name,
        'b-tenant-column-missing',
        'không có cột account_id và chưa đăng ký là bảng dùng chung (sharedTable + reason)',
      );
    }
    if (r?.kind === 'shared' && (r.reason ?? '').trim() === '') {
      add(t.schema, t.name, 'b-tenant-column-missing', 'bảng dùng chung thiếu lý do (reason)');
    }
    // (j) bảng không có trong sổ đăng ký.
    if (r === undefined) {
      add(
        t.schema,
        t.name,
        'j-unregistered-table',
        'bảng không khai báo bằng tenantTable/sharedTable/partitionedLogTable',
      );
    }
    // (l) bảng tenant có account_id cho phép NULL mà không khai báo lý do (003 – nullableTenant).
    if (
      isTenant(t) &&
      !isRoot(t) &&
      t.account_id_nullable &&
      (r?.nullableTenant?.reason ?? '').trim() === ''
    ) {
      add(
        t.schema,
        t.name,
        'l-nullable-tenant-without-reason',
        'account_id cho phép NULL – thêm NOT NULL hoặc đăng ký nullableTenant: { reason } nếu cố ý',
      );
    }
  }

  // (a) bảng việc của thư viện hàng chờ (schema ngoài module) phải bật RLS + có chính sách (R12).
  const libraries = LIBRARY_SCHEMAS.filter((s) => present.has(s));
  if (libraries.length > 0) {
    const libTables = (
      await client.query<{ schema: string; name: string; rls: boolean; policies: number }>(
        `SELECT n.nspname AS schema, c.relname AS name, c.relrowsecurity AS rls,
                (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname || '.' || c.relname = ANY($1)`,
        [LIBRARY_RLS_TABLES],
      )
    ).rows;
    for (const t of libTables) {
      if (!t.rls || t.policies === 0) {
        add(
          t.schema,
          t.name,
          'a-rls-missing',
          t.rls
            ? 'đã bật RLS nhưng không có chính sách'
            : 'bảng việc của thư viện hàng chờ chưa bật RLS',
        );
      }
    }
  }
  /** Phạm vi cho quy tắc f, g: schema module + schema thư viện. */
  const ownedScope = [...scope, ...libraries];

  // (c), (h) khóa ngoại.
  const fks = (
    await client.query<{
      schema: string;
      table: string;
      name: string;
      target_schema: string;
      target_table: string;
      deltype: string;
    }>(
      `SELECT n.nspname AS schema, c.relname AS table, con.conname AS name,
              tn.nspname AS target_schema, tc.relname AS target_table, con.confdeltype::text AS deltype
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_class tc ON tc.oid = con.confrelid JOIN pg_namespace tn ON tn.oid = tc.relnamespace
        WHERE con.contype = 'f' AND n.nspname = ANY($1) AND NOT c.relispartition
        ORDER BY 1, 2, 3`,
      [scope],
    )
  ).rows;
  for (const fk of fks) {
    const toRoot = fk.target_schema === 'account' && fk.target_table === 'accounts';
    if (fk.target_schema !== fk.schema && !toRoot) {
      add(
        fk.schema,
        fk.table,
        'c-cross-schema-fk',
        `khóa ngoại ${fk.name} trỏ sang ${fk.target_schema}.${fk.target_table} (chỉ được trỏ trong schema hoặc tới account.accounts)`,
      );
    }
    if (toRoot) {
      const r = reg(fk.schema, fk.table);
      if (r?.kind === 'partitioned_log') {
        add(
          fk.schema,
          fk.table,
          'h-fk-delete-rule',
          `bảng nhật ký phân vùng không được có khóa ngoại tới accounts (${fk.name})`,
        );
      } else if (fk.deltype !== 'c') {
        add(
          fk.schema,
          fk.table,
          'h-fk-delete-rule',
          `khóa ngoại ${fk.name} tới accounts phải ON DELETE CASCADE`,
        );
      }
    }
  }

  // (d) chỉ mục của bảng tenant không bắt đầu bằng account_id.
  const indexes = (
    await client.query<{ schema: string; table: string; name: string; first: number }>(
      `SELECT n.nspname AS schema, c.relname AS table, ic.relname AS name, i.indkey[0]::int AS first
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_class ic ON ic.oid = i.indexrelid
        WHERE n.nspname = ANY($1) AND NOT i.indisprimary AND NOT c.relispartition
        ORDER BY 1, 2, 3`,
      [scope],
    )
  ).rows;
  for (const ix of indexes) {
    const t = tables.find((x) => x.schema === ix.schema && x.name === ix.table);
    if (t === undefined || isRoot(t) || !isTenant(t) || t.account_id_attnum === null) continue;
    if (ix.first === t.account_id_attnum) continue;
    const reason = reg(t.schema, t.name)?.indexExceptions[ix.name];
    if (reason !== undefined && reason.trim() !== '') continue;
    add(
      ix.schema,
      ix.table,
      'd-index-not-tenant-first',
      `chỉ mục ${ix.name} không bắt đầu bằng account_id (thêm vào indexExceptions kèm lý do nếu cố ý)`,
    );
  }

  // (e) cột tiền kiểu số thực.
  const money = (
    await client.query<{ schema: string; table: string; column: string; type: string }>(
      `SELECT n.nspname AS schema, c.relname AS table, a.attname AS column,
              format_type(a.atttypid, NULL) AS type
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ANY($1) AND c.relkind IN ('r', 'p') AND NOT c.relispartition
          AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY 1, 2, 3`,
      [scope],
    )
  ).rows;
  for (const col of money) {
    if (MONEY_COLUMN.test(col.column) && FLOAT_TYPES.has(col.type)) {
      add(
        col.schema,
        col.table,
        'e-money-float',
        `cột tiền ${col.column} kiểu ${col.type} – dùng bigint micro-USD (microUsd)`,
      );
    }
  }

  // (f) đối tượng không thuộc owner.
  const owners = (
    await client.query<{ schema: string; obj: string; kind: string; owner: string }>(
      `SELECT nspname AS schema, '-' AS obj, 'schema' AS kind, pg_get_userbyid(nspowner) AS owner
         FROM pg_namespace WHERE nspname = ANY($1)
       UNION ALL
       SELECT n.nspname, c.relname,
              CASE c.relkind WHEN 'v' THEN 'khung nhìn' WHEN 'm' THEN 'khung nhìn' WHEN 'S' THEN 'chuỗi' ELSE 'bảng' END,
              pg_get_userbyid(c.relowner)
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ANY($1) AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
       UNION ALL
       SELECT n.nspname, p.proname || '()', 'hàm', pg_get_userbyid(p.proowner)
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = ANY($1)
       ORDER BY 1, 2`,
      [ownedScope],
    )
  ).rows;
  for (const o of owners) {
    if (o.owner !== 'owner') {
      add(
        o.schema,
        o.obj,
        'f-not-owned-by-owner',
        `${o.kind} thuộc "${o.owner}", phải thuộc "owner"`,
      );
    }
  }

  // (g) quyền của vai trò ứng dụng.
  const roles = (
    await client.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
      member_of: string[] | null;
      owned: number;
    }>(
      `SELECT r.rolname, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
              (SELECT array_agg(g.rolname::text) FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid
                WHERE m.member = r.oid) AS member_of,
              (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relowner = r.oid AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                  AND n.nspname NOT LIKE 'pg\\_%')
              + (SELECT count(*)::int FROM pg_namespace n WHERE n.nspowner = r.oid)
              + (SELECT count(*)::int FROM pg_proc p WHERE p.proowner = r.oid) AS owned
         FROM pg_roles r WHERE r.rolname = ANY($1) ORDER BY 1`,
      [[...APP_ROLES]],
    )
  ).rows;
  for (const r of roles) {
    const flags = [
      r.rolsuper && 'SUPERUSER',
      r.rolbypassrls && 'BYPASSRLS',
      r.rolcreaterole && 'CREATEROLE',
      r.rolcreatedb && 'CREATEDB',
    ].filter(Boolean);
    if (flags.length > 0)
      add('-', r.rolname, 'g-app-privileges', `vai trò ${r.rolname} có ${flags.join(', ')}`);
    if (r.member_of && r.member_of.length > 0) {
      add(
        '-',
        r.rolname,
        'g-app-privileges',
        `vai trò ${r.rolname} là thành viên của ${r.member_of.join(', ')}`,
      );
    }
    if (r.owned > 0)
      add('-', r.rolname, 'g-app-privileges', `vai trò ${r.rolname} sở hữu ${r.owned} đối tượng`);
  }
  const createPrivs = (
    await client.query<{ role: string; schema: string }>(
      `SELECT r.role, n.nspname AS schema
         FROM unnest($1::text[]) AS r(role)
         CROSS JOIN pg_namespace n
        WHERE (n.nspname = ANY($2) OR n.nspname = 'public') AND has_schema_privilege(r.role, n.oid, 'CREATE')
        ORDER BY 2, 1`,
      [[...APP_ROLES], ownedScope],
    )
  ).rows;
  for (const p of createPrivs) {
    add(
      p.schema,
      '-',
      'g-app-privileges',
      `vai trò ${p.role} có quyền CREATE trên schema ${p.schema}`,
    );
  }

  // (i) khung nhìn (do owner sở hữu → vượt RLS) cấp cho app/system.
  const views = (
    await client.query<{ schema: string; name: string; leaked_to: string[] | null }>(
      `SELECT n.nspname AS schema, c.relname AS name,
              ARRAY(SELECT r FROM unnest(ARRAY['app', 'system']) AS r
                     WHERE has_table_privilege(r, c.oid, 'SELECT')) AS leaked_to
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ANY($1) AND c.relkind IN ('v', 'm')
        ORDER BY 1, 2`,
      [scope],
    )
  ).rows;
  for (const v of views) {
    if (v.leaked_to && v.leaked_to.length > 0) {
      add(
        v.schema,
        v.name,
        'i-support-view-leak',
        `khung nhìn đọc vượt RLS nhưng cấp SELECT cho ${v.leaked_to.join(', ')} – chỉ được cấp cho support`,
      );
    }
  }

  // (k) schema dành sẵn không được chứa bảng.
  for (const schema of options.manifest.reservedSchemas) {
    for (const t of tables.filter((x) => x.schema === schema)) {
      add(
        schema,
        t.name,
        'k-reserved-schema-not-empty',
        `schema ${schema} là schema dành sẵn (reservedSchema) – chưa được có bảng`,
      );
    }
  }

  return {
    violations,
    checked: { schemas: scope.length, tables: tables.length, views: views.length },
  };
}

/** Tệp kê khai rút gọn cho kiểm tra. */
export function manifestInfo(): ManifestInfo {
  const modules = manifestModules();
  return {
    schemas: modules.map((m) => m.schema),
    reservedSchemas: modules.filter((m) => m.reservedSchema === true).map((m) => m.schema),
  };
}

const SERVER_DIR = resolve(__dirname, '..', '..');

/**
 * Nạp sổ đăng ký: bảng gốc, mọi `modules/*\/internal/db/schema.ts` và `*.log-table.ts`, bảng nhật ký
 * của lõi, và bảng mẫu `sandbox` khi được yêu cầu. Trả false nếu không nạp được định nghĩa sandbox
 * (vd chạy từ dist/ – thư mục test không có trong ảnh).
 */
export function loadRegistry(includeSandbox: boolean): { sandboxLoaded: boolean } {
  /* eslint-disable @typescript-eslint/no-require-imports -- nạp động định nghĩa bảng theo thư mục */
  require('../core/db/tenant-root');
  require('../core/db/audit-log.log-table');
  const modulesDir = resolve(__dirname, '..', 'modules');
  for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dbDir = join(modulesDir, entry.name, 'internal', 'db');
    if (!existsSync(dbDir)) continue;
    for (const file of readdirSync(dbDir)) {
      if (/^schema\.[jt]s$/.test(file) || /\.log-table\.[jt]s$/.test(file))
        require(join(dbDir, file));
    }
  }
  let sandboxLoaded = false;
  if (includeSandbox) {
    const sandbox = join(SERVER_DIR, 'test', 'db', 'sandbox', 'schema.ts');
    if (existsSync(sandbox) && __filename.endsWith('.ts')) {
      // Schema sandbox chỉ có trên CSDL dev/test (migration dev) – coi như đang ở môi trường đó.
      process.env.APP_ENV ??= 'development';
      try {
        require(sandbox);
        sandboxLoaded = true;
      } catch {
        sandboxLoaded = false;
      }
    }
  }
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { sandboxLoaded };
}

function mergeExtra(file: string): Map<string, TableRegistration> {
  const merged = new Map(tableRegistry());
  const extra = JSON.parse(readFileSync(file, 'utf8')) as (Omit<
    TableRegistration,
    'indexExceptions'
  > & { indexExceptions?: Record<string, string> })[];
  for (const e of extra) {
    merged.set(`${e.schema}.${e.name}`, { ...e, indexExceptions: e.indexExceptions ?? {} });
  }
  return merged;
}

const COL_SCHEMA = 16;
const COL_TABLE = 28;
const COL_RULE = 28;

function printTable(result: CheckResult): void {
  const { checked, violations } = result;
  const lines = [
    `Kiểm tra quy ước CSDL – ${checked.schemas} schema, ${checked.tables} bảng, ${checked.views} khung nhìn`,
  ];
  if (violations.length > 0) {
    lines.push(
      `${'schema'.padEnd(COL_SCHEMA)}${'bảng'.padEnd(COL_TABLE)}${'quy tắc'.padEnd(COL_RULE)}chi tiết`,
    );
    for (const v of violations) {
      lines.push(
        `${v.schema.padEnd(COL_SCHEMA)}${v.table.padEnd(COL_TABLE)}${v.rule.padEnd(COL_RULE)}${v.detail}`,
      );
    }
  }
  lines.push(
    violations.length === 0 ? '→ ĐẠT: 0 vi phạm' : `→ THẤT BẠI: ${violations.length} vi phạm`,
  );
  console.log(lines.join('\n'));
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const extraIndex = args.indexOf('--registry-extra');
  const extraFile = extraIndex >= 0 ? args[extraIndex + 1] : undefined;
  let config;
  try {
    config = loadCheckConfig();
  } catch (err) {
    console.error(err instanceof ConfigError ? err.message : describeError(err));
    return 2;
  }
  const client = new Client({ connectionString: config.DATABASE_OWNER_URL });
  try {
    await client.connect();
  } catch (err) {
    const code = (normalizePgError(err) as { code?: unknown }).code;
    console.error(
      `Không kết nối được CSDL bằng DATABASE_OWNER_URL (mã ${typeof code === 'string' ? code : 'UNKNOWN'})`,
    );
    return 2;
  }
  try {
    const hasSandbox =
      (await client.query("SELECT 1 FROM pg_namespace WHERE nspname = 'sandbox'")).rowCount === 1;
    const { sandboxLoaded } = loadRegistry(hasSandbox);
    const manifest = manifestInfo();
    const registry = extraFile !== undefined ? mergeExtra(resolve(extraFile)) : tableRegistry();
    let result = await checkConventions(client, { registry, manifest });
    if (hasSandbox && !sandboxLoaded) {
      // Ảnh container không có định nghĩa bảng mẫu – bỏ qua schema sandbox thay vì báo sai.
      result = {
        ...result,
        violations: result.violations.filter((v) => v.schema !== SANDBOX_SCHEMA),
      };
      if (!json) console.log('Bỏ qua schema sandbox (không có test/db/sandbox/schema.ts)');
    }
    if (json) console.log(JSON.stringify(result));
    else printTable(result);
    return result.violations.length === 0 ? 0 : 1;
  } catch (err) {
    console.error(`Lỗi: ${describeError(err)}`);
    return 2;
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (require.main === module) {
  void main().then((code) => process.exit(code));
}
