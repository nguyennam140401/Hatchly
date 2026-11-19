// 010 / US1 (T020) – hợp đồng kết nối Facebook của bộ chuyển đổi Meta: authorizeUrl, exchangeCallback, phân trang.
// Chạy trên máy chủ Graph giả (graph-stub); bí mật ứng dụng chỉ được phép nằm trong thân form, không bao giờ ở URL.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FacebookAdapter } from '../../src/modules/platform_gateway/internal/adapters/meta/facebook.adapter';
import { GraphClient } from '../../src/modules/platform_gateway/internal/adapters/meta/graph-client';
import { MetaOAuth } from '../../src/modules/platform_gateway/internal/adapters/meta/meta-oauth';
import { accountsPage, GraphStub, loadMetaConnectScenario } from './graph-stub';

const APP_SECRET = 'APP-SECRET-must-not-leak';
const REDIRECT = 'https://app.example.test/api/v1/channels/callback/facebook_page';
const stub = new GraphStub();
let baseUrl = '';

beforeAll(async () => {
  baseUrl = await stub.start();
});
afterAll(async () => {
  await stub.stop();
});
beforeEach(() => {
  stub.clear();
});

const make = (): FacebookAdapter => {
  const graph = new GraphClient({ baseUrl, version: 'v21.0', timeoutMs: 2000 }, 'FB');
  return new FacebookAdapter({
    client: graph,
    reconcile: false,
    videoMaxBytes: 1_000_000_000,
    oauth: new MetaOAuth({
      client: graph,
      appId: 'app-123',
      appSecret: APP_SECRET,
      dialogBaseUrl: 'https://www.facebook.test',
      version: 'v21.0',
      scopes: {
        facebook_page: ['pages_show_list', 'pages_manage_posts'],
        instagram: ['instagram_basic'],
      },
    }),
  });
};

describe('Facebook – kết nối kênh (010)', () => {
  it('authorizeUrl: đủ tham số, state nguyên văn, KHÔNG có client_secret', () => {
    const url = new URL(make().authorizeUrl('state-abc', REDIRECT));
    expect(url.origin + url.pathname).toBe('https://www.facebook.test/v21.0/dialog/oauth');
    expect(url.searchParams.get('client_id')).toBe('app-123');
    expect(url.searchParams.get('state')).toBe('state-abc');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('scope')).toBe('pages_show_list,pages_manage_posts');
    expect(url.searchParams.get('auth_type')).toBeNull();
    expect(url.toString()).not.toContain(APP_SECRET);
    expect(url.toString()).not.toContain('client_secret');
    const again = new URL(make().authorizeUrl('s', REDIRECT, { rerequest: true }));
    expect(again.searchParams.get('auth_type')).toBe('rerequest');
  });

  it('exchangeCallback: người dùng hủy ⇒ không có ứng viên, không gọi nền tảng', async () => {
    const r = await make().exchangeCallback({ error: 'access_denied', redirectUri: REDIRECT });
    expect(r.candidates).toEqual([]);
    expect(stub.requests).toHaveLength(0);
  });

  it('exchangeCallback: 2 Page ⇒ 2 ứng viên, mã Page + mã người dùng dài hạn + quyền đã cấp', async () => {
    loadMetaConnectScenario(stub, {
      pages: [
        { id: 'p1', name: 'Tiệm Hoa', accessToken: 'EAApage1' },
        { id: 'p2', name: 'Quán Cà Phê', accessToken: 'EAApage2' },
      ],
    });
    const { candidates } = await make().exchangeCallback({ code: 'code-1', redirectUri: REDIRECT });
    expect(candidates.map((c) => c.externalId)).toEqual(['p1', 'p2']);
    expect(candidates[0]).toMatchObject({
      displayName: 'Tiệm Hoa',
      accessToken: 'EAApage1',
      refreshToken: 'EAAlong_user_token',
      accountType: 'page',
    });
    expect(candidates[0]?.grantedScopes).toContain('pages_manage_posts');
    expect(stub.requests.every((r) => !r.url.includes(APP_SECRET))).toBe(true);
  });

  it('exchangeCallback: phân trang > 1 trang ⇒ gộp đủ Page của mọi trang', async () => {
    stub.on(
      'POST /oauth/access_token',
      { json: { access_token: 'EAAshort' } },
      { json: { access_token: 'EAAlong' } },
    );
    stub.on(
      'GET /me/accounts',
      accountsPage([{ id: 'p1', name: 'Một', accessToken: 'EAA1' }], 'cursor-2'),
      accountsPage([{ id: 'p2', name: 'Hai', accessToken: 'EAA2' }]),
    );
    stub.on('POST /debug_token', {
      json: { data: { is_valid: true, expires_at: 0, data_access_expires_at: 0, scopes: [] } },
    });
    const { candidates } = await make().exchangeCallback({ code: 'c', redirectUri: REDIRECT });
    expect(candidates.map((c) => c.externalId)).toEqual(['p1', 'p2']);
    expect(stub.requests.filter((r) => r.url.includes('me/accounts'))).toHaveLength(2);
    expect(stub.requests.some((r) => r.url.includes('after=cursor-2'))).toBe(true);
  });
});
