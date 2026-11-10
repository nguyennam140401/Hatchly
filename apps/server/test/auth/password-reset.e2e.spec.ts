import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { asOwner, describeDb } from '../db/helpers/db';
import {
  createTestApp,
  registerAndVerify,
  settleMail,
  tokenFromMail,
  uniqueEmail,
  waitForMail,
  type ErrorBody,
  type MeBody,
  type TestApp,
} from './helpers/app';

// T072 (US5, FR-009): quên mật khẩu, đặt lại bằng liên kết một lần, đổi mật khẩu.

const FORGOT = '/api/v1/auth/password/forgot';
const RESET = '/api/v1/auth/password/reset';
const CHANGE = '/api/v1/auth/password/change';
const LOGIN = '/api/v1/auth/login';
const ME = '/api/v1/auth/me';
const NEW_PASSWORD = 'Mật-khẩu-mới-rất-mạnh-9';

const code = (b: unknown) => (b as ErrorBody).error.code;
const isReset = (m: { text: string }) => m.text.includes('/reset-password#token=');
const isChanged = (m: { subject: string }) => m.subject.includes('vừa được thay đổi');

describeDb('Quên / đặt lại / đổi mật khẩu (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(() => {
    t.cache.clear();
  });

  it('AS1: email có/không có tài khoản → cùng 202 check_email, chỉ email thật nhận thư', async () => {
    const { email } = await registerAndVerify(t);
    const ghost = uniqueEmail('ma');
    const r1 = await t.agent().post(FORGOT, { email });
    const r2 = await t.agent().post(FORGOT, { email: ghost });
    expect([r1.status, r2.status]).toEqual([202, 202]);
    expect(r1.body).toEqual({ status: 'check_email' });
    expect(r2.body).toEqual(r1.body);
    const mail = await waitForMail(t.mail, email, isReset);
    expect(mail.subject).toBe('Đặt lại mật khẩu');
    await settleMail();
    expect(t.mail.messages().some((m) => m.to === ghost)).toBe(false);
  });

  it('AS1: quá 3 thư/giờ/email → không gửi thêm, phản hồi như cũ', async () => {
    const { email } = await registerAndVerify(t);
    for (let i = 0; i < 5; i++) {
      const r = await t.agent().post(FORGOT, { email });
      expect(r.status).toBe(202);
      expect(r.body).toEqual({ status: 'check_email' });
    }
    await settleMail();
    expect(t.mail.messages().filter((m) => m.to === email && isReset(m))).toHaveLength(3);
  });

  it('AS2: đặt lại thành công → MeResponse + cookie mới, phiên cũ 401, mật khẩu cũ 401', async () => {
    const { agent: oldSession, email, password, me } = await registerAndVerify(t);
    await t.agent().post(FORGOT, { email });
    const token = tokenFromMail(await waitForMail(t.mail, email, isReset));
    const fresh = t.agent();
    const res = await fresh.post(RESET, { token, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect((res.body as MeBody).user.id).toBe(me.user.id);
    expect(fresh.sid).toBeDefined();
    expect((await fresh.get(ME)).status).toBe(200);
    expect((await oldSession.get(ME)).status).toBe(401);
    expect((await t.agent().post(LOGIN, { email, password })).status).toBe(401);
    expect((await t.agent().post(LOGIN, { email, password: NEW_PASSWORD })).status).toBe(200);
    const changedAt = await asOwner(async (c) => {
      const r = await c.query<{ password_changed_at: Date | null }>(
        'SELECT password_changed_at FROM account.users WHERE id = $1',
        [me.user.id],
      );
      return r.rows[0]?.password_changed_at;
    });
    expect(changedAt).toBeInstanceOf(Date);
    // AS4: thư báo đổi mật khẩu.
    await waitForMail(t.mail, email, isChanged);
    // Dùng lại mã → TOKEN_INVALID.
    const again = await t.agent().post(RESET, { token, newPassword: 'Mật-khẩu-khác-nữa-8' });
    expect(again.status).toBe(400);
    expect(code(again.body)).toBe('TOKEN_INVALID');
  });

  it('AS2: mã quá 30 phút hoặc bị mã mới thay → TOKEN_INVALID', async () => {
    const { email, me } = await registerAndVerify(t);
    await t.agent().post(FORGOT, { email });
    const first = tokenFromMail(await waitForMail(t.mail, email, isReset));
    await t.agent().post(FORGOT, { email });
    await settleMail();
    const resets = t.mail.messages().filter((m) => m.to === email && isReset(m));
    const last = resets.at(-1);
    if (last === undefined) throw new Error('thiếu thư thứ hai');
    const second = tokenFromMail(last);
    expect(second).not.toBe(first);
    expect(
      code((await t.agent().post(RESET, { token: first, newPassword: NEW_PASSWORD })).body),
    ).toBe('TOKEN_INVALID');
    const ttl = await asOwner(async (c) => {
      const r = await c.query<{ s: number }>(
        `SELECT EXTRACT(EPOCH FROM expires_at - created_at)::int AS s FROM account.auth_tokens
          WHERE user_id = $1 AND purpose = 'reset_password' AND used_at IS NULL`,
        [me.user.id],
      );
      await c.query(
        `UPDATE account.auth_tokens SET expires_at = now() - interval '1 second'
          WHERE user_id = $1 AND purpose = 'reset_password'`,
        [me.user.id],
      );
      return r.rows[0]?.s;
    });
    expect(ttl).toBeGreaterThanOrEqual(30 * 60 - 2);
    expect(ttl).toBeLessThanOrEqual(30 * 60 + 2);
    expect(
      code((await t.agent().post(RESET, { token: second, newPassword: NEW_PASSWORD })).body),
    ).toBe('TOKEN_INVALID');
  });

  it('mật khẩu mới yếu → 400 VALIDATION_FAILED, mã chưa bị tiêu thụ', async () => {
    const { email } = await registerAndVerify(t);
    await t.agent().post(FORGOT, { email });
    const token = tokenFromMail(await waitForMail(t.mail, email, isReset));
    const weak = await t.agent().post(RESET, { token, newPassword: 'matkhau123' });
    expect(weak.status).toBe(400);
    expect(code(weak.body)).toBe('VALIDATION_FAILED');
    expect((await t.agent().post(RESET, { token, newPassword: NEW_PASSWORD })).status).toBe(200);
  });

  it('AS3: đổi mật khẩu sai mật khẩu hiện tại → 401 trên currentPassword, được đếm (lần 6 → 429)', async () => {
    const { agent } = await registerAndVerify(t);
    for (let i = 0; i < 5; i++) {
      const r = await agent.post(CHANGE, {
        currentPassword: `sai-${i}-xx`,
        newPassword: NEW_PASSWORD,
      });
      expect(r.status).toBe(401);
      expect(code(r.body)).toBe('INVALID_CREDENTIALS');
      expect((r.body as ErrorBody).error.fieldErrors?.[0]?.path).toEqual(['currentPassword']);
    }
    const blocked = await agent.post(CHANGE, { currentPassword: 'x', newPassword: NEW_PASSWORD });
    expect(blocked.status).toBe(429);
    expect(code(blocked.body)).toBe('LOGIN_THROTTLED');
  });

  it('AS3: đổi đúng → 204, phiên khác bị thu hồi, phiên hiện tại được cấp mã mới; thư báo', async () => {
    const { agent, email, password } = await registerAndVerify(t);
    const other = t.agent();
    await other.post(LOGIN, { email, password });
    const before = agent.sid;
    const res = await agent.post(CHANGE, { currentPassword: password, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(204);
    expect(agent.sid).toBeDefined();
    expect(agent.sid).not.toBe(before);
    expect((await agent.get(ME)).status).toBe(200);
    expect((await other.get(ME)).status).toBe(401);
    const stale = t.agent();
    stale.cookies.set('__Host-sid', before ?? '');
    expect((await stale.get(ME)).status).toBe(401);
    await waitForMail(t.mail, email, isChanged);
    const weak = await agent.post(CHANGE, {
      currentPassword: NEW_PASSWORD,
      newPassword: 'matkhau123',
    });
    expect(code(weak.body)).toBe('VALIDATION_FAILED');
  });
});
