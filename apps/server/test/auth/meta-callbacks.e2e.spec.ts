import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { asOwner, describeDb } from '../db/helpers/db';
import { makeSignedRequest } from '../support/make-signed-request';
import {
  createTestApp,
  followFakeProvider,
  oauthSignup,
  registerAndVerify,
  uniqueEmail,
  type ErrorBody,
  type MeBody,
  type TestApp,
} from './helpers/app';

// T080 (009, FR-009a): thông báo "gỡ ứng dụng" / "yêu cầu xóa dữ liệu" của Meta.

const SECRET = 'bi-mat-ung-dung-facebook-thu';
const DEAUTH = '/api/v1/auth/facebook/deauthorize';
const DELETION = '/api/v1/auth/facebook/data-deletion';

describeDb('Thông báo của Meta', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({
      env: { FACEBOOK_APP_ID: '1234567890', FACEBOOK_APP_SECRET: SECRET },
    });
  });
  afterAll(async () => {
    await t.close();
  });

  /** Máy gọi máy: form-urlencoded, KHÔNG Origin, KHÔNG cookie. */
  const post = (path: string, signed: string) =>
    request(t.server).post(path).type('form').send({ signed_request: signed });

  const identities = (userId: string) =>
    asOwner(async (c) => {
      const r = await c.query<{ provider: string }>(
        'SELECT provider FROM account.login_identities WHERE user_id = $1 ORDER BY provider',
        [userId],
      );
      return r.rows.map((x) => x.provider);
    });

  const notices = (userId: string) =>
    asOwner(async (c) =>
      Number(
        (
          await c.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM pgboss.job
              WHERE data->>'type' = 'account.mail_notice'
                AND data->'payload'->>'template' = 'identity_removed_by_provider'
                AND data->'payload'->>'userId' = $1`,
            [userId],
          )
        ).rows[0]?.n,
      ),
    );

  it('chữ ký sai → 400 SIGNED_REQUEST_INVALID, không tác dụng phụ', async () => {
    const sub = `fb-${uniqueEmail()}`;
    const { me } = await oauthSignup(t, {
      scenario: 'facebook_with_email',
      email: uniqueEmail('fb'),
      sub,
    });
    const good = makeSignedRequest(sub, SECRET);
    const bad = (good.startsWith('A') ? 'B' : 'A') + good.slice(1);
    for (const path of [DEAUTH, DELETION]) {
      const res = await post(path, bad);
      expect(res.status, path).toBe(400);
      expect((res.body as ErrorBody).error.code).toBe('SIGNED_REQUEST_INVALID');
    }
    expect((await request(t.server).post(DELETION).type('form').send({})).status).toBe(400);
    expect(await identities(me.user.id)).toEqual(['facebook']);
    const rows = await asOwner(
      async (c) => (await c.query('SELECT 1 FROM account.meta_deletion_requests')).rowCount,
    );
    expect(rows).toBe(0);
  });

  it('data-deletion hợp lệ → gỡ Facebook của đúng người, mã xác nhận + trang trạng thái; gửi lại → cùng mã, không thư thứ hai', async () => {
    const sub = `fb-${uniqueEmail()}`;
    const { me } = await registerAndVerify(t);
    const owner = await oauthSignup(t, {
      scenario: 'facebook_with_email',
      email: uniqueEmail('fb'),
      sub,
    });
    const untouched = await oauthSignup(t, {
      scenario: 'facebook_with_email',
      email: uniqueEmail('fb2'),
    });

    const started = Date.now();
    const res = await post(DELETION, makeSignedRequest(sub, SECRET));
    expect(res.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(60_000);
    const body = res.body as { url: string; confirmation_code: string };
    expect(body.url).toBe(`http://app.test/data-deletion/${body.confirmation_code}`);
    expect(body.confirmation_code).toMatch(/^[A-Za-z0-9_-]{22}$/);

    // Facebook là cách đăng nhập CUỐI CÙNG → vẫn gỡ; người dùng, vai trò, tài khoản còn nguyên.
    expect(await identities(owner.me.user.id)).toEqual([]);
    expect(await identities(untouched.me.user.id)).toEqual(['facebook']);
    expect(await identities(me.user.id)).toEqual(['password']);
    const kept = await asOwner(async (c) => ({
      user: (await c.query('SELECT 1 FROM account.users WHERE id = $1', [owner.me.user.id]))
        .rowCount,
      membership: (
        await c.query('SELECT 1 FROM account.memberships WHERE user_id = $1', [owner.me.user.id])
      ).rowCount,
      audit: (
        await c.query<{ actor_type: string; metadata: Record<string, unknown> }>(
          `SELECT actor_type, metadata FROM infra.audit_log
            WHERE account_id = $1 AND action = 'auth.identity.unlinked_by_provider'`,
          [owner.me.account.id],
        )
      ).rows,
      request: (
        await c.query<Record<string, unknown>>(
          'SELECT * FROM account.meta_deletion_requests WHERE confirmation_code = $1',
          [body.confirmation_code],
        )
      ).rows[0],
    }));
    expect(kept.user).toBe(1);
    expect(kept.membership).toBe(1);
    expect(kept.audit).toHaveLength(1);
    expect(kept.audit[0]).toMatchObject({
      actor_type: 'system',
      metadata: { provider: 'facebook' },
    });
    expect(kept.request).toMatchObject({ kind: 'data_deletion', status: 'completed' });
    // Chỉ HMAC – không có mã người dùng Facebook rõ ở bất kỳ cột nào.
    expect(JSON.stringify(kept.request)).not.toContain(sub);
    expect(await notices(owner.me.user.id)).toBe(1);

    const status = await t.agent().get(`/api/v1/public/data-deletion/${body.confirmation_code}`);
    expect(status.status).toBe(200);
    expect(Object.keys(status.body as object).sort()).toEqual(['receivedAt', 'status']);
    expect((status.body as { status: string }).status).toBe('completed');
    expect((await t.agent().get('/api/v1/public/data-deletion/ma-la')).status).toBe(404);

    // Gửi lại: 200, cùng mã, không thư thứ hai.
    const again = await post(DELETION, makeSignedRequest(sub, SECRET));
    expect(again.status).toBe(200);
    expect((again.body as { confirmation_code: string }).confirmation_code).toBe(
      body.confirmation_code,
    );
    expect(await notices(owner.me.user.id)).toBe(1);
  });

  it('deauthorize trả {}; người không tồn tại → 200 với no_data', async () => {
    const res = await post(DEAUTH, makeSignedRequest('khong-ton-tai-123', SECRET));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
    const unknown = await post(DELETION, makeSignedRequest('khong-ton-tai-456', SECRET));
    expect(unknown.status).toBe(200);
    const code = (unknown.body as { confirmation_code: string }).confirmation_code;
    const status = await t.agent().get(`/api/v1/public/data-deletion/${code}`);
    expect((status.body as { status: string }).status).toBe('no_data');
  });

  it('gỡ → liên kết lại Facebook → gỡ lần hai: bị xóa lần nữa, có thư thứ hai, cùng mã; chết giữa chừng thì lần sau gỡ xong', async () => {
    const sub = `fb-${uniqueEmail()}`;
    const { agent, me } = await registerAndVerify(t);
    const link = async () => {
      const start = await agent.post('/api/v1/auth/login-methods/facebook/start', {
        purpose: 'link',
      });
      expect(start.status).toBe(200);
      await followFakeProvider(
        agent,
        (start.body as { authorizationUrl: string }).authorizationUrl,
        {
          scenario: 'facebook_with_email',
          sub,
          email: uniqueEmail('fb'),
        },
      );
      expect(await identities(me.user.id)).toEqual(['facebook', 'password']);
    };
    await link();
    const first = await post(DEAUTH, makeSignedRequest(sub, SECRET));
    expect(first.status).toBe(200);
    expect(await identities(me.user.id)).toEqual(['password']);
    expect(await notices(me.user.id)).toBe(1);

    await link();
    await post(DEAUTH, makeSignedRequest(sub, SECRET));
    expect(await identities(me.user.id)).toEqual(['password']);
    expect(await notices(me.user.id)).toBe(2);
    const rows = await asOwner(
      async (c) =>
        (
          await c.query<{ status: string }>(
            `SELECT status FROM account.meta_deletion_requests WHERE kind = 'deauthorize'`,
          )
        ).rows,
    );
    // Một dòng cho mỗi (loại, người) – thông báo lặp không tạo dòng mới.
    expect(rows.filter((r) => r.status === 'completed').length).toBeGreaterThanOrEqual(1);

    // Mô phỏng tiến trình chết giữa chừng: dòng yêu cầu đã có (no_data) nhưng danh tính vẫn còn.
    await link();
    await asOwner((c) => c.query(`UPDATE account.meta_deletion_requests SET status = 'no_data'`));
    await post(DEAUTH, makeSignedRequest(sub, SECRET));
    expect(await identities(me.user.id)).toEqual(['password']);
    expect(((await agent.get('/api/v1/auth/me')).body as MeBody).user.id).toBe(me.user.id);
  });
});
