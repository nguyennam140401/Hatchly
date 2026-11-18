import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AUTH_AUDIT_ACTIONS } from '../../src/modules/account/internal/auth/audit';
import { QueueLifecycle } from '../../src/modules/queue';
import { asOwner, describeDb } from '../db/helpers/db';
import { makeSignedRequest } from '../support/make-signed-request';
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
  type MeBody,
  type TestApp,
} from './helpers/app';

// T085 (FR-029): mỗi hành động trong 19 hành động kiểm toán của 009 (data-model mục 7) có ÍT NHẤT MỘT
// bản ghi sau khi chạy luồng tương ứng; bản ghi không chứa email, mã hay liên kết (metadata chỉ
// { ip, ua_family, reason, provider }).

const NINETEEN = [
  'auth.oauth.succeeded',
  'auth.oauth.failed',
  'auth.register.oauth',
  'auth.identity.link_requested',
  'auth.identity.link_confirmed',
  'auth.identity.link_denied',
  'auth.identity.linked',
  'auth.identity.unlinked',
  'auth.identity.unlinked_by_provider',
  'auth.password.set',
  'auth.reauth',
  'account.invitation.sent',
  'account.invitation.resent',
  'account.invitation.cancelled',
  'account.invitation.accepted',
  'account.invitation.expired',
  'account.member.removed',
  'account.claimed',
  'account.user.purged',
] as const;

/** Hai hành động chỉ Worker ghi (việc định kỳ có bể `system`) – xem spec hàng chờ. */
const WORKER_ONLY = ['account.invitation.expired', 'account.user.purged'] as const;
const API_DRIVEN = NINETEEN.filter((a) => !(WORKER_ONLY as readonly string[]).includes(a));

const FB_SECRET = 'bi-mat-ung-dung-facebook-kiem-toan';
const METHODS = '/api/v1/auth/login-methods';
const terms = { acceptTerms: true, termsVersion: '2026-11' };

