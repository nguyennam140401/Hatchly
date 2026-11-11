import { afterAll, beforeAll, expect, it } from 'vitest';
import { runInAccountScope } from '../../src/core/auth/account-scope';
import { executionStorage } from '../../src/core/context/execution-storage';
import { TenantContextError } from '../../src/core/db/errors';
import { currentAccountId, tenantTx } from '../../src/core/db/transaction';
import { users } from '../../src/modules/account/internal/db/schema';
import { describeDb, makeDatabase, withAccount, type TestDatabase } from './helpers/db';
import { seedUser, type SeededUser } from './helpers/auth-seed';

// T023 (R4): runInAccountScope – ngữ cảnh CON có accountId cho tenantTx, không sửa ngữ cảnh gốc.

describeDb('runInAccountScope', () => {
  let database: TestDatabase;
  let a: SeededUser;
  let b: SeededUser;
  beforeAll(async () => {
    database = makeDatabase({ unit: 'api' });
    a = await seedUser();
    b = await seedUser();
  });
  afterAll(async () => {
    await database.close();
  });

  it('trong phạm vi: tenantTx thấy đúng tài khoản; ngoài phạm vi: ngữ cảnh gốc không đổi', async () => {
    await executionStorage.run({ traceId: 't', source: 'request' }, async () => {
      const rows = await runInAccountScope(a.accountId, () =>
        tenantTx((db) => db.select().from(users)),
      );
      expect(rows.map((r) => r.id)).toEqual([a.userId]);
      expect(executionStorage.getStore()?.accountId).toBeUndefined();
      expect(currentAccountId()).toBeNull();
    });
  });

  it('giữ traceId và người gọi của ngữ cảnh cha', async () => {
    await executionStorage.run({ traceId: 'trace-cha', source: 'request' }, async () => {
      const ctx = await runInAccountScope(a.accountId, async () => executionStorage.getStore());
      expect(ctx).toMatchObject({
        traceId: 'trace-cha',
        source: 'request',
        accountId: a.accountId,
      });
    });
  });

  it('yêu cầu đã gắn tài khoản khác → TENANT_CONTEXT_CONFLICT; cùng tài khoản → được', async () => {
    await withAccount(a.accountId, async () => {
      await expect(runInAccountScope(b.accountId, async () => 1)).rejects.toMatchObject({
        code: 'TENANT_CONTEXT_CONFLICT',
      });
      await expect(runInAccountScope(a.accountId, async () => 2)).resolves.toBe(2);
    });
  });

  it('đang trong giao dịch → TENANT_CONTEXT_CONFLICT', async () => {
    await expect(
      withAccount(a.accountId, () => tenantTx(() => runInAccountScope(a.accountId, async () => 1))),
    ).rejects.toBeInstanceOf(TenantContextError);
  });
});
