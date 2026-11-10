// US2-AS1, AS2, SC-004, FR-017: migration từ CSDL trống, chạy lại, chạy song song, production.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, expect, it } from 'vitest';
import { runBootstrap } from '../../src/db/bootstrap';
import { runMigrations } from '../../src/db/migrate';
import { dbUrls, describeDb } from './helpers/db';

const manifestSchemas = (
  JSON.parse(readFileSync(resolve('src/modules/modules.manifest.json'), 'utf8')) as {
    modules: { schema: string }[];
  }
).modules.map((m) => m.schema);

const created: string[] = [];
const quiet = () => undefined;

function urlFor(base: string, database: string): string {
  const u = new URL(base);
  u.pathname = `/${database}`;
  return u.toString();
}

/** CSDL trống mới (đã bootstrap vai trò, chưa migrate). */
async function freshDatabase(): Promise<{ name: string; ownerUrl: string }> {
  const name = `app_test_mig_${randomBytes(3).toString('hex')}`;
  created.push(name);
  await runBootstrap({
    adminUrl: dbUrls.admin,
    database: name,
    // Vai trò đã có (globalSetup) → giữ mật khẩu; giá trị ở đây chỉ dùng khi phải tạo mới.
    passwords: {
      owner: 'x'.repeat(8),
      app: 'x'.repeat(8),
      system: 'x'.repeat(8),
      support: 'x'.repeat(8),
    },
    keepExistingPasswords: true,
    log: quiet,
  });
  return { name, ownerUrl: urlFor(dbUrls.owner, name) };
}

async function query<T extends object>(url: string, text: string): Promise<T[]> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query<T>(text)).rows;
  } finally {
    await c.end();
  }
}

const SNAPSHOT = `
  SELECT 'class:' || n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity::text AS k
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  UNION ALL
  SELECT 'policy:' || polname || ':' || polrelid::regclass::text FROM pg_policy
  UNION ALL
  SELECT 'ns:' || nspname || ':' || pg_get_userbyid(nspowner) FROM pg_namespace
  ORDER BY 1`;

describeDb('Migration có quản lý', () => {
  afterAll(async () => {
    const c = new Client({ connectionString: dbUrls.admin });
    await c.connect();
    try {
      for (const name of created) {
        await c.query(`DROP DATABASE IF EXISTS ${c.escapeIdentifier(name)} WITH (FORCE)`);
      }
    } finally {
      await c.end();
    }
  });

  it('CSDL trống: lần 1 ≤ 60 s, tập schema = tệp kê khai; lần 2: 0 migration mới, cấu trúc không đổi', async () => {
    const db = await freshDatabase();
    const first = await runMigrations({ ownerUrl: db.ownerUrl, appEnv: 'test', log: quiet });
    expect(first.seconds).toBeLessThanOrEqual(60);
    expect(first.main).toBeGreaterThan(0);
    expect(first.dev).toBeGreaterThan(0);

    const schemas = await query<{ nspname: string }>(
      db.ownerUrl,
      `SELECT nspname FROM pg_namespace
        WHERE nspname NOT IN ('public', 'information_schema', 'sandbox') AND nspname NOT LIKE 'pg\\_%'`,
    );
    expect(schemas.map((s) => s.nspname).sort()).toEqual([...manifestSchemas, 'pgboss'].sort()); // + schema thư viện hàng chờ (003)

    const approvalTables = await query(
      db.ownerUrl,
      "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'approval'",
    );
    expect(approvalTables).toHaveLength(0);

    const before = await query<{ k: string }>(db.ownerUrl, SNAPSHOT);
    const lines: string[] = [];
    const second = await runMigrations({
      ownerUrl: db.ownerUrl,
      appEnv: 'test',
      log: (l) => lines.push(l),
    });
    expect(second.main + second.dev).toBe(0);
    expect(lines.join('\n')).toContain('0 migration mới');
    expect(await query<{ k: string }>(db.ownerUrl, SNAPSHOT)).toEqual(before);
  });

  it('hai lần migrate song song không lỗi (khóa tư vấn)', async () => {
    const db = await freshDatabase();
    const results = await Promise.all([
      runMigrations({ ownerUrl: db.ownerUrl, appEnv: 'test', log: quiet }),
      runMigrations({ ownerUrl: db.ownerUrl, appEnv: 'test', log: quiet }),
    ]);
    expect(results.map((r) => r.main).sort()).toEqual(
      [0, results[0].main + results[1].main].sort(),
    );
    const applied = await query<{ n: number }>(
      db.ownerUrl,
      'SELECT count(*)::int AS n FROM infra.schema_migrations',
    );
    expect(applied[0]!.n).toBe(results[0].main + results[1].main);
  });

  it('APP_ENV=production: không có schema sandbox', async () => {
    const db = await freshDatabase();
    const lines: string[] = [];
    const result = await runMigrations({
      ownerUrl: db.ownerUrl,
      appEnv: 'production',
      log: (l) => lines.push(l),
    });
    expect(result.dev).toBe(0);
    expect(lines.join('\n')).toContain('Bỏ qua migration dev');
    const sandbox = await query(
      db.ownerUrl,
      "SELECT 1 FROM pg_namespace WHERE nspname = 'sandbox'",
    );
    expect(sandbox).toHaveLength(0);
  });

  it('migrate bằng vai trò khác owner → từ chối', async () => {
    await expect(
      runMigrations({ ownerUrl: dbUrls.app, appEnv: 'test', log: quiet }),
    ).rejects.toThrow(/vai trò "owner"/);
  });
});
