import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTH_CONFIG, type AuthConfig } from '../../src/core/config/auth-config';
import { createStaffOps } from '../../src/modules/account';
import { asOwner, describeDb } from '../db/helpers/db';
import { createTestApp, STRONG_PASSWORD, type ErrorBody, type TestApp } from './helpers/app';
import { staffAgent } from './helpers/actors';
import { AccessMatrixTestModule } from './support/access-matrix.module';

// T065 (US4, FR-010, FR-016, SC-008): lối vào nội bộ tách khỏi lối vào khách hàng, phiên ngắn,
// giới hạn dải mạng, kiểm toán mọi đăng nhập và thao tác thay đổi dữ liệu.

const LOGIN = '/api/v1/internal/auth/login';

async function auditRows(action: string, filter: { ip?: string; actorId?: string } = {}) {
  return asOwner(async (c) => {
    const r = await c.query<{
      actor_type: string;
      actor_id: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT actor_type, actor_id, metadata FROM infra.audit_log
        WHERE action = $1 AND ($2::text IS NULL OR metadata->>'ip' = $2)
          AND ($3::text IS NULL OR actor_id = $3)`,
      [action, filter.ip ?? null, filter.actorId ?? null],
    );
    return r.rows;
  });
}

describeDb('Nhân viên nội bộ (e2e)', () => {
  let t: TestApp;
  const clock = { t: Date.now() };
  beforeAll(async () => {
    t = await createTestApp({ extraImports: [AccessMatrixTestModule] });
    t.cache.now = () => clock.t;
  });
  afterAll(async () => {
    await t.close();
  });

  it('đăng nhập → StaffMeResponse + __Host-staff_sid là cookie phiên trình duyệt', async () => {
    const { agent, email } = await staffAgent(t, 'support');
    const me = await agent.get('/api/v1/internal/auth/me');
    expect(me.status).toBe(200);
    expect(me.body).toEqual({
      staff: { id: expect.any(String) as string, displayName: 'Hỗ trợ', email },
      role: 'support',
      // 015: support có thêm ai.cost.view (xem sổ chi phí AI nội bộ); ai.pricing.manage chỉ admin.
      permissions: ['support.lookup', 'ai.cost.view'],
    });
    const again = t.agent();
    const res = await again.post(LOGIN, { email, password: STRONG_PASSWORD });
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0] ?? '';
    expect(cookie).toMatch(
      /^__Host-staff_sid=[A-Za-z0-9_-]+; Path=\/; HttpOnly; Secure; SameSite=Lax$/,
    );
  });

  it('AS1: support gọi plan.manage → 403, admin → 200', async () => {
    const support = await staffAgent(t, 'support');
    const admin = await staffAgent(t, 'admin');
    expect((await support.agent.get('/api/v1/__test/perm/plan.manage')).status).toBe(403);
    expect((await admin.agent.get('/api/v1/__test/perm/plan.manage')).status).toBe(200);
    expect((await support.agent.get('/api/v1/__test/perm/support.lookup')).status).toBe(200);
  });

  it('015: ai.cost.view cho support và admin; ai.pricing.manage chỉ admin', async () => {
    const support = await staffAgent(t, 'support');
    const admin = await staffAgent(t, 'admin');
    expect((await support.agent.get('/api/v1/__test/perm/ai.cost.view')).status).toBe(200);
    expect((await admin.agent.get('/api/v1/__test/perm/ai.cost.view')).status).toBe(200);
    expect((await support.agent.get('/api/v1/__test/perm/ai.pricing.manage')).status).toBe(403);
    expect((await admin.agent.get('/api/v1/__test/perm/ai.pricing.manage')).status).toBe(200);
  });

  it('AS2: kiểm toán đăng nhập thành công/thất bại có ip, không mật khẩu', async () => {
    const { agent, id, email } = await staffAgent(t, 'support');
    const ok = await auditRows('staff.login.succeeded', { actorId: id });
    expect(ok).toHaveLength(1);
    expect(ok[0]).toMatchObject({ actor_type: 'support', metadata: { ip: agent.ip } });
    const bad = t.agent();
    const r = await bad.post(LOGIN, { email, password: 'sai-mat-khau-nv' });
    expect(r.status).toBe(401);
    expect((r.body as ErrorBody).error.code).toBe('INVALID_CREDENTIALS');
    const failed = await auditRows('staff.login.failed', { ip: bad.ip });
    expect(failed).toHaveLength(1);
    expect(JSON.stringify(failed)).not.toContain('sai-mat-khau-nv');
    expect(JSON.stringify(failed)).not.toContain(email);
  });

  it('AS3: khóa nhân viên → mọi phiên bị từ chối khi bộ nhớ đệm hết hạn (≤ 60 giây)', async () => {
    const { agent, email } = await staffAgent(t, 'support');
    expect((await agent.get('/api/v1/internal/auth/me')).status).toBe(200);
    await createStaffOps(t.app.get<AuthConfig>(AUTH_CONFIG)).disable(email);
    clock.t += 60_001;
    expect((await agent.get('/api/v1/internal/auth/me')).status).toBe(401);
    expect((await t.agent().post(LOGIN, { email, password: STRONG_PASSWORD })).status).toBe(401);
  });

  it('cùng email/mật khẩu ở lối vào khách hàng → 401 INVALID_CREDENTIALS', async () => {
    const { email } = await staffAgent(t, 'admin');
    const r = await t.agent().post('/api/v1/auth/login', { email, password: STRONG_PASSWORD });
    expect(r.status).toBe(401);
    expect((r.body as ErrorBody).error.code).toBe('INVALID_CREDENTIALS');
  });

  it('chống dò: 5 lần sai → 429 LOGIN_THROTTLED', async () => {
    const { email } = await staffAgent(t, 'support');
    for (let i = 0; i < 5; i++) await t.agent().post(LOGIN, { email, password: `sai-${i}-xxxx` });
    const r = await t.agent().post(LOGIN, { email, password: STRONG_PASSWORD });
    expect(r.status).toBe(429);
    expect((r.body as ErrorBody).error.code).toBe('LOGIN_THROTTLED');
  });

  it('phiên quá 30 phút không hoạt động / 12 giờ tuyệt đối → 401', async () => {
    for (const column of ['idle_expires_at', 'absolute_expires_at']) {
      const { agent, id } = await staffAgent(t, 'support');
      const sessionLimits = await asOwner(async (c) => {
        const r = await c.query<{ idle: number; abs: number }>(
          `SELECT EXTRACT(EPOCH FROM idle_expires_at - created_at)::int AS idle,
                  EXTRACT(EPOCH FROM absolute_expires_at - created_at)::int AS abs
             FROM account.staff_sessions WHERE staff_user_id = $1`,
          [id],
        );
        await c.query(
          `UPDATE account.staff_sessions SET ${column} = now() - interval '1 second' WHERE staff_user_id = $1`,
          [id],
        );
        return r.rows[0];
      });
      expect(sessionLimits?.idle).toBeGreaterThanOrEqual(30 * 60 - 1);
      expect(sessionLimits?.idle).toBeLessThanOrEqual(30 * 60 + 1);
      expect(sessionLimits?.abs).toBeGreaterThanOrEqual(12 * 3600 - 1);
      t.cache.clear();
      expect((await agent.get('/api/v1/internal/auth/me')).status, column).toBe(401);
    }
  });

  it('SC-008: yêu cầu nội bộ thay đổi dữ liệu có bản ghi staff.request', async () => {
    const { agent, id } = await staffAgent(t, 'admin');
    expect((await agent.post('/api/v1/internal/auth/logout')).status).toBe(204);
    const rows = await auditRows('staff.request', { actorId: id });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor_type).toBe('admin');
    expect(JSON.stringify(rows[0]?.metadata)).toContain('/api/v1/internal/auth/logout');
  });

  describe('dải mạng nội bộ (STAFF_ALLOWED_CIDRS=203.0.113.0/24)', () => {
    let narrow: TestApp;
    beforeAll(async () => {
      narrow = await createTestApp({ env: { STAFF_ALLOWED_CIDRS: '203.0.113.0/24' } });
    });
    afterAll(async () => {
      await narrow.close();
    });

    it('AS4: đăng nhập ngoài dải → 403 IP_NOT_ALLOWED + staff.login.denied_ip; trong dải → được', async () => {
      const inside = await staffAgent(narrow, 'support', '203.0.113.7');
      const outside = narrow.agent({ ip: '198.51.100.9' });
      const r = await outside.post(LOGIN, { email: inside.email, password: STRONG_PASSWORD });
      expect(r.status).toBe(403);
      expect((r.body as ErrorBody).error.code).toBe('IP_NOT_ALLOWED');
      expect(await auditRows('staff.login.denied_ip', { ip: '198.51.100.9' })).toHaveLength(1);

      // Phiên hợp lệ nhưng yêu cầu đến từ ngoài dải → 403.
      const moved = narrow.agent({ ip: '198.51.100.10' });
      for (const [k, v] of inside.agent.cookies) moved.cookies.set(k, v);
      const req = await moved.get('/api/v1/internal/auth/me');
      expect(req.status).toBe(403);
      expect((req.body as ErrorBody).error.code).toBe('IP_NOT_ALLOWED');
      expect((await inside.agent.get('/api/v1/internal/auth/me')).status).toBe(200);
    });
  });
});
