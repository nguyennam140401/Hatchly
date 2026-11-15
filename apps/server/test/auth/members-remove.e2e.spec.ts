import { afterAll, beforeAll, expect, it } from 'vitest';
import { ACCOUNT_PUBLIC_API, type AccountPublicApi } from '../../src/modules/account';
import { withAccount, asOwner, describeDb } from '../db/helpers/db';
import { collaboratorOf } from './helpers/actors';
import {
  createTestApp,
  oauthLogin,
  oauthPending,
  registerAndVerify,
  STRONG_PASSWORD,
  tokenFromMail,
  uniqueEmail,
  waitForMail,
  type ErrorBody,
  type MeBody,
  type TestApp,
} from './helpers/app';

// T061 + T062 (009 – US4): chủ gỡ cộng tác viên; người bị gỡ ở "tài khoản chờ" – tự tạo tài khoản
// riêng hoặc nhận lời mời mới.

const MEMBERS = '/api/v1/members';
const INVITE = '/api/v1/members/invitations';
const ME = '/api/v1/auth/me';
const MINE = '/api/v1/invitations/mine';
const ACCEPT_EXISTING = '/api/v1/invitations/accept-existing';
const CLAIM = '/api/v1/account/claim';
const terms = { acceptTerms: true, termsVersion: '2026-11' };
const code = (body: unknown) => (body as ErrorBody).error.code;

async function setup(t: TestApp) {
  const owner = await registerAndVerify(t, { displayName: 'Chủ Lan' });
  const collaborator = await collaboratorOf(t, owner.me);
  return { owner, collaborator };
}

/** Gỡ rồi đăng nhập lại → tác nhân của người ở tài khoản chờ. */
async function detached(t: TestApp) {
  const s = await setup(t);
  const res = await s.owner.agent.delete(`${MEMBERS}/${s.collaborator.userId}`);
  if (res.status !== 204) throw new Error(`remove ${res.status} ${res.text}`);
  const agent = t.agent();
  const login = await agent.post('/api/v1/auth/login', {
    email: s.collaborator.email,
    password: STRONG_PASSWORD,
  });
  if (login.status !== 200) throw new Error(`login ${login.status} ${login.text}`);
  return { ...s, agent, me: login.body as MeBody };
}

