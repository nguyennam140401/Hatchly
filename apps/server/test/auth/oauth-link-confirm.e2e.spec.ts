import { afterAll, beforeAll, expect, it } from 'vitest';
import { ACCOUNT_PUBLIC_API, type AccountPublicApi } from '../../src/modules/account';
import { asOwner, describeDb } from '../db/helpers/db';
import {
  createTestApp,
  oauthLogin,
  oauthPending,
  oauthSignup,
  registerAndVerify,
  settleMail,
  STRONG_PASSWORD,
  tokenFromMail,
  uniqueEmail,
  waitForMail,
  type ErrorBody,
  type FakeScenario,
  type MeBody,
  type TestApp,
} from './helpers/app';

// T039 (009 – US2, SC-003): email trùng người dùng đã có → KHÔNG tự gộp, phải xác nhận trước khi liên kết.

const SIGNUP = '/api/v1/auth/oauth/signup';
const LINK_PASSWORD = '/api/v1/auth/oauth/link/password';
const LINK_EMAIL = '/api/v1/auth/oauth/link/send-email';
const CONFIRM = '/api/v1/auth/oauth/confirm';
const LOGIN = '/api/v1/auth/login';
const terms = { acceptTerms: true, termsVersion: '2026-11' };
const code = (body: unknown) => (body as ErrorBody).error.code;

async function userCount(email: string): Promise<number> {
  return asOwner(async (c) =>
    Number(
      (
        await c.query<{ n: string }>(
          'SELECT count(*)::text AS n FROM account.users WHERE email_normalized = $1',
          [email.toLowerCase()],
        )
      ).rows[0]?.n,
    ),
  );
}

async function providersOf(email: string): Promise<string[]> {
  return asOwner(async (c) => {
    const r = await c.query<{ provider: string }>(
      `SELECT i.provider FROM account.login_identities i
         JOIN account.users u ON u.id = i.user_id
        WHERE u.email_normalized = $1 ORDER BY i.provider`,
      [email.toLowerCase()],
    );
    return r.rows.map((x) => x.provider);
  });
}

async function actionsFor(actorId: string): Promise<string[]> {
  return asOwner(async (c) => {
    const r = await c.query<{ action: string }>(
      'SELECT action FROM infra.audit_log WHERE actor_id = $1 ORDER BY id',
      [actorId],
    );
    return r.rows.map((x) => x.action);
  });
}

async function noticeJobs(userId: string): Promise<string[]> {
  return asOwner(async (c) => {
    const r = await c.query<{ template: string }>(
      `SELECT data->'payload'->>'template' AS template FROM pgboss.job
        WHERE data->>'type' = 'account.mail_notice' AND data->'payload'->>'userId' = $1`,
      [userId],
    );
    return r.rows.map((x) => x.template);
  });
}

/** Người dùng đã có theo từng ô của ma trận: {có / không mật khẩu} × {email đã / chưa xác minh}. */
async function existingUser(
  t: TestApp,
  shape: { password: boolean; verified: boolean },
): Promise<{ email: string; userId: string }> {
  const email = uniqueEmail('trung');
  if (shape.password && shape.verified) {
    const { me } = await registerAndVerify(t, { email });
    return { email, userId: me.user.id };
  }
  if (shape.password) {
    // Đăng ký nhưng chưa mở liên kết xác minh.
    const reg = await t.agent().post('/api/v1/auth/register', {
      displayName: 'Chưa xác minh',
      email,
      password: STRONG_PASSWORD,
      ...terms,
    });
    expect(reg.status).toBe(202);
    const id = await asOwner(async (c) => {
      const r = await c.query<{ id: string }>(
        'SELECT id FROM account.users WHERE email_normalized = $1',
        [email],
      );
      return r.rows[0]?.id;
    });
    return { email, userId: id! };
  }
  // Không mật khẩu: người dùng chỉ có Facebook (đăng ký qua nhà cung cấp).
  const { me } = await oauthSignup(t, { scenario: 'facebook_with_email', email });
  if (!shape.verified) {
    await asOwner((c) =>
      c.query('UPDATE account.users SET email_verified_at = NULL WHERE id = $1', [me.user.id]),
    );
  }
  return { email, userId: me.user.id };
}

