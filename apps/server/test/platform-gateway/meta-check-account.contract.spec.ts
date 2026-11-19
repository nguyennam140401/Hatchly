// 010 / US2 + US3 (T036, T042) – hợp đồng kết nối Instagram và `checkAccount` của Facebook/Instagram trên Graph giả.
// Mỗi ca "không đủ điều kiện" PHẢI cho đúng một mã lý do + ≥ 1 hành động khắc phục (FR-009); lỗi tạm thời/mã lạ KHÔNG
// được coi là kết luận khẳng định (FR-012).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FacebookAdapter } from '../../src/modules/platform_gateway/internal/adapters/meta/facebook.adapter';
import { GraphClient } from '../../src/modules/platform_gateway/internal/adapters/meta/graph-client';
import {
  InstagramAdapter,
  UNLINKED_PREFIX,
} from '../../src/modules/platform_gateway/internal/adapters/meta/instagram.adapter';
import { MetaOAuth } from '../../src/modules/platform_gateway/internal/adapters/meta/meta-oauth';
import {
  FakeCredentialVault,
  type DecryptedCredential,
} from '../../src/modules/platform_gateway/internal/vault/credential-vault';
import {
  DEFAULT_GRANTED_SCOPES,
  graphError,
  GraphStub,
  loadMetaConnectScenario,
} from './graph-stub';

const REDIRECT = 'https://app.example.test/api/v1/channels/callback/instagram';
const stub = new GraphStub();
let baseUrl = '';
let cred: DecryptedCredential;

beforeAll(async () => {
  baseUrl = await stub.start();
  const vault = new FakeCredentialVault();
  cred = await vault.decrypt(await vault.encrypt('EAApage-secret', 'aad'), 'aad');
});
afterAll(async () => {
  await stub.stop();
});
beforeEach(() => {
  stub.clear();
});

const graph = () => new GraphClient({ baseUrl, version: 'v21.0', timeoutMs: 2000 }, 'FB');
const oauth = () =>
  new MetaOAuth({
    client: graph(),
    appId: 'app-123',
    appSecret: 'APP-SECRET',
    dialogBaseUrl: 'https://www.facebook.test',
    version: 'v21.0',
    scopes: {
      facebook_page: ['pages_show_list', 'pages_manage_posts'],
      instagram: ['instagram_basic', 'instagram_content_publish', 'pages_show_list'],
    },
  });
const facebook = () =>
  new FacebookAdapter({ client: graph(), reconcile: false, videoMaxBytes: 1e9, oauth: oauth() });
const instagram = () =>
  new InstagramAdapter({
    client: new GraphClient({ baseUrl, version: 'v21.0', timeoutMs: 2000 }, 'IG'),
    reconcile: false,
    oauth: oauth(),
  });

const debugOk = (scopes: string[] = DEFAULT_GRANTED_SCOPES, expiresAt = 0) =>
  ({
    json: {
      data: { is_valid: true, expires_at: expiresAt, data_access_expires_at: 0, scopes },
    },
  }) as const;

