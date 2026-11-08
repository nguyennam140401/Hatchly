// US4-AS1, AS2, FR-022: vai trò `system` chịu cùng RLS; chỉ thấy/ghi tài khoản của việc.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DbPolicyViolationError, TenantContextError } from '../../src/core/db/errors';
import { systemTx, tenantTx } from '../../src/core/db/transaction';
import {
  createAccount,
  describeDb,
  makeDatabase,
  seedNotes,
  withAccount,
  type TestDatabase,
} from './helpers/db';
import { tenantNotes } from './sandbox/schema';

describeDb('Ngữ cảnh hệ thống (systemTx)', () => {
  let database: TestDatabase;
  let a: string;
  let b: string;

  beforeAll(async () => {
    database = makeDatabase({ unit: 'worker' });
    a = await createAccount();
    b = await createAccount();
    await seedNotes(a, 2);
    await seedNotes(b, 3);
  });
  afterAll(async () => {
    await database.close();
  });

  it('không tenant đọc tenant_notes → TENANT_CONTEXT_MISSING (APP_ENV=test)', async () => {
    const err = await systemTx((db) => db.select().from(tenantNotes)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TenantContextError);
    expect((err as TenantContextError).code).toBe('TENANT_CONTEXT_MISSING');
  });

  it("'from-context' với tài khoản A → chỉ thấy/ghi dòng A; ghi dòng B → DB_POLICY_VIOLATION", async () => {
    const rows = await withAccount(a, () =>
      systemTx((db) => db.select().from(tenantNotes), { tenant: 'from-context' }),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.account_id === a)).toBe(true);

    const role = await withAccount(a, () =>
      systemTx((db) => db.execute<{ u: string }>(sql`SELECT current_user AS u`), {
        tenant: 'from-context',
      }),
    );
    expect(role.rows[0]?.u).toBe('system');

    await expect(
      withAccount(a, () =>
        systemTx((db) => db.insert(tenantNotes).values({ account_id: b, title: 'chéo' }), {
          tenant: 'from-context',
        }),
      ),
    ).rejects.toBeInstanceOf(DbPolicyViolationError);
  });

  it("'from-context' khi việc không có accountId → TENANT_CONTEXT_MISSING", async () => {
    const err = await withAccount(undefined, () =>
      systemTx(async () => 1, { tenant: 'from-context' }),
    ).catch((e: unknown) => e);
    expect((err as TenantContextError).code).toBe('TENANT_CONTEXT_MISSING');
  });

  it('systemTx lồng trong tenantTx → TENANT_CONTEXT_CONFLICT', async () => {
    const err = await withAccount(a, () =>
      tenantTx(() => systemTx(async () => 1, { tenant: 'from-context' })),
    ).catch((e: unknown) => e);
    expect((err as TenantContextError).code).toBe('TENANT_CONTEXT_CONFLICT');
  });

  it('system gọi được infra.ensure_audit_log_partitions(2)', async () => {
    await expect(
      systemTx((db) => db.execute(sql`SELECT infra.ensure_audit_log_partitions(2)`)),
    ).resolves.toBeDefined();
  });

  it('đơn vị API không có bể system → systemTx báo lỗi rõ', async () => {
    const api = makeDatabase({ unit: 'api' });
    try {
      await expect(systemTx(async () => 1)).rejects.toThrow('systemTx chỉ dùng ở Worker');
    } finally {
      await api.close();
      database = makeDatabase({ unit: 'worker' });
    }
  });
});
