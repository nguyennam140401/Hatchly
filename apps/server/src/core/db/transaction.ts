import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PoolClient } from 'pg';
import { getExecutionContext } from '../context/request-context';
import { activeDatabase } from './database';
import { isConnectionError, normalizePgError, TenantContextError } from './errors';
import type { DbRole, RolePool } from './pools';
import { guardClient } from './query-guard';

// Giao dịch tự quản trên PoolClient (research R3, R4; trạng thái ở data-model mục 9).
// BEGIN → set_config('app.account_id', $1, true) (PHẠM VI GIAO DỊCH) → kiểm tài khoản → fn → COMMIT.
// Lỗi → ROLLBACK; lỗi kết nối hoặc ROLLBACK lỗi → hủy kết nối (release(err)) thay vì trả về bể.

/** Drizzle gắn vào kết nối của giao dịch hiện tại. Chỉ dùng bên trong hàm truyền cho *Tx. */
export type Db = NodePgDatabase & { $client: PoolClient };

export interface TxContext {
  role: DbRole;
  /** null: giao dịch không tenant (systemTx 'none', supportSearch). */
  accountId: string | null;
  db: Db;
}

const txStorage = new AsyncLocalStorage<TxContext>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cách kiểm tài khoản tồn tại sau khi đặt ngữ cảnh. `support` không có quyền trên accounts. */
type ExistsCheck = 'accounts' | 'account_exists';

const EXISTS_SQL: Record<ExistsCheck, string> = {
  // Đi qua chính sách của accounts → đồng thời chứng minh biến phiên đã có hiệu lực (R3).
  accounts: 'SELECT 1 AS ok FROM account.accounts WHERE id = account.current_account_id()',
  account_exists:
    'SELECT 1 AS ok WHERE account.account_exists(account.current_account_id()) IS TRUE',
};

export interface RunTxOptions {
  existsCheck?: ExistsCheck;
  /** Bật bộ gác truy vấn (mặc định: bật khi không có tenant). */
  guard?: boolean;
  /** Chạy trong giao dịch, TRƯỚC `fn` (vd ghi dòng kiểm toán của hỗ trợ). */
  before?: (db: Db) => Promise<void>;
}

/** Lõi giao dịch – chỉ lớp CSDL dùng. */
export async function runTx<T>(
  pool: RolePool,
  role: DbRole,
  accountId: string | null,
  fn: (db: Db) => Promise<T>,
  options: RunTxOptions = {},
): Promise<T> {
  // Kiểm định dạng TRƯỚC khi lấy kết nối – mã sai không bao giờ chạm CSDL.
  if (accountId !== null && !UUID.test(accountId)) {
    throw new TenantContextError('TENANT_CONTEXT_INVALID');
  }
  const database = activeDatabase();
  const client = await pool.connect();
  // Kết nối bị máy chủ ngắt giữa giao dịch có thể phát sự kiện 'error' – lỗi đã trả cho người gọi.
  const onClientError = () => undefined;
  client.on('error', onClientError);
  let destroy: unknown;
  let unguard: (() => void) | undefined;
  try {
    await client.query('BEGIN');
    if (accountId !== null) {
      await client.query("SELECT set_config('app.account_id', $1, true)", [accountId]);
      const found = await client.query(EXISTS_SQL[options.existsCheck ?? 'accounts']);
      if (found.rowCount === 0) throw new TenantContextError('TENANT_NOT_FOUND');
    }
    if (options.guard ?? accountId === null) {
      unguard = guardClient(client, {
        appEnv: database.appEnv,
        logger: database.logger,
        traceId: () => getExecutionContext()?.traceId ?? null,
      });
    }
    const db: Db = drizzle(client);
    const result = await txStorage.run({ role, accountId, db }, async () => {
      if (options.before) await options.before(db);
      return fn(db);
    });
    unguard?.();
    unguard = undefined;
    await client.query('COMMIT');
    return result;
  } catch (err) {
    unguard?.();
    unguard = undefined;
    if (isConnectionError(err)) {
      destroy = err;
    } else {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        destroy = rollbackErr;
      }
    }
    throw normalizePgError(err);
  } finally {
    unguard?.();
    client.off('error', onClientError);
    // release(err) hủy kết nối; release() trả về bể – biến phiên đã mất cùng giao dịch.
    client.release(destroy === undefined ? undefined : destroy instanceof Error ? destroy : true);
  }
}

