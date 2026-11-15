import { afterAll, beforeAll, expect, it } from 'vitest';
import { asOwner, describeDb } from '../db/helpers/db';
import { collaboratorOf } from './helpers/actors';
import {
  createTestApp,
  followFakeProvider,
  oauthLogin,
  oauthPending,
  oauthSignup,
  registerAndVerify,
  STRONG_PASSWORD,
  tokenFromMail,
  uniqueEmail,
  waitForMail,
  type Agent,
  type ErrorBody,
  type MeBody,
  type OAuthScenario,
  type TestApp,
} from './helpers/app';

// T072 (009 – US5): tự quản lý các cách đăng nhập; thao tác nhạy cảm đòi xác nhận lại danh tính.

const METHODS = '/api/v1/auth/login-methods';
const REAUTH = '/api/v1/auth/reauth';
const LOGIN = '/api/v1/auth/login';
const code = (body: unknown) => (body as ErrorBody).error.code;

interface MethodsBody {
  methods: {
    kind: string;
    linked: boolean;
    providerEmail?: string;
    providerDisplayName?: string;
    linkedAt?: string;
  }[];
  reauthFresh: boolean;
}

async function ageSessions(userId: string): Promise<void> {
  await asOwner((c) =>
    c.query(
      `UPDATE account.sessions
          SET created_at = now() - interval '11 minutes', reauthenticated_at = NULL
        WHERE user_id = $1`,
      [userId],
    ),
  );
}

async function startFor(
  agent: Agent,
  purpose: 'link' | 'reauth',
  input: OAuthScenario,
): Promise<number> {
  const provider = input.scenario.startsWith('facebook') ? 'facebook' : 'google';
  const start = await agent.post(`${METHODS}/${provider}/start`, { purpose });
  if (start.status !== 200) return start.status;
  await followFakeProvider(
    agent,
    (start.body as { authorizationUrl: string }).authorizationUrl,
    input,
  );
  return 200;
}

const actionsOf = (userId: string) =>
  asOwner(async (c) => {
    const r = await c.query<{ action: string }>(
      'SELECT action FROM infra.audit_log WHERE actor_id = $1 ORDER BY id',
      [userId],
    );
    return r.rows.map((x) => x.action);
  });

const notices = (userId: string) =>
  asOwner(async (c) => {
    const r = await c.query<{ template: string }>(
      `SELECT data->'payload'->>'template' AS template FROM pgboss.job
        WHERE data->>'type' = 'account.mail_notice' AND data->'payload'->>'userId' = $1
        ORDER BY created_on`,
      [userId],
    );
    return r.rows.map((x) => x.template);
  });

