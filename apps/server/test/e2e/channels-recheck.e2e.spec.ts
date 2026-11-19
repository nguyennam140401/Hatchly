// 010 T037 (US3, FR-011/FR-012): `POST /channels/:id/recheck` trên bộ chuyển đổi Meta THẬT + Graph giả cục bộ –
// giới hạn tần suất bằng cập nhật có điều kiện, lỗi tạm thời/mã lạ không đổi trạng thái, kết luận khẳng định mới đổi.
import { randomBytes } from 'node:crypto';
import { RecheckResponse } from '@app/shared/platform_gateway';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { asOwner, describeDb } from '../db/helpers/db';
import { createActors, type Actors } from '../auth/helpers/actors';
import { createTestApp, type TestApp } from '../auth/helpers/app';
import { clearAdapters } from '../../src/modules/platform_gateway/internal/adapters/registry';
import {
  DEFAULT_GRANTED_SCOPES,
  graphError,
  GraphStub,
  loadMetaConnectScenario,
} from '../platform-gateway/graph-stub';

const PAGE = 'page-recheck-1';
const stub = new GraphStub();

describeDb('Kiểm tra lại kênh – HTTP (010 US3)', () => {
  let t: TestApp;
  let actors: Actors;
  let connectionId = '';

  const okPage = () => ({ json: { id: PAGE, tasks: ['CREATE_CONTENT', 'MANAGE'] } });
  const okDebug = (scopes: string[] = DEFAULT_GRANTED_SCOPES) => ({
    json: { data: { is_valid: true, expires_at: 0, data_access_expires_at: 0, scopes } },
  });

  const resetCooldown = () =>
    asOwner((c) =>
      c.query(
        'UPDATE platform_gateway.channel_connections SET last_manual_check_at = NULL WHERE id = $1',
        [connectionId],
      ),
    );

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

    // Kết nối một Page thật qua luồng OAuth (Graph giả).
    loadMetaConnectScenario(stub, {
      pages: [{ id: PAGE, name: 'Tiệm Hoa', accessToken: 'EAApage-recheck' }],
    });
    for (let i = 0; i < 6; i++) {
      stub.on(`GET /${PAGE}`, okPage());
      stub.on('POST /debug_token', okDebug());
    }
    const start = await actors.owner.post('/api/v1/channels/connect', {
      channelType: 'facebook_page',
    });
    const authorizeUrl = (start.body as { authorizeUrl: string }).authorizeUrl;
    const state = new URL(authorizeUrl).searchParams.get('state') ?? '';
    const cb = await actors.owner.get(
      `/api/v1/channels/callback/facebook_page?state=${encodeURIComponent(state)}&code=c`,
    );
    const selectionId = new URL(cb.headers.location ?? '', 'http://x').pathname.split('/').pop();
    const confirm = await actors.owner.post(`/api/v1/channels/selections/${selectionId}/confirm`, {
      externalIds: [PAGE],
    });
    expect(confirm.status).toBe(200);
    connectionId =
      (confirm.body as { results: { connection?: { connectionId: string } }[] }).results[0]
        ?.connection?.connectionId ?? '';
    expect(connectionId).not.toBe('');
  });
  afterAll(async () => {
    await t.close();
    await stub.stop();
    clearAdapters();
  });
  beforeEach(async () => {
    await resetCooldown();
    await asOwner((c) =>
      c.query(
        `UPDATE platform_gateway.channel_connections
            SET status = 'active', reason_code = NULL, last_error_code = NULL WHERE id = $1`,
        [connectionId],
      ),
    );
    stub.clear();
  });

  const recheck = (agent = actors.owner) =>
    agent.post(`/api/v1/channels/${connectionId}/recheck`, {});
  const row = () =>
    asOwner(async (c) => {
      const r = await c.query<{ s: string; l: Date | null }>(
        'SELECT status AS s, last_checked_at AS l FROM platform_gateway.channel_connections WHERE id = $1',
        [connectionId],
      );
      return r.rows[0];
    });

  it('cộng tác viên không kiểm tra lại được (403)', async () => {
    expect((await recheck(actors.collaborator)).status).toBe(403);
  });

  it('còn đủ điều kiện ⇒ 200 ok; lần hai trong thời gian giãn cách ⇒ 429 RECHECK_TOO_SOON', async () => {
    stub.on(`GET /${PAGE}`, okPage());
    stub.on('POST /debug_token', okDebug());
    const first = await recheck();
    expect(first.status).toBe(200);
    const parsed = RecheckResponse.parse(first.body);
    expect(parsed.result).toBe('ok');
    expect(parsed.connection.state).toBe('active');

    const again = await recheck();
    expect(again.status).toBe(429);
    expect((again.body as { error: { code: string } }).error.code).toBe('RECHECK_TOO_SOON');
    expect(
      (again.body as { error: { retryAfterSeconds?: number } }).error.retryAfterSeconds,
    ).toBeGreaterThanOrEqual(1);
  });

  it('nền tảng 503 hoặc mã lạ ⇒ 200 unavailable, KHÔNG đổi trạng thái, không cập nhật last_checked_at', async () => {
    const before = await row();
    stub.on(`GET /${PAGE}`, { status: 503, json: {} });
    const a = await recheck();
    expect(a.status).toBe(200);
    expect(RecheckResponse.parse(a.body).result).toBe('unavailable');

    await resetCooldown();
    stub.clear();
    stub.on(`GET /${PAGE}`, graphError(999999));
    const b = await recheck();
    expect(RecheckResponse.parse(b.body).result).toBe('unavailable');

    const after = await row();
    expect(after?.s).toBe(before?.s);
    expect(after?.l?.getTime()).toBe(before?.l?.getTime());
  });

  it('vai trò thấp ⇒ changed → ineligible kèm hành động; đủ lại ⇒ changed → active', async () => {
    stub.on(`GET /${PAGE}`, { json: { id: PAGE, tasks: ['ANALYZE'] } });
    stub.on('POST /debug_token', okDebug());
    const bad = RecheckResponse.parse((await recheck()).body);
    expect(bad.result).toBe('changed');
    expect(bad.connection.state).toBe('ineligible');
    expect(bad.connection.actionsVi.length).toBeGreaterThanOrEqual(1);
    expect((await row())?.s).toBe('ineligible');

    await resetCooldown();
    stub.clear();
    stub.on(`GET /${PAGE}`, okPage());
    stub.on('POST /debug_token', okDebug());
    const good = RecheckResponse.parse((await recheck()).body);
    expect(good.result).toBe('changed');
    expect(good.connection.state).toBe('active');
  });

  it('thiếu quyền bắt buộc ⇒ changed → needs_reconnect (cấp lại quyền)', async () => {
    stub.on(`GET /${PAGE}`, okPage());
    stub.on('POST /debug_token', okDebug(['pages_show_list']));
    const r = RecheckResponse.parse((await recheck()).body);
    expect(r.result).toBe('changed');
    expect(r.connection.state).toBe('needs_reconnect');
    expect(r.connection.reasonCode).toBe('SCOPE_MISSING');
  });

  it('mã hết hạn/bị thu hồi (190) ⇒ changed → needs_reconnect', async () => {
    stub.on(`GET /${PAGE}`, graphError(190, undefined, 401));
    const r = RecheckResponse.parse((await recheck()).body);
    expect(r.result).toBe('changed');
    expect(r.connection.state).toBe('needs_reconnect');
  });
});
