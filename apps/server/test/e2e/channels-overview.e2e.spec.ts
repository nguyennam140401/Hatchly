// 010 T047 (US6, FR-026, FR-028, FR-035): `GET /channels/overview` chỉ đọc dữ liệu đã lưu (0 lời gọi nền tảng), không cache, sắp xếp
// "cần chú ý" lên trước, `attention` liệt kê từng kênh, `viewerCanManage` (chủ true / cộng tác viên false); cộng tác viên gọi
// connect/recheck/DELETE ⇒ 403.
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { OverviewResponse } from '@app/shared/platform_gateway';
import { asOwner, describeDb } from '../db/helpers/db';
import { createActors, type Actors } from '../auth/helpers/actors';
import { createTestApp, type TestApp } from '../auth/helpers/app';
import { clearAdapters } from '../../src/modules/platform_gateway/internal/adapters/registry';
import {
  DEFAULT_GRANTED_SCOPES,
  GraphStub,
  loadMetaConnectScenario,
} from '../platform-gateway/graph-stub';

const stub = new GraphStub();

describeDb('Tổng quan kênh kết nối – HTTP (010 US6)', () => {
  let t: TestApp;
  let actors: Actors;
  const ids: string[] = [];

  beforeAll(async () => {
    const baseUrl = await stub.start();
    clearAdapters();
    t = await createTestApp({
      env: {
        PLATFORM_GATEWAY_DRIVER: 'real',
        PLATFORM_ADAPTER_MODE: 'real',
        META_GRAPH_BASE_URL: baseUrl,
        FACEBOOK_APP_ID: 'app-123',
        FACEBOOK_APP_SECRET: 'APP-SECRET',
        CREDENTIAL_VAULT_DRIVER: 'env-master-key',
        CREDENTIAL_MASTER_KEY_B64: randomBytes(32).toString('base64'),
      },
    });
    actors = await createActors(t);
    const pages = ['ov-page-1', 'ov-page-2', 'ov-page-3'];
    loadMetaConnectScenario(stub, {
      pages: pages.map((id, i) => ({ id, name: `Trang ${i + 1}`, accessToken: `EAAov${i}` })),
    });
    for (const id of pages) {
      for (let i = 0; i < 4; i++) {
        stub.on(`GET /${id}`, { json: { id, tasks: ['CREATE_CONTENT', 'MANAGE'] } });
      }
    }
    for (let i = 0; i < 12; i++) {
      stub.on('POST /debug_token', {
        json: {
          data: {
            is_valid: true,
            expires_at: 0,
            data_access_expires_at: 0,
            scopes: DEFAULT_GRANTED_SCOPES,
          },
        },
      });
    }
    const start = await actors.owner.post('/api/v1/channels/connect', {
      channelType: 'facebook_page',
    });
    const state =
      new URL((start.body as { authorizeUrl: string }).authorizeUrl).searchParams.get('state') ??
      '';
    const cb = await actors.owner.get(
      `/api/v1/channels/callback/facebook_page?state=${encodeURIComponent(state)}&code=c`,
    );
    const selectionId = new URL(cb.headers.location ?? '', 'http://x').pathname.split('/').pop();
    const confirm = await actors.owner.post(`/api/v1/channels/selections/${selectionId}/confirm`, {
      externalIds: pages,
    });
    expect(confirm.status).toBe(200);
    for (const r of (confirm.body as { results: { connection?: { connectionId: string } }[] })
      .results) {
      if (r.connection !== undefined) ids.push(r.connection.connectionId);
    }
    expect(ids).toHaveLength(3);
    // Một kênh cần kết nối lại, một kênh sắp hết hạn.
    await asOwner(async (c) => {
      await c.query(
        `UPDATE platform_gateway.channel_connections SET status = 'needs_reconnect', reason_code = 'TOKEN_REVOKED' WHERE id = $1`,
        [ids[2]],
      );
      await c.query(
        `UPDATE platform_gateway.channel_connections SET expiry_kind = 'token', token_expires_at = now() + interval '3 days' WHERE id = $1`,
        [ids[1]],
      );
    });
  });
  afterAll(async () => {
    await t.close();
    await stub.stop();
    clearAdapters();
  });

  it('chỉ đọc dữ liệu đã lưu: 0 lời gọi nền tảng, Cache-Control no-store, đúng lược đồ', async () => {
    const before = stub.requests.length;
    const res = await actors.owner.get('/api/v1/channels/overview');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(stub.requests.length).toBe(before); // KHÔNG chạm nền tảng
    const parsed = OverviewResponse.parse(res.body);
    expect(parsed.connections).toHaveLength(3);
    expect(parsed.viewerCanManage).toBe(true);
    expect(parsed.planActive).toBe(true);
    expect(parsed.features.tiktok).toBe(false);
    expect(parsed.platforms.map((p) => p.channelType)).toEqual(['facebook_page', 'instagram']);
    expect(parsed.platforms[0]).toMatchObject({ used: 3, limit: 5, canAdd: true });
    // Không có mã quyền ở bất kỳ đâu.
    expect(JSON.stringify(res.body)).not.toMatch(/EAA|ciphertext|access_?token/i);
  });

  it('sắp xếp: kênh cần kết nối lại trước, rồi sắp hết hạn, rồi bình thường; `attention` liệt kê từng kênh', async () => {
    const parsed = OverviewResponse.parse(
      (await actors.owner.get('/api/v1/channels/overview')).body,
    );
    expect(parsed.connections.map((c) => c.state)).toEqual([
      'needs_reconnect',
      'expiring',
      'active',
    ]);
    expect(parsed.attention.map((a) => a.kind).sort()).toEqual(['expiring', 'needs_reconnect']);
    expect(new Set(parsed.attention.map((a) => a.connectionId))).toEqual(new Set([ids[1], ids[2]]));
  });

  it('cộng tác viên xem được (viewerCanManage=false) nhưng connect/recheck/DELETE ⇒ 403', async () => {
    const res = await actors.collaborator.get('/api/v1/channels/overview');
    expect(res.status).toBe(200);
    expect(OverviewResponse.parse(res.body).viewerCanManage).toBe(false);
    const id = ids[0] ?? '';
    expect(
      (await actors.collaborator.post('/api/v1/channels/connect', { channelType: 'facebook_page' }))
        .status,
    ).toBe(403);
    expect((await actors.collaborator.post(`/api/v1/channels/${id}/recheck`, {})).status).toBe(403);
    expect((await actors.collaborator.delete(`/api/v1/channels/${id}`)).status).toBe(403);
  });

  it('hiệu năng: 15 kết nối ⇒ overview ≤ 1 giây (T087)', async () => {
    // Thêm 12 kết nối Instagram "giữ chỗ" bằng SQL để có 15 dòng (3 Page + 12 Instagram).
    const accountId = actors.ownerMe.account.id;
    await asOwner(async (c) => {
      for (let i = 0; i < 12; i++) {
        await c.query(
          `INSERT INTO platform_gateway.channel_connections
             (id, account_id, channel_type, external_id, display_name, token_ciphertext, token_issued_at,
              expiry_kind, connected_at)
           VALUES (gen_random_uuid(), $1, 'instagram', $2, $3, $4, now(), 'none', now())`,
          [accountId, `perf-ig-${i}`, `Instagram ${i} ${'x'.repeat(100)}`, randomBytes(40)],
        );
      }
    });
    const started = performance.now();
    const res = await actors.owner.get('/api/v1/channels/overview');
    const elapsed = performance.now() - started;
    expect(res.status).toBe(200);
    expect(OverviewResponse.parse(res.body).connections).toHaveLength(15);
    expect(elapsed).toBeLessThan(1000);
  });

  it('chưa đăng nhập ⇒ 401', async () => {
    expect((await actors.anonymous.get('/api/v1/channels/overview')).status).toBe(401);
  });
});
