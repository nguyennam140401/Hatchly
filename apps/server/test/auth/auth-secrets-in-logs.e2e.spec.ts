import { createHash } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { asOwner, describeDb } from '../db/helpers/db';
import { QueueLifecycle } from '../../src/modules/queue';
import {
  createTestApp,
  registerAndVerify,
  tokenFromMail,
  uniqueEmail,
  waitForMail,
  type TestApp,
} from './helpers/app';
import { staffAgent } from './helpers/actors';

// T080 (SC-007, FR-019, nguyên tắc VII): chạy trọn các luồng xác thực, rồi quét mọi dòng nhật ký, mọi
// phản hồi và infra.audit_log.metadata – không được có mật khẩu, mã phiên, mã một lần, băm mã, băm
// mật khẩu, email.

describeDb('Không lộ bí mật xác thực (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
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
