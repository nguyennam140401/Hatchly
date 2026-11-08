// Edge cases: mã tài khoản thiếu/sai/không tồn tại, giao dịch lồng, ngắt kết nối giữa giao dịch.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { setActiveDatabase } from '../../src/core/db/database';
import { DbConnectionError, TenantContextError } from '../../src/core/db/errors';
import { tenantTx } from '../../src/core/db/transaction';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import {
  asAdmin,
  asOwner,
  createAccount,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from './helpers/db';
import { tenantNotes } from './sandbox/schema';

function expectTenantError(code: string) {
  return (err: unknown) => {
    expect(err).toBeInstanceOf(TenantContextError);
    expect((err as TenantContextError).code).toBe(code);
    return true;
  };
}

describeDb('Lỗi ngữ cảnh tenant', () => {
  let database: TestDatabase;
  let a: string;
  let b: string;

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 2 });
    a = await createAccount();
    b = await createAccount();
  });
  afterAll(async () => {
    await database.close();
  });

  it('không có accountId trong ngữ cảnh → TENANT_CONTEXT_MISSING', async () => {
    await expect(tenantTx(async () => 1)).rejects.toSatisfy(
      expectTenantError('TENANT_CONTEXT_MISSING'),
    );
    await expect(withAccount(undefined, () => tenantTx(async () => 1))).rejects.toSatisfy(
      expectTenantError('TENANT_CONTEXT_MISSING'),
    );
  });

  it("accountId rỗng / 'abc' → TENANT_CONTEXT_INVALID, không câu lệnh nào tới CSDL", async () => {
    const before = database.service.pool('app')!.totalCount;
    for (const bad of ['', 'abc', "'; DROP TABLE x; --"]) {
      await expect(withAccount(bad, () => tenantTx(async () => 1))).rejects.toSatisfy(
        expectTenantError('TENANT_CONTEXT_INVALID'),
      );
    }
    // Không mở kết nối mới nào cho các lần gọi sai định dạng.
    expect(database.service.pool('app')!.totalCount).toBe(before);
  });

  it('UUID không tồn tại → TENANT_NOT_FOUND', async () => {
    await expect(withAccount(uuidV7(), () => tenantTx(async () => 1))).rejects.toSatisfy(
      expectTenantError('TENANT_NOT_FOUND'),
    );
  });

  it('lồng cùng tài khoản → dùng chung giao dịch (thấy thay đổi, hoàn tác cùng nhau)', async () => {
    const title = `lồng ${uuidV7()}`;
    await expect(
      withAccount(a, () =>
        tenantTx(async (outer) => {
          await tenantTx(async (inner) => {
            await inner.insert(tenantNotes).values({ account_id: a, title });
          });
          const seen = await outer.select().from(tenantNotes);
          expect(seen.some((r) => r.title === title)).toBe(true);
          throw new Error('hoàn tác');
        }),
      ),
    ).rejects.toThrow('hoàn tác');
    const count = await asOwner((c) =>
      c.query('SELECT 1 FROM sandbox.tenant_notes WHERE title = $1', [title]),
    );
    expect(count.rowCount).toBe(0);
  });

  it('lồng khác tài khoản → TENANT_CONTEXT_CONFLICT', async () => {
    await expect(
      withAccount(a, () => tenantTx(() => withAccount(b, () => tenantTx(async () => 1)))),
    ).rejects.toSatisfy(expectTenantError('TENANT_CONTEXT_CONFLICT'));
  });

  it('hủy kết nối giữa giao dịch → lỗi cho người gọi; lần sau chạy trên kết nối mới, không ngữ cảnh cũ', async () => {
    const single = makeDatabase({ poolMax: 1 });
    try {
      let firstPid = 0;
      await expect(
        withAccount(a, () =>
          tenantTx(async (db) => {
            const pid = await db.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
            firstPid = pid.rows[0]!.pid;
            await asAdmin((c) => c.query('SELECT pg_terminate_backend($1)', [firstPid]));
            await db.select().from(tenantNotes);
          }),
        ),
      ).rejects.toBeInstanceOf(DbConnectionError);

      const rows = await withAccount(b, () => tenantTx((db) => db.select().from(tenantNotes)));
      expect(rows.every((r) => r.account_id === b)).toBe(true);
      const client = await single.service.pool('app')!.connect();
      try {
        const v = await client.query<{ v: string | null; pid: number }>(
          "SELECT current_setting('app.account_id', true) AS v, pg_backend_pid() AS pid",
        );
        expect(v.rows[0]?.v === '' || v.rows[0]?.v === null).toBe(true);
        // Kết nối hỏng đã bị hủy, không quay lại bể.
        expect(v.rows[0]?.pid).not.toBe(firstPid);
      } finally {
        client.release();
      }
    } finally {
      await single.close();
      setActiveDatabase(database.service);
    }
  });
});
