// 008 (T021, spec Edge "Bản sửa nóng có kèm migration", research R11): bộ chạy migration xử lý thế nào
// một migration có mốc `when` CŨ HƠN migration đã áp – tình huống xảy ra khi sửa nóng trên `master` mang
// migration được tạo sau một migration của `dev` chưa phát hành, rồi `dev` phát hành sau đó (hoặc ngược lại).
//
// KẾT QUẢ QUAN SÁT ĐƯỢC (drizzle-orm 0.45.x): migration có mốc cũ hơn migration mới nhất đã áp bị BỎ QUA
// ÂM THẦM – không áp, không báo lỗi, không ghi nhật ký. Bộ chạy chỉ so `when` của từng mục với
// `created_at` lớn nhất trong bảng nhật ký. Hệ quả cho quy trình: sửa nóng KHÔNG được kèm migration
// (cổng check:release-source chặn). Nếu nâng drizzle-orm làm ca này đổi kết quả → xem lại luật đó.
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, expect, it } from 'vitest';
import { runBootstrap } from '../../src/db/bootstrap';
import { runMigrations } from '../../src/db/migrate';
import { dbUrls, describeDb } from './helpers/db';

const created: string[] = [];
const quiet = () => undefined;

function urlFor(base: string, database: string): string {
  const u = new URL(base);
  u.pathname = `/${database}`;
  return u.toString();
}

async function freshDatabase(): Promise<string> {
  const name = `app_test_order_${randomBytes(3).toString('hex')}`;
  created.push(name);
  await runBootstrap({
    adminUrl: dbUrls.admin,
    database: name,
    passwords: {
      owner: 'x'.repeat(8),
      app: 'x'.repeat(8),
      system: 'x'.repeat(8),
      support: 'x'.repeat(8),
    },
    keepExistingPasswords: true,
    log: quiet,
  });
  return urlFor(dbUrls.owner, name);
}

interface Entry {
  tag: string;
  when: number;
}

/** Thư mục drizzle tạm: mỗi migration tạo một bảng `public.<tag>`. */
function drizzleDir(): { dir: string; setEntries: (entries: Entry[]) => void } {
  const dir = mkdtempSync(join(tmpdir(), 'mig-order-'));
  const folder = join(dir, 'migrations');
  mkdirSync(join(folder, 'meta'), { recursive: true });
  const setEntries = (entries: Entry[]) => {
    for (const e of entries) {
      writeFileSync(join(folder, `${e.tag}.sql`), `CREATE TABLE infra.${e.tag} (id int);\n`);
    }
    writeFileSync(
      join(folder, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'postgresql',
        entries: entries.map((e, idx) => ({ idx, version: '7', ...e, breakpoints: true })),
      }),
    );
  };
  return { dir, setEntries };
}

async function tables(ownerUrl: string): Promise<string[]> {
  const c = new Client({ connectionString: ownerUrl });
  await c.connect();
  try {
    const r = await c.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'infra' AND c.relkind = 'r' AND c.relname LIKE 'm\\_%' ORDER BY 1`,
    );
    return r.rows.map((row) => row.relname);
  } finally {
    await c.end();
  }
}

describeDb('Thứ tự áp migration khi mốc thời gian không tăng dần (008 T021)', () => {
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

  const A = { tag: 'm_a', when: 1_000 };
  const B = { tag: 'm_b', when: 3_000 };
  const C_BETWEEN = { tag: 'm_c', when: 2_000 };
  const D_AFTER = { tag: 'm_d', when: 4_000 };

  it('migration thêm sau nhưng mốc nằm GIỮA hai migration đã áp → bị bỏ qua âm thầm', async () => {
    const ownerUrl = await freshDatabase();
    const { dir, setEntries } = drizzleDir();
    const run = () =>
      runMigrations({
        ownerUrl,
        appEnv: 'production',
        log: quiet,
        ensureQueues: false,
        drizzleDir: dir,
      });

    setEntries([A, B]);
    expect((await run()).main).toBe(2);
    expect(await tables(ownerUrl)).toEqual(['m_a', 'm_b']);

    // C nối vào CUỐI nhật ký (đúng luật db:immutable) nhưng mốc `when` cũ hơn B.
    setEntries([A, B, C_BETWEEN]);
    const second = await run(); // không ném lỗi
    expect(second.main).toBe(0);
    expect(await tables(ownerUrl)).toEqual(['m_a', 'm_b']); // bảng của C KHÔNG được tạo

    // Và C vẫn bị bỏ qua mãi về sau, kể cả khi có migration mới hơn được áp.
    setEntries([A, B, C_BETWEEN, D_AFTER]);
    expect((await run()).main).toBe(1);
    expect(await tables(ownerUrl)).toEqual(['m_a', 'm_b', 'm_d']);
  });

  it('đối chứng: migration có mốc mới hơn mọi migration đã áp → được áp', async () => {
    const ownerUrl = await freshDatabase();
    const { dir, setEntries } = drizzleDir();
    const run = () =>
      runMigrations({
        ownerUrl,
        appEnv: 'production',
        log: quiet,
        ensureQueues: false,
        drizzleDir: dir,
      });
    setEntries([A, B]);
    await run();
    setEntries([A, B, D_AFTER]);
    expect((await run()).main).toBe(1);
    expect(await tables(ownerUrl)).toEqual(['m_a', 'm_b', 'm_d']);
  });

  it('CSDL trống: mọi migration được áp theo thứ tự nhật ký dù mốc không tăng dần', async () => {
    const ownerUrl = await freshDatabase();
    const { dir, setEntries } = drizzleDir();
    setEntries([A, B, C_BETWEEN]);
    const result = await runMigrations({
      ownerUrl,
      appEnv: 'production',
      log: quiet,
      ensureQueues: false,
      drizzleDir: dir,
    });
    expect(result.main).toBe(3);
    expect(await tables(ownerUrl)).toEqual(['m_a', 'm_b', 'm_c']);
  });
});