describe('Facebook.checkAccount (US3)', () => {
  const ctx = { connectionId: 'c1', externalId: 'page-1' };

  it('đủ quyền + vai trò + Page tồn tại ⇒ eligible, hạn mức không biết (null), không có hạn cố định ⇒ expiry none', async () => {
    stub.on('GET /page-1', { json: { id: 'page-1', tasks: ['CREATE_CONTENT', 'MANAGE'] } });
    stub.on('POST /debug_token', debugOk());
    const r = await facebook().checkAccount(cred, ctx);
    expect(r.kind).toBe('eligible');
    if (r.kind !== 'eligible') return;
    expect(r.quotaRemaining).toBeNull();
    expect(r.expiry).toEqual({ kind: 'none' });
    expect(r.grantedScopes).toContain('pages_manage_posts');
  });

  it('thiếu quyền bắt buộc ⇒ SCOPE_MISSING + hành động', async () => {
    stub.on('GET /page-1', { json: { id: 'page-1', tasks: ['CREATE_CONTENT'] } });
    stub.on('POST /debug_token', debugOk(['pages_show_list']));
    const r = await facebook().checkAccount(cred, ctx);
    expect(r.kind).toBe('ineligible');
    if (r.kind !== 'ineligible') return;
    expect(r.error.rawCode).toBe('FB:SCOPE_MISSING');
    expect(r.error.category).toBe('user_action');
    expect(r.error.remedies.length).toBeGreaterThanOrEqual(1);
  });

  it('vai trò thấp (thiếu CREATE_CONTENT) ⇒ ROLE_TOO_LOW + hành động', async () => {
    stub.on('GET /page-1', { json: { id: 'page-1', tasks: ['ANALYZE'] } });
    stub.on('POST /debug_token', debugOk());
    const r = await facebook().checkAccount(cred, ctx);
    expect(r.kind === 'ineligible' && r.error.rawCode).toBe('FB:ROLE_TOO_LOW');
    expect(r.kind === 'ineligible' && r.error.remedies.length).toBeGreaterThanOrEqual(1);
  });

  it('Page đã bị xóa ⇒ PAGE_UNAVAILABLE + hành động', async () => {
    stub.on('GET /page-1', graphError(100, 33));
    const r = await facebook().checkAccount(cred, ctx);
    expect(r.kind === 'ineligible' && r.error.rawCode).toBe('FB:PAGE_UNAVAILABLE');
    expect(r.kind === 'ineligible' && r.error.remedies.length).toBeGreaterThanOrEqual(1);
  });

  it('mã hết hạn/bị thu hồi (190) ⇒ cần người dùng kết nối lại', async () => {
    stub.on('GET /page-1', graphError(190, undefined, 401));
    const r = await facebook().checkAccount(cred, ctx);
    expect(r.kind).toBe('ineligible');
    expect(r.kind === 'ineligible' && r.error.category).toBe('user_action');
  });

  it('lỗi 5xx/mã lạ ⇒ KHÔNG phải kết luận khẳng định (không user_action) để bên gọi giữ nguyên trạng thái kênh', async () => {
    stub.on('GET /page-1', { status: 503, json: {} });
    const r = await facebook().checkAccount(cred, ctx);
    expect(r.kind).toBe('ineligible');
    expect(r.kind === 'ineligible' && r.error.category).not.toBe('user_action');
    stub.clear();
    stub.on('GET /page-1', graphError(999999));
    const r2 = await facebook().checkAccount(cred, ctx);
    expect(r2.kind === 'ineligible' && r2.error.category).not.toBe('user_action');
  });

  it('hạn: còn mốc ⇒ lấy mốc SỚM hơn của hết hạn mã và hết hạn truy cập dữ liệu, kèm kind', async () => {
    const soon = Math.floor(Date.now() / 1000) + 10 * 86_400;
    const later = soon + 30 * 86_400;
    stub.on('POST /debug_token', {
      json: {
        data: { is_valid: true, expires_at: later, data_access_expires_at: soon, scopes: [] },
      },
    });
    const e = await facebook().expiryOf(cred);
    expect(e.kind).toBe('data_access');
    expect(e.kind !== 'none' && Math.floor(e.expiresAt.getTime() / 1000)).toBe(soon);
  });
});

