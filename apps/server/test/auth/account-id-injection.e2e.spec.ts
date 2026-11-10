import { afterAll, beforeAll, expect, it } from 'vitest';
import { executionStorage } from '../../src/core/context/execution-storage';
import { tenantTx } from '../../src/core/db/transaction';
import { users } from '../../src/modules/account/internal/db/schema';
import { describeDb } from '../db/helpers/db';
import {
  createTestApp,
  registerAndVerify,
  type MeBody,
  type TestApp,
  type Agent,
} from './helpers/app';
import { AccessMatrixTestModule } from './support/access-matrix.module';

// T058 (AS2, SC-004, nguyên tắc I): mã tài khoản CHỈ từ phiên – mọi accountId do người dùng gửi lên
// (đường dẫn, truy vấn, thân, tiêu đề) đều bị bỏ qua.

describeDb('Chèn mã tài khoản (e2e)', () => {
  let t: TestApp;
  let a: { agent: Agent; me: MeBody };
  let b: { agent: Agent; me: MeBody };
  beforeAll(async () => {
    t = await createTestApp({ extraImports: [AccessMatrixTestModule] });
    a = await registerAndVerify(t);
    b = await registerAndVerify(t);
  });
  afterAll(async () => {
    await t.close();
  });

  it('A gửi mã của B ở path/query/body/header → currentAccountId() vẫn là A', async () => {
    const B = b.me.account.id;
    for (const body of [{ accountId: B }, { account_id: B }]) {
      const res = await a.agent.post(`/api/v1/__test/echo-account/${B}?accountId=${B}`, body, {
        'x-account-id': B,
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ current: a.me.account.id, path: B, query: B, body: B });
    }
  });

  it('đọc qua tenantTx với ngữ cảnh của A chỉ thấy người dùng của A', async () => {
    const rows = await executionStorage.run(
      { traceId: 't', source: 'request', accountId: a.me.account.id },
      () => tenantTx((db) => db.select({ id: users.id }).from(users)),
    );
    expect(rows.map((r) => r.id)).toEqual([a.me.user.id]);
  });
});
