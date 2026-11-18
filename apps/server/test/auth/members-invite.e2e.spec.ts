import { afterAll, beforeAll, expect, it } from 'vitest';
import { asOwner, describeDb } from '../db/helpers/db';
import { collaboratorOf } from './helpers/actors';
import {
  createTestApp,
  followFakeProvider,
  oauthPending,
  oauthSignup,
  registerAndVerify,
  settleMail,
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

// T048 (009 – US3): chủ mời cộng tác viên qua email; người được mời chấp nhận bằng mật khẩu hoặc
// Google/Facebook. Cộng tác viên + lời mời đang chờ ≤ 2.

const MEMBERS = '/api/v1/members';
const INVITE = '/api/v1/members/invitations';
const PREVIEW = '/api/v1/invitations/preview';
const ACCEPT = '/api/v1/invitations/accept';
const terms = { acceptTerms: true, termsVersion: '2026-11' };
const code = (body: unknown) => (body as ErrorBody).error.code;

interface MembersBody {
  owner: { userId: string; displayName: string; email: string };
  collaborators: { userId: string; displayName: string; email: string; joinedAt: string }[];
  invitations: { id: string; email: string; sentAt: string; expiresAt: string }[];
  seats: { used: number; total: number };
}

async function inviteAndToken(t: TestApp, owner: Agent, email: string) {
  const res = await owner.post(INVITE, { email });
  if (res.status !== 201) throw new Error(`invite ${res.status} ${res.text}`);
  const mail = await waitForMail(t.mail, email, (m) => m.text.includes('/join#token='));
  return { id: (res.body as { id: string }).id, token: tokenFromMail(mail), mail };
}

async function acceptViaProvider(
  t: TestApp,
  token: string,
  input: OAuthScenario,
  agent: Agent = t.agent(),
) {
  const provider = input.scenario.startsWith('facebook') ? 'facebook' : 'google';
  const start = await agent.post(`/api/v1/auth/oauth/${provider}/start`, {
    purpose: 'invite',
    invitationToken: token,
    ...terms,
  });
  if (start.status !== 200) return { agent, start };
  await followFakeProvider(
    agent,
    (start.body as { authorizationUrl: string }).authorizationUrl,
    input,
  );
  return { agent, start };
}

const actions = (accountId: string) =>
  asOwner(async (c) => {
    const r = await c.query<{ action: string }>(
      'SELECT action FROM infra.audit_log WHERE account_id = $1 ORDER BY id',
      [accountId],
    );
    return r.rows.map((x) => x.action);
  });

describeDb('Mời cộng tác viên – US3', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('mời → thư → xem trước → đặt mật khẩu → vào với vai trò cộng tác viên', async () => {
    const owner = await registerAndVerify(t, { displayName: 'Chị Lan' });
    const empty = (await owner.agent.get(MEMBERS)).body as MembersBody;
    expect(empty).toMatchObject({
      owner: { userId: owner.me.user.id, displayName: 'Chị Lan', email: owner.email },
      collaborators: [],
      invitations: [],
      seats: { used: 0, total: 2 },
    });

    const email = uniqueEmail('moi');
    const invited = await owner.agent.post(INVITE, { email });
    expect(invited.status).toBe(201);
    expect(invited.body).toMatchObject({ email });
    expect(Object.keys(invited.body as object).sort()).toEqual([
      'email',
      'expiresAt',
      'id',
      'sentAt',
    ]);
    const mail = await waitForMail(t.mail, email, (m) => m.text.includes('/join#token='));
    // Thư nêu người mời, nhãn tài khoản, vai trò, hạn – không có số tiền.
    expect(mail.subject).toContain('Chị Lan');
    expect(mail.text).toContain('tài khoản của Chị Lan');
    expect(mail.text).toContain('cộng tác viên');
    expect(mail.text).toMatch(/đến hết ngày \d{2}\/\d{2}\/\d{4}/);
    expect(mail.text).not.toMatch(/USD|\$|đồng/);
    const token = tokenFromMail(mail);

    const listed = (await owner.agent.get(MEMBERS)).body as MembersBody;
    expect(listed.seats.used).toBe(1);
    expect(listed.invitations.map((i) => i.email)).toEqual([email]);
    expect(await actions(owner.me.account.id)).toContain('account.invitation.sent');

    const preview = await t.agent().post(PREVIEW, { token });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      accountLabel: 'tài khoản của Chị Lan',
      inviterName: 'Chị Lan',
      email,
      mode: 'new_user',
    });

    const joiner = t.agent();
    const noTerms = await joiner.post(ACCEPT, {
      token,
      displayName: 'Minh',
      password: STRONG_PASSWORD,
      termsVersion: '2026-11',
    });
    expect(noTerms.status).toBe(400);
    const accepted = await joiner.post(ACCEPT, {
      token,
      displayName: 'Minh',
      password: STRONG_PASSWORD,
      ...terms,
    });
    expect(accepted.status).toBe(200);
    const me = accepted.body as MeBody;
    expect(me).toMatchObject({
      user: { displayName: 'Minh', email, emailVerified: true },
      account: { id: owner.me.account.id },
      role: 'collaborator',
    });
    expect(joiner.sid).toBeDefined();
    expect(me.permissions).not.toContain('members.manage');

    // Lời mời không dùng lại được.
    const reuse = await t.agent().post(ACCEPT, {
      token,
      displayName: 'Ai đó',
      password: STRONG_PASSWORD,
      ...terms,
    });
    expect(reuse.status).toBe(400);
    expect(code(reuse.body)).toBe('INVITE_INVALID');

    const after = (await owner.agent.get(MEMBERS)).body as MembersBody;
    expect(after.collaborators.map((c) => c.email)).toEqual([email]);
    expect(after.invitations).toEqual([]);
    expect(after.seats.used).toBe(1);
    expect(await actions(owner.me.account.id)).toContain('account.invitation.accepted');
    // Chủ nhận việc thư "… đã tham gia" – dữ liệu việc chỉ có mã tham chiếu.
    const jobs = await asOwner(async (c) => {
      const r = await c.query<{ payload: Record<string, unknown> }>(
        `SELECT data->'payload' AS payload FROM pgboss.job
          WHERE data->>'type' = 'account.mail_notice' AND data->'payload'->>'userId' = $1`,
        [owner.me.user.id],
      );
      return r.rows.map((x) => x.payload);
    });
    expect(jobs).toEqual([
      { template: 'invite_accepted', userId: owner.me.user.id, subjectUserId: me.user.id },
    ]);

    // Cộng tác viên: đăng nhập lại được; mọi điểm cuối /members/* → 403.
    const login = await t.agent().post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });
    expect(login.status).toBe(200);
    for (const res of [
      await joiner.get(MEMBERS),
      await joiner.post(INVITE, { email: uniqueEmail() }),
      await joiner.post(`${INVITE}/${crypto.randomUUID()}/resend`),
      await joiner.delete(`${INVITE}/${crypto.randomUUID()}`),
      await joiner.delete(`${MEMBERS}/${owner.me.user.id}`),
    ]) {
      expect(res.status).toBe(403);
      expect(code(res.body)).toBe('FORBIDDEN');
    }
  });

  it('gửi lại, hủy, đủ chỗ, mời chính mình, phản hồi giống nhau dù email đã có người dùng', async () => {
    const owner = await registerAndVerify(t);
    const other = await registerAndVerify(t);
    const fresh = uniqueEmail('a');
    // Email đã thuộc tài khoản khác và email mới: phản hồi cùng hình dạng (FR-023).
    const r1 = await owner.agent.post(INVITE, { email: other.email });
    const r2 = await owner.agent.post(INVITE, { email: fresh });
    expect([r1.status, r2.status]).toEqual([201, 201]);
    expect(Object.keys(r1.body as object).sort()).toEqual(Object.keys(r2.body as object).sort());

    // Đủ 2 chỗ (2 lời mời đang chờ) → 409 SEATS_FULL.
    const full = await owner.agent.post(INVITE, { email: uniqueEmail('b') });
    expect(full.status).toBe(409);
    expect(code(full.body)).toBe('SEATS_FULL');

    const self = await owner.agent.post(INVITE, { email: owner.email.toUpperCase() });
    expect(self.status).toBe(400);
    expect(code(self.body)).toBe('INVITE_SELF');

    // Mời lại email đang chờ → 200, coi là "Gửi lại", không chiếm thêm chỗ; mã cũ hết hiệu lực.
    const first = tokenFromMail(
      await waitForMail(t.mail, fresh, (m) => m.text.includes('/join#token=')),
    );
    const again = await owner.agent.post(INVITE, { email: fresh });
    expect(again.status).toBe(200);
    expect((again.body as { id: string }).id).toBe((r2.body as { id: string }).id);
    const second = tokenFromMail(
      await waitForMail(
        t.mail,
        fresh,
        (m) => m.text.includes('/join#token=') && tokenFromMail(m) !== first,
      ),
    );
    expect(code((await t.agent().post(PREVIEW, { token: first })).body)).toBe('INVITE_INVALID');
    expect((await t.agent().post(PREVIEW, { token: second })).status).toBe(200);
    expect(((await owner.agent.get(MEMBERS)).body as MembersBody).seats.used).toBe(2);

    // resend theo mã lời mời.
    const resent = await owner.agent.post(`${INVITE}/${(r2.body as { id: string }).id}/resend`);
    expect(resent.status).toBe(200);
    expect(code((await t.agent().post(PREVIEW, { token: second })).body)).toBe('INVITE_INVALID');

    // Quá 3 thư/giờ cho một email → 429.
    const limited = await owner.agent.post(INVITE, { email: fresh });
    expect(limited.status).toBe(429);
    expect(code(limited.body)).toBe('RATE_LIMITED');

    // Email thuộc tài khoản khác: xem trước báo in_use, chấp nhận → 409 INVITE_EMAIL_IN_USE.
    const inUse = tokenFromMail(
      await waitForMail(t.mail, other.email, (m) => m.text.includes('/join#token=')),
    );
    expect(((await t.agent().post(PREVIEW, { token: inUse })).body as { mode: string }).mode).toBe(
      'in_use',
    );
    const blocked = await t.agent().post(ACCEPT, {
      token: inUse,
      displayName: 'X',
      password: STRONG_PASSWORD,
      ...terms,
    });
    expect(blocked.status).toBe(409);
    expect(code(blocked.body)).toBe('INVITE_EMAIL_IN_USE');

    // Hủy → 204, chỗ được trả, mã hết hiệu lực; mã của tài khoản khác → 404.
    const stranger = await registerAndVerify(t);
    const foreign = await stranger.agent.delete(`${INVITE}/${(r1.body as { id: string }).id}`);
    expect(foreign.status).toBe(404);
    expect(
      (await stranger.agent.post(`${INVITE}/${(r1.body as { id: string }).id}/resend`)).status,
    ).toBe(404);
    const cancelled = await owner.agent.delete(`${INVITE}/${(r1.body as { id: string }).id}`);
    expect(cancelled.status).toBe(204);
    expect(code((await t.agent().post(PREVIEW, { token: inUse })).body)).toBe('INVITE_INVALID');
    expect(((await owner.agent.get(MEMBERS)).body as MembersBody).seats.used).toBe(1);
    expect((await owner.agent.delete(`${INVITE}/${(r1.body as { id: string }).id}`)).status).toBe(
      404,
    );

    const audit = await actions(owner.me.account.id);
    expect(audit).toEqual(
      expect.arrayContaining(['account.invitation.resent', 'account.invitation.cancelled']),
    );
  });

  it('lời mời quá 7 ngày → INVITE_INVALID và chỗ được trả khi mời tiếp (dọn tại chỗ)', async () => {
    const owner = await registerAndVerify(t);
    const a = await inviteAndToken(t, owner.agent, uniqueEmail('cu1'));
    await inviteAndToken(t, owner.agent, uniqueEmail('cu2'));
    await asOwner((c) =>
      c.query(
        `UPDATE account.invitations SET expires_at = now() - interval '1 minute' WHERE account_id = $1`,
        [owner.me.account.id],
      ),
    );
    expect(code((await t.agent().post(PREVIEW, { token: a.token })).body)).toBe('INVITE_INVALID');
    expect(((await owner.agent.get(MEMBERS)).body as MembersBody).seats.used).toBe(0);
    expect((await owner.agent.post(INVITE, { email: uniqueEmail('moi') })).status).toBe(201);
    const statuses = await asOwner(async (c) => {
      const r = await c.query<{ status: string }>(
        'SELECT status FROM account.invitations WHERE account_id = $1 ORDER BY status',
        [owner.me.account.id],
      );
      return r.rows.map((x) => x.status);
    });
    expect(statuses).toEqual(['expired', 'expired', 'pending']);
  });

  it('lời mời của tài khoản đang xóa → INVITE_INVALID', async () => {
    const owner = await registerAndVerify(t);
    const { token } = await inviteAndToken(t, owner.agent, uniqueEmail('xoa'));
    await asOwner((c) =>
      c.query(`UPDATE account.accounts SET status = 'deleting' WHERE id = $1`, [
        owner.me.account.id,
      ]),
    );
    expect(code((await t.agent().post(PREVIEW, { token })).body)).toBe('INVITE_INVALID');
    const res = await t.agent().post(ACCEPT, {
      token,
      displayName: 'X',
      password: STRONG_PASSWORD,
      ...terms,
    });
    expect(code(res.body)).toBe('INVITE_INVALID');
  });

  it('chấp nhận bằng Google (email trùng) và Facebook không trả email → tham gia', async () => {
    const owner = await registerAndVerify(t);
    const e1 = uniqueEmail('g');
    const i1 = await inviteAndToken(t, owner.agent, e1);
    const g = await acceptViaProvider(t, i1.token, {
      scenario: 'google_verified',
      email: e1.toUpperCase(),
      name: 'Hà Google',
    });
    expect(g.agent.sid).toBeDefined();
    expect((await oauthPending(g.agent)).stage).toBe('completed');
    const meG = (await g.agent.get('/api/v1/auth/me')).body as MeBody;
    expect(meG).toMatchObject({
      user: { email: e1, displayName: 'Hà Google', emailVerified: true },
      account: { id: owner.me.account.id },
      role: 'collaborator',
    });

    const e2 = uniqueEmail('f');
    const i2 = await inviteAndToken(t, owner.agent, e2);
    const f = await acceptViaProvider(t, i2.token, {
      scenario: 'facebook_no_email',
      name: 'Tú FB',
    });
    expect(f.agent.sid).toBeDefined();
    const meF = (await f.agent.get('/api/v1/auth/me')).body as MeBody;
    expect(meF).toMatchObject({ user: { email: e2 }, role: 'collaborator' });
    expect(((await owner.agent.get(MEMBERS)).body as MembersBody).seats.used).toBe(2);
  });

  it('nhà cung cấp: email khác → INVITE_EMAIL_MISMATCH; danh tính đã thuộc người khác → IDENTITY_IN_USE; lời mời vẫn chờ', async () => {
    const owner = await registerAndVerify(t);
    const email = uniqueEmail('lech');
    const { token } = await inviteAndToken(t, owner.agent, email);
    const wrong = await acceptViaProvider(t, token, {
      scenario: 'google_verified',
      email: uniqueEmail('khac'),
    });
    expect(wrong.agent.sid).toBeUndefined();
    const p = await oauthPending(wrong.agent);
    expect(p.stage).toBe('failed');
    expect(p.error?.code).toBe('INVITE_EMAIL_MISMATCH');
    expect(p.error?.message).toContain(email);

    // Danh tính Facebook đã thuộc người dùng khác (không trả email nên qua được quy tắc email).
    const taken = await oauthSignup(t, {
      scenario: 'facebook_with_email',
      email: uniqueEmail('co'),
      sub: `fb-${email}`,
    });
    expect(taken.me.role).toBe('owner');
    const dup = await acceptViaProvider(t, token, {
      scenario: 'facebook_no_email',
      sub: `fb-${email}`,
    });
    expect(dup.agent.sid).toBeUndefined();
    expect((await oauthPending(dup.agent)).error?.code).toBe('IDENTITY_IN_USE');
    expect((await t.agent().post(PREVIEW, { token })).status).toBe(200);

    // Thiếu đồng ý điều khoản hoặc mã hỏng ở bước start.
    const noTerms = await t.agent().post('/api/v1/auth/oauth/google/start', {
      purpose: 'invite',
      invitationToken: token,
      termsVersion: '2026-11',
    });
    expect(noTerms.status).toBe(400);
    const bad = await t.agent().post('/api/v1/auth/oauth/google/start', {
      purpose: 'invite',
      invitationToken: 'x'.repeat(43),
      ...terms,
    });
    expect(bad.status).toBe(400);
    expect(code(bad.body)).toBe('INVITE_INVALID');
  });

  it('yêu cầu CÓ phiên hợp lệ: đang thuộc một tài khoản → 409 ALREADY_IN_ACCOUNT, không đổi gì', async () => {
    const owner = await registerAndVerify(t);
    const email = uniqueEmail('phien');
    const { token } = await inviteAndToken(t, owner.agent, email);
    const someone = await registerAndVerify(t);
    const collaborator = await collaboratorOf(t, someone.me);
    for (const agent of [someone.agent, collaborator.agent]) {
      const sid = agent.sid;
      const res = await agent.post(ACCEPT, {
        token,
        displayName: 'X',
        password: STRONG_PASSWORD,
        ...terms,
      });
      expect(res.status).toBe(409);
      expect(code(res.body)).toBe('ALREADY_IN_ACCOUNT');
      const start = await agent.post('/api/v1/auth/oauth/google/start', {
        purpose: 'invite',
        invitationToken: token,
        ...terms,
      });
      expect(start.status).toBe(409);
      expect(code(start.body)).toBe('ALREADY_IN_ACCOUNT');
      expect(agent.sid).toBe(sid);
    }
    await settleMail();
    expect((await t.agent().post(PREVIEW, { token })).status).toBe(200);
  });
});
