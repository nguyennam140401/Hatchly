import { Pool, type PoolClient } from 'pg';
import { normalizePgError } from './errors';

// Bể kết nối theo vai trò (research R7, R15). Chỉ lớp CSDL dùng – KHÔNG xuất qua core/index.ts.

export type DbRole = 'app' | 'system' | 'support';

/** Nhật ký tối thiểu của lớp CSDL – chỉ nhận đối tượng có cấu trúc, không bao giờ có bí mật. */
export interface DbLogger {
  warn(entry: Record<string, unknown>): void;
  error(entry: Record<string, unknown>): void;
}

export interface PoolSettings {
  max: number;
  statementTimeoutMs: number;
  idleInTxTimeoutMs: number;
  /** vd `api-app`, `worker-system` – hiện trong pg_stat_activity. */
  applicationName: string;
}

/** Vai trò đăng nhập không phải vai trò ứng dụng mong đợi, hoặc có quyền vượt RLS. */
export class DbRoleInvalidError extends Error {
  readonly code = 'DB_ROLE_INVALID';

  constructor(readonly roleName: string) {
    super(`Vai trò CSDL không hợp lệ cho ứng dụng: ${roleName}`);
    this.name = 'DbRoleInvalidError';
  }
}

/** Kiểm vai trò đăng nhập: đúng tên, không SUPERUSER, không BYPASSRLS (R7). */
export async function assertRuntimeRole(client: PoolClient, expected: DbRole): Promise<void> {
  const result = await client.query<{ user: string; rolsuper: boolean; rolbypassrls: boolean }>(
    `SELECT current_user AS "user", r.rolsuper, r.rolbypassrls
       FROM pg_catalog.pg_roles r WHERE r.rolname = current_user`,
  );
  const row = result.rows[0];
  const user = row?.user ?? '(không rõ)';
  if (row?.user !== expected || row.rolsuper || row.rolbypassrls) {
    throw new DbRoleInvalidError(user);
  }
}

/**
 * Bể của một vai trò: tạo `pg.Pool` lười, tự kiểm vai trò ở lần lấy kết nối đầu tiên thành công.
 * Mọi kết nối: `TimeZone=UTC`, `statement_timeout`, `idle_in_transaction_session_timeout`.
 */
export class RolePool {
  private pool: Pool | undefined;
  private verified: Promise<void> | undefined;

  constructor(
    readonly role: DbRole,
    private readonly url: string,
    private readonly settings: PoolSettings,
    private readonly logger: DbLogger,
  ) {}

  private getPool(): Pool {
    if (this.pool === undefined) {
      const pool = new Pool({
        connectionString: this.url,
        max: this.settings.max,
        application_name: this.settings.applicationName,
        options: `-c TimeZone=UTC -c statement_timeout=${this.settings.statementTimeoutMs} -c idle_in_transaction_session_timeout=${this.settings.idleInTxTimeoutMs}`,
        connectionTimeoutMillis: 5000,
      });
      // Lỗi trên kết nối rảnh (vd máy chủ khởi động lại): chỉ ghi mã, không ghi thông điệp gốc.
      pool.on('error', (err) => {
        const normalized = normalizePgError(err) as { code?: unknown };
        this.logger.warn({
          event: 'db.pool_error',
          role: this.role,
          code: typeof normalized.code === 'string' ? normalized.code : 'UNKNOWN',
        });
      });
      this.pool = pool;
    }
    return this.pool;
  }

  /** Lấy một kết nối; lỗi kết nối → `DbConnectionError`; vai trò sai → `DbRoleInvalidError`. */
  async connect(): Promise<PoolClient> {
    let client: PoolClient;
    try {
      client = await this.getPool().connect();
    } catch (err) {
      throw normalizePgError(err);
    }
    if (this.verified === undefined) {
      const check = assertRuntimeRole(client, this.role);
      this.verified = check;
      try {
        await check;
      } catch (err) {
        // Lỗi kết nối khi kiểm → thử lại lần sau; vai trò sai → giữ lỗi (mọi lần sau đều ném).
        if (!(err instanceof DbRoleInvalidError)) this.verified = undefined;
        client.release(true);
        throw normalizePgError(err);
      }
    } else {
      try {
        await this.verified;
      } catch (err) {
        client.release(true);
        throw err;
      }
    }
    return client;
  }

  /** Số kết nối đang mở (kiểm thử). */
  get totalCount(): number {
    return this.pool?.totalCount ?? 0;
  }

  async close(): Promise<void> {
    const pool = this.pool;
    this.pool = undefined;
    if (pool !== undefined) await pool.end();
  }
}

/** Tạo bể lười cho một vai trò. */
export function createPool(
  role: DbRole,
  url: string,
  settings: PoolSettings,
  logger: DbLogger,
): RolePool {
  return new RolePool(role, url, settings, logger);
}
