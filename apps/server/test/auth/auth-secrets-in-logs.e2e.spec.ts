import { createHash } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import request from 'supertest';
import { asOwner, describeDb } from '../db/helpers/db';
import { QueueLifecycle } from '../../src/modules/queue';
import { makeSignedRequest } from '../support/make-signed-request';
import {
  createTestApp,
  oauthSignup,
  pathOf,
  registerAndVerify,
  STRONG_PASSWORD,
  tokenFromMail,
  uniqueEmail,
  waitForMail,
  type MeBody,
  type TestApp,
} from './helpers/app';
import { staffAgent } from './helpers/actors';

const FB_SECRET = 'bi-mat-ung-dung-facebook-quet-log';

// T080 (SC-007, FR-019, nguyên tắc VII): chạy trọn các luồng xác thực, rồi quét mọi dòng nhật ký, mọi
// phản hồi và infra.audit_log.metadata – không được có mật khẩu, mã phiên, mã một lần, băm mã, băm
// mật khẩu, email.

describeDb('Không lộ bí mật xác thực (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({
      env: { FACEBOOK_APP_ID: '1234567890', FACEBOOK_APP_SECRET: FB_SECRET },
    });
  });
  afterAll(async () => {
    await t.close();
  });

  it('đăng ký → xác minh → đăng nhập sai/đúng → quên/đặt lại → đổi mật khẩu → đăng nhập nội bộ', async () => {
    const email = uniqueEmail('bimat');
    const passwords = [
      'Bi-mat-dang-ky-001',
      'Bi-mat-sai-002',
      'Bi-mat-dat-lai-003',
      'Bi-mat-doi-004',
    ];
    const [p1, wrong, p2, p3] = passwords as [string, string, string, string];
    const responses: string[] = [];
    const secrets: string[] = [...passwords];
    const agent = t.agent();
    const keep = (r: { headers: unknown; body: unknown; text?: string }) => {
      responses.push(JSON.stringify(r.body ?? null));
      return r;
    };

    keep(
      await agent.post('/api/v1/auth/register', {
        displayName: 'Bí mật',
        email,
        password: p1,
        acceptTerms: true,
        termsVersion: '2026-11',
      }),
    );
    const verifyToken = tokenFromMail(await waitForMail(t.mail, email));
    secrets.push(verifyToken);
    keep(await agent.post('/api/v1/auth/email/verify', { token: verifyToken }));
    secrets.push(agent.sid ?? '');
    keep(await t.agent().post('/api/v1/auth/login', { email, password: wrong }));
    keep(await agent.post('/api/v1/auth/login', { email, password: p1 }));
    secrets.push(agent.sid ?? '');
    keep(await t.agent().post('/api/v1/auth/password/forgot', { email }));
    const resetToken = tokenFromMail(
      await waitForMail(t.mail, email, (m) => m.text.includes('/reset-password#token=')),
    );
    secrets.push(resetToken);
    keep(await agent.post('/api/v1/auth/password/reset', { token: resetToken, newPassword: p2 }));
    secrets.push(agent.sid ?? '');
    keep(
      await agent.post('/api/v1/auth/password/change', { currentPassword: p2, newPassword: p3 }),
    );
    secrets.push(agent.sid ?? '');
    const staff = await staffAgent(t, 'support');
    secrets.push(staff.agent.cookies.get('__Host-staff_sid') ?? '');
    keep(await staff.agent.get('/api/v1/internal/auth/me'));

    // Băm mã dạng hex/base64 cũng không được xuất hiện.
    for (const token of [verifyToken, resetToken, ...secrets.slice(-4)]) {
      if (token === '') continue;
      const h = createHash('sha256').update(token).digest();
      secrets.push(h.toString('hex'), h.toString('base64'), h.toString('base64url'));
    }

    const metadata = await asOwner(async (c) => {
      const r = await c.query<{ metadata: unknown }>(
        `SELECT metadata FROM infra.audit_log WHERE occurred_at > now() - interval '10 minutes'`,
      );
      return r.rows.map((row) => JSON.stringify(row.metadata));
    });
    expect(metadata.length).toBeGreaterThan(5);

    const haystacks = {
      logs: t.rawLogs.join('\n'),
      responses: responses.join('\n'),
      audit: metadata.join('\n'),
    };
    for (const [where, text] of Object.entries(haystacks)) {
      for (const secret of secrets.filter((s) => s.length >= 8)) {
        expect(text.includes(secret), `${where} chứa bí mật`).toBe(false);
      }
      expect(text, where).not.toContain('$argon2id$');
    }
    // Email không nằm trong metadata kiểm toán và nhật ký kỹ thuật.
    expect(haystacks.audit).not.toContain(email);
    expect(haystacks.audit).not.toContain(staff.email);
    expect(haystacks.logs).not.toContain(email);
    // Cookie bị che trong nhật ký yêu cầu.
    expect(haystacks.logs).not.toMatch(/__Host-(staff_)?sid=[A-Za-z0-9_-]{10,}/);
  });

  // 009 T085 (SC-008, FR-030): chạy trọn các luồng đăng nhập nhà cung cấp, liên kết, lời mời, Meta rồi
  // quét nhật ký, `infra.audit_log.metadata` và dữ liệu việc trong `pgboss`.
  it('009: đăng nhập nhà cung cấp, liên kết, lời mời, Meta – không lộ code/state/mã lời mời/signed_request/cookie lượt/mật khẩu/email', async () => {
    await t.app.get(QueueLifecycle).whenStarted(15_000);
    const since = await asOwner(
      async (c) => (await c.query<{ n: Date }>('SELECT now() AS n')).rows[0]?.n ?? new Date(),
    );
    const secrets: string[] = [];
    const emails: string[] = [];
    const passwords = ['Bi-mat-moi-tham-gia-009', STRONG_PASSWORD];
    secrets.push(passwords[0]!, 'Sai-mật-khẩu-liên-kết-009!');

    // 1. Google: start → trang giả lập → callback (có `code`, `state`) → needs_signup → signup.
    const gEmail = uniqueEmail('gbm');
    emails.push(gEmail);
    const agent = t.agent();
    const start = await agent.post('/api/v1/auth/oauth/google/start', { purpose: 'login' });
    expect(start.status).toBe(200);
    const authorize = new URL((start.body as { authorizationUrl: string }).authorizationUrl);
    const state = authorize.searchParams.get('state');
    secrets.push(state ?? '');
    authorize.searchParams.set('scenario', 'google_verified');
    authorize.searchParams.set('email', gEmail);
    authorize.searchParams.set('sub', `sub-${gEmail}`);
    const page = await agent.get(`${authorize.pathname}${authorize.search}`);
    expect(page.status).toBe(302);
    const callbackUrl = new URL(page.headers.location!, 'http://x');
    secrets.push(
      callbackUrl.searchParams.get('code') ?? '',
      callbackUrl.searchParams.get('state') ?? '',
    );
    const cb = await agent.get(pathOf(page.headers.location!));
    expect(cb.status).toBe(303);
    secrets.push(agent.cookies.get('__Host-oauth') ?? '');
    const signup = await agent.post('/api/v1/auth/oauth/signup', {
      displayName: 'Bí mật Google',
      acceptTerms: true,
      termsVersion: '2026-11',
    });
    expect(signup.status).toBe(200);
    secrets.push(agent.sid ?? '');

    // 2. Trùng email: liên kết bằng mật khẩu sai rồi đúng, và bằng thư xác nhận.
    const existing = await registerAndVerify(t);
    emails.push(existing.email);
    secrets.push(existing.password);
    const link = t.agent();
    const lstart = await link.post('/api/v1/auth/oauth/google/start', { purpose: 'login' });
    const lurl = new URL((lstart.body as { authorizationUrl: string }).authorizationUrl);
    lurl.searchParams.set('scenario', 'google_verified');
    lurl.searchParams.set('email', existing.email);
    lurl.searchParams.set('sub', `sub-lk-${existing.email}`);
    const lpage = await link.get(`${lurl.pathname}${lurl.search}`);
    await link.get(pathOf(lpage.headers.location!));
    secrets.push(link.cookies.get('__Host-oauth') ?? '');
    expect(
      (
        await link.post('/api/v1/auth/oauth/link/password', {
          password: 'Sai-mật-khẩu-liên-kết-009!',
        })
      ).status,
    ).toBe(401);
    expect((await link.post('/api/v1/auth/oauth/link/send-email')).status).toBe(202);
    const confirmMail = await waitForMail(t.mail, existing.email, (m) =>
      m.text.includes('/oauth/confirm#token='),
    );
    const confirmToken = tokenFromMail(confirmMail);
    secrets.push(confirmToken);
    expect(
      (await t.agent().post('/api/v1/auth/oauth/confirm', { token: confirmToken })).status,
    ).toBe(200);

    // 3. Lời mời: gửi → xem trước → chấp nhận (mã lời mời, mật khẩu người mới).
    const owner = await registerAndVerify(t);
    emails.push(owner.email);
    const invitee = uniqueEmail('moi');
    emails.push(invitee);
    expect((await owner.agent.post('/api/v1/members/invitations', { email: invitee })).status).toBe(
      201,
    );
    const inviteToken = tokenFromMail(
      await waitForMail(t.mail, invitee, (m) => m.text.includes('/join#token=')),
    );
    secrets.push(inviteToken);
    expect(
      (await t.agent().post('/api/v1/invitations/preview', { token: inviteToken })).status,
    ).toBe(200);
    const joiner = t.agent();
    const accepted = await joiner.post('/api/v1/invitations/accept', {
      token: inviteToken,
      displayName: 'Người mới',
      password: passwords[0],
      acceptTerms: true,
      termsVersion: '2026-11',
    });
    expect(accepted.status).toBe(200);
    secrets.push(joiner.sid ?? '');
    const memberId = (accepted.body as MeBody).user.id;
    // Mã lời mời cũ không dùng lại được; chủ gỡ người đó.
    expect(
      (await t.agent().post('/api/v1/invitations/preview', { token: inviteToken })).status,
    ).toBe(400);
    expect((await owner.agent.delete(`/api/v1/members/${memberId}`)).status).toBe(204);

    // 4. Meta: `signed_request` và mã xác nhận.
    const fbSub = `fb-${uniqueEmail()}`;
    const fbEmail = uniqueEmail('fb');
    emails.push(fbEmail);
    await oauthSignup(t, { scenario: 'facebook_with_email', email: fbEmail, sub: fbSub });
    const signed = makeSignedRequest(fbSub, FB_SECRET);
    secrets.push(signed, fbSub);
    const meta = await request(t.server)
      .post('/api/v1/auth/facebook/data-deletion')
      .type('form')
      .send({ signed_request: signed });
    expect(meta.status).toBe(200);
    secrets.push((meta.body as { confirmation_code: string }).confirmation_code);

    // ---- Quét ----
    const metadata = await asOwner(async (c) => {
      const r = await c.query<{ metadata: unknown }>(
        'SELECT metadata FROM infra.audit_log WHERE occurred_at >= $1',
        [since],
      );
      return r.rows.map((row) => JSON.stringify(row.metadata));
    });
    expect(metadata.length).toBeGreaterThan(8);
    const jobData = await asOwner(async (c) => {
      const r = await c.query<{ data: string }>('SELECT data::text AS data FROM pgboss.job');
      return r.rows.map((row) => row.data);
    });
    const haystacks = {
      logs: t.rawLogs.join('\n'),
      audit: metadata.join('\n'),
      jobs: jobData.join('\n'),
    };
    for (const [where, text] of Object.entries(haystacks)) {
      for (const secret of secrets.filter((s) => s.length >= 8)) {
        const at = text.indexOf(secret);
        // Thông báo nêu dòng chứa bí mật (dữ liệu thử) để lần ra nguồn rò rỉ.
        const context = at < 0 ? '' : text.slice(Math.max(0, at - 160), at + secret.length + 40);
        expect(at, `${where} chứa bí mật «${secret.slice(0, 10)}…»: ${context}`).toBe(-1);
      }
      for (const email of emails) expect(text.includes(email), `${where} chứa email`).toBe(false);
      expect(text, where).not.toContain('$argon2id$');
    }
    // Không dòng nhật ký nào của /auth/oauth/* có chuỗi truy vấn (code, state).
    const oauthLines = t.rawLogs.filter((l) => l.includes('/auth/oauth/'));
    expect(oauthLines.length).toBeGreaterThan(0);
    for (const line of oauthLines) {
      expect(line).not.toMatch(/[?&](code|state|error)=/);
      expect(line).not.toMatch(/\/auth\/oauth\/[a-z/]*\?/);
    }
    // Cookie của lượt bị che trong nhật ký yêu cầu.
    expect(haystacks.logs).not.toMatch(/__Host-oauth=[A-Za-z0-9_-]{10,}/);
  });

  it('006 FR-020: lưu hồ sơ kinh doanh (thành công, 400, 409) – nhật ký không chứa nội dung hồ sơ', async () => {
    await t.app.get(QueueLifecycle).whenStarted(15_000);
    const { agent } = await registerAndVerify(t);
    const SECRET = 'Nội-dung-hồ-sơ-thử-7f3a';
    const fields = {
      industryCode: 'other',
      industryOther: `Ngành ${SECRET}`,
      introduction: `Giới thiệu ${SECRET}`,
      products: `SP ${SECRET}`,
      policies: null,
      tone: null,
      keywords: [`kw-${SECRET}`],
    };
    const before = t.rawLogs.length;
    expect(
      (await agent.put('/api/v1/context/profile', { expectedVersion: 0, fields })).status,
    ).toBe(200);
    // 400: từ khóa trùng – thông điệp lỗi CÓ giá trị người dùng nhưng nhật ký thì không.
    const bad = await agent.put('/api/v1/context/profile', {
      expectedVersion: 1,
      fields: { ...fields, keywords: [`kw-${SECRET}`, `KW-${SECRET}`] },
    });
    expect(bad.status).toBe(400);
    expect(
      (await agent.put('/api/v1/context/profile', { expectedVersion: 0, fields })).status,
    ).toBe(409);
    const logs = t.rawLogs.slice(before).join('\n');
    expect(logs).toContain('request.rejected');
    expect(logs).toContain('context.profile.saved');
    expect(logs).not.toContain(SECRET);
  });
});
