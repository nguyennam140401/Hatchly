import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { auditLog } from '../../src/core/db/audit-log.log-table';
import { authTx } from '../../src/core/db/auth-tx';
import { TenantContextError } from '../../src/core/db/errors';
import { tenantTx } from '../../src/core/db/transaction';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { authThrottle, users } from '../../src/modules/account/internal/db/schema';
import { asOwner, describeDb, makeDatabase, withAccount, type TestDatabase } from './helpers/db';

// T015 (004, R4): authTx – giao dịch `app` không tenant, chỉ cho bảng dùng chung của xác thực và
// nhật ký kiểm toán; bộ gác truy vấn của 002 vẫn chặn bảng tenant.

describeDb('authTx', () => {
  let database: TestDatabase;
  beforeAll(() => {
    database = makeDatabase({ unit: 'api' });
  });
  afterAll(async () => {
    await database.close();
  });

  it('đọc/ghi được account.auth_throttle', async () => {
    const key = randomBytes(32);
    await authTx((db) =>
      db
        .insert(authThrottle)
        .values({ kind: 'login_ip', key_hash: key, window_start: new Date(), count: 1 }),
    );
    const rows = await authTx((db) =>
      db.select().from(authThrottle).where(eq(authThrottle.key_hash, key)),
    );
    expect(rows).toHaveLength(1);
    await authTx((db) => db.delete(authThrottle).where(eq(authThrottle.key_hash, key)));
  });

  it('ghi được infra.audit_log', async () => {
    const id = uuidV7();
    await authTx((db) =>
      db.insert(auditLog).values({
        id,
        actor_type: 'anonymous',
        actor_id: 'anonymous',
        action: 'auth.login.failed',
      }),
    );
    // app chỉ ghi nối (không SELECT được nhật ký kiểm toán) – kiểm bằng owner.
    const n = await asOwner(async (c) => {
      const r = await c.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM infra.audit_log WHERE id = $1',
        [id],
      );
      return r.rows[0]?.n;
    });
    expect(n).toBe(1);
  });

  it('chạm bảng tenant → bộ gác ném TENANT_CONTEXT_MISSING (test)', async () => {
    await expect(authTx((db) => db.select().from(users).limit(1))).rejects.toMatchObject({
      code: 'TENANT_CONTEXT_MISSING',
    });
  });

  it('gọi authTx bên trong tenantTx → TENANT_CONTEXT_CONFLICT', async () => {
    const accountId = uuidV7();
    await expect(
      withAccount(accountId, () => tenantTx(() => authTx(async () => 1))),
    ).rejects.toBeInstanceOf(TenantContextError);
  });

  it('authTx lồng trong authTx dùng lại giao dịch', async () => {
    const pids = await authTx(async (outer) => {
      const a = await outer.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
      const b = await authTx((inner) =>
        inner.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`),
      );
      return [a.rows[0]?.pid, b.rows[0]?.pid];
    });
    expect(pids[0]).toBe(pids[1]);
  });
});
