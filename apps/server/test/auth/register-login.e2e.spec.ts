import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PasswordHasher } from '../../src/modules/account/internal/auth/password/password-hasher';
import { asOwner, describeDb } from '../db/helpers/db';
import {
  createTestApp,
  randomIp,
  registerAndVerify,
  settleMail,
  STRONG_PASSWORD,
  tokenFromMail,
  uniqueEmail,
  waitForMail,
  type ErrorBody,
  type MeBody,
  type TestApp,
} from './helpers/app';
import { AccessMatrixTestModule } from './support/access-matrix.module';

// T041 (US1) + T050 (US2): đăng ký, xác minh, gửi lại, sửa email; đăng nhập, phiên, đăng xuất, chống dò.

const REGISTER = '/api/v1/auth/register';
const VERIFY = '/api/v1/auth/email/verify';
const RESEND = '/api/v1/auth/email/resend';
const LOGIN = '/api/v1/auth/login';
const ME = '/api/v1/auth/me';

const registerBody = (email: string, extra: Record<string, unknown> = {}) => ({
  displayName: 'Chủ tiệm hoa',
  email,
  password: STRONG_PASSWORD,
  acceptTerms: true,
  termsVersion: '2026-11',
  ...extra,
});

const code = (body: unknown) => (body as ErrorBody).error.code;