describeDb('Cách đăng nhập của tôi – US5', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('luôn đủ ba dòng; phiên vừa đăng nhập coi là mới xác nhận', async () => {
    const { agent } = await registerAndVerify(t);
    const body = (await agent.get(METHODS)).body as MethodsBody;
    expect(body.methods.map((m) => [m.kind, m.linked])).toEqual([
      ['password', true],
      ['google', false],
      ['facebook', false],
    ]);
    expect(body.methods[0]?.linkedAt).toBeDefined();
    expect(body.reauthFresh).toBe(true);
    expect((await t.agent().get(METHODS)).status).toBe(401);
  });

  it('liên kết Google có email KHÁC email người dùng → thành công, email chính không đổi', async () => {
    const { agent, email, me } = await registerAndVerify(t);
    const googleEmail = uniqueEmail('g');
    expect(
      await startFor(agent, 'link', {
        scenario: 'google_verified',
        email: googleEmail,
        name: 'Lan G',
      }),
    ).toBe(200);
    const pending = await oauthPending(agent);
    expect(pending).toMatchObject({ purpose: 'link', stage: 'completed' });

    const body = (await agent.get(METHODS)).body as MethodsBody;
    expect(body.methods.find((m) => m.kind === 'google')).toMatchObject({
      linked: true,
      providerEmail: googleEmail,
      providerDisplayName: 'Lan G',
    });
    expect(((await agent.get('/api/v1/auth/me')).body as MeBody).user.email).toBe(email);
    expect(await actionsOf(me.user.id)).toContain('auth.identity.linked');
    expect(await notices(me.user.id)).toEqual(['identity_added']);

    // Đăng xuất, đăng nhập bằng Google → vào đúng tài khoản.
    const back = await oauthLogin(t, { scenario: 'google_verified', email: googleEmail });
    expect(((await back.agent.get('/api/v1/auth/me')).body as MeBody).user.id).toBe(me.user.id);

    // Đã có loại đó → 409.
    const dup = await agent.post(`${METHODS}/google/start`, { purpose: 'link' });
    expect(dup.status).toBe(409);
    expect(code(dup.body)).toBe('LOGIN_METHOD_EXISTS');
    expect((await agent.post(`${METHODS}/zalo/start`, { purpose: 'link' })).status).toBe(404);
  });

  it('danh tính đã gắn người dùng khác → failed IDENTITY_IN_USE, không chuyển, không gộp', async () => {
    const taken = await oauthSignup(t, {
      scenario: 'google_verified',
      email: uniqueEmail('co'),
      sub: 'sub-da-co',
    });
    const { agent, email } = await registerAndVerify(t);
    await startFor(agent, 'link', { scenario: 'google_verified', sub: 'sub-da-co' });
    const pending = await oauthPending(agent);
    expect(pending.stage).toBe('failed');
    expect(pending.error?.code).toBe('IDENTITY_IN_USE');
    const body = (await agent.get(METHODS)).body as MethodsBody;
    expect(body.methods.find((m) => m.kind === 'google')?.linked).toBe(false);
    // Danh tính vẫn thuộc người cũ.
    const back = await oauthLogin(t, { scenario: 'google_verified', sub: 'sub-da-co', email });
    expect(((await back.agent.get('/api/v1/auth/me')).body as MeBody).user.id).toBe(
      taken.me.user.id,
    );
  });

  it('phiên quá 10 phút: link / DELETE / password/request → 403 REAUTH_REQUIRED; reauth bằng mật khẩu', async () => {
    const { agent, me, password, email } = await registerAndVerify(t);
    await startFor(agent, 'link', { scenario: 'google_verified', email: uniqueEmail('g') });
    await ageSessions(me.user.id);
    expect(((await agent.get(METHODS)).body as MethodsBody).reauthFresh).toBe(false);

    for (const res of [
      await agent.post(`${METHODS}/facebook/start`, { purpose: 'link' }),
      await agent.delete(`${METHODS}/google`),
      await agent.post(`${METHODS}/password/request`),
    ]) {
      expect(res.status).toBe(403);
      expect(code(res.body)).toBe('REAUTH_REQUIRED');
      expect((res.body as ErrorBody).error.actions.map((a) => a.kind)).toContain('reauth');
    }

    const wrong = await agent.post(REAUTH, { password: 'Sai-mật-khẩu-2026!' });
    expect(wrong.status).toBe(401);
    expect(code(wrong.body)).toBe('INVALID_CREDENTIALS');
    // Cùng bộ đếm với đăng nhập: thêm 4 lần sai ở trang đăng nhập → reauth bị chặn.
    for (let i = 0; i < 4; i++)
      await t.agent().post(LOGIN, { email, password: 'Sai-mật-khẩu-2026!' });
    const blocked = await agent.post(REAUTH, { password });
    expect(blocked.status).toBe(429);
    await asOwner((c) => c.query('DELETE FROM account.auth_throttle'));

    expect((await agent.post(REAUTH, { password })).status).toBe(204);
    expect(((await agent.get(METHODS)).body as MethodsBody).reauthFresh).toBe(true);
    expect(await actionsOf(me.user.id)).toContain('auth.reauth');
    expect((await agent.delete(`${METHODS}/google`)).status).toBe(204);
  });

  it('xác nhận lại bằng nhà cung cấp: danh tính của mình → completed; của người khác → REAUTH_MISMATCH', async () => {
    const email = uniqueEmail('chi-g');
    const { agent, me } = await oauthSignup(t, {
      scenario: 'google_verified',
      email,
      sub: `s-${email}`,
    });
    await ageSessions(me.user.id);
    expect(
      await startFor(agent, 'reauth', { scenario: 'google_verified', sub: 'sub-nguoi-la' }),
    ).toBe(200);
    const bad = await oauthPending(agent);
    expect(bad.stage).toBe('failed');
    expect(bad.error?.code).toBe('REAUTH_MISMATCH');
    expect(((await agent.get(METHODS)).body as MethodsBody).reauthFresh).toBe(false);

    await startFor(agent, 'reauth', { scenario: 'google_verified', sub: `s-${email}` });
    expect((await oauthPending(agent)).stage).toBe('completed');
    expect(((await agent.get(METHODS)).body as MethodsBody).reauthFresh).toBe(true);
  });

  it('gỡ khi còn ≥ 2 → 204, cách đó không vào được nữa, phiên giữ nguyên; gỡ cách cuối → 409', async () => {
    const { agent, me, email } = await registerAndVerify(t);
    const gEmail = uniqueEmail('g');
    await startFor(agent, 'link', { scenario: 'google_verified', email: gEmail });
    expect((await agent.delete(`${METHODS}/facebook`)).status).toBe(404);
    expect((await agent.delete(`${METHODS}/khac`)).status).toBe(404);

    const sid = agent.sid;
    expect((await agent.delete(`${METHODS}/google`)).status).toBe(204);
    expect(agent.sid).toBe(sid);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
    expect(await actionsOf(me.user.id)).toContain('auth.identity.unlinked');
    expect(await notices(me.user.id)).toEqual(['identity_added', 'identity_removed']);
    // Google đó không còn vào được tài khoản này (thành người mới).
    const back = await oauthLogin(t, { scenario: 'google_verified', email: gEmail });
    expect(back.agent.sid).toBeUndefined();
    expect((await oauthPending(back.agent)).stage).toBe('needs_signup');

    const last = await agent.delete(`${METHODS}/password`);
    expect(last.status).toBe(409);
    expect(code(last.body)).toBe('LAST_LOGIN_METHOD');
    expect((await t.agent().post(LOGIN, { email, password: STRONG_PASSWORD })).status).toBe(200);
  });

  it('người chỉ có Google tạo mật khẩu: thư đặt mật khẩu → reset tạo dòng password → đăng nhập bằng email', async () => {
    const email = uniqueEmail('chi-g');
    const { agent, me } = await oauthSignup(t, { scenario: 'google_verified', email });
    const res = await agent.post(`${METHODS}/password/request`);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: 'check_email' });
    const mail = await waitForMail(t.mail, email, (m) => m.text.includes('/reset-password#token='));
    expect(mail.subject).toBe('Tạo mật khẩu đăng nhập');
    const reset = await t.agent().post('/api/v1/auth/password/reset', {
      token: tokenFromMail(mail),
      newPassword: STRONG_PASSWORD,
    });
    expect(reset.status).toBe(200);
    expect(await actionsOf(me.user.id)).toContain('auth.password.set');
    expect((await t.agent().post(LOGIN, { email, password: STRONG_PASSWORD })).status).toBe(200);
    // Đã có mật khẩu → 409 (cần phiên mới vì reset đã thu hồi phiên cũ).
    const fresh = t.agent();
    await fresh.post(LOGIN, { email, password: STRONG_PASSWORD });
    const dup = await fresh.post(`${METHODS}/password/request`);
    expect(dup.status).toBe(409);
    expect(code(dup.body)).toBe('LOGIN_METHOD_EXISTS');
  });

  it('quên mật khẩu cho người chưa có mật khẩu: gửi thư, phản hồi giống hệt email khác', async () => {
    const email = uniqueEmail('chi-f');
    await oauthSignup(t, { scenario: 'facebook_with_email', email });
    const a = await t.agent().post('/api/v1/auth/password/forgot', { email });
    const b = await t
      .agent()
      .post('/api/v1/auth/password/forgot', { email: uniqueEmail('khong-co') });
    expect([a.status, a.body]).toEqual([b.status, b.body]);
    const mail = await waitForMail(t.mail, email, (m) => m.text.includes('/reset-password#token='));
    expect(mail.subject).toBe('Tạo mật khẩu đăng nhập');
  });

  it('cộng tác viên dùng được đầy đủ; người chưa xác minh email chỉ xem danh sách và reauth', async () => {
    const owner = await registerAndVerify(t);
    const collaborator = await collaboratorOf(t, owner.me);
    expect(
      await startFor(collaborator.agent, 'link', {
        scenario: 'facebook_with_email',
        email: uniqueEmail('f'),
      }),
    ).toBe(200);
    expect((await oauthPending(collaborator.agent)).stage).toBe('completed');

    const email = uniqueEmail('chua');
    await t.agent().post('/api/v1/auth/register', {
      displayName: 'Chưa xác minh',
      email,
      password: STRONG_PASSWORD,
      acceptTerms: true,
      termsVersion: '2026-11',
    });
    // Người chưa xác minh không đăng nhập được bằng mật khẩu cho tới khi xác minh – dùng liên kết thư
    // để lấy phiên rồi bỏ xác minh, mô phỏng phiên "chưa xác minh" của 004 (sửa email).
    const verifyMail = await waitForMail(t.mail, email, (m) =>
      m.text.includes('/verify-email#token='),
    );
    const unverified = t.agent();
    const verified = await unverified.post('/api/v1/auth/email/verify', {
      token: tokenFromMail(verifyMail),
    });
    await asOwner((c) =>
      c.query('UPDATE account.users SET email_verified_at = NULL WHERE id = $1', [
        (verified.body as MeBody).user.id,
      ]),
    );
    t.cache.evictWhere(() => true);
    expect((await unverified.get(METHODS)).status).toBe(200);
    expect((await unverified.post(REAUTH, { password: STRONG_PASSWORD })).status).toBe(204);
    const denied = await unverified.post(`${METHODS}/google/start`, { purpose: 'link' });
    expect(denied.status).toBe(403);
    expect(code(denied.body)).toBe('EMAIL_NOT_VERIFIED');
  });
});
