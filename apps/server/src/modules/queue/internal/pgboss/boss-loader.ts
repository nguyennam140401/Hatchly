// Nơi DUY NHẤT nạp thư viện pg-boss (research R1, R2). pg-boss 12 là ESM thuần → `import()` động; kiểu
// nhập bằng `import type … with { 'resolution-mode': 'import' }` để build CommonJS (Node16) không chặn.
// Kiểu của thư viện KHÔNG BAO GIỜ ra khỏi `internal/` (FR-002).
import { Pool } from 'pg';
import type * as PgBossLib from 'pg-boss' with { 'resolution-mode': 'import' };
import { queueError } from '../errors';

export type PgBoss = PgBossLib.PgBoss;
export type BossDatabase = PgBossLib.Db;
export type BossJob = PgBossLib.JobWithMetadata<unknown>;
export type BossInstance = PgBossLib.Instance;

/** Phiên bản schema của pg-boss 12.38.0 (package.json `pgboss.schema`) – migration 0005 cài đúng bản này. */
export const EXPECTED_SCHEMA_VERSION = 46;
export const PGBOSS_SCHEMA = 'pgboss';

let lib: Promise<typeof PgBossLib> | undefined;

export function loadPgBoss(): Promise<typeof PgBossLib> {
  lib ??= import('pg-boss');
  return lib;
}

export interface QueuePoolOptions {
  url: string;
  max: number;
  /** Hiện trong pg_stat_activity, vd `worker-queue`. */
  applicationName: string;
  statementTimeoutMs?: number;
  /** Ghi mã lỗi kết nối rảnh (không ghi thông điệp gốc – có thể chứa máy chủ/người dùng). */
  onError?: (code: string) => void;
}

/** Bể riêng của lớp hàng chờ (bể điều khiển ở Worker – vai trò `system`; bể đọc ở API – vai trò `app`). */
export function createQueuePool(options: QueuePoolOptions): Pool {
  const pool = new Pool({
    connectionString: options.url,
    max: options.max,
    application_name: options.applicationName,
    options: `-c TimeZone=UTC -c statement_timeout=${options.statementTimeoutMs ?? 15000}`,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', (err) => {
    const code = (err as { code?: unknown }).code;
    options.onError?.(typeof code === 'string' ? code : 'UNKNOWN');
  });
  return pool;
}

/** Bộ nối IDatabase của pg-boss trên một bể `pg` do lớp hàng chờ quản lý. */
export function poolDatabase(pool: Pool): BossDatabase {
  return {
    executeSql: (text, values) => pool.query(text, values),
    poolCounts: () => ({
      max: pool.options.max,
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    }),
  };
}

/** Đọc phiên bản schema pgboss (NULL khi chưa cài). */
export async function readSchemaVersion(pool: Pool): Promise<number | null> {
  const r = await pool.query<{ version: number }>(
    `SELECT version FROM ${PGBOSS_SCHEMA}.version LIMIT 1`,
  );
  return r.rows[0]?.version ?? null;
}

/** Phiên bản schema lệch bản cố định → `QUEUE_SCHEMA_VERSION_MISMATCH` (không tự nâng – R2). */
export async function assertSchemaVersion(pool: Pool): Promise<void> {
  const version = await readSchemaVersion(pool);
  if (version !== EXPECTED_SCHEMA_VERSION) throw queueError('QUEUE_SCHEMA_VERSION_MISMATCH');
}

export interface WorkerBossOptions {
  /** Chu kỳ giám sát (trả việc mất heartbeat/quá hạn). Mặc định 30 giây. */
  superviseIntervalSeconds?: number;
  monitorIntervalSeconds?: number;
  queueCacheIntervalSeconds?: number;
}

/**
 * pg-boss của Worker trên bể điều khiển: giám sát (supervise) bật, KHÔNG tự hẹn giờ (bộ hẹn giờ riêng –
 * R9), KHÔNG sửa cấu trúc (migrate: false), ghi sổ bản tên `worker` (chỉ số số bản đang sống).
 */
export async function createWorkerBoss(
  pool: Pool,
  options: WorkerBossOptions = {},
): Promise<PgBoss> {
  const { PgBoss } = await loadPgBoss();
  return new PgBoss({
    db: poolDatabase(pool),
    schema: PGBOSS_SCHEMA,
    migrate: false,
    createSchema: false,
    supervise: true,
    schedule: false,
    registerInstance: true,
    instanceName: 'worker',
    reindex: false,
    superviseIntervalSeconds: options.superviseIntervalSeconds ?? 30,
    monitorIntervalSeconds: options.monitorIntervalSeconds ?? 30,
    queueCacheIntervalSeconds: options.queueCacheIntervalSeconds ?? 60,
    // Chỉ số của lớp hàng chờ do module tự đo (R11) – không để thư viện xuất chỉ số riêng.
    openTelemetry: { enabled: false },
  });
}

/**
 * pg-boss của API (vai trò `app`): KHÔNG chạy Worker/giám sát/sổ bản – chỉ giữ bộ nhớ đệm cấu hình hàng
 * chờ; mọi lệnh ghi đi qua kết nối của giao dịch (R4).
 */
export async function createProducerBoss(pool: Pool): Promise<PgBoss> {
  const { PgBoss } = await loadPgBoss();
  return new PgBoss({
    db: poolDatabase(pool),
    schema: PGBOSS_SCHEMA,
    migrate: false,
    createSchema: false,
    supervise: false,
    schedule: false,
    registerInstance: false,
    openTelemetry: { enabled: false },
  });
}
