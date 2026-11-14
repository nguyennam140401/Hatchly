// 008 (FR-015, R10): mọi đường vào dữ liệu ngoài bảng tenant thường phải được kiểm kê. Danh sách lấy từ
// catalog của CSDL tạm đã migrate; thêm khung nhìn / hàm SECURITY DEFINER / đường vào mới mà quên kiểm kê → đỏ.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { beforeAll, expect, it } from 'vitest';
import { ACCESS_PATH_INVENTORY } from './fixtures/access-path-inventory';
import { asOwner, createAccount, dbUrls, describeDb, seedNotes } from './helpers/db';

const manifestSchemas = (
  JSON.parse(readFileSync(resolve('src/modules/modules.manifest.json'), 'utf8')) as {
    modules: { schema: string }[];
  }
).modules.map((m) => m.schema);
const SCHEMAS = [...new Set([...manifestSchemas, 'sandbox', 'pgboss'])];

async function names(sql: string, params: unknown[] = [SCHEMAS]): Promise<string[]> {
  return asOwner(async (c) => (await c.query<{ k: string }>(sql, params)).rows.map((r) => r.k));
}

async function catalog(): Promise<string[]> {
  const views = await names(
    `SELECT 'view:' || n.nspname || '.' || c.relname AS k
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('v', 'm') AND n.nspname = ANY($1)
        AND (has_table_privilege('app', c.oid, 'SELECT') OR has_table_privilege('support', c.oid, 'SELECT'))`,
  );
  const functions = await names(
    `SELECT DISTINCT 'function:' || n.nspname || '.' || p.proname AS k
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.prosecdef AND n.nspname = ANY($1) AND has_function_privilege('app', p.oid, 'EXECUTE')`,
  );
  const jobs = await names(
    `SELECT 'table:' || n.nspname || '.' || c.relname AS k
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'pgboss' AND c.relname = 'job_common'`,
    [],
  );
  return [...views, ...functions, ...jobs].sort();
}

describeDb('Kiểm kê đường vào dữ liệu ngoài bảng tenant (008 FR-015)', () => {
  let found: string[] = [];
  beforeAll(async () => {
    found = await catalog();
  });

  it('mọi khung nhìn / hàm SECURITY DEFINER / bảng việc chung trong catalog đều đã kiểm kê', () => {
    expect(found.length).toBeGreaterThan(5); // truy vấn catalog hỏng sẽ trả rỗng
    const missing = found.filter((k) => !(k in ACCESS_PATH_INVENTORY));
    console.log(`Kiểm kê đường vào: ${found.length - missing.length} / ${found.length} mục`);
    expect(
      missing,
      `Đường vào chưa kiểm kê – thêm vào test/db/fixtures/access-path-inventory.ts kèm bằng chứng hoặc lý do: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('mục kiểm kê không trỏ tới đối tượng không còn tồn tại; bằng chứng trỏ tới tệp có thật', () => {
    const known = new Set(found);
    expect(Object.keys(ACCESS_PATH_INVENTORY).filter((k) => !known.has(k))).toEqual([]);
    const bad = Object.entries(ACCESS_PATH_INVENTORY).filter(
      ([, e]) =>
        ('proof' in e && !existsSync(resolve(e.proof))) ||
        ('exempt' in e && e.exempt.trim().length < 10),
    );
    expect(bad.map(([k]) => k)).toEqual([]);
  });

  it('khung nhìn app được SELECT: không có ngữ cảnh tài khoản thấy 0 dòng dù có dữ liệu của hai tài khoản', async () => {
    const a = await createAccount();
    const b = await createAccount();
    await seedNotes(a, 2);
    await seedNotes(b, 2);
    const views = found.filter((k) => k.startsWith('view:')).map((k) => k.slice(5));
    // `support` đọc chéo tài khoản có chủ đích qua khung nhìn đã lọc + nhật ký kiểm toán (hiến pháp I) –
    // phần đó được chứng minh bằng `proof` trong kiểm kê, không áp phép "0 dòng" ở đây.
    for (const [role, url] of [['app', dbUrls.app]] as const) {
      const client = new Client({ connectionString: url });
      await client.connect();
      try {
        for (const view of views) {
          const granted = await asOwner(
            async (c) =>
              (
                await c.query<{ ok: boolean }>(
                  `SELECT has_table_privilege($1, $2, 'SELECT') AS ok`,
                  [role, view],
                )
              ).rows[0]!.ok,
          );
          if (!granted) continue;
          const r = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${view}`);
          expect(Number(r.rows[0]!.n), `${role} đọc ${view} khi chưa có ngữ cảnh`).toBe(0);
        }
      } finally {
        await client.end();
      }
    }
  });
});
