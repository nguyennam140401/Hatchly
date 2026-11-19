// 010 T031 (US4, SC-003, hiến pháp VII): sau chuỗi kết nối → kiểm tra lại → ngắt, KHÔNG nơi nào lộ mã quyền/bí mật:
// phản hồi HTTP (thân + tiêu đề), nhật ký có cấu trúc, kiểm toán, dữ liệu việc nền, địa chỉ gọi ra Graph; bản mã thô trong
// CSDL không giải mã được nếu thiếu khóa và không chứa bản rõ.
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { asOwner, describeDb } from '../db/helpers/db';
import { createActors, type Actors } from '../auth/helpers/actors';
import { createTestApp, type TestApp } from '../auth/helpers/app';
import { clearAdapters } from '../../src/modules/platform_gateway/internal/adapters/registry';
import { credentialAad } from '../../src/modules/platform_gateway/internal/vault/credential-vault';
import { EnvMasterKeyWrapper } from '../../src/modules/platform_gateway/internal/vault/env-master-key.wrapper';
import { KmsCredentialVault } from '../../src/modules/platform_gateway/internal/vault/kms-credential-vault';
import {
  DEFAULT_GRANTED_SCOPES,
  GraphStub,
  loadMetaConnectScenario,
} from '../platform-gateway/graph-stub';

const PAGE = 'page-secret-1';
const PAGE_TOKEN = 'EAApage-secret-scan-0001';
const APP_SECRET = 'APP-SECRET-scan';
// Mẫu bí mật: mã Meta (EAA…), mã TikTok (act.…), mã giả của bản fake, tên tham số nhạy cảm, bí mật ứng dụng.
const PATTERNS: RegExp[] = [
  /EAA[\w-]{4,}/,
  /act\.[\w.-]{6,}/,
  /fake_tok_/,
  /client_secret/i,
  /fb_exchange_token/i,
  /APP-SECRET/,
  /EAAlong_user_token/,
];

const stub = new GraphStub();

const hits = (label: string, text: string): string[] =>
  PATTERNS.filter((p) => p.test(text)).map((p) => `${label}: khớp ${String(p)}`);

