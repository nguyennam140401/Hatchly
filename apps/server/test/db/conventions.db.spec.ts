// SC-003, US3, US2-AS4 (qua mẫu c): db:check không báo sai trên cấu trúc sạch và phát hiện đúng
// từng quy tắc trên mẫu vi phạm. Mỗi mẫu chạy trên CSDL tạm sao từ một CSDL sạch (TEMPLATE).
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import '../../src/core/db/audit-log.log-table';
import { tableRegistry, type TableRegistration } from '../../src/core/db/table-registry';
import { checkConventions, manifestInfo, type CheckResult } from '../../src/db/check-conventions';
import { runBootstrap } from '../../src/db/bootstrap';
import { runMigrations } from '../../src/db/migrate';
import { dbUrls, describeDb } from './helpers/db';
import '../../src/modules/queue/internal/db/schema';
import './sandbox/schema';
// 005: bảng trạng thái của bản giả lập (schema sandbox, migration dev).
import '../../src/dev/sandbox/schema';
// Bảng của module (đăng ký vào sổ khi nạp) – như db:check nạp mọi modules/*/internal/db/schema.ts.
import '../../src/modules/account/internal/db/schema';

const FIXTURES = join(__dirname, 'fixtures', 'conventions');
const fixtures = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => f.replace(/\.sql$/, ''))
  .sort();

const withDb = (base: string, name: string) => {
  const u = new URL(base);
  u.pathname = `/${name}`;
  return u.toString();
};

async function run<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

const created: string[] = [];
const suffix = randomBytes(3).toString('hex');
const clean = `app_test_conv_${suffix}`;

function registryWith(fixture: string): Map<string, TableRegistration> {
  const merged = new Map(tableRegistry());
  const file = join(FIXTURES, `${fixture}.registry.json`);
  if (existsSync(file)) {
    for (const e of JSON.parse(readFileSync(file, 'utf8')) as TableRegistration[]) {
      merged.set(`${e.schema}.${e.name}`, e);
    }
  }
  return merged;
}

async function check(database: string, fixture?: string): Promise<CheckResult> {
  return run(withDb(dbUrls.owner, database), (c) =>
    checkConventions(c, {
      registry: fixture ? registryWith(fixture) : tableRegistry(),
      manifest: manifestInfo(),
    }),
  );
}

describeDb('Kiểm tra quy ước CSDL (db:check)', () => {
  beforeAll(async () => {
    created.push(clean);
    await runBootstrap({
      adminUrl: dbUrls.admin,
      database: clean,
      passwords: { owner: 'unused00', app: 'unused00', system: 'unused00', support: 'unused00' },
      keepExistingPasswords: true,
      log: () => undefined,
    });
    await runMigrations({
      ownerUrl: withDb(dbUrls.owner, clean),
      appEnv: 'test',
      log: () => undefined,
    });
  });

  afterAll(async () => {
    await run(dbUrls.admin, async (c) => {
      for (const name of created.reverse()) {
        await c.query(`DROP DATABASE IF EXISTS ${c.escapeIdentifier(name)} WITH (FORCE)`);
      }
    });
  });

  it('có đủ mẫu cho 12 quy tắc a–l', () => {
    expect(fixtures.map((f) => f[0])).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
      'i',
      'j',
      'k',
      'l',
    ]);
  });

  it('003: pgboss.job_common tắt RLS → a-rls-missing; vai trò app có CREATE trên pgboss → g', async () => {
    const name = `app_test_fx_pgboss_${suffix}`;
    created.push(name);
    await run(dbUrls.admin, (c) =>
      c.query(`CREATE DATABASE ${c.escapeIdentifier(name)} TEMPLATE ${c.escapeIdentifier(clean)}`),
    );
    await run(withDb(dbUrls.admin, name), (c) =>
      c.query(
        'ALTER TABLE pgboss.job_common DISABLE ROW LEVEL SECURITY; GRANT CREATE ON SCHEMA pgboss TO "app";',
      ),
    );
    const result = await check(name);
    expect(result.violations.map((v) => `${v.rule}:${v.schema}.${v.table}`).sort()).toEqual([
      'a-rls-missing:pgboss.job_common',
      'g-app-privileges:pgboss.-',
    ]);
  });

  it('cấu trúc sạch sau migration → 0 vi phạm (SC-003: 0 báo sai)', async () => {
    const result = await check(clean);
    expect(result.violations).toEqual([]);
    expect(result.checked.tables).toBeGreaterThanOrEqual(3);
    expect(result.checked.views).toBe(4); // + 2 khung nhìn hỗ trợ việc hỏng (003)
  });

  it.each(fixtures)('%s → phát hiện đúng quy tắc mong đợi', async (fixture) => {
    const name = `app_test_fx_${fixture[0]}_${suffix}`;
    created.push(name);
    await run(dbUrls.admin, (c) =>
      c.query(`CREATE DATABASE ${c.escapeIdentifier(name)} TEMPLATE ${c.escapeIdentifier(clean)}`),
    );
    // Quản trị cụm áp mẫu: vài vi phạm (vd đổi chủ sang postgres) owner không tự làm được.
    await run(withDb(dbUrls.admin, name), (c) =>
      c.query(readFileSync(join(FIXTURES, `${fixture}.sql`), 'utf8')),
    );
    const expected = (
      JSON.parse(readFileSync(join(FIXTURES, `${fixture}.expected.json`), 'utf8')) as {
        rules: string[];
      }
    ).rules;
    const result = await check(name, fixture);
    expect([...new Set(result.violations.map((v) => v.rule))].sort()).toEqual([...expected].sort());
  });

  it('CLI: DATABASE_OWNER_URL trỏ cổng đóng → mã 2, chỉ nêu tên biến, không in chuỗi kết nối', () => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/db/check-conventions.ts'], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        SYSTEMROOT: process.env.SYSTEMROOT ?? '',
        DATABASE_OWNER_URL: 'postgres://owner:S3cr3t_marker@127.0.0.1:1/app',
      },
    });
    expect(r.status).toBe(2);
    const out = `${r.stdout}${r.stderr}`;
    expect(out).toContain('DATABASE_OWNER_URL');
    expect(out).not.toContain('S3cr3t_marker');
    expect(out).not.toMatch(/postgres(ql)?:\/\//);
  });

  it('CLI --json trên CSDL sạch → { violations: [] }, mã 0', () => {
    const r = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'src/db/check-conventions.ts', '--json'],
      {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH ?? '',
          SYSTEMROOT: process.env.SYSTEMROOT ?? '',
          DATABASE_OWNER_URL: withDb(dbUrls.owner, clean),
        },
      },
    );
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect((JSON.parse(r.stdout) as CheckResult).violations).toEqual([]);
  });
});
