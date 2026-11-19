import { afterAll, beforeAll, expect, it } from 'vitest';
import { asOwner, describeDb } from '../db/helpers/db';
import {
  createTestApp,
  followFakeProvider,
  oauthLogin,
  oauthPending,
  oauthSignup,
  settleMail,
  tokenFromMail,
  uniqueEmail,
  waitForMail,
  type ErrorBody,
  type MeBody,
  type TestApp,
} from './helpers/app';

// T031 (009 – US1): vào ứng dụng bằng Google/Facebook qua nhà cung cấp GIẢ LẬP (OAUTH_DRIVER=fake).

const SIGNUP = '/api/v1/auth/oauth/signup';
const CONFIRM = '/api/v1/auth/oauth/confirm';
const ME = '/api/v1/auth/me';
const terms = { acceptTerms: true, termsVersion: '2026-11' };
const code = (body: unknown) => (body as ErrorBody).error.code;

async function counts(emailNormalized: string) {
  return asOwner(async (c) => {
    const users = await c.query<{ id: string; account_id: string }>(
      'SELECT id, account_id FROM account.users WHERE email_normalized = $1',
      [emailNormalized],
    );
    const user = users.rows[0];
    if (user === undefined) return { users: 0, accounts: 0, identities: 0, memberships: 0 };
    const n = async (sql: string) =>
      Number((await c.query<{ n: string }>(sql, [user.account_id])).rows[0]?.n);
    return {
      users: users.rows.length,
      accounts: await n('SELECT count(*)::text AS n FROM account.accounts WHERE id = $1'),
      identities: await n(
        'SELECT count(*)::text AS n FROM account.login_identities WHERE account_id = $1',
      ),
      memberships: await n(
        `SELECT count(*)::text AS n FROM account.memberships WHERE account_id = $1 AND role = 'owner'`,
      ),
    };
  });
}

async function auditActions(actorId: string): Promise<string[]> {
  return asOwner(async (c) => {
    const r = await c.query<{ action: string }>(
      'SELECT action FROM infra.audit_log WHERE actor_id = $1 ORDER BY id',
      [actorId],
    );
    return r.rows.map((x) => x.action);
  });
}

