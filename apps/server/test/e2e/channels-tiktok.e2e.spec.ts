// 010 T076/T077 (US9, FR-036…FR-039, SC-011): công tắc TikTok theo khách hàng trên HTTP thật + bộ chuyển đổi TikTok thật + máy chủ giả.
// Tắt ⇒ 403 FEATURE_NOT_ENABLED và 0 lời gọi mạng; admin bật ⇒ kết nối được; tắt lại ⇒ `suspended` (chỉ xem/ngắt); mỗi lần đổi có
// đúng một dòng nhật ký công tắc + một dòng kiểm toán; chủ/CTV/support không đổi được.
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { asOwner, describeDb } from '../db/helpers/db';
import { createActors, type Actors } from '../auth/helpers/actors';
import { createTestApp, type TestApp } from '../auth/helpers/app';
import { clearAdapters } from '../../src/modules/platform_gateway/internal/adapters/registry';
import { TiktokStub } from '../platform-gateway/tiktok-stub';

const stub = new TiktokStub();

describeDb('Công tắc TikTok theo khách hàng (010 US9)', () => {
  let t: TestApp;
  let actors: Actors;
  let accountId = '';

  const url = () => `/api/v1/staff/accounts/${accountId}/features/channel.tiktok`;
  const connect = () => actors.owner.post('/api/v1/channels/connect', { channelType: 'tiktok' });
  const overview = async () =>
    (await actors.owner.get('/api/v1/channels/overview')).body as {
      features: { tiktok: boolean };
      platforms: { channelType: string }[];
      connections: { channelType: string; state: string; connectionId: string }[];
    };

  beforeAll(async () => {
    const baseUrl = await stub.start();
    clearAdapters();
    t = await createTestApp({
      env: {
        PLATFORM_GATEWAY_DRIVER: 'real',
        PLATFORM_ADAPTER_MODE: 'real',
        CREDENTIAL_VAULT_DRIVER: 'env-master-key',
        CREDENTIAL_MASTER_KEY_B64: randomBytes(32).toString('base64'),
        TIKTOK_CLIENT_KEY: 'tt-key',
        TIKTOK_CLIENT_SECRET: 'TT-SECRET',
        TIKTOK_BASE_URL: baseUrl,
      },
    });
    actors = await createActors(t);
    accountId = actors.ownerMe.account.id;
    stub.loadConnectScenario();
  });
  afterAll(async () => {
    await t.close();
    await stub.stop();
    clearAdapters();
  });

  it('công tắc tắt ⇒ 403 FEATURE_NOT_ENABLED ở connect/recheck, overview không có TikTok, 0 lời gọi mạng', async () => {
    const res = await connect();
    expect(res.status).toBe(403);
    expect((res.body as { error: { code: string } }).error.code).toBe('FEATURE_NOT_ENABLED');
    expect(
      (await actors.owner.post(`/api/v1/channels/${crypto.randomUUID()}/recheck`, {})).status,
    ).toBe(404);
    const ov = await overview();
    expect(ov.features.tiktok).toBe(false);
    expect(ov.platforms.map((p) => p.channelType)).not.toContain('tiktok');
    expect(stub.callCount).toBe(0);
  });

  it('chủ, cộng tác viên, hỗ trợ KHÔNG đổi được công tắc (403); thiếu lý do ⇒ 400, không đổi gì', async () => {
    expect((await actors.support.put(url(), { value: 'on', reason: 'thử nghiệm' })).status).toBe(
      403,
    );
    for (const who of [actors.owner, actors.collaborator, actors.support]) {
      const r = await who.put(url(), { value: 'on', reason: 'thử nghiệm' });
      expect([401, 403]).toContain(r.status); // khách hàng không có phiên nhân viên ⇒ 401; nhân viên hỗ trợ thiếu quyền ⇒ 403
    }
    const bad = await actors.admin.put(url(), { value: 'on' });
    expect(bad.status).toBe(400);
    expect((await overview()).features.tiktok).toBe(false);
  });

  it('admin bật cho tài khoản ⇒ kết nối được, có đúng 1 dòng nhật ký công tắc + 1 dòng kiểm toán', async () => {
    const set = await actors.admin.put(url(), { value: 'on', reason: 'Khách thử nghiệm TikTok' });
    expect(set.status).toBe(200);
    expect((set.body as { old: string }).old).toBe('default');

    const events = await asOwner(
      async (c) =>
        (
          await c.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM platform_gateway.feature_override_events WHERE account_id = $1`,
            [accountId],
          )
        ).rows[0]?.n,
    );
    expect(events).toBe(1);
    const audit = await asOwner(
      async (c) =>
        (
          await c.query<{ metadata: Record<string, unknown> }>(
            `SELECT metadata FROM infra.audit_log WHERE account_id = $1 AND action = 'feature.set'`,
            [accountId],
          )
        ).rows,
    );
    expect(audit).toHaveLength(1);
    expect(Object.keys(audit[0]?.metadata ?? {}).sort()).toEqual([
      'flag',
      'new',
      'old',
      'reason_len',
    ]);
    expect(JSON.stringify(audit)).not.toContain('Khách thử nghiệm'); // không chép lại lý do vào kiểm toán

    expect((await overview()).features.tiktok).toBe(true);
    const start = await connect();
    expect(start.status).toBe(200);
    const authorize = new URL((start.body as { authorizeUrl: string }).authorizeUrl);
    expect(authorize.hostname).toBe('www.tiktok.com');
    expect(authorize.searchParams.get('client_key')).toBe('tt-key');
    expect(authorize.toString()).not.toContain('TT-SECRET');
  });

  it('kết nối trọn luồng khi bật; tắt lại ⇒ suspended, ngắt được, kiểm tra lại bị chặn', async () => {
    const start = await connect();
    const state =
      new URL((start.body as { authorizeUrl: string }).authorizeUrl).searchParams.get('state') ??
      '';
    const cb = await actors.owner.get(
      `/api/v1/channels/callback/tiktok?state=${encodeURIComponent(state)}&code=tt-code`,
    );
    const selectionId = new URL(cb.headers.location ?? '', 'http://x').pathname.split('/').pop();
    const confirm = await actors.owner.post(`/api/v1/channels/selections/${selectionId}/confirm`, {
      externalIds: ['tt-open-1'],
    });
    expect(confirm.status).toBe(200);
    const id =
      (confirm.body as { results: { connection?: { connectionId: string } }[] }).results[0]
        ?.connection?.connectionId ?? '';
    expect(id).not.toBe('');
    // Bí mật OAuth chỉ trong THÂN form, không bao giờ trong URL.
    for (const req of stub.requests) {
      expect(req.url).not.toContain('TT-SECRET');
      expect(req.url).not.toContain('tt-code');
    }

    const off = await actors.admin.put(url(), { value: 'off', reason: 'Tạm tắt để kiểm thử' });
    expect(off.status).toBe(200);
    const ov = await overview();
    expect(ov.features.tiktok).toBe(false);
    expect(ov.connections.find((c) => c.connectionId === id)?.state).toBe('suspended');

    const before = stub.callCount;
    expect((await actors.owner.post(`/api/v1/channels/${id}/recheck`, {})).status).toBe(403);
    expect(stub.callCount).toBe(before); // 0 lời gọi mạng khi tắt
    const del = await actors.owner.delete(`/api/v1/channels/${id}`);
    expect(del.status).toBe(200); // vẫn ngắt được
  });

  it('đổi MẶC ĐỊNH: khách không ghi đè thấy TikTok, khách ghi đè off vẫn không; trả lại mặc định tắt', async () => {
    const off = await actors.admin.put(url(), { value: 'off', reason: 'Khách chọn tắt hẳn' });
    expect(off.status).toBe(200);
    const on = await actors.admin.put('/api/v1/staff/features/channel.tiktok/default', {
      value: 'on',
      reason: 'TikTok đã duyệt ứng dụng',
    });
    expect(on.status).toBe(200);
    expect((await overview()).features.tiktok).toBe(false); // ghi đè off thắng mặc định bật

    const back = await actors.admin.put(url(), {
      value: 'default',
      reason: 'Theo mặc định hệ thống',
    });
    expect(back.status).toBe(200);
    expect((await overview()).features.tiktok).toBe(true); // theo mặc định đã bật

    const reset = await actors.admin.put('/api/v1/staff/features/channel.tiktok/default', {
      value: 'off',
      reason: 'Hoàn trả mặc định sau kiểm thử',
    });
    expect(reset.status).toBe(200);
    expect((await overview()).features.tiktok).toBe(false);
  });
});
