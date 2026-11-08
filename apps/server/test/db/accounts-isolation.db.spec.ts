// Hiến pháp I (kiểm thử truy cập chéo cho MỌI bảng khách hàng): bảng gốc account.accounts – cột
// tenant là `id`. Kèm VII: lỗi SQL không mang giá trị dữ liệu (detail) ra ngoài lớp CSDL.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DbQueryError } from '../../src/core/db/errors';
import { accounts } from '../../src/core/db/tenant-root';
import { tenantTx } from '../../src/core/db/transaction';
import {
  asOwner,
  createAccount,
  describeDb,
  makeDatabase,
  seedNotes,
  withAccount,
  type TestDatabase,
} from './helpers/db';
import { tenantNotes } from './sandbox/schema';

describeDb('Truy cập chéo tenant – account.accounts', () => {
  let database: TestDatabase;
  let a: string;
  let b: string;

  beforeAll(async () => {
    database = makeDatabase();
    a = await createAccount();
    b = await createAccount();
  });
  afterAll(async () => {
    await database.close();
  });

  for (const dir of ['A→B', 'B→A'] as const) {
    it(`${dir}: đọc toàn bảng chỉ thấy tài khoản của mình; sửa tài khoản kia → 0 dòng`, async () => {
      const [self, other] = dir === 'A→B' ? [a, b] : [b, a];
      const rows = await withAccount(self, () => tenantTx((db) => db.select().from(accounts)));
      expect(rows.map((r) => r.id)).toEqual([self]);

      const updated = await withAccount(self, () =>
        tenantTx((db) =>
          db
            .update(accounts)
            .set({ status: 'suspended' })
            .where(eq(accounts.id, other))
            .returning(),
        ),
      );
      expect(updated).toEqual([]);
      const status = await asOwner((c) =>
        c.query<{ status: string }>('SELECT status FROM account.accounts WHERE id = $1', [other]),
      );
      expect(status.rows[0]?.status).toBe('active');
    });

    it(`${dir}: xóa toàn bảng → bị từ chối (app không có DELETE trên accounts)`, async () => {
      const self = dir === 'A→B' ? a : b;
      const err = await withAccount(self, () => tenantTx((db) => db.delete(accounts))).catch(
        (e: unknown) => e,
      );
      expect((err as DbQueryError).code).toBe('42501');
    });
  }

  it('VII: lỗi trùng khóa (23505) là DbQueryError, không chứa giá trị dữ liệu', async () => {
    const [id] = await seedNotes(a, 1);
    const err = await withAccount(a, () =>
      tenantTx((db) => db.insert(tenantNotes).values({ id: id!, account_id: a, title: 'trùng' })),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DbQueryError);
    expect((err as DbQueryError).code).toBe('23505');
    expect((err as DbQueryError).constraint).toBe('tenant_notes_pkey');
    expect(err).not.toHaveProperty('detail');
    expect(JSON.stringify(err) + String(err)).not.toContain(id!);
  });
});