describeDb('Trùng email – xác nhận trước khi liên kết (US2)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  // ----- Ma trận SC-003 -----
  const shapes = [
    { password: true, verified: true },
    { password: true, verified: false },
    { password: false, verified: true },
    { password: false, verified: false },
  ];
  // Người dùng không mật khẩu ở ma trận đã có Facebook → chỉ thử bằng Google.
  const scenarios: FakeScenario[] = ['google_verified', 'google_unverified'];
  const facebookScenarios: FakeScenario[] = ['facebook_with_email', 'facebook_no_email'];

  for (const shape of shapes) {
    for (const scenario of [...scenarios, ...(shape.password ? facebookScenarios : [])]) {
      const label = `${shape.password ? 'có' : 'không'} mật khẩu, email ${
        shape.verified ? 'đã' : 'chưa'
      } xác minh × ${scenario}`;
      it(`ma trận: ${label} → không có phiên, không có người dùng thứ hai`, async () => {
        const user = await existingUser(t, shape);
        const before = await providersOf(user.email);
        const { agent, callback } = await oauthLogin(t, { scenario, email: user.email });
        expect(callback.status).toBe(303);
        expect(agent.sid).toBeUndefined();
        expect(await userCount(user.email)).toBe(1);

        const pending = await oauthPending(agent);
        if (scenario === 'google_verified' || scenario === 'facebook_with_email') {
          expect(pending.stage).toBe('needs_link_confirm');
          expect(pending.methods).toEqual(
            shape.password && shape.verified ? ['password', 'email'] : ['email'],
          );
          expect(pending.hint).toBe(shape.password ? null : 'login_with_facebook');
          // Email bị che – người lạ cầm tài khoản nhà cung cấp không thấy đầy đủ.
          expect(pending.suggestedEmail).toMatch(/^.\*\*\*@example\.test$/);
        } else {
          // Tự nhập email trùng: phản hồi giống hệt email chưa có người dùng.
          expect(pending.stage).toBe('needs_email');
          const fresh = await oauthLogin(t, { scenario, email: uniqueEmail('ncc') });
          const body = { displayName: 'Người lạ', ...terms };
          const [same, other] = await Promise.all([
            agent.post(SIGNUP, { ...body, email: user.email }),
            fresh.agent.post(SIGNUP, { ...body, email: uniqueEmail('moi') }),
          ]);
          expect([same.status, same.body]).toEqual([other.status, other.body]);
          expect(same.status).toBe(202);
          expect(same.headers['set-cookie']).toEqual(other.headers['set-cookie']);
          expect((await oauthPending(agent)).stage).toBe('awaiting_email');
          expect((await oauthPending(fresh.agent)).stage).toBe('awaiting_email');
          const mail = await waitForMail(t.mail, user.email, (m) =>
            m.text.includes('/oauth/confirm#token='),
          );
          expect(mail.subject).toContain('Xác nhận đăng nhập bằng');
        }
        // Bỏ dở: không có liên kết nào được tạo, không có phiên, vẫn một người dùng.
        expect(agent.sid).toBeUndefined();
        expect(await providersOf(user.email)).toEqual(before);
        expect(await userCount(user.email)).toBe(1);
      });
    }
  }

  it('đúng mật khẩu → liên kết + phiên + kiểm toán + việc thư identity_added', async () => {
    const { email, me, password } = await registerAndVerify(t);
    const { agent } = await oauthLogin(t, { scenario: 'google_verified', email, name: 'Lan G' });
    const res = await agent.post(LINK_PASSWORD, { password });
    expect(res.status).toBe(200);
    expect((res.body as MeBody).user.id).toBe(me.user.id);
    expect(agent.sid).toBeDefined();
    expect(agent.cookies.has('__Host-oauth')).toBe(false);
    expect(await providersOf(email)).toEqual(['google', 'password']);
    const actions = await actionsFor(me.user.id);
    expect(actions).toEqual(
      expect.arrayContaining([
        'auth.identity.link_requested',
        'auth.identity.link_confirmed',
        'auth.identity.linked',
      ]),
    );
    expect(await noticeJobs(me.user.id)).toEqual(['identity_added']);
    // Lần sau đăng nhập Google vào thẳng; mật khẩu cũ vẫn dùng được.
    const again = await oauthLogin(t, { scenario: 'google_verified', email });
    expect(again.agent.sid).toBeDefined();
    expect((await t.agent().post(LOGIN, { email, password })).status).toBe(200);
  });

  it('sai mật khẩu → 401, tính CHUNG bộ đếm login_email với đăng nhập → 429', async () => {
    const { email, me } = await registerAndVerify(t);
    const { agent } = await oauthLogin(t, { scenario: 'google_verified', email });
    const wrong = await agent.post(LINK_PASSWORD, { password: 'Sai-mật-khẩu-2026!' });
    expect(wrong.status).toBe(401);
    expect(code(wrong.body)).toBe('INVALID_CREDENTIALS');
    expect(await actionsFor(me.user.id)).toContain('auth.identity.link_denied');
    // 4 lần sai nữa ở trang đăng nhập (ngưỡng 5) → cả hai đường đều bị chặn.
    for (let i = 0; i < 4; i++) {
      await t.agent().post(LOGIN, { email, password: 'Sai-mật-khẩu-2026!' });
    }
    const blocked = await agent.post(LINK_PASSWORD, { password: STRONG_PASSWORD });
    expect(blocked.status).toBe(429);
    expect(code(blocked.body)).toBe('LOGIN_THROTTLED');
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(await providersOf(email)).toEqual(['password']);
  });

  it('link/password khi cách này không được phép → 400 OAUTH_FLOW_INVALID', async () => {
    const user = await existingUser(t, { password: true, verified: false });
    const { agent } = await oauthLogin(t, { scenario: 'google_verified', email: user.email });
    expect((await oauthPending(agent)).methods).toEqual(['email']);
    const res = await agent.post(LINK_PASSWORD, { password: STRONG_PASSWORD });
    expect(res.status).toBe(400);
    expect(code(res.body)).toBe('OAUTH_FLOW_INVALID');
    expect(agent.sid).toBeUndefined();
  });

  it('gửi liên kết qua email: dùng một lần, mã mới vô hiệu mã cũ, quá 3 thư/giờ vẫn 202', async () => {
    const { email, me } = await registerAndVerify(t);
    const { agent } = await oauthLogin(t, { scenario: 'facebook_with_email', email });
    const first = await agent.post(LINK_EMAIL);
    expect(first.status).toBe(202);
    expect(first.body).toEqual({ status: 'check_email' });
    const mail1 = await waitForMail(t.mail, email, (m) => m.text.includes('/oauth/confirm#'));
    const token1 = tokenFromMail(mail1);
    expect(mail1.text).toContain('Facebook');
    expect(mail1.text).toContain('30 phút');

    // "Gửi lại": mã mới, mã cũ không còn tra được.
    expect((await agent.post(LINK_EMAIL)).status).toBe(202);
    const mail2 = await waitForMail(
      t.mail,
      email,
      (m) => m.text.includes('/oauth/confirm#') && tokenFromMail(m) !== token1,
    );
    const token2 = tokenFromMail(mail2);
    const old = await t.agent().post(CONFIRM, { token: token1 });
    expect(old.status).toBe(400);
    expect(code(old.body)).toBe('TOKEN_INVALID');

    // Quá ngưỡng 3 thư/giờ: vẫn 202, không thêm thư.
    await agent.post(LINK_EMAIL);
    await settleMail();
    const sent = t.mail.messages().length;
    expect((await agent.post(LINK_EMAIL)).status).toBe(202);
    await settleMail();
    expect(t.mail.messages().length).toBe(sent);

    const device = t.agent();
    // Mã thứ ba (còn trong ngưỡng) đã thay mã thứ hai.
    const latest = tokenFromMail(
      await waitForMail(
        t.mail,
        email,
        (m) => m.text.includes('/oauth/confirm#') && ![token1, token2].includes(tokenFromMail(m)),
      ),
    );
    const ok = await device.post(CONFIRM, { token: latest });
    expect(ok.status).toBe(200);
    expect((ok.body as MeBody).user.id).toBe(me.user.id);
    expect(device.sid).toBeDefined();
    expect(await providersOf(email)).toEqual(['facebook', 'password']);
    expect((await t.agent().post(CONFIRM, { token: latest })).status).toBe(400);
  });

  it('người dùng CHƯA xác minh email xác nhận qua thư → mật khẩu cũ bị xóa, phiên cũ bị thu hồi', async () => {
    const user = await existingUser(t, { password: true, verified: false });
    const { agent } = await oauthLogin(t, { scenario: 'google_verified', email: user.email });
    await agent.post(LINK_EMAIL);
    const mail = await waitForMail(t.mail, user.email, (m) => m.text.includes('/oauth/confirm#'));
    const res = await t.agent().post(CONFIRM, { token: tokenFromMail(mail) });
    expect(res.status).toBe(200);
    expect((res.body as MeBody).user).toMatchObject({ id: user.userId, emailVerified: true });
    // Người mở thư mới là chủ thật của email: mật khẩu do người đăng ký trước đặt không còn dùng được.
    expect(await providersOf(user.email)).toEqual(['google']);
    const login = await t.agent().post(LOGIN, { email: user.email, password: STRONG_PASSWORD });
    expect(login.status).toBe(401);
  });

  it('email trùng nhân viên nội bộ → đi nhánh người mới', async () => {
    const email = uniqueEmail('nhanvien');
    await t.app.get<AccountPublicApi>(ACCOUNT_PUBLIC_API).createStaff({
      email,
      displayName: 'Nhân viên',
      role: 'support',
      password: STRONG_PASSWORD,
    });
    const { agent } = await oauthLogin(t, { scenario: 'google_verified', email });
    expect((await oauthPending(agent)).stage).toBe('needs_signup');
  });

  it('người dùng đã có một danh tính CÙNG nhà cung cấp → PROVIDER_ACCOUNT_CONFLICT, không đổi gì', async () => {
    const email = uniqueEmail('fbA');
    const { me } = await oauthSignup(t, {
      scenario: 'facebook_with_email',
      email,
      sub: `A-${email}`,
    });
    // Facebook B cùng email đã xác minh.
    const b = await oauthLogin(t, { scenario: 'facebook_with_email', email, sub: `B-${email}` });
    expect(b.agent.sid).toBeUndefined();
    const pending = await oauthPending(b.agent);
    expect(pending.stage).toBe('failed');
    expect(pending.error?.code).toBe('PROVIDER_ACCOUNT_CONFLICT');
    expect(await actionsFor(me.user.id)).toContain('auth.identity.link_denied');
    expect(await providersOf(email)).toEqual(['facebook']);

    // Facebook C không trả email, người dùng tự nhập email đó: vẫn 202, KHÔNG phát mã, có thư thông tin.
    const c = await oauthLogin(t, { scenario: 'facebook_no_email', sub: `C-${email}` });
    const sent = t.mail.messages().length;
    const res = await c.agent.post(SIGNUP, { displayName: 'C', email, ...terms });
    expect([res.status, res.body]).toEqual([202, { status: 'check_email' }]);
    expect((await oauthPending(c.agent)).stage).toBe('awaiting_email');
    await settleMail();
    expect(t.mail.messages().length).toBe(sent);
    expect(await noticeJobs(me.user.id)).toEqual(['identity_link_blocked']);
    // "Gửi lại" cũng không phát mã.
    expect((await c.agent.post(LINK_EMAIL)).status).toBe(202);
    await settleMail();
    expect(t.mail.messages().length).toBe(sent);
    expect(await providersOf(email)).toEqual(['facebook']);
  });

  it('tranh chấp ở bước xác nhận (danh tính cùng loại được thêm sau khi lượt bắt đầu) → 409, không 500', async () => {
    const { email, me, password } = await registerAndVerify(t);
    const { agent } = await oauthLogin(t, {
      scenario: 'google_verified',
      email,
      sub: `1-${email}`,
    });
    expect((await oauthPending(agent)).stage).toBe('needs_link_confirm');
    // Trong lúc đó người dùng có thêm một danh tính Google khác.
    await asOwner((c) =>
      c.query(
        `INSERT INTO account.login_identities (id, account_id, user_id, provider, provider_subject)
         VALUES (gen_random_uuid(), $1, $2, 'google', $3)`,
        [me.account.id, me.user.id, `2-${email}`],
      ),
    );
    const res = await agent.post(LINK_PASSWORD, { password });
    expect(res.status).toBe(409);
    expect(code(res.body)).toBe('PROVIDER_ACCOUNT_CONFLICT');
    expect(agent.sid).toBeUndefined();
  });
});
