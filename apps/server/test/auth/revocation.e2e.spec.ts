import { afterAll, beforeAll, expect, it } from 'vitest';
import { ACCOUNT_PUBLIC_API, type AccountPublicApi } from '../../src/modules/account';
import { describeDb } from '../db/helpers/db';
import { Agent, createTestApp, registerAndVerify, type TestApp } from './helpers/app';
import { collaboratorOf } from './helpers/actors';

// T060 (AS6, SC-005): thu hồi quyền có hiệu lực ≤ 60 giây trên MỌI bản API. Hai INestApplication
// dùng chung CSDL; đồng hồ của bộ nhớ đệm phiên ở bản 2 là đồng hồ giả.

describeDb('Thu hồi phiên giữa hai bản API (e2e)', () => {
  let one: TestApp;
  let two: TestApp;
  const clock = { t: Date.now() };
  beforeAll(async () => {
    one = await createTestApp();
    two = await createTestApp();
    two.cache.now = () => clock.t;
  });
  afterAll(async () => {
    await one.close();
    await two.close();
  });

  /** Cùng cookie, gửi tới bản API kia. */
  function onTwo(agent: Agent): Agent {
    const copy = new Agent(two.server, 'http://app.test', agent.ip);
    for (const [k, v] of agent.cookies) copy.cookies.set(k, v);
    return copy;
  }

  for (const action of ['removeMember', 'disableMember'] as const) {
    it(`${action} trên bản 1 → bản 2 từ chối khi bộ nhớ đệm hết hạn (≤ 60 giây)`, async () => {
      const owner = await registerAndVerify(one);
      const col = await collaboratorOf(one, owner.me);
      const remote = onTwo(col.agent);
      expect((await remote.get('/api/v1/auth/me')).status).toBe(200);

      const accounts = one.app.get<AccountPublicApi>(ACCOUNT_PUBLIC_API);
      await accounts[action]({
        accountId: owner.me.account.id,
        userId: col.userId,
        byUserId: owner.me.user.id,
      });
      // Bản 1 (nơi thu hồi) từ chối ngay.
      expect((await col.agent.get('/api/v1/auth/me')).status).toBe(401);
      // Bản 2 còn trong bộ nhớ đệm < 60 giây: có thể vẫn cho qua …
      clock.t += 59_000;
      expect([200, 401]).toContain((await remote.get('/api/v1/auth/me')).status);
      // … nhưng hết 60 giây thì bắt buộc từ chối như chưa đăng nhập.
      clock.t += 1_001;
      const res = await remote.get('/api/v1/auth/me');
      expect(res.status).toBe(401);
      expect((res.body as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
    });
  }

  it('đăng xuất trên bản 1 có hiệu lực ngay trên bản 1', async () => {
    const { agent } = await registerAndVerify(one);
    const sid = agent.sid ?? '';
    await agent.post('/api/v1/auth/logout');
    const stale = one.agent();
    stale.cookies.set('__Host-sid', sid);
    expect((await stale.get('/api/v1/auth/me')).status).toBe(401);
  });
});
