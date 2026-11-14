// US2-AS3: mọi đối tượng thuộc `owner`; `app` không đổi cấu trúc được; bootstrap idempotent.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { expect, it } from 'vitest';
import { runBootstrap } from '../../src/db/bootstrap';
import { asOwner, dbName, dbUrls, describeDb } from './helpers/db';

const schemas = [
  ...(
    JSON.parse(readFileSync(resolve('src/modules/modules.manifest.json'), 'utf8')) as {
      modules: { schema: string }[];
    }
  ).modules.map((m) => m.schema),
  'sandbox',
];

async function asApp<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: dbUrls.app });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

describeDb('Chủ sở hữu và quyền đổi cấu trúc', () => {
  it('mọi schema/bảng/khung nhìn/chuỗi/hàm trong 11 schema + sandbox thuộc owner', async () => {
    const notOwned = await asOwner(async (c) => {
      const r = await c.query<{ obj: string; owner: string }>(
        `SELECT 'schema ' || nspname AS obj, pg_get_userbyid(nspowner) AS owner
           FROM pg_namespace WHERE nspname = ANY($1)
         UNION ALL
         SELECT 'rel ' || n.nspname || '.' || c.relname, pg_get_userbyid(c.relowner)
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ANY($1)
         UNION ALL
         SELECT 'func ' || n.nspname || '.' || p.proname, pg_get_userbyid(p.proowner)
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = ANY($1)`,
        [schemas],
      );
      expect(r.rows.length).toBeGreaterThan(schemas.length);
      return r.rows.filter((row) => row.owner !== 'owner');
    });
    expect(notOwned).toEqual([]);
  });

  // 008 (FR-016): kiểm trên MỌI schema không phải hệ thống (kể cả schema thư viện như pgboss và schema
  // tạo bằng SQL tay), không chỉ schema của module – `app` mà sở hữu một bảng là vượt được RLS.
  it('app không sở hữu đối tượng nào ở mọi schema không phải hệ thống, và không có BYPASSRLS/SUPERUSER', async () => {
    const result = await asOwner(async (c) => {
      const owned = await c.query<{ obj: string }>(
        `SELECT n.nspname || '.' || c.relname AS obj
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE pg_get_userbyid(c.relowner) = 'app'
            AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_toast%'
         UNION ALL
         SELECT 'schema ' || nspname FROM pg_namespace WHERE pg_get_userbyid(nspowner) = 'app'
         UNION ALL
         SELECT 'func ' || n.nspname || '.' || p.proname
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE pg_get_userbyid(p.proowner) = 'app'
            AND n.nspname NOT IN ('pg_catalog', 'information_schema')`,
      );
      const role = await c.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app'`,
      );
      return { owned: owned.rows.map((r) => r.obj), role: role.rows[0] };
    });
    expect(result.owned).toEqual([]);
    expect(result.role).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it.each([
    ['CREATE TABLE content.x (id int)'],
    ['ALTER TABLE sandbox.tenant_notes ADD COLUMN y int'],
    ['DROP TABLE sandbox.tenant_notes'],
    ['CREATE SCHEMA x'],
    ['CREATE TABLE public.x (id int)'],
  ])('app chạy "%s" → 42501', async (statement) => {
    const err = await asApp((c) => c.query(statement)).catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe('42501');
  });

  it('bootstrap chạy lại 2 lần không lỗi; 4 vai trò không SUPERUSER/BYPASSRLS, không là thành viên vai trò khác', async () => {
    for (let i = 0; i < 2; i++) {
      await runBootstrap({
        adminUrl: dbUrls.admin,
        database: dbName,
        passwords: { owner: 'unused00', app: 'unused00', system: 'unused00', support: 'unused00' },
        keepExistingPasswords: true,
        log: () => undefined,
      });
    }
    const roles = await asOwner(
      async (c) =>
        (
          await c.query<{
            rolname: string;
            rolsuper: boolean;
            rolbypassrls: boolean;
            members: number;
          }>(
            `SELECT r.rolname, r.rolsuper, r.rolbypassrls,
                  (SELECT count(*)::int FROM pg_auth_members m WHERE m.member = r.oid) AS members
             FROM pg_roles r WHERE r.rolname IN ('owner', 'app', 'system', 'support') ORDER BY 1`,
          )
        ).rows,
    );
    expect(roles).toEqual(
      ['app', 'owner', 'support', 'system'].map((rolname) => ({
        rolname,
        rolsuper: false,
        rolbypassrls: false,
        members: 0,
      })),
    );
  });
});