describeDb('Đăng nhập qua nhà cung cấp – US1', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  for (const scenario of ['google_verified', 'facebook_with_email'] as const) {
    it(`${scenario}: email mới → needs_signup → đồng ý → tài khoản + vai trò chủ, đã xác minh`, async () => {
      const email = uniqueEmail('oauth');
      const { agent, callback } = await oauthLogin(t, { scenario, email, name: 'Lan Tiệm Hoa' });
      // Đường quay về luôn 303 về trang kết quả, KHÔNG tham số, chưa có phiên.
      expect(callback.status).toBe(303);
      expect(callback.headers.location).toBe('http://app.test/oauth/result');
      expect(agent.sid).toBeUndefined();

      const pending = await oauthPending(agent);
      expect(pending).toMatchObject({
        stage: 'needs_signup',
        purpose: 'login',
        suggestedDisplayName: 'Lan Tiệm Hoa',
        suggestedEmail: email,
        emailRequired: false,
        methods: [],
        error: null,
      });
      // Không có state, mã nhà cung cấp hay mã người dùng phía nhà cung cấp trong phản hồi.
      expect(Object.keys(pending).sort()).toEqual(
        [
          'emailRequired',
          'error',
          'hint',
          'methods',
          'provider',
          'purpose',
          'stage',
          'suggestedDisplayName',
          'suggestedEmail',
        ].sort(),
      );
      // Bỏ dở ở đây → chưa có gì được tạo.
      expect(await counts(email)).toMatchObject({ users: 0 });

      // Ô đồng ý không bao giờ được coi là đã tích.
      const noTerms = await agent.post(SIGNUP, { displayName: 'Lan', termsVersion: '2026-11' });
      expect(noTerms.status).toBe(400);
      expect(code(noTerms.body)).toBe('VALIDATION_FAILED');
      expect(await counts(email)).toMatchObject({ users: 0 });

      const done = await agent.post(SIGNUP, { displayName: 'Lan', ...terms });
      expect(done.status).toBe(200);
      const me = done.body as MeBody;
      expect(me).toMatchObject({
        user: { displayName: 'Lan', email, emailVerified: true },
        account: { status: 'active' },
        role: 'owner',
      });
      expect(agent.sid).toBeDefined();
      expect(agent.cookies.has('__Host-oauth')).toBe(false);
      expect(await counts(email)).toEqual({ users: 1, accounts: 1, identities: 1, memberships: 1 });

      // 010 FR-005: đăng nhập Facebook KHÔNG tự tạo kết nối kênh (quyền đăng bài là bước xin riêng).
      const channels = await asOwner((c) =>
        c.query<{ n: string }>(
          'SELECT count(*)::text AS n FROM platform_gateway.channel_connections WHERE account_id = $1',
          [me.account.id],
        ),
      );
      expect(channels.rows[0]?.n).toBe('0');

      const row = await asOwner(async (c) => {
        const u = await c.query<{ terms_version: string; terms_accepted_at: Date | null }>(
          'SELECT terms_version, terms_accepted_at FROM account.users WHERE id = $1',
          [me.user.id],
        );
        const i = await c.query<Record<string, unknown>>(
          'SELECT * FROM account.login_identities WHERE user_id = $1',
          [me.user.id],
        );
        return { user: u.rows[0], identity: i.rows[0] };
      });
      expect(row.user?.terms_version).toBe('2026-11');
      expect(row.user?.terms_accepted_at).not.toBeNull();
      // Chỉ có mã người dùng, email, tên phía nhà cung cấp – không cột nào chứa mã quyền.
      expect(row.identity).toMatchObject({
        provider: scenario.startsWith('google') ? 'google' : 'facebook',
        provider_email: email,
        provider_display_name: 'Lan Tiệm Hoa',
        password_hash: null,
      });
      expect(Object.keys(row.identity ?? {}).join(',')).not.toMatch(/token|secret/i);
      expect(await auditActions(me.user.id)).toContain('auth.register.oauth');

      // Đăng xuất rồi đăng nhập lại: vào thẳng, không hỏi điều khoản, không tạo thêm gì.
      await agent.post('/api/v1/auth/logout');
      const again = await oauthLogin(t, { scenario, email });
      expect(again.callback.status).toBe(303);
      expect(again.agent.sid).toBeDefined();
      expect((await oauthPending(again.agent)).stage).toBe('signed_in');
      const meAgain = await again.agent.get(ME);
      expect((meAgain.body as MeBody).user.id).toBe(me.user.id);
      expect(await counts(email)).toEqual({ users: 1, accounts: 1, identities: 1, memberships: 1 });
      expect(await auditActions(me.user.id)).toContain('auth.oauth.succeeded');
    });
  }

  it('đổi email phía nhà cung cấp sau khi liên kết (cùng sub) → vẫn vào đúng người dùng', async () => {
    const email = uniqueEmail('oauth');
    const sub = `sub-${email}`;
    const { me } = await oauthSignup(t, { scenario: 'google_verified', email, sub });
    const again = await oauthLogin(t, {
      scenario: 'google_verified',
      sub,
      email: uniqueEmail('khac'),
    });
    const now = (await again.agent.get(ME)).body as MeBody;
    expect(now.user.id).toBe(me.user.id);
    expect(now.user.email).toBe(email);
  });

  for (const scenario of ['facebook_no_email', 'google_unverified'] as const) {
    it(`${scenario}: needs_email → nhập email mới → thư hoàn tất → tạo tài khoản`, async () => {
      const typed = uniqueEmail('nhap');
      const { agent } = await oauthLogin(t, { scenario, email: uniqueEmail('ncc'), name: 'Minh' });
      expect(agent.sid).toBeUndefined();
      const pending = await oauthPending(agent);
      expect(pending).toMatchObject({ stage: 'needs_email', emailRequired: true });

      const res = await agent.post(SIGNUP, { displayName: 'Minh', email: typed, ...terms });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ status: 'check_email' });
      expect(agent.sid).toBeUndefined();
      // CHƯA có người dùng cho tới khi mở liên kết trong thư.
      expect(await counts(typed)).toMatchObject({ users: 0 });
      expect((await oauthPending(agent)).stage).toBe('awaiting_email');

      const mail = await waitForMail(t.mail, typed, (m) =>
        m.text.includes('/oauth/confirm#token='),
      );
      const token = tokenFromMail(mail);
      // Mở trên thiết bị khác: không cần cookie của lượt.
      const other = t.agent();
      const confirmed = await other.post(CONFIRM, { token });
      expect(confirmed.status).toBe(200);
      expect(confirmed.body).toMatchObject({
        user: { email: typed, emailVerified: true },
        role: 'owner',
      });
      expect(other.sid).toBeDefined();
      expect(await counts(typed)).toEqual({ users: 1, accounts: 1, identities: 1, memberships: 1 });

      // Mã dùng một lần.
      const twice = await t.agent().post(CONFIRM, { token });
      expect(twice.status).toBe(400);
      expect(code(twice.body)).toBe('TOKEN_INVALID');
    });
  }

  it('mã hoàn tất đăng ký quá 24 giờ → TOKEN_INVALID, không tạo gì', async () => {
    const typed = uniqueEmail('han');
    const { agent } = await oauthLogin(t, { scenario: 'facebook_no_email' });
    await agent.post(SIGNUP, { displayName: 'Hạn', email: typed, ...terms });
    const mail = await waitForMail(t.mail, typed);
    await asOwner((c) =>
      c.query(
        `UPDATE account.oauth_flows SET expires_at = now() - interval '1 minute'
          WHERE claimed_email_normalized = $1`,
        [typed],
      ),
    );
    const res = await t.agent().post(CONFIRM, { token: tokenFromMail(mail) });
    expect(res.status).toBe(400);
    expect(code(res.body)).toBe('TOKEN_INVALID');
    expect(await counts(typed)).toMatchObject({ users: 0 });
  });

  it('cancel → OAUTH_CANCELLED; provider_down → PROVIDER_UNAVAILABLE; không tạo gì, có kiểm toán', async () => {
    const before = await asOwner(async (c) =>
      Number(
        (
          await c.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM infra.audit_log WHERE action = 'auth.oauth.failed'`,
          )
        ).rows[0]?.n,
      ),
    );
    const cancelled = await oauthLogin(t, { scenario: 'cancel' });
    expect(cancelled.callback.status).toBe(303);
    const p1 = await oauthPending(cancelled.agent);
    expect(p1.stage).toBe('failed');
    expect(p1.error?.code).toBe('OAUTH_CANCELLED');
    expect(p1.error?.message).toContain('Google');
    expect(p1.error?.actions.length).toBeGreaterThan(0);
    // Lượt kết thúc → cookie của lượt bị xóa.
    expect(cancelled.agent.cookies.has('__Host-oauth')).toBe(false);

    const down = await oauthLogin(t, { scenario: 'provider_down', provider: 'facebook' });
    const p2 = await oauthPending(down.agent);
    expect(p2.error?.code).toBe('PROVIDER_UNAVAILABLE');
    expect(down.agent.sid).toBeUndefined();

    const reasons = await asOwner(async (c) => {
      const r = await c.query<{ metadata: { reason: string; provider: string } }>(
        `SELECT metadata FROM infra.audit_log WHERE action = 'auth.oauth.failed'
          ORDER BY id DESC LIMIT 2`,
      );
      return r.rows.map((x) => `${x.metadata.provider}:${x.metadata.reason}`);
    });
    expect(reasons.sort()).toEqual(['facebook:provider_error', 'google:cancelled']);
    const after = await asOwner(async (c) =>
      Number(
        (
          await c.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM infra.audit_log WHERE action = 'auth.oauth.failed'`,
          )
        ).rows[0]?.n,
      ),
    );
    expect(after - before).toBe(2);
  });

  it('đường quay về không cookie / sai state / lặp lại / quá hạn → OAUTH_FLOW_INVALID', async () => {
    const email = uniqueEmail('flow');
    // Không cookie: trình duyệt khác mở đường quay về.
    const a = t.agent();
    const start = await a.post('/api/v1/auth/oauth/google/start', { purpose: 'login' });
    const url = (start.body as { authorizationUrl: string }).authorizationUrl;
    const stranger = t.agent();
    const res = await followFakeProvider(stranger, url, { scenario: 'google_verified', email });
    expect(res.status).toBe(303);
    expect(stranger.sid).toBeUndefined();
    expect((await stranger.get('/api/v1/auth/oauth/pending')).status).toBe(400);
    // Lượt gốc vẫn dùng được với đúng trình duyệt.
    await followFakeProvider(a, url, { scenario: 'google_verified', email });
    expect((await oauthPending(a)).stage).toBe('needs_signup');
    // Lặp lại đường quay về → lượt hỏng, không tạo gì.
    await followFakeProvider(a, url, { scenario: 'google_verified', email });
    const repeated = await oauthPending(a);
    expect(repeated.stage).toBe('failed');
    expect(repeated.error?.code).toBe('OAUTH_FLOW_INVALID');
    expect(await counts(email)).toMatchObject({ users: 0 });

    // Sai state.
    const b = t.agent();
    await b.post('/api/v1/auth/oauth/google/start', { purpose: 'login' });
    await b.get('/api/v1/auth/oauth/google/callback?code=x&state=sai-state');
    expect((await oauthPending(b)).error?.code).toBe('OAUTH_FLOW_INVALID');

    // Quá 10 phút.
    const c = t.agent();
    const s3 = await c.post('/api/v1/auth/oauth/google/start', { purpose: 'login' });
    await asOwner((db) =>
      db.query(
        `UPDATE account.oauth_flows SET expires_at = now() - interval '1 second'
          WHERE stage = 'started' AND expires_at > now() + interval '9 minutes'`,
      ),
    );
    await followFakeProvider(c, (s3.body as { authorizationUrl: string }).authorizationUrl, {
      scenario: 'google_verified',
      email,
    });
    expect((await oauthPending(c)).error?.code).toBe('OAUTH_FLOW_INVALID');
    expect(await counts(email)).toMatchObject({ users: 0 });
  });

  it('hai signup đồng thời cùng một lượt → đúng một người dùng', async () => {
    const email = uniqueEmail('dua');
    const { agent } = await oauthLogin(t, { scenario: 'google_verified', email });
    const body = { displayName: 'Đua', ...terms };
    const results = await Promise.all([agent.post(SIGNUP, body), agent.post(SIGNUP, body)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await counts(email)).toEqual({ users: 1, accounts: 1, identities: 1, memberships: 1 });
  });

  it('người dùng bị khóa → failed ACCOUNT_UNAVAILABLE (theo danh tính lẫn theo email đã xác minh)', async () => {
    const email = uniqueEmail('khoa');
    const { me } = await oauthSignup(t, { scenario: 'google_verified', email });
    await asOwner((c) =>
      c.query(`UPDATE account.users SET status = 'disabled' WHERE id = $1`, [me.user.id]),
    );
    const byIdentity = await oauthLogin(t, { scenario: 'google_verified', email });
    expect(byIdentity.agent.sid).toBeUndefined();
    expect((await oauthPending(byIdentity.agent)).error?.code).toBe('ACCOUNT_UNAVAILABLE');
    // Danh tính Facebook chưa liên kết, email đã xác minh trùng người bị khóa: không vào xác nhận liên
    // kết, không tạo người dùng thay thế.
    const byEmail = await oauthLogin(t, { scenario: 'facebook_with_email', email });
    expect((await oauthPending(byEmail.agent)).error?.code).toBe('ACCOUNT_UNAVAILABLE');
    // Email tự nhập trùng người đó → vẫn 202, không gửi thư.
    const typed = await oauthLogin(t, { scenario: 'facebook_no_email' });
    const sent = t.mail.messages().length;
    const res = await typed.agent.post(SIGNUP, { displayName: 'X', email, ...terms });
    expect(res.status).toBe(202);
    await settleMail();
    expect(t.mail.messages().length).toBe(sent);
    expect((await counts(email)).users).toBe(1);
  });

  it('{provider} lạ → 404; quá 30 lượt start/giờ từ một địa chỉ → 429', async () => {
    const agent = t.agent();
    expect((await agent.post('/api/v1/auth/oauth/zalo/start', { purpose: 'login' })).status).toBe(
      404,
    );
    expect((await agent.get('/api/v1/auth/oauth/zalo/callback?code=1&state=2')).status).toBe(404);
    const flood = t.agent();
    let last = 0;
    for (let i = 0; i < 31; i++) {
      last = (await flood.post('/api/v1/auth/oauth/google/start', { purpose: 'login' })).status;
      if (i < 30) expect(last).toBe(200);
    }
    expect(last).toBe(429);
  });

  it('lối vào nhân viên nội bộ không có điểm cuối nhà cung cấp', async () => {
    const agent = t.agent();
    for (const path of [
      '/api/v1/internal/auth/oauth/google/start',
      '/api/v1/internal/auth/google/start',
    ]) {
      expect((await agent.post(path, { purpose: 'login' })).status).toBe(404);
    }
  });
});