function requirePool(role: DbRole, missingMessage: string): RolePool {
  const pool = activeDatabase().pool(role);
  if (pool === undefined) throw new Error(missingMessage);
  return pool;
}

/** Bể của một vai trò hoặc lỗi lập trình nêu `missingMessage` (chỉ lớp CSDL dùng). */
export function rolePoolOrThrow(role: DbRole, missingMessage: string): RolePool {
  return requirePool(role, missingMessage);
}

/** Giao dịch lồng: cùng vai trò + cùng tài khoản → dùng lại; khác → CONFLICT. */
export function reuseOrConflict(role: DbRole, accountId: string | null): TxContext | undefined {
  const current = txStorage.getStore();
  if (current === undefined) return undefined;
  if (current.role === role && current.accountId === accountId) return current;
  throw new TenantContextError('TENANT_CONTEXT_CONFLICT');
}

/**
 * Giao dịch trong ngữ cảnh tenant (vai trò `app`). `accountId` lấy từ ExecutionContext hiện hành –
 * KHÔNG có tham số accountId (FR-004).
 */
export async function tenantTx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const accountId = getExecutionContext()?.accountId;
  if (accountId === undefined) throw new TenantContextError('TENANT_CONTEXT_MISSING');
  const current = reuseOrConflict('app', accountId);
  if (current !== undefined) return await fn(current.db);
  return await runTx(requirePool('app', 'Bể CSDL app chưa được khởi tạo'), 'app', accountId, fn);
}

/**
 * Giao dịch của việc dùng chung (vai trò `system`, chỉ Worker – FR-022). `'from-context'`: tài khoản
 * của việc trong ExecutionContext, chịu cùng RLS; `'none'`: không tenant, bộ gác truy vấn bật.
 */
export async function systemTx<T>(
  fn: (db: Db) => Promise<T>,
  opts: { tenant?: 'from-context' | 'none' } = {},
): Promise<T> {
  const pool = requirePool('system', 'systemTx chỉ dùng ở Worker (không có bể system)');
  let accountId: string | null = null;
  if (opts.tenant === 'from-context') {
    const fromContext = getExecutionContext()?.accountId;
    if (fromContext === undefined) throw new TenantContextError('TENANT_CONTEXT_MISSING');
    accountId = fromContext;
  }
  const current = reuseOrConflict('system', accountId);
  if (current !== undefined) return await fn(current.db);
  return await runTx(pool, 'system', accountId, fn);
}

/** Ngữ cảnh giao dịch hiện tại (dùng bởi support.ts để chặn lồng). */
export function currentTx(): { role: DbRole; accountId: string | null } | undefined {
  const tx = txStorage.getStore();
  return tx === undefined ? undefined : { role: tx.role, accountId: tx.accountId };
}

/**
 * Giao dịch hiện tại KÈM kết nối – CHỈ cho `modules/queue` (003 R4): pg-boss ghi việc trên đúng kết nối
 * của tenantTx/systemTx để việc và dữ liệu nghiệp vụ cùng xác nhận/hoàn tác. Không xuất qua index.ts.
 */
export function currentTxHandle(): TxContext | undefined {
  return txStorage.getStore();
}

/** Tài khoản của ngữ cảnh hiện hành (FR-007) – nhật ký và module đọc được; null khi không có. */
export function currentAccountId(): string | null {
  return txStorage.getStore()?.accountId ?? getExecutionContext()?.accountId ?? null;
}