async function rowsFor(emailNormalized: string) {
  return asOwner(async (c) => {
    const u = await c.query<{
      id: string;
      account_id: string;
      email_verified_at: Date | null;
      terms_version: string;
      terms_accepted_at: Date | null;
    }>('SELECT * FROM account.users WHERE email_normalized = $1', [emailNormalized]);
    const user = u.rows[0];
    if (user === undefined) return { users: 0 } as const;
    const count = async (table: string) =>
      Number(
        (
          await c.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM account.${table} WHERE account_id = $1`,
            [user.account_id],
          )
        ).rows[0]?.n,
      );
    const identity = await c.query<{ provider: string; password_hash: string }>(
      'SELECT provider, password_hash FROM account.login_identities WHERE user_id = $1',
      [user.id],
    );
    const membership = await c.query<{ role: string; seat: number }>(
      'SELECT role, seat FROM account.memberships WHERE user_id = $1',
      [user.id],
    );
    return {
      users: u.rowCount,
      user,
      accounts: Number(
        (
          await c.query<{ n: string }>(
            'SELECT count(*)::text AS n FROM account.accounts WHERE id = $1',
            [user.account_id],
          )
        ).rows[0]?.n,
      ),
      identities: identity.rows,
      memberships: membership.rows,
      tokens: await count('auth_tokens'),
    } as const;
  });
}

describeDb('Xác thực khách hàng (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ extraImports: [AccessMatrixTestModule] });
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(() => {
    t.cache.clear();
  });

  describe('US1', () => {
    it('AS1: đăng ký tạo đủ dòng + mã xác minh, 202 check_email, không Set-Cookie', async () => {
      const email = uniqueEmail();
      const res = await t.agent().post(REGISTER, registerBody(email));
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ status: 'check_email' });
      expect(res.headers['set-cookie']).toBeUndefined();
      const rows = await rowsFor(email);
      expect(rows.users).toBe(1);
      if (rows.users !== 1) return;
      expect(rows.accounts).toBe(1);
      expect(rows.identities).toEqual([
        { provider: 'password', password_hash: expect.any(String) as string },
      ]);
      expect(rows.memberships).toEqual([{ role: 'owner', seat: 0 }]);
      expect(rows.tokens).toBe(1);
      expect(rows.user.email_verified_at).toBeNull();
      expect(rows.user.terms_version).toBe('2026-11');
      expect(rows.user.terms_accepted_at).not.toBeNull();
      const mail = await waitForMail(t.mail, email);
      expect(mail.subject).toBe('Xác nhận email của bạn');
      expect(mail.text).toContain('http://app.test/verify-email#token=');
    });

    it('AS2: email trùng (khác hoa/thường, khoảng trắng) → phản hồi giống hệt, không tài khoản thứ hai', async () => {
      const email = uniqueEmail('trung');
      const first = await t.agent().post(REGISTER, registerBody(email));
      const again = await t
        .agent()
        .post(REGISTER, registerBody(`  ${email.toUpperCase()} `, { displayName: 'Kẻ khác' }));
      expect(again.status).toBe(first.status);
      expect(again.body).toEqual(first.body);
      expect(again.headers['set-cookie']).toBeUndefined();
      expect(again.headers['content-type']).toBe(first.headers['content-type']);
      expect(again.headers['content-length']).toBe(first.headers['content-length']);
      expect((await rowsFor(email)).users).toBe(1);
      const mail = await waitForMail(t.mail, `  ${email.toUpperCase()} `.trim(), (m) =>
        m.subject.includes('đã có tài khoản'),
      );
      expect(mail.text).toContain('/login');
      expect(mail.text).toContain('/forgot-password');
    });

    it('AS3: mật khẩu yếu → 400 PASSWORD_WEAK ở fieldErrors; thiếu acceptTerms → 400; không ghi gì', async () => {
      const weak = uniqueEmail('yeu');
      const r1 = await t.agent().post(REGISTER, registerBody(weak, { password: 'matkhau123' }));
      expect(r1.status).toBe(400);
      const e1 = (r1.body as ErrorBody).error;
      expect(e1.fieldErrors).toEqual([
        { path: ['password'], message: expect.any(String) as string },
      ]);
      expect(e1.support.detail).toMatch(/^PASSWORD_WEAK:/);
      const noTerms = uniqueEmail('dk');
      const r2 = await t.agent().post(REGISTER, registerBody(noTerms, { acceptTerms: false }));
      expect(r2.status).toBe(400);
      expect(code(r2.body)).toBe('VALIDATION_FAILED');
      expect((await rowsFor(weak)).users).toBe(0);
      expect((await rowsFor(noTerms)).users).toBe(0);
    });

    it('AS5: lưu băm argon2id, mật khẩu không có trong nhật ký', async () => {
      const email = uniqueEmail('bam');
      const password = 'Mật-khẩu-không-lộ-ra-77';
      await t.agent().post(REGISTER, registerBody(email, { password }));
      const rows = await rowsFor(email);
      if (rows.users !== 1) throw new Error('chưa tạo');
      expect(rows.identities[0]?.password_hash).toMatch(/^\$argon2id\$/);
      expect(t.rawLogs.join('\n')).not.toContain(password);
    });

    it('AS6: verify cấp cookie; dùng lại mã → TOKEN_INVALID; mã quá 24 giờ → TOKEN_INVALID', async () => {
      const email = uniqueEmail('xm');
      const agent = t.agent();
      await agent.post(REGISTER, registerBody(email));
      const token = tokenFromMail(await waitForMail(t.mail, email));
      const ok = await agent.post(VERIFY, { token });
      expect(ok.status).toBe(200);
      expect((ok.body as MeBody).user.emailVerified).toBe(true);
      expect(agent.sid).toBeDefined();
      const reuse = await t.agent().post(VERIFY, { token });
      expect(reuse.status).toBe(400);
      expect(code(reuse.body)).toBe('TOKEN_INVALID');

      const late = uniqueEmail('tre');
      await t.agent().post(REGISTER, registerBody(late));
      const lateToken = tokenFromMail(await waitForMail(t.mail, late));
      await asOwner((c) =>
        c.query(
          `UPDATE account.auth_tokens SET expires_at = now() - interval '1 second'
            WHERE email_normalized = $1`,
          [late],
        ),
      );
      const expired = await t.agent().post(VERIFY, { token: lateToken });
      expect(code(expired.body)).toBe('TOKEN_INVALID');
    });

    it('AS7: sửa email khi chưa xác minh → thư mới tới email mới, mã cũ hết hiệu lực; email mới đã có → như thành công, không đổi', async () => {
      const email = uniqueEmail('sai');
      const agent = t.agent();
      await agent.post(REGISTER, registerBody(email));
      const oldToken = tokenFromMail(await waitForMail(t.mail, email));
      expect((await agent.post(LOGIN, { email, password: STRONG_PASSWORD })).status).toBe(200);

      const taken = (await registerAndVerify(t)).email;
      const r1 = await agent.patch('/api/v1/auth/email', { email: taken });
      expect(r1.status).toBe(202);
      expect(r1.body).toEqual({ status: 'check_email' });
      expect(((await agent.get(ME)).body as MeBody).user.email).toBe(email);
      await waitForMail(t.mail, taken, (m) => m.subject.includes('đã có tài khoản'));

      const fixed = uniqueEmail('dung');
      const r2 = await agent.patch('/api/v1/auth/email', { email: fixed });
      expect(r2.status).toBe(202);
      const newToken = tokenFromMail(await waitForMail(t.mail, fixed));
      expect(code((await t.agent().post(VERIFY, { token: oldToken })).body)).toBe('TOKEN_INVALID');
      const v = await agent.post(VERIFY, { token: newToken });
      expect(v.status).toBe(200);
      expect((v.body as MeBody).user).toMatchObject({ email: fixed, emailVerified: true });

      // Đã xác minh → không sửa được nữa.
      const r3 = await agent.patch('/api/v1/auth/email', { email: uniqueEmail() });
      expect(r3.status).toBe(409);
      expect(code(r3.body)).toBe('EMAIL_ALREADY_VERIFIED');
    });

    it('AS8: phiên chưa xác minh gọi điểm cuối cần xác minh → 403 EMAIL_NOT_VERIFIED', async () => {
      const email = uniqueEmail('chua');
      const agent = t.agent();
      await agent.post(REGISTER, registerBody(email));
      await agent.post(LOGIN, { email, password: STRONG_PASSWORD });
      const me = await agent.get(ME);
      expect(me.status).toBe(200);
      expect((me.body as MeBody).user.emailVerified).toBe(false);
      const denied = await agent.get('/api/v1/__test/perm/post.edit');
      expect(denied.status).toBe(403);
      expect(code(denied.body)).toBe('EMAIL_NOT_VERIFIED');
      expect((denied.body as ErrorBody).error.actions[0]?.kind).toBe('resend_verification');
    });

    it('gửi lại thư: tối đa 3 thư/giờ/email nhưng phản hồi luôn 202 như nhau', async () => {
      const email = uniqueEmail('gl');
      await t.agent().post(REGISTER, registerBody(email));
      await waitForMail(t.mail, email);
      const bodies: unknown[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await t.agent().post(RESEND, { email });
        expect(r.status).toBe(202);
        bodies.push(r.body);
      }
      const unknown = await t.agent().post(RESEND, { email: uniqueEmail('khongco') });
      expect(unknown.status).toBe(202);
      expect(new Set([...bodies, unknown.body].map((b) => JSON.stringify(b))).size).toBe(1);
      await settleMail();
      expect(t.mail.messages().filter((m) => m.to === email)).toHaveLength(4);
    });

    it('register_ip vượt 20/giờ → 429 RATE_LIMITED', async () => {
      const ip = randomIp();
      for (let i = 0; i < 20; i++) {
        expect((await t.agent({ ip }).post(REGISTER, registerBody(uniqueEmail('ip')))).status).toBe(
          202,
        );
      }
      const r = await t.agent({ ip }).post(REGISTER, registerBody(uniqueEmail('ip')));
      expect(r.status).toBe(429);
      expect(code(r.body)).toBe('RATE_LIMITED');
    });

    it('thiếu Origin → 403 CSRF_REJECTED', async () => {
      const r = await t.agent({ origin: null }).post(REGISTER, registerBody(uniqueEmail()));
      expect(r.status).toBe(403);
      expect(code(r.body)).toBe('CSRF_REJECTED');
    });
  });

  describe('US2', () => {
    it('AS1: MeResponse đúng hợp đồng, cookie an toàn, mỗi lần đăng nhập một mã mới', async () => {
      const { email, password } = await registerAndVerify(t);
      const a = t.agent();
      const res = await a.post(LOGIN, { email, password });
      expect(res.status).toBe(200);
      const me = res.body as MeBody;
      expect(Object.keys(me).sort()).toEqual(['account', 'permissions', 'role', 'user']);
      expect(me.role).toBe('owner');
      expect(me.permissions).toContain('post.approve');
      expect(JSON.stringify(me)).not.toMatch(/argon2|token|hash/i);
      const cookie = (res.headers['set-cookie'] as unknown as string[])[0] ?? '';
      expect(cookie).toMatch(
        /^__Host-sid=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=\d+$/,
      );
      expect(cookie).not.toMatch(/Domain/i);
      const first = a.sid;
      await a.post(LOGIN, { email, password });
      expect(a.sid).not.toBe(first);
      expect((await a.get(ME)).status).toBe(200);
    });

    it('AS2: email không tồn tại và sai mật khẩu → cùng 401 INVALID_CREDENTIALS', async () => {
      const { email } = await registerAndVerify(t);
      const r1 = await t.agent().post(LOGIN, { email, password: 'sai-mat-khau-1' });
      const r2 = await t
        .agent()
        .post(LOGIN, { email: uniqueEmail('ma'), password: 'sai-mat-khau-1' });
      for (const r of [r1, r2]) {
        expect(r.status).toBe(401);
        expect(code(r.body)).toBe('INVALID_CREDENTIALS');
        expect((r.body as ErrorBody).error.support.detail).toBe('invalid_credentials');
      }
      const strip = (b: unknown) => ({ ...(b as ErrorBody).error, support: undefined });
      expect(strip(r1.body)).toEqual(strip(r2.body));
    });

    it('AS3: 5 lần sai → 429 LOGIN_THROTTLED có Retry-After; mật khẩu đúng cũng bị chặn; hết chặn → được', async () => {
      const { email, password } = await registerAndVerify(t);
      for (let i = 0; i < 5; i++) {
        expect((await t.agent().post(LOGIN, { email, password: `sai-${i}-xxxx` })).status).toBe(
          401,
        );
      }
      const blockedAgent = t.agent();
      const blocked = await blockedAgent.post(LOGIN, { email, password });
      expect(blocked.status).toBe(429);
      expect(code(blocked.body)).toBe('LOGIN_THROTTLED');
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      const err = (blocked.body as ErrorBody).error;
      expect(err.retryAfterSeconds).toBeGreaterThan(0);
      expect(err.actions.some((x) => x.href === '/forgot-password')).toBe(true);
      // Khi bị chặn không tra người dùng (không thêm truy vấn cho kẻ dò) → ghi "anonymous".
      const audited = await asOwner(async (c) => {
        const r = await c.query<{ actor_type: string; metadata: Record<string, unknown> }>(
          `SELECT actor_type, metadata FROM infra.audit_log
            WHERE action = 'auth.login.throttled' AND metadata->>'ip' = $1`,
          [blockedAgent.ip],
        );
        return r.rows;
      });
      expect(audited).toEqual([
        {
          actor_type: 'anonymous',
          metadata: { ip: blockedAgent.ip, ua_family: null, reason: 'blocked_email' },
        },
      ]);

      await asOwner((c) =>
        c.query(
          `UPDATE account.auth_throttle SET blocked_until = now() - interval '1 second',
             window_start = now() - interval '1 hour' WHERE kind = 'login_email'`,
        ),
      );
      expect((await t.agent().post(LOGIN, { email, password })).status).toBe(200);
    });

    it('AS3: 30 lần sai từ một địa chỉ mạng trên nhiều email → chặn địa chỉ', async () => {
      const { email, password } = await registerAndVerify(t);
      const ip = randomIp();
      for (let i = 0; i < 30; i++) {
        await t.agent({ ip }).post(LOGIN, { email: uniqueEmail('quet'), password: 'sai-sai-sai' });
      }
      const r = await t.agent({ ip }).post(LOGIN, { email, password });
      expect(r.status).toBe(429);
      expect(code(r.body)).toBe('LOGIN_THROTTLED');
      // Địa chỉ khác vẫn đăng nhập được.
      expect((await t.agent().post(LOGIN, { email, password })).status).toBe(200);
    });

    it('AS4: đăng xuất → 401 ngay, cookie bị xóa', async () => {
      const { agent } = await registerAndVerify(t);
      const sid = agent.sid;
      const out = await agent.post('/api/v1/auth/logout');
      expect(out.status).toBe(204);
      expect(agent.sid).toBeUndefined();
      const reuse = t.agent();
      reuse.cookies.set('__Host-sid', sid ?? '');
      const r = await reuse.get(ME);
      expect(r.status).toBe(401);
      expect(code(r.body)).toBe('UNAUTHENTICATED');
    });

    it('AS5: đăng xuất mọi thiết bị → thiết bị kia 401', async () => {
      const { agent, email, password } = await registerAndVerify(t);
      const other = t.agent();
      await other.post(LOGIN, { email, password });
      expect((await other.get(ME)).status).toBe(200);
      expect((await agent.post('/api/v1/auth/logout-all')).status).toBe(204);
      expect((await other.get(ME)).status).toBe(401);
      expect((await agent.get(ME)).status).toBe(401);
    });

    it('AS6: phiên quá hạn không hoạt động / tuyệt đối → 401', async () => {
      for (const column of ['idle_expires_at', 'absolute_expires_at']) {
        const { agent, me } = await registerAndVerify(t);
        await asOwner((c) =>
          c.query(
            `UPDATE account.sessions SET ${column} = now() - interval '1 second' WHERE user_id = $1`,
            [me.user.id],
          ),
        );
        t.cache.clear();
        expect((await agent.get(ME)).status, column).toBe(401);
      }
    });

    it('AS7: Origin lạ → 403 CSRF_REJECTED', async () => {
      const r = await t
        .agent({ origin: 'https://evil.example' })
        .post(LOGIN, { email: uniqueEmail(), password: 'x' });
      expect(r.status).toBe(403);
      expect(code(r.body)).toBe('CSRF_REJECTED');
    });

    it('người dùng disabled / tài khoản deleting: mật khẩu đúng → 403 ACCOUNT_UNAVAILABLE, sai → 401', async () => {
      const disabled = await registerAndVerify(t);
      await asOwner((c) =>
        c.query(`UPDATE account.users SET status = 'disabled' WHERE id = $1`, [
          disabled.me.user.id,
        ]),
      );
      const deleting = await registerAndVerify(t);
      await asOwner((c) =>
        c.query(`UPDATE account.accounts SET status = 'deleting' WHERE id = $1`, [
          deleting.me.account.id,
        ]),
      );
      for (const u of [disabled, deleting]) {
        const ok = await t.agent().post(LOGIN, { email: u.email, password: u.password });
        expect(ok.status).toBe(403);
        expect(code(ok.body)).toBe('ACCOUNT_UNAVAILABLE');
        const bad = await t.agent().post(LOGIN, { email: u.email, password: 'sai-sai-sai' });
        expect(bad.status).toBe(401);
      }
    });

    it('đăng nhập với băm tham số cũ → được băm lại theo cấu hình', async () => {
      const { email, password, me } = await registerAndVerify(t);
      const old = await new PasswordHasher({ memoryCost: 128, timeCost: 1 }).hash(
        password.normalize('NFKC'),
      );
      await asOwner((c) =>
        c.query('UPDATE account.login_identities SET password_hash = $1 WHERE user_id = $2', [
          old,
          me.user.id,
        ]),
      );
      expect((await t.agent().post(LOGIN, { email, password })).status).toBe(200);
      const now = await asOwner(async (c) => {
        const r = await c.query<{ password_hash: string }>(
          'SELECT password_hash FROM account.login_identities WHERE user_id = $1',
          [me.user.id],
        );
        return r.rows[0]?.password_hash;
      });
      expect(now).toMatch(/^\$argon2id\$v=19\$m=64,t=1,p=1\$/);
    });
  });
});
