// pnpm db:migrate – áp migration bằng vai trò "owner" (research R10). Idempotent nhờ nhật ký
// infra.schema_migrations; khóa tư vấn để hai bản chạy cùng lúc không đè nhau. Migration dev
// (schema sandbox) chỉ áp khi APP_ENV ∈ {development, test} (FR-017).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';
import { ensureQueues } from './ensure-queues';
import { loadMigrateConfig } from './script-config';
import { DRIZZLE_DIR, runScript } from './script-utils';

/** Khóa tư vấn cố định cho migration (số bất kỳ, chỉ cần không trùng với khóa khác của ứng dụng). */
const MIGRATION_LOCK_KEY = 4_200_200_002;
const MIGRATIONS_SCHEMA = 'infra';

export type AppEnvName = 'development' | 'test' | 'staging' | 'production';

export interface MigrateOptions {
  ownerUrl: string;
  appEnv: AppEnvName;
  /** 007 (R15): ở `staging` có cờ này thì áp thêm migration dev (schema `sandbox` cho bản giả lập). */
  stagingAllowFakes?: boolean;
  log?: (line: string) => void;
  /** Tạo/đồng bộ 6 hàng chờ pg-boss sau migration (003). Mặc định bật. */
  ensureQueues?: boolean;
}

export interface MigrateResult {
  main: number;
  dev: number;
  seconds: number;
}

async function countApplied(client: Client, table: string): Promise<number> {
  const exists = await client.query<{ found: boolean }>(
    'SELECT to_regclass($1) IS NOT NULL AS found',
    [`${MIGRATIONS_SCHEMA}.${table}`],
  );
  if (exists.rows[0]?.found !== true) return 0;
  const result = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${MIGRATIONS_SCHEMA}.${table}`,
  );
  return Number(result.rows[0]?.n ?? 0);
}

async function applyFolder(client: Client, folder: string, table: string): Promise<number> {
  const before = await countApplied(client, table);
  await migrate(drizzle(client), {
    migrationsFolder: folder,
    migrationsSchema: MIGRATIONS_SCHEMA,
    migrationsTable: table,
  });
  return (await countApplied(client, table)) - before;
}

/** Áp migration chính (+ dev khi được phép). Trả số migration mới đã áp. */
export async function runMigrations(options: MigrateOptions): Promise<MigrateResult> {
  const log =
    options.log ??
    ((line: string) => {
      console.log(line);
    });
  const started = performance.now();
  const client = new Client({ connectionString: options.ownerUrl, options: '-c TimeZone=UTC' });
  await client.connect();
  try {
    const who = await client.query<{ user: string }>('SELECT current_user AS "user"');
    if (who.rows[0]?.user !== 'owner') {
      throw new Error(
        `Migration phải chạy bằng vai trò "owner" (đang là "${who.rows[0]?.user ?? '?'}")`,
      );
    }
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${MIGRATIONS_SCHEMA} AUTHORIZATION "owner"`);
      const main = await applyFolder(client, join(DRIZZLE_DIR, 'migrations'), 'schema_migrations');

      let dev = 0;
      const devFolder = join(DRIZZLE_DIR, 'migrations-dev');
      const devAllowed =
        options.appEnv === 'development' ||
        options.appEnv === 'test' ||
        (options.appEnv === 'staging' && options.stagingAllowFakes === true);
      if (devAllowed && existsSync(join(devFolder, 'meta', '_journal.json'))) {
        dev = await applyFolder(client, devFolder, 'schema_migrations_dev');
      } else if (!devAllowed) {
        log(`Bỏ qua migration dev (APP_ENV=${options.appEnv})`);
      }

      // 003: tạo/đồng bộ 6 hàng chờ pg-boss sau migration (idempotent).
      if (options.ensureQueues !== false) {
        const queues = await ensureQueues(options.ownerUrl);
        if (queues.created.length > 0) log(`Đã tạo hàng chờ: ${queues.created.join(', ')}`);
      }

      const seconds = (performance.now() - started) / 1000;
      log(
        main + dev === 0
          ? `0 migration mới (${seconds.toFixed(1)} s)`
          : `Đã áp ${main} migration chính, ${dev} migration dev (${seconds.toFixed(1)} s)`,
      );
      return { main, dev, seconds };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}

export async function migrateFromEnv(
  env: Record<string, string | undefined> = process.env,
): Promise<MigrateResult> {
  const config = loadMigrateConfig(env);
  return runMigrations({
    ownerUrl: config.DATABASE_OWNER_URL,
    appEnv: config.APP_ENV,
    stagingAllowFakes: config.STAGING_ALLOW_FAKES,
  });
}

if (require.main === module) {
  runScript(async () => {
    await migrateFromEnv();
  });
}