describeDb('Gỡ cộng tác viên và tài khoản chờ – US4', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('DELETE /members/{userId}: mất quyền ngay, chỗ được trả, tên còn tra được, có thư và kiểm toán', async () => {
    const { owner, collaborator } = await setup(t);
    expect((await collaborator.agent.get(ME)).status).toBe(200);
    const before = await asOwner(async (c) =>
      Number(
        (await c.query<{ n: string }>('SELECT count(*)::text AS n FROM pgboss.job')).rows[0]?.n,
      ),
    );

    const res = await owner.agent.delete(`${MEMBERS}/${collaborator.userId}`);
    expect(res.status).toBe(204);
    // Lời gọi tiếp theo của người bị gỡ bị từ chối ngay trên bản API này (≤ 60 giây trên bản khác).
    expect((await collaborator.agent.get(ME)).status).toBe(401);

    const members = (await owner.agent.get(MEMBERS)).body as {
      collaborators: unknown[];
      seats: { used: number };
    };
    expect(members.collaborators).toEqual([]);
    expect(members.seats.used).toBe(0);

    const rows = await asOwner(async (c) => {
      const m = await c.query<{ status: string }>(
        'SELECT status FROM account.memberships WHERE account_id = $1 AND user_id = $2',
        [owner.me.account.id, collaborator.userId],
      );
      const f = await c.query<Record<string, unknown>>(
        'SELECT * FROM account.former_members WHERE account_id = $1 AND user_id = $2',
        [owner.me.account.id, collaborator.userId],
      );
      const s = await c.query('SELECT 1 FROM account.sessions WHERE user_id = $1', [
        collaborator.userId,
      ]);
      const a = await c.query<{ actor_id: string; metadata: { reason: string } }>(
        `SELECT actor_id, metadata FROM infra.audit_log
          WHERE account_id = $1 AND action = 'account.member.removed'`,
        [owner.me.account.id],
      );
      return { membership: m.rows[0], former: f.rows[0], sessions: s.rowCount, audit: a.rows };
    });
    expect(rows.membership?.status).toBe('removed');
    expect(rows.sessions).toBe(0);
    // Tên lúc bị gỡ, KHÔNG có email.
    expect(rows.former).toMatchObject({ display_name: 'Cộng tác viên' });
    expect(JSON.stringify(rows.former)).not.toContain(collaborator.email);
    // Ai gỡ ai.
    expect(rows.audit).toEqual([
      {
        actor_id: owner.me.user.id,
        metadata: expect.objectContaining({ reason: `user:${collaborator.userId}` }) as unknown,
      },
    ]);

    // describeMembers vẫn trả tên với status removed (dữ liệu họ tạo vẫn hiển thị được tác giả).
    const described = await withAccount(owner.me.account.id, () =>
      t.app.get<AccountPublicApi>(ACCOUNT_PUBLIC_API).describeMembers([collaborator.userId]),
    );
    expect(described).toEqual([
      { userId: collaborator.userId, displayName: 'Cộng tác viên', status: 'removed' },
    ]);

    const mail = await waitForMail(t.mail, collaborator.email, (m) =>
      m.subject.includes('không còn là thành viên'),
    );
    expect(mail.text).not.toMatch(/lý do/i);
    // Việc nền của tài khoản không đổi.
    const after = await asOwner(async (c) =>
      Number(
        (await c.query<{ n: string }>('SELECT count(*)::text AS n FROM pgboss.job')).rows[0]?.n,
      ),
    );
    expect(after).toBe(before);
  });

  it('gỡ chính mình / gỡ chủ → 409; mã của tài khoản khác hoặc không tồn tại → 404; cộng tác viên → 403', async () => {
    const a = await setup(t);
    const b = await setup(t);
    const self = await a.owner.agent.delete(`${MEMBERS}/${a.owner.me.user.id}`);
    expect(self.status).toBe(409);
    expect(code(self.body)).toBe('OWNER_REQUIRED');
    expect((await a.owner.agent.delete(`${MEMBERS}/${b.collaborator.userId}`)).status).toBe(404);
    expect((await a.owner.agent.delete(`${MEMBERS}/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await a.owner.agent.delete(`${MEMBERS}/khong-phai-uuid`)).status).toBe(400);
    expect((await a.collaborator.agent.delete(`${MEMBERS}/${a.owner.me.user.id}`)).status).toBe(
      403,
    );
    // Cộng tác viên của b không bị ảnh hưởng.
    expect((await b.collaborator.agent.get(ME)).status).toBe(200);
  });

  it('người bị gỡ đăng nhập lại → tài khoản chờ: không quyền, điểm cuối nghiệp vụ → 403 NO_ACCOUNT', async () => {
    const d = await detached(t);
    expect(d.me).toMatchObject({
      user: { id: d.collaborator.userId },
      account: { status: 'unclaimed' },
      permissions: [],
    });
    expect(d.me.account.id).not.toBe(d.owner.me.account.id);
    for (const path of ['/api/v1/context/profile', MEMBERS]) {
      const res = await d.agent.get(path);
      expect(res.status, path).toBe(403);
      expect(code(res.body), path).toBe('NO_ACCOUNT');
    }
    // Điểm cuối cá nhân vẫn dùng được.
    expect((await d.agent.get(ME)).status).toBe(200);
    expect((await d.agent.get('/api/v1/auth/login-methods')).status).toBe(200);
    expect(((await d.agent.get(MINE)).body as { invitations: unknown[] }).invitations).toEqual([]);
  });

  it('được mời lại → accept-existing: cùng userId, phiên mới, former_members bị xóa, tài khoản chờ bị xóa', async () => {
    const d = await detached(t);
    const shellId = d.me.account.id;
    // Chủ cũ mời lại đúng email đó.
    const invited = await d.owner.agent.post(INVITE, { email: d.collaborator.email });
    expect(invited.status).toBe(201);
    const token = tokenFromMail(
      await waitForMail(t.mail, d.collaborator.email, (m) => m.text.includes('/join#token=')),
    );
    const preview = await t.agent().post('/api/v1/invitations/preview', { token });
    expect((preview.body as { mode: string }).mode).toBe('login_required');

    const mine = (await d.agent.get(MINE)).body as {
      invitations: { id: string; inviterName: string }[];
    };
    expect(mine.invitations).toHaveLength(1);
    expect(mine.invitations[0]).toMatchObject({
      id: (invited.body as { id: string }).id,
      inviterName: 'Chủ Lan',
    });

    // Đường "người mới" không dùng được cho người đã có.
    const asNew = await t.agent().post('/api/v1/invitations/accept', {
      token,
      displayName: 'X',
      password: STRONG_PASSWORD,
      ...terms,
    });
    expect(asNew.status).toBe(409);
    expect(code(asNew.body)).toBe('INVITE_EMAIL_IN_USE');

    const oldSid = d.agent.sid;
    const res = await d.agent.post(ACCEPT_EXISTING, { invitationId: mine.invitations[0]?.id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      user: { id: d.collaborator.userId },
      account: { id: d.owner.me.account.id, status: 'active' },
      role: 'collaborator',
    });
    expect(d.agent.sid).toBeDefined();
    expect(d.agent.sid).not.toBe(oldSid);
    expect((await d.agent.get('/api/v1/context/profile')).status).not.toBe(403);

    const rows = await asOwner(async (c) => ({
      former: (
        await c.query('SELECT 1 FROM account.former_members WHERE user_id = $1', [
          d.collaborator.userId,
        ])
      ).rowCount,
      shell: (await c.query('SELECT 1 FROM account.accounts WHERE id = $1', [shellId])).rowCount,
      user: (
        await c.query<{ detached_at: Date | null; account_id: string }>(
          'SELECT detached_at, account_id FROM account.users WHERE id = $1',
          [d.collaborator.userId],
        )
      ).rows[0],
    }));
    expect(rows.former).toBe(0);
    expect(rows.shell).toBe(0);
    expect(rows.user).toEqual({ detached_at: null, account_id: d.owner.me.account.id });
    // Không còn ở tài khoản chờ → không còn lời mời "của tôi"; chấp nhận lần nữa → ALREADY_IN_ACCOUNT.
    expect(((await d.agent.get(MINE)).body as { invitations: unknown[] }).invitations).toEqual([]);
    const again = await d.agent.post(ACCEPT_EXISTING, { token });
    expect(again.status).toBe(409);
    expect(code(again.body)).toBe('ALREADY_IN_ACCOUNT');
  });

  it('accept-existing: email phiên khác email được mời → 409 INVITE_EMAIL_MISMATCH; hết chỗ → SEATS_FULL; mã hỏng → INVITE_INVALID', async () => {
    const d = await detached(t);
    const other = await registerAndVerify(t);
    const otherEmail = uniqueEmail('khac');
    const invited = await other.agent.post(INVITE, { email: otherEmail });
    const token = tokenFromMail(
      await waitForMail(t.mail, otherEmail, (m) => m.text.includes('/join#token=')),
    );
    // Lời mời gửi tới email khác không nằm trong danh sách "của tôi".
    expect(((await d.agent.get(MINE)).body as { invitations: unknown[] }).invitations).toEqual([]);
    for (const body of [{ token }, { invitationId: (invited.body as { id: string }).id }]) {
      const res = await d.agent.post(ACCEPT_EXISTING, body);
      expect(res.status).toBe(409);
      expect(code(res.body)).toBe('INVITE_EMAIL_MISMATCH');
    }
    const bad = await d.agent.post(ACCEPT_EXISTING, { invitationId: crypto.randomUUID() });
    expect(bad.status).toBe(400);
    expect(code(bad.body)).toBe('INVITE_INVALID');
    // Người đang thuộc tài khoản thật.
    const res = await other.agent.post(ACCEPT_EXISTING, { token });
    expect(res.status).toBe(409);
    expect(code(res.body)).toBe('ALREADY_IN_ACCOUNT');
    // Vẫn ở tài khoản chờ, phiên không đổi.
    expect(((await d.agent.get(ME)).body as MeBody).account.status).toBe('unclaimed');
  });

  it('POST /account/claim: thiếu đồng ý → 400; đủ → chủ tài khoản mới, phiên mới; gọi lại → 409', async () => {
    const d = await detached(t);
    const pendingInvite = await d.owner.agent.post(INVITE, { email: d.collaborator.email });
    expect(pendingInvite.status).toBe(201);

    expect((await d.agent.post(CLAIM, { termsVersion: '2026-11' })).status).toBe(400);
    const oldSid = d.agent.sid;
    const res = await d.agent.post(CLAIM, terms);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      user: { id: d.collaborator.userId },
      account: { id: d.me.account.id, status: 'active' },
      role: 'owner',
    });
    expect((res.body as MeBody).permissions).toContain('members.manage');
    expect(d.agent.sid).not.toBe(oldSid);
    const row = await asOwner(async (c) => {
      const u = await c.query<{ detached_at: Date | null }>(
        'SELECT detached_at FROM account.users WHERE id = $1',
        [d.collaborator.userId],
      );
      const a = await c.query(
        `SELECT 1 FROM infra.audit_log WHERE account_id = $1 AND action = 'account.claimed'`,
        [d.me.account.id],
      );
      return { user: u.rows[0], audits: a.rowCount };
    });
    expect(row.user?.detached_at).toBeNull();
    expect(row.audits).toBe(1);
    // Giờ là chủ tài khoản thật: dùng được chức năng của chủ; gọi lại → 409.
    expect((await d.agent.get(MEMBERS)).status).toBe(200);
    const again = await d.agent.post(CLAIM, terms);
    expect(again.status).toBe(409);
    expect(code(again.body)).toBe('ALREADY_IN_ACCOUNT');
    // Lời mời tới email đó không chấp nhận được nữa (một người – một tài khoản).
    const accept = await d.agent.post(ACCEPT_EXISTING, {
      invitationId: (pendingInvite.body as { id: string }).id,
    });
    expect(accept.status).toBe(409);
    expect(code(accept.body)).toBe('ALREADY_IN_ACCOUNT');
  });

  it('xoay phiên không làm mới xác nhận danh tính (claim với phiên cũ hơn 10 phút)', async () => {
    const d = await detached(t);
    await asOwner((c) =>
      c.query(
        `UPDATE account.sessions SET created_at = now() - interval '11 minutes' WHERE user_id = $1`,
        [d.collaborator.userId],
      ),
    );
    expect((await d.agent.post(CLAIM, terms)).status).toBe(200);
    const link = await d.agent.post('/api/v1/auth/login-methods/google/start', { purpose: 'link' });
    expect(link.status).toBe(403);
    expect(code(link.body)).toBe('REAUTH_REQUIRED');
  });

  it('người bị gỡ đăng nhập lại bằng nhà cung cấp đã liên kết → vẫn có phiên ở tài khoản chờ', async () => {
    const owner = await registerAndVerify(t);
    const email = uniqueEmail('ncc');
    await owner.agent.post(INVITE, { email });
    const token = tokenFromMail(
      await waitForMail(t.mail, email, (m) => m.text.includes('/join#token=')),
    );
    const joiner = t.agent();
    const start = await joiner.post('/api/v1/auth/oauth/google/start', {
      purpose: 'invite',
      invitationToken: token,
      ...terms,
    });
    const { followFakeProvider } = await import('./helpers/app');
    await followFakeProvider(
      joiner,
      (start.body as { authorizationUrl: string }).authorizationUrl,
      {
        scenario: 'google_verified',
        email,
      },
    );
    const me = (await joiner.get(ME)).body as MeBody;
    expect((await owner.agent.delete(`${MEMBERS}/${me.user.id}`)).status).toBe(204);
    const back = await oauthLogin(t, { scenario: 'google_verified', email });
    expect(back.agent.sid).toBeDefined();
    expect((await oauthPending(back.agent)).stage).toBe('signed_in');
    expect(((await back.agent.get(ME)).body as MeBody).account.status).toBe('unclaimed');
  });
});