describeDb('Kiểm toán đủ 19 hành động của 009', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({
      env: { FACEBOOK_APP_ID: '1234567890', FACEBOOK_APP_SECRET: FB_SECRET },
    });
    await t.app.get(QueueLifecycle).whenStarted(15_000);
  });
  afterAll(async () => {
    await t.close();
  });

  it('danh sách 19 hành động đều là hành động hợp lệ của AUTH_AUDIT_ACTIONS', () => {
    expect(NINETEEN).toHaveLength(19);
    for (const action of NINETEEN) expect(AUTH_AUDIT_ACTIONS).toContain(action);
  });

  /** Liên kết (`link`) hoặc xác nhận lại (`reauth`) bằng nhà cung cấp giả lập từ Cài đặt. */
  async function startFor(
    agent: Agent,
    purpose: 'link' | 'reauth',
    scenario: 'google_verified' | 'facebook_with_email',
    extra: { email?: string; sub?: string } = {},
  ): Promise<void> {
    const provider = scenario === 'google_verified' ? 'google' : 'facebook';
    const start = await agent.post(`${METHODS}/${provider}/start`, { purpose });
    if (start.status !== 200) throw new Error(`start ${start.status} ${start.text}`);
    await followFakeProvider(agent, (start.body as { authorizationUrl: string }).authorizationUrl, {
      scenario,
      ...extra,
    });
  }

  it('chạy các luồng thật → đủ 19 bản ghi kiểm toán, không có email/mã trong metadata', async () => {
    const since = await asOwner(
      async (c) => (await c.query<{ n: Date }>('SELECT now() AS n')).rows[0]?.n ?? new Date(),
    );

    // ---- Đăng nhập / đăng ký qua nhà cung cấp ----
    const googleEmail = uniqueEmail('gg');
    const googleSub = `sub-${googleEmail}`;
    // `auth.register.oauth`
    const googleUser = await oauthSignup(t, {
      scenario: 'google_verified',
      email: googleEmail,
      sub: googleSub,
    });
    // `auth.oauth.succeeded`: danh tính đã liên kết → vào thẳng.
    const again = await oauthLogin(t, {
      scenario: 'google_verified',
      email: googleEmail,
      sub: googleSub,
    });
    expect(again.agent.sid).toBeDefined();
    // `auth.oauth.failed`: người dùng bấm "Hủy" ở trang nhà cung cấp.
    const cancelled = await oauthLogin(t, { scenario: 'cancel' });
    expect((await oauthPending(cancelled.agent)).stage).toBe('failed');

    // ---- Xác nhận trước khi liên kết (trùng email) ----
    const existing = await registerAndVerify(t);
    const confirm = await oauthLogin(t, {
      scenario: 'google_verified',
      email: existing.email,
      sub: `sub-lk-${existing.email}`,
    });
    // `auth.identity.link_requested`
    expect((await oauthPending(confirm.agent)).stage).toBe('needs_link_confirm');
    // `auth.identity.link_denied`: mật khẩu sai.
    const wrong = await confirm.agent.post('/api/v1/auth/oauth/link/password', {
      password: 'Sai-mật-khẩu-2026!',
    });
    expect(wrong.status).toBe(401);
    // `auth.identity.link_confirmed` + `auth.identity.linked`: mật khẩu đúng.
    const linked = await confirm.agent.post('/api/v1/auth/oauth/link/password', {
      password: existing.password,
    });
    expect(linked.status).toBe(200);

    // ---- Cách đăng nhập của tôi ----
    const settings = await registerAndVerify(t);
    // `auth.identity.linked` từ Cài đặt (không so email – FR-014).
    await startFor(settings.agent, 'link', 'google_verified', { email: uniqueEmail('khac') });
    // `auth.reauth`
    expect(
      (await settings.agent.post('/api/v1/auth/reauth', { password: settings.password })).status,
    ).toBe(204);
    // `auth.identity.unlinked`
    expect((await settings.agent.delete(`${METHODS}/google`)).status).toBe(204);
    // `auth.password.set`: người chỉ có Google tạo mật khẩu qua thư.
    const setPassword = await googleUser.agent.post(`${METHODS}/password/request`);
    expect(setPassword.status).toBe(202);
    const resetMail = await waitForMail(t.mail, googleEmail, (m) =>
      m.text.includes('/reset-password#token='),
    );
    const reset = await t.agent().post('/api/v1/auth/password/reset', {
      token: tokenFromMail(resetMail),
      newPassword: STRONG_PASSWORD,
    });
    expect(reset.status).toBe(200);

    // ---- Thông báo của Meta ----
    // `auth.identity.unlinked_by_provider`
    const fbSub = `fb-${uniqueEmail()}`;
    await oauthSignup(t, { scenario: 'facebook_with_email', email: uniqueEmail('fb'), sub: fbSub });
    const meta = await request(t.server)
      .post('/api/v1/auth/facebook/data-deletion')
      .type('form')
      .send({ signed_request: makeSignedRequest(fbSub, FB_SECRET) });
    expect(meta.status).toBe(200);

    // ---- Lời mời, gỡ, nhận tài khoản ----
    const owner = await registerAndVerify(t, { displayName: 'Chủ kiểm toán' });
    const invitee = uniqueEmail('moi');
    // `account.invitation.sent`
    const sent = await owner.agent.post('/api/v1/members/invitations', { email: invitee });
    expect(sent.status).toBe(201);
    // `account.invitation.resent`: mời lại cùng email = "Gửi lại".
    const resent = await owner.agent.post('/api/v1/members/invitations', { email: invitee });
    expect(resent.status).toBe(200);
    const inviteMail = await waitForMail(
      t.mail,
      invitee,
      (m) => m.text.includes('/join#token=') && tokenFromMail(m) !== '',
    );
    // Thư gửi lại có mã MỚI – lấy thư mới nhất.
    const token = tokenFromMail(
      [...t.mail.messages()]
        .reverse()
        .find(
          (m) => m.to.toLowerCase() === invitee.toLowerCase() && m.text.includes('/join#token='),
        )!,
    );
    expect(inviteMail).toBeDefined();
    // `account.invitation.accepted`
    const accepted = await t.agent().post('/api/v1/invitations/accept', {
      token,
      displayName: 'Người được mời',
      password: STRONG_PASSWORD,
      ...terms,
    });
    expect(accepted.status).toBe(200);
    const memberId = (accepted.body as MeBody).user.id;
    // `account.invitation.cancelled`
    const second = await owner.agent.post('/api/v1/members/invitations', {
      email: uniqueEmail('huy'),
    });
    expect(second.status).toBe(201);
    expect(
      (
        await owner.agent.delete(
          `/api/v1/members/invitations/${(second.body as { id: string }).id}`,
        )
      ).status,
    ).toBe(204);
    // `account.member.removed`
    expect((await owner.agent.delete(`/api/v1/members/${memberId}`)).status).toBe(204);
    // `account.claimed`: người bị gỡ tự tạo tài khoản của riêng mình.
    const leaver = t.agent();
    const login = await leaver.post('/api/v1/auth/login', {
      email: invitee,
      password: STRONG_PASSWORD,
    });
    expect(login.status).toBe(200);
    expect((await leaver.post('/api/v1/account/claim', terms)).status).toBe(200);

    // ---- Khẳng định ----
    const rows = await asOwner(async (c) => {
      const r = await c.query<{ action: string; metadata: unknown }>(
        'SELECT action, metadata FROM infra.audit_log WHERE occurred_at >= $1',
        [since],
      );
      return r.rows;
    });
    const seen = new Set(rows.map((r) => r.action));
    const missing = API_DRIVEN.filter((a) => !seen.has(a));
    expect(missing).toEqual([]);

    // metadata chỉ có { ip, ua_family, reason, provider } và không có email/mã/liên kết.
    const allowed = new Set(['ip', 'ua_family', 'reason', 'provider']);
    const emails = [googleEmail, existing.email, settings.email, invitee, owner.email];
    for (const row of rows.filter((r) => (NINETEEN as readonly string[]).includes(r.action))) {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const extra = Object.keys(meta).filter((k) => !allowed.has(k));
      expect(extra, `${row.action}: khóa lạ trong metadata`).toEqual([]);
      const text = JSON.stringify(meta);
      for (const email of emails) expect(text, row.action).not.toContain(email);
      expect(text, row.action).not.toMatch(/token|#|https?:\/\//i);
    }
  });

  it('hai hành động do Worker chạy (expired, purged) được khẳng định ở spec hàng chờ có bể system', () => {
    // `systemTx` chỉ có ở Worker nên e2e API không chạy được hai việc định kỳ; spec hàng chờ chạy chúng
    // thật và đọc `infra.audit_log`. Khóa chặt để không ai xóa nhầm khẳng định đó.
    const queueSpec = readFileSync(
      resolve(__dirname, '..', 'queue', 'account-jobs.queue.spec.ts'),
      'utf8',
    );
    for (const action of WORKER_ONLY) expect(queueSpec, action).toContain(`action = '${action}'`);
  });
});