describeDb('Quét bí mật sau luồng kết nối kênh (010 SC-003)', () => {
  let t: TestApp;
  let actors: Actors;
  const masterKey = randomBytes(32).toString('base64');
  const seen: string[] = [];
  let connectionId = '';
  let accountId = '';

  /** Ghi lại thân + tiêu đề của mọi phản hồi để quét. */
  const track = async <T extends { status: number; headers: unknown; body: unknown; text?: string }>(
    p: Promise<T>,
  ): Promise<T> => {
    const r = await p;
    seen.push(JSON.stringify({ status: r.status, headers: r.headers, body: r.body, text: r.text }));
    return r;
  };

  beforeAll(async () => {
    const baseUrl = await stub.start();
    clearAdapters();
    t = await createTestApp({
      env: {
        PLATFORM_GATEWAY_DRIVER: 'real',
        PLATFORM_ADAPTER_MODE: 'real',
        META_GRAPH_BASE_URL: baseUrl,
        FACEBOOK_APP_ID: 'app-123',
        FACEBOOK_APP_SECRET: APP_SECRET,
        CREDENTIAL_VAULT_DRIVER: 'env-master-key',
        CREDENTIAL_MASTER_KEY_B64: masterKey,
      },
    });
    actors = await createActors(t);
    accountId = actors.ownerMe.account.id;
  });
  afterAll(async () => {
    await t.close();
    await stub.stop();
    clearAdapters();
  });

  it('chạy trọn luồng: kết nối → xác nhận → tổng quan → kiểm tra lại → ngắt', async () => {
    loadMetaConnectScenario(stub, {
      pages: [{ id: PAGE, name: 'Tiệm Hoa', accessToken: PAGE_TOKEN }],
    });
    for (let i = 0; i < 6; i++) {
      stub.on(`GET /${PAGE}`, { json: { id: PAGE, tasks: ['CREATE_CONTENT', 'MANAGE'] } });
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
    const start = await track(
      actors.owner.post('/api/v1/channels/connect', { channelType: 'facebook_page' }),
    );
    const state =
      new URL((start.body as { authorizeUrl: string }).authorizeUrl).searchParams.get('state') ?? '';
    const cb = await track(
      actors.owner.get(
        `/api/v1/channels/callback/facebook_page?state=${encodeURIComponent(state)}&code=c`,
      ),
    );
    const selectionId = new URL(cb.headers.location ?? '', 'http://x').pathname.split('/').pop();
    await track(actors.owner.get(`/api/v1/channels/selections/${selectionId}`));
    const confirm = await track(
      actors.owner.post(`/api/v1/channels/selections/${selectionId}/confirm`, {
        externalIds: [PAGE],
      }),
    );
    connectionId =
      (confirm.body as { results: { connection?: { connectionId: string } }[] }).results[0]
        ?.connection?.connectionId ?? '';
    expect(connectionId).not.toBe('');

    await track(actors.owner.get('/api/v1/channels/overview'));
    await track(actors.owner.get('/api/v1/channels'));
    await track(actors.owner.post(`/api/v1/channels/${connectionId}/recheck`, {}));
    await track(actors.support.get(
      `/api/v1/staff/accounts/${accountId}/channels?reason=${encodeURIComponent('Khách báo lỗi kênh')}`,
    ));
  });

  it('phản hồi HTTP (thân + tiêu đề) không chứa mã quyền/bí mật', () => {
    expect(seen.length).toBeGreaterThan(5);
    expect(seen.flatMap((s) => hits('http', s))).toEqual([]);
  });

  it('nhật ký có cấu trúc không chứa mã quyền/bí mật', () => {
    expect(t.rawLogs.length).toBeGreaterThan(0);
    expect(hits('log', t.rawLogs.join('\n'))).toEqual([]);
  });

  it('địa chỉ gọi ra Graph không chứa mã quyền/bí mật (mã chỉ trong tiêu đề/thân)', () => {
    expect(stub.requests.length).toBeGreaterThan(0);
    expect(stub.requests.flatMap((r) => hits('url', r.url))).toEqual([]);
  });

  it('kiểm toán + dữ liệu việc nền không chứa mã quyền/bí mật', async () => {
    const audit = await asOwner(async (c) =>
      (
        await c.query<{ j: string }>(
          `SELECT (metadata::text || coalesce(reason, '')) AS j FROM infra.audit_log WHERE account_id = $1`,
          [accountId],
        )
      ).rows.map((r) => r.j),
    );
    expect(audit.flatMap((s) => hits('audit', s))).toEqual([]);
    const jobs = await asOwner(async (c) => {
      try {
        return (await c.query<{ d: string }>('SELECT data::text AS d FROM pgboss.job')).rows;
      } catch {
        return []; // chưa có bảng việc nền trong CSDL thử nghiệm
      }
    });
    expect(jobs.flatMap((r) => hits('job', r.d))).toEqual([]);
  });

  it('bản mã thô: không chứa bản rõ; thiếu khóa/AAD sai thì không giải mã được; đúng khóa + AAD thì được', async () => {
    const row = await asOwner(async (c) => {
      const r = await c.query<{ ct: Buffer; ext: string }>(
        `SELECT token_ciphertext AS ct, external_id AS ext FROM platform_gateway.channel_connections WHERE id = $1`,
        [connectionId],
      );
      return r.rows[0];
    });
    expect(row).toBeDefined();
    const ct = row!.ct;
    expect(ct.toString('utf8')).not.toContain(PAGE_TOKEN);
    expect(ct.toString('latin1')).not.toContain(PAGE_TOKEN);

    const aad = credentialAad(accountId, 'token', 'facebook_page', row!.ext);
    const wrongKey = new KmsCredentialVault(new EnvMasterKeyWrapper(randomBytes(32).toString('base64')));
    await expect(wrongKey.decrypt(ct, aad)).rejects.toThrow('VAULT_');
    const rightKey = new KmsCredentialVault(new EnvMasterKeyWrapper(masterKey));
    await expect(
      rightKey.decrypt(ct, credentialAad(accountId, 'token', 'facebook_page', 'page-khac')),
    ).rejects.toThrow('VAULT_');
    await expect(rightKey.decrypt(ct, aad)).resolves.toBeDefined();
  });

  it('ngắt kết nối xong, phản hồi/nhật ký sau đó vẫn sạch', async () => {
    const del = await track(actors.owner.delete(`/api/v1/channels/${connectionId}`));
    expect(del.status).toBe(204);
    expect(seen.flatMap((s) => hits('http', s))).toEqual([]);
    expect(hits('log', t.rawLogs.join('\n'))).toEqual([]);
  });
});
