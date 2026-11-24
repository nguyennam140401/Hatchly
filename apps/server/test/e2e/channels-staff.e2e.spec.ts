// 010 T034 (FR-030): hỗ trợ xem kênh của khách qua `GET /staff/accounts/:accountId/channels` – chỉ khung nhìn đã lọc,
// bắt buộc lý do, khách hàng không gọi được, mỗi lần xem có dòng kiểm toán và không có bản mã/mã quyền trong phản hồi.
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { asOwner, describeDb } from '../db/helpers/db';
import { createActors, type Actors } from '../auth/helpers/actors';
import { createTestApp, type TestApp } from '../auth/helpers/app';

describeDb('Hỗ trợ xem kênh khách hàng (010 FR-030)', () => {
  let t: TestApp;
  let actors: Actors;
  let accountId = '';
  const SECRET = 'EAA-ban-ma-bi-mat-khong-duoc-lo';

  beforeAll(async () => {
    t = await createTestApp({});
    actors = await createActors(t);
    accountId = actors.ownerMe.account.id;
    await asOwner((c) =>
      c.query(
        `INSERT INTO platform_gateway.channel_connections
           (id, account_id, channel_type, external_id, display_name, token_ciphertext, refresh_ciphertext,
            token_issued_at, expiry_kind, token_expires_at, connected_at)
         VALUES ($1, $2, 'facebook_page', $3, 'Tiệm Hoa', $4, $5, now(), 'token', now() + interval '3 day', now())`,
        [
          uuidV7(),
          accountId,
          `page-${randomBytes(6).toString('hex')}`,
          Buffer.from(SECRET),
          Buffer.from(SECRET),
        ],
      ),
    );
  });
  afterAll(async () => {
    await t.close();
  });

  const url = (reason?: string) =>
    `/api/v1/staff/accounts/${accountId}/channels${reason === undefined ? '' : `?reason=${encodeURIComponent(reason)}`}`;

  it('khách hàng (chủ) không gọi được', async () => {
    const res = await actors.owner.get(url('Khách báo lỗi kênh'));
    expect([401, 403]).toContain(res.status);
  });

  it('thiếu lý do ⇒ 400, không đọc gì', async () => {
    expect((await actors.support.get(url())).status).toBe(400);
  });

  it('hỗ trợ xem được kênh, phản hồi không có bản mã/mã quyền; ghi cả view_account và view_channel', async () => {
    const res = await actors.support.get(url('Khách báo lỗi kênh'));
    expect(res.status).toBe(200);
    const body = res.body as { channels: { displayName: string; state: string }[] };
    expect(body.channels).toHaveLength(1);
    expect(body.channels[0]?.displayName).toBe('Tiệm Hoa');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('ciphertext');
    expect(text).not.toContain(Buffer.from(SECRET).toString('base64'));

    const actions = await asOwner(async (c) =>
      (
        await c.query<{ action: string }>(
          `SELECT action FROM infra.audit_log WHERE account_id = $1 AND action IN ('support.view_account','support.view_channel')`,
          [accountId],
        )
      ).rows.map((r) => r.action),
    );
    expect(actions).toContain('support.view_account');
    expect(actions).toContain('support.view_channel');
  });
});
