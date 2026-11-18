import { afterAll, beforeAll, expect, it } from 'vitest';
import { executionStorage } from '../../src/core/context/execution-storage';
import { tenantTx } from '../../src/core/db/transaction';
import { users } from '../../src/modules/account/internal/db/schema';
import { QueueLifecycle } from '../../src/modules/queue';
import { asOwner } from '../db/helpers/db';
import { describeDb } from '../db/helpers/db';
import { collaboratorOf, detachedOf } from './helpers/actors';
import {
  createTestApp,
  registerAndVerify,
  uniqueEmail,
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

  it('006: PUT /context/profile – accountId trong thân → 400; trong truy vấn → bỏ qua, lưu cho A', async () => {
    await t.app.get(QueueLifecycle).whenStarted(15_000);
    const B = b.me.account.id;
    const fields = {
      industryCode: 'fashion',
      industryOther: null,
      introduction: 'Tiệm của A',
      products: null,
      policies: null,
      tone: null,
      keywords: [],
    };
    for (const extra of [{ accountId: B }, { account_id: B }]) {
      const res = await a.agent.put('/api/v1/context/profile', {
        expectedVersion: 0,
        fields,
        ...extra,
      });
      expect(res.status).toBe(400);
      expect((res.body as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
    }
    const inFields = await a.agent.put('/api/v1/context/profile', {
      expectedVersion: 0,
      fields: { ...fields, accountId: B },
    });
    expect(inFields.status).toBe(400);
    const res = await a.agent.put(`/api/v1/context/profile?accountId=${B}`, {
      expectedVersion: 0,
      fields,
    });
    expect(res.status).toBe(200);
    const owners = await asOwner(async (c) => {
      const r = await c.query<{ account_id: string }>(
        'SELECT account_id FROM context.profile_versions WHERE account_id = ANY($1)',
        [[a.me.account.id, B]],
      );
      return r.rows.map((row) => row.account_id);
    });
    expect(owners).toEqual([a.me.account.id]);
  });

  // 009 T084 (nguyên tắc I, SC-007): các điểm cuối mới tuyệt đối không nhận mã tài khoản từ người gọi.
  it('009: POST /members/invitations – accountId ở truy vấn/tiêu đề/thân không đổi tài khoản được mời vào', async () => {
    const B = b.me.account.id;
    const viaQuery = uniqueEmail('moi-q');
    const res = await a.agent.post(
      `/api/v1/members/invitations?accountId=${B}&account_id=${B}`,
      { email: viaQuery },
      { 'x-account-id': B },
    );
    expect(res.status).toBe(201);
    // Mã trong thân: lược đồ nghiêm ngặt từ chối (400) hoặc bỏ qua – KHÔNG BAO GIỜ tạo lời mời cho B.
    const viaBody = await a.agent.post('/api/v1/members/invitations', {
      email: uniqueEmail('moi-b'),
      accountId: B,
      account_id: B,
    });
    expect([201, 400]).toContain(viaBody.status);

    const owners = await asOwner(async (c) => {
      const r = await c.query<{ account_id: string }>(
        'SELECT DISTINCT account_id FROM account.invitations WHERE account_id = ANY($1)',
        [[a.me.account.id, B]],
      );
      return r.rows.map((row) => row.account_id);
    });
    expect(owners).toEqual([a.me.account.id]);
    const bView = (await b.agent.get('/api/v1/members')).body as { invitations: unknown[] };
    expect(bView.invitations).toEqual([]);
  });

  it('009: DELETE /members/{userId} của tài khoản khác → 404, người đó vẫn là thành viên của B', async () => {
    const member = await collaboratorOf(t, b.me);
    const res = await a.agent.delete(
      `/api/v1/members/${member.userId}?accountId=${b.me.account.id}`,
    );
    expect(res.status).toBe(404);
    const status = await asOwner(async (c) => {
      const r = await c.query<{ status: string }>(
        'SELECT status FROM account.memberships WHERE user_id = $1',
        [member.userId],
      );
      return r.rows.map((row) => row.status);
    });
    expect(status).toEqual(['active']);
  });

  it('009: POST /account/claim – accountId trong thân không chạm tài khoản khác; chỉ nhận tài khoản chờ của chính mình', async () => {
    const B = b.me.account.id;
    const terms = { acceptTerms: true, termsVersion: '2026-11' };
    // Chủ đang thuộc tài khoản thật → 409 (hoặc 400 nếu lược đồ nghiêm ngặt), B không đổi.
    const asOwnerRes = await a.agent.post(`/api/v1/account/claim?accountId=${B}`, {
      ...terms,
      accountId: B,
    });
    expect([400, 409]).toContain(asOwnerRes.status);
    // Người ở tài khoản chờ nhận tài khoản: là tài khoản chờ của CHÍNH họ, không phải B.
    const detached = await detachedOf(t, await registerAndVerify(t));
    const res = await detached.agent.post(`/api/v1/account/claim?accountId=${B}`, {
      ...terms,
      accountId: B,
    });
    expect([200, 400]).toContain(res.status);
    const rows = await asOwner(async (c) => {
      const acc = await c.query<{ id: string; status: string }>(
        'SELECT id, status FROM account.accounts WHERE id = ANY($1)',
        [[a.me.account.id, B]],
      );
      const owner = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM account.memberships
          WHERE account_id = $1 AND user_id = $2`,
        [B, detached.userId],
      );
      return { accounts: acc.rows, intoB: owner.rows[0]?.n };
    });
    expect(rows.intoB).toBe('0'); // không thành viên của B
    expect(rows.accounts.every((r) => r.status === 'active')).toBe(true); // A và B không đổi
  });

  it('009: GET /invitations/mine và POST /invitations/accept-existing – accountId bị bỏ qua', async () => {
    const detached = await detachedOf(t, await registerAndVerify(t));
    const mine = await detached.agent.get(`/api/v1/invitations/mine?accountId=${b.me.account.id}`);
    expect(mine.status).toBe(200);
    expect((mine.body as { invitations: unknown[] }).invitations).toEqual([]);
    const accept = await detached.agent.post('/api/v1/invitations/accept-existing', {
      invitationId: '00000000-0000-7000-8000-000000000000',
      accountId: b.me.account.id,
    });
    expect([400, 409]).toContain(accept.status);
  });

  it('đọc qua tenantTx với ngữ cảnh của A chỉ thấy người dùng của A', async () => {
    const rows = await executionStorage.run(
      { traceId: 't', source: 'request', accountId: a.me.account.id },
      () => tenantTx((db) => db.select({ id: users.id }).from(users)),
    );
    expect(rows.map((r) => r.id)).toEqual([a.me.user.id]);
  });
});