describe('InstagramAdapter – kết nối (US2)', () => {
  const ctx = { connectionId: 'c1', externalId: 'ig-1' };

  it('authorizeUrl dùng nhóm quyền Instagram, không có client_secret', () => {
    const url = new URL(instagram().authorizeUrl('st', REDIRECT));
    expect(url.searchParams.get('scope')).toBe(
      'instagram_basic,instagram_content_publish,pages_show_list',
    );
    expect(url.toString()).not.toContain('APP-SECRET');
  });

  it('exchangeCallback: Page có IG ⇒ ứng viên IG (@username, sourceExternalId = Page); Page không IG ⇒ ứng viên giữ chỗ', async () => {
    loadMetaConnectScenario(stub, {
      pages: [
        {
          id: 'p1',
          name: 'Tiệm Hoa',
          accessToken: 'EAApage1',
          instagram: { id: 'ig-1', username: 'tiemhoa' },
        },
        { id: 'p2', name: 'Quán Cà Phê', accessToken: 'EAApage2' },
      ],
    });
    const { candidates } = await instagram().exchangeCallback({ code: 'c', redirectUri: REDIRECT });
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      externalId: 'ig-1',
      displayName: '@tiemhoa',
      sourceExternalId: 'p1',
      accessToken: 'EAApage1',
      refreshToken: 'EAAlong_user_token',
    });
    expect(candidates[1]).toMatchObject({
      externalId: `${UNLINKED_PREFIX}p2`,
      sourceExternalId: 'p2',
      accessToken: '', // không giữ mã quyền cho ứng viên không kết nối được
    });
  });

  it('Page chưa liên kết ⇒ checkAccount kết luận PAGE_NOT_LINKED mà KHÔNG gọi nền tảng', async () => {
    const r = await instagram().checkAccount(cred, {
      connectionId: 'c',
      externalId: `${UNLINKED_PREFIX}p2`,
    });
    expect(r.kind === 'ineligible' && r.error.rawCode).toBe('IG:PAGE_NOT_LINKED');
    expect(r.kind === 'ineligible' && r.error.remedies.length).toBeGreaterThanOrEqual(1);
    expect(stub.requests).toHaveLength(0);
  });

  it('IG chuyên nghiệp (BUSINESS | MEDIA_CREATOR) ⇒ eligible; IG cá nhân ⇒ NOT_PROFESSIONAL + hành động', async () => {
    for (const type of ['BUSINESS', 'MEDIA_CREATOR']) {
      stub.clear();
      stub.on('GET /ig-1', { json: { id: 'ig-1', username: 'u', account_type: type } });
      stub.on('POST /debug_token', debugOk());
      const r = await instagram().checkAccount(cred, ctx);
      expect(r.kind).toBe('eligible');
    }
    stub.clear();
    stub.on('GET /ig-1', { json: { id: 'ig-1', username: 'u', account_type: 'PERSONAL' } });
    const personal = await instagram().checkAccount(cred, ctx);
    expect(personal.kind === 'ineligible' && personal.error.rawCode).toBe('IG:NOT_PROFESSIONAL');
    expect(personal.kind === 'ineligible' && personal.error.remedies.length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it('thiếu quyền Instagram ⇒ SCOPE_MISSING; hạn mức đăng 24 giờ ⇒ quotaRemaining', async () => {
    stub.on('GET /ig-1', { json: { id: 'ig-1', username: 'u', account_type: 'BUSINESS' } });
    stub.on('POST /debug_token', debugOk(['instagram_basic']));
    const miss = await instagram().checkAccount(cred, ctx);
    expect(miss.kind === 'ineligible' && miss.error.rawCode).toBe('IG:SCOPE_MISSING');

    stub.clear();
    stub.on('GET /ig-1', { json: { id: 'ig-1', username: 'u', account_type: 'BUSINESS' } });
    stub.on('GET /content_publishing_limit', {
      json: { data: [{ quota_usage: 4, config: { quota_total: 25 } }] },
    });
    stub.on('POST /debug_token', debugOk());
    const ok = await instagram().checkAccount(cred, ctx);
    expect(ok.kind === 'eligible' && ok.quotaRemaining).toBe(21);
  });

  it('revoke ⇒ unsupported (không thu hồi quyền người dùng dùng chung với Facebook), không ném', async () => {
    await expect(instagram().revoke()).resolves.toBe('unsupported');
  });
});

describe('renewToken – làm mới quyền Meta (T061)', () => {
  const ctxFb = { connectionId: 'c1', externalId: 'page-1' };

  it('Facebook: đổi lại mã người dùng dài hạn → lấy lại mã Page → đo hạn mới; bí mật không vào URL', async () => {
    stub.on('POST /oauth/access_token', {
      json: { access_token: 'EAAnew_user', expires_in: 5_184_000 },
    });
    stub.on('GET /me/accounts', {
      json: {
        data: [
          {
            id: 'page-1',
            name: 'Tiệm Hoa',
            access_token: 'EAAnew_page',
            tasks: ['CREATE_CONTENT'],
          },
        ],
      },
    });
    stub.on(
      'POST /debug_token',
      debugOk(DEFAULT_GRANTED_SCOPES, Math.floor(Date.now() / 1000) + 40 * 86_400),
    );
    const r = await facebook().renewToken(cred, ctxFb);
    expect(r.kind).toBe('renewed');
    if (r.kind !== 'renewed') return;
    expect(r.accessToken).toBe('EAAnew_page');
    expect(r.refreshToken).toBe('EAAnew_user');
    expect(r.expiry.kind).toBe('token');
    for (const req of stub.requests) {
      expect(req.url).not.toContain('APP-SECRET');
      expect(req.url).not.toContain('fb_exchange_token');
    }
  });

  it('Facebook: Page không còn trong danh sách ⇒ failed user_action (cần kết nối lại)', async () => {
    stub.on('POST /oauth/access_token', { json: { access_token: 'EAAnew_user' } });
    stub.on('GET /me/accounts', { json: { data: [] } });
    const r = await facebook().renewToken(cred, ctxFb);
    expect(r.kind === 'failed' && r.error.category).toBe('user_action');
  });

  it('thu hồi (190) ⇒ user_action; mạng/5xx ⇒ không phải kết luận khẳng định', async () => {
    stub.on('POST /oauth/access_token', graphError(190, undefined, 401));
    const revoked = await facebook().renewToken(cred, ctxFb);
    expect(revoked.kind === 'failed' && revoked.error.category).toBe('user_action');
    stub.clear();
    stub.on('POST /oauth/access_token', { status: 503, json: {} });
    const down = await facebook().renewToken(cred, ctxFb);
    expect(down.kind === 'failed' && down.error.category).not.toBe('user_action');
  });

  it('Instagram: lấy lại mã Page chứa tài khoản Instagram này', async () => {
    stub.on('POST /oauth/access_token', { json: { access_token: 'EAAnew_user' } });
    stub.on('GET /me/accounts', {
      json: {
        data: [
          {
            id: 'p1',
            name: 'Tiệm Hoa',
            access_token: 'EAAnew_ig_page',
            tasks: ['CREATE_CONTENT'],
            instagram_business_account: { id: 'ig-1', username: 'tiemhoa' },
          },
        ],
      },
    });
    stub.on('POST /debug_token', debugOk());
    const r = await instagram().renewToken(cred, { connectionId: 'c1', externalId: 'ig-1' });
    expect(r.kind === 'renewed' && r.accessToken).toBe('EAAnew_ig_page');
  });
});
