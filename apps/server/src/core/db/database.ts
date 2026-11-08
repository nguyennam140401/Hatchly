import type { UnitName } from '@app/shared/core';
import type { AppConfig } from '../config/config.schema';
import { createPool, type DbLogger, type DbRole, type RolePool } from './pools';

// Dịch vụ CSDL của một tiến trình: giữ các bể theo vai trò. Chỉ hạ tầng và kiểm thử dùng trực tiếp
// (contracts/db-layer-api.md mục 5) – module nghiệp vụ chỉ dùng tenantTx/systemTx/support*.

export type AppEnv = AppConfig['APP_ENV'];

export interface DatabaseOptions {
  unit: UnitName;
  appEnv: AppEnv;
  appUrl: string;
  /** Chỉ Worker tạo bể `system`. */
  systemUrl?: string | undefined;
  /** Chỉ API tạo bể `support`, khi có cấu hình. */
  supportUrl?: string | undefined;
  poolMax: number;
  statementTimeoutMs: number;
  idleInTxTimeoutMs: number;
  logger: DbLogger;
}

export class DatabaseService {
  readonly appEnv: AppEnv;
  readonly logger: DbLogger;
  private readonly pools = new Map<DbRole, RolePool>();

  constructor(readonly options: DatabaseOptions) {
    this.appEnv = options.appEnv;
    this.logger = options.logger;
    const settings = (role: DbRole) => ({
      max: options.poolMax,
      statementTimeoutMs: options.statementTimeoutMs,
      idleInTxTimeoutMs: options.idleInTxTimeoutMs,
      applicationName: `${options.unit}-${role}`,
    });
    this.pools.set('app', createPool('app', options.appUrl, settings('app'), options.logger));
    if (options.unit === 'worker' && options.systemUrl !== undefined) {
      this.pools.set(
        'system',
        createPool('system', options.systemUrl, settings('system'), options.logger),
      );
    }
    if (options.unit === 'api' && options.supportUrl !== undefined) {
      this.pools.set(
        'support',
        createPool('support', options.supportUrl, settings('support'), options.logger),
      );
    }
  }

  /** Bể của một vai trò; `undefined` khi đơn vị này không có vai trò đó. */
  pool(role: DbRole): RolePool | undefined {
    return this.pools.get(role);
  }

  /** Lấy và trả một kết nối của mọi bể – tự kiểm vai trò (R7). Ném lỗi đầu tiên gặp. */
  async verifyRoles(): Promise<void> {
    for (const pool of this.pools.values()) {
      const client = await pool.connect();
      client.release();
    }
  }

  /** `SELECT 1` trên bể `app`, hết hạn `timeoutMs` → false. Vai trò sai → ném `DbRoleInvalidError`. */
  async ping(timeoutMs = 2000): Promise<boolean> {
    const pool = this.pools.get('app');
    if (pool === undefined) return false;
    let timer: NodeJS.Timeout | undefined;
    const work = (async () => {
      const client = await pool.connect();
      try {
        await client.query('SELECT 1');
        return true;
      } finally {
        client.release();
      }
    })();
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => {
        resolve(false);
      }, timeoutMs);
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
      work.catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    if (active === this) active = undefined;
    await Promise.all([...this.pools.values()].map((p) => p.close()));
  }
}

/** Tạo dịch vụ CSDL từ cấu hình ứng dụng. */
export function createDatabase(
  config: AppConfig,
  unit: UnitName,
  logger: DbLogger,
): DatabaseService {
  return new DatabaseService({
    unit,
    appEnv: config.APP_ENV,
    appUrl: config.DATABASE_APP_URL,
    systemUrl: config.DATABASE_SYSTEM_URL,
    supportUrl: config.DATABASE_SUPPORT_URL,
    poolMax: config.DATABASE_POOL_MAX,
    statementTimeoutMs: config.DATABASE_STATEMENT_TIMEOUT_MS,
    idleInTxTimeoutMs: config.DATABASE_IDLE_IN_TX_TIMEOUT_MS,
    logger,
  });
}

// Một tiến trình có đúng một dịch vụ CSDL đang hoạt động; tenantTx/systemTx/support* dùng nó, nên
// module không bao giờ cầm bể hay thể hiện Drizzle "trần" (research R5 lớp 1).
let active: DatabaseService | undefined;

export function setActiveDatabase(db: DatabaseService | undefined): void {
  active = db;
}

export function activeDatabase(): DatabaseService {
  if (active === undefined) throw new Error('Lớp CSDL chưa được khởi tạo (DatabaseModule)');
  return active;
}
