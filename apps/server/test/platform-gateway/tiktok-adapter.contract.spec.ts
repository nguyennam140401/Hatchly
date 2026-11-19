// 010 T078 (US9, contracts/meta-tiktok-adapters.md mục 4, 6): hợp đồng bộ chuyển đổi TikTok trên máy chủ giả – kết nối, kiểm tra, làm mới
// (ghi CẢ HAI mã), thu hồi, chỉ video, `submit` luôn user_action (không bao giờ transient), và decorator công tắc ⇒ 0 lời gọi mạng.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { executionStorage } from '../../src/core/context/execution-storage';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { guardAdapter, GUARDED } from '../../src/modules/platform_gateway/internal/adapters/feature-guarded-adapter';
import { TiktokAdapter } from '../../src/modules/platform_gateway/internal/adapters/tiktok/tiktok.adapter';
import { TiktokClient } from '../../src/modules/platform_gateway/internal/adapters/tiktok/tiktok-client';
import {
  FakeCredentialVault,
  type DecryptedCredential,
} from '../../src/modules/platform_gateway/internal/vault/credential-vault';
import { TiktokStub, tiktokError } from './tiktok-stub';

const REDIRECT = 'https://app.example.test/api/v1/channels/callback/tiktok';
const stub = new TiktokStub();
let baseUrl = '';
let cred: DecryptedCredential;

beforeAll(async () => {
  baseUrl = await stub.start();
  const vault = new FakeCredentialVault();
  cred = await vault.decrypt(await vault.encrypt('act.secret-token', 'aad'), 'aad');
});
afterAll(async () => {
  await stub.stop();
});
beforeEach(() => {
  stub.clear();
});

const adapter = () =>
  new TiktokAdapter({
    client: new TiktokClient({ baseUrl, timeoutMs: 2000 }),
    clientKey: 'tt-key',
    clientSecret: 'TT-SECRET',
    scopes: ['user.info.basic', 'video.publish', 'video.upload'],
  });

describe('TiktokAdapter – kết nối (US9)', () => {
  it('authorizeUrl đủ tham số, không có client_secret; state đi nguyên văn', () => {
    const url = new URL(adapter().authorizeUrl('st-123', REDIRECT));
    expect(url.hostname).toBe('www.tiktok.com');
    expect(url.searchParams.get('client_key')).toBe('tt-key');
    expect(url.searchParams.get('state')).toBe('st-123');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('user.info.basic,video.publish,video.upload');
    expect(url.toString()).not.toContain('TT-SECRET');
  });

  it('exchangeCallback: MỘT ứng viên open_id, hạn = hạn refresh_token, mã làm mới đi kèm; bí mật chỉ trong thân form', async () => {
    stub.loadConnectScenario({ openId: 'tt-77', displayName: 'Cửa hàng thử' });
    const { candidates } = await adapter().exchangeCallback({ code: 'c1', redirectUri: REDIRECT });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      externalId: 'tt-77',
      displayName: 'Cửa hàng thử',
      accessToken: 'act.stub_access_token',
      refreshToken: 'rft.stub_refresh_token',
    });
    expect(candidates[0]?.expiry?.kind).toBe('token');
    for (const r of stub.requests) {
      expect(r.url).not.toContain('TT-SECRET');
      expect(r.url).not.toContain('c1');
    }
    const tokenCall = stub.requests.find((r) => r.url.startsWith('/v2/oauth/token/'));
    expect(tokenCall?.body).toContain('client_secret=TT-SECRET'); // nằm trong THÂN
  });

  it('người dùng hủy ⇒ không có ứng viên', async () => {
    const out = await adapter().exchangeCallback({ error: 'access_denied', redirectUri: REDIRECT });
    expect(out.candidates).toEqual([]);
    expect(stub.callCount).toBe(0);
  });

  it('checkAccount: đủ quyền ⇒ eligible; thiếu quyền ⇒ SCOPE_MISSING + hành động; 5xx/mạng ⇒ KHÔNG phải user_action', async () => {
    stub.loadConnectScenario();
    expect((await adapter().checkAccount(cred)).kind).toBe('eligible');

    stub.clear();
    stub.on('POST /v2/post/publish/creator_info/query/', tiktokError('scope_not_authorized'));
    const missing = await adapter().checkAccount(cred);
    expect(missing.kind === 'ineligible' && missing.error.rawCode).toBe('TT:SCOPE_MISSING');
    expect(missing.kind === 'ineligible' && missing.error.remedies.length).toBeGreaterThanOrEqual(1);

    stub.clear();
    stub.on('POST /v2/post/publish/creator_info/query/', { status: 503, json: {} });
    const down = await adapter().checkAccount(cred);
    expect(down.kind === 'ineligible' && down.error.category).not.toBe('user_action');
  });

  it('thông điệp lỗi không chứa nội dung do nền tảng trả (message/log_id)', async () => {
    stub.on('POST /v2/post/publish/creator_info/query/', tiktokError('access_token_invalid', 401));
    const r = await adapter().checkAccount(cred);
    const text = JSON.stringify(r);
    expect(text).not.toContain('secret-should-not-leak');
    expect(r.kind === 'ineligible' && r.error.category).toBe('user_action');
  });

  it('expiryOf không bịa ngày (hạn ghi lúc kết nối/làm mới)', async () => {
    await expect(adapter().expiryOf()).rejects.toThrow('TT:EXPIRY_UNKNOWN');
  });

  it('renewToken ghi CẢ HAI mã mới + hạn mới; bị thu hồi ⇒ user_action; mạng ⇒ không user_action', async () => {
    stub.loadConnectScenario({ refreshExpiresInSec: 1_000_000 });
    const ok = await adapter().renewToken(cred, { connectionId: 'c' });
    expect(ok.kind).toBe('renewed');
    if (ok.kind === 'renewed') {
      expect(ok.accessToken).toBe('act.stub_access_token');
      expect(ok.refreshToken).toBe('rft.stub_refresh_token');
      expect(ok.expiry.kind).toBe('token');
    }
    stub.clear();
    stub.on('POST /v2/oauth/token/', tiktokError('invalid_grant'));
    const revoked = await adapter().renewToken(cred, { connectionId: 'c' });
    expect(revoked.kind === 'failed' && revoked.error.category).toBe('user_action');
    stub.clear();
    stub.on('POST /v2/oauth/token/', { status: 502, json: {} });
    const down = await adapter().renewToken(cred, { connectionId: 'c' });
    expect(down.kind === 'failed' && down.error.category).not.toBe('user_action');
  });

  it('revoke: done / failed, không ném', async () => {
    stub.loadConnectScenario();
    await expect(adapter().revoke(cred)).resolves.toBe('done');
    stub.clear();
    stub.on('POST /v2/oauth/revoke/', { status: 500, json: {} });
    await expect(adapter().revoke(cred)).resolves.toBe('failed');
  });
});

