// US3-AS1, AS4: khuôn tenantTable sinh đúng cột, khóa ngoại, RLS, chính sách; UUID v7; timestamptz UTC.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { tenantTx } from '../../src/core/db/transaction';
import {
  asOwner,
  createAccount,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from './helpers/db';
import { tenantNotes } from './sandbox/schema';

describeDb('Khuôn bảng tenant (sandbox.tenant_notes)', () => {
  let database: TestDatabase;
  let a: string;

  beforeAll(async () => {
    database = makeDatabase();
    a = await createAccount();
  });
  afterAll(async () => {
    await database.close();
  });

  it('danh mục hệ thống: account_id NOT NULL, FK cascade, RLS, chính sách ALL có USING + WITH CHECK cho app, system', async () => {
    const info = await asOwner(async (c) => {
      const col = await c.query<{ attnotnull: boolean }>(
        `SELECT attnotnull FROM pg_attribute WHERE attrelid = 'sandbox.tenant_notes'::regclass AND attname = 'account_id'`,
      );
      const fk = await c.query<{ confdeltype: string; target: string }>(
        `SELECT confdeltype::text, confrelid::regclass::text AS target FROM pg_constraint
          WHERE conrelid = 'sandbox.tenant_notes'::regclass AND contype = 'f'`,
      );
      const rls = await c.query<{ relrowsecurity: boolean }>(
        `SELECT relrowsecurity FROM pg_class WHERE oid = 'sandbox.tenant_notes'::regclass`,
      );
      const pol = await c.query<{
        polname: string;
        polcmd: string;
        has_using: boolean;
        has_check: boolean;
        roles: string[];
        qual: string;
      }>(
        `SELECT polname, polcmd::text, polqual IS NOT NULL AS has_using, polwithcheck IS NOT NULL AS has_check,
                ARRAY(SELECT rolname::text FROM pg_roles WHERE oid = ANY(polroles) ORDER BY 1) AS roles,
                pg_get_expr(polqual, polrelid) AS qual
           FROM pg_policy WHERE polrelid = 'sandbox.tenant_notes'::regclass`,
      );
      return { col: col.rows[0], fk: fk.rows, rls: rls.rows[0], pol: pol.rows };
    });
    expect(info.col?.attnotnull).toBe(true);
    expect(info.fk).toEqual([{ confdeltype: 'c', target: 'account.accounts' }]);
    expect(info.rls?.relrowsecurity).toBe(true);
    expect(info.pol).toHaveLength(1);
    expect(info.pol[0]).toMatchObject({
      polname: 'tenant_isolation',
      polcmd: '*',
      has_using: true,
      has_check: true,
      roles: ['app', 'system'],
    });
    expect(info.pol[0]!.qual).toContain('account.current_account_id()');
  });

  it('chèn không truyền id → UUID v7; created_at/updated_at có múi giờ, giá trị UTC; version = 1', async () => {
    const before = Date.now();
    const row = await withAccount(a, () =>
      tenantTx(async (db) => {
        const [r] = await db
          .insert(tenantNotes)
          .values({ account_id: a, title: 'mới' })
          .returning();
        return r!;
      }),
    );
    expect(row.id[14]).toBe('7');
    expect(row.version).toBe(1);
    expect(row.created_at).toBeInstanceOf(Date);
    expect(Math.abs(row.created_at.getTime() - before)).toBeLessThan(60_000);
    const raw = await asOwner((c) =>
      c.query<{ created: string; type: string }>(
        `SELECT created_at::text AS created, pg_typeof(created_at)::text AS type
           FROM sandbox.tenant_notes WHERE id = $1`,
        [row.id],
      ),
    );
    // Phiên owner trong kiểm thử cũng đặt TimeZone=UTC → hiển thị +00.
    expect(raw.rows[0]?.type).toBe('timestamp with time zone');
    expect(raw.rows[0]?.created).toMatch(/\+00$/);
  });

  it('sửa dòng → updated_at tăng', async () => {
    const created = await withAccount(a, () =>
      tenantTx(async (db) => {
        const [r] = await db.insert(tenantNotes).values({ account_id: a, title: 'cũ' }).returning();
        return r!;
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    const updated = await withAccount(a, () =>
      tenantTx(async (db) => {
        const [r] = await db
          .update(tenantNotes)
          .set({ title: 'sửa' })
          .where(eq(tenantNotes.id, created.id))
          .returning();
        return r!;
      }),
    );
    expect(updated.updated_at.getTime()).toBeGreaterThan(created.updated_at.getTime());
  });
});