describe('TiktokAdapter – đăng và quy tắc media', () => {
  it('chỉ video; capabilities đúng hợp đồng', () => {
    const a = adapter();
    expect(a.mediaRules().image).toBeNull();
    expect(a.mediaRules().video).not.toBeNull();
    expect(a.capabilities).toEqual({
      reconcile: false,
      asyncProcessing: true,
      tokenRefresh: true,
      reportsQuota: false,
      maxReconcileWindowHours: null,
    });
  });

  it('submit/checkStatus ⇒ failed user_action POSTING_NOT_AVAILABLE, KHÔNG BAO GIỜ transient; reconcile ⇒ unsupported', async () => {
    const a = adapter();
    const s = await a.submit();
    const c = await a.checkStatus();
    for (const r of [s, c]) {
      expect(r.kind).toBe('failed');
      if (r.kind === 'failed') {
        expect(r.error.category).toBe('user_action');
        expect(r.error.rawCode).toBe('TT:POSTING_NOT_AVAILABLE');
      }
    }
    expect(await a.reconcile()).toEqual({ kind: 'unsupported', reason: 'capability' });
    expect(stub.callCount).toBe(0);
  });
});

describe('FeatureGuardedAdapter – công tắc tắt ⇒ 0 lời gọi mạng ở MỌI thao tác chạm mạng', () => {
  const run = <T>(accountId: string, fn: () => Promise<T>): Promise<T> =>
    executionStorage.run({ traceId: uuidV7(), source: 'system', accountId }, fn);

  it('bị bọc (dấu hiệu cấu trúc); tắt ⇒ FEATURE_NOT_ENABLED, stub không nhận yêu cầu nào', async () => {
    stub.loadConnectScenario();
    const guarded = guardAdapter(adapter(), () => Promise.resolve(false));
    expect((guarded as unknown as Record<symbol, unknown>)[GUARDED]).toBe(true);
    const calls: (() => Promise<unknown>)[] = [
      () => guarded.checkAccount(cred, { connectionId: 'c' }),
      () => guarded.exchangeCallback({ code: 'x', redirectUri: REDIRECT }),
      () => guarded.revoke(cred, { connectionId: 'c' }),
      () => guarded.refreshToken(cred, { connectionId: 'c' }),
      () => guarded.expiryOf(cred, { connectionId: 'c' }),
      () => guarded.submit(cred, {} as never),
      () => guarded.renewToken?.(cred, { connectionId: 'c' }) ?? Promise.reject(new Error('x')),
    ];
    for (const call of calls) {
      await expect(run('acc-1', call)).rejects.toMatchObject({ code: 'FEATURE_NOT_ENABLED' });
    }
    expect(stub.callCount).toBe(0);
  });

  it('bật ⇒ đi tiếp xuống bộ chuyển đổi; không có ngữ cảnh tài khoản ⇒ coi như tắt; thao tác thuần không bị chặn', async () => {
    stub.loadConnectScenario();
    const guarded = guardAdapter(adapter(), () => Promise.resolve(true));
    expect((await run('acc-1', () => guarded.checkAccount(cred, { connectionId: 'c' }))).kind).toBe(
      'eligible',
    );
    await expect(guarded.checkAccount(cred, { connectionId: 'c' })).rejects.toMatchObject({
      code: 'FEATURE_NOT_ENABLED',
    });
    expect(guarded.authorizeUrl('s', REDIRECT)).toContain('tiktok.com'); // không chạm mạng
  });
});
