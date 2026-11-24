// US6 (013) – bộ kiểm thử HỢP ĐỒNG chung của bộ chuyển đổi Meta: cùng một bộ ca chạy cho FacebookAdapter và
// InstagramAdapter trên máy chủ Graph giả. Bản giả lập (FakePlatformAdapter) đã có bộ hợp đồng của 005; ở đây khẳng định
// hành vi an toàn quan trọng nhất cho bản thật: phân loại lỗi (không bao giờ đoán "tạm thời"), mã quyền không rò rỉ,
// dấu nội dung ổn định, đối soát theo năng lực.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter } from '../../src/modules/platform_gateway/internal/adapters/adapter';
import { FacebookAdapter } from '../../src/modules/platform_gateway/internal/adapters/meta/facebook.adapter';
import { GraphClient } from '../../src/modules/platform_gateway/internal/adapters/meta/graph-client';
import { InstagramAdapter } from '../../src/modules/platform_gateway/internal/adapters/meta/instagram.adapter';
import {
  FakeCredentialVault,
  type DecryptedCredential,
} from '../../src/modules/platform_gateway/internal/vault/credential-vault';
import { graphError, GraphStub } from './graph-stub';

const TOKEN = 'EAAB-SECRET-TOKEN-do-not-leak-123';
const EXTERNAL = 'page-1';
const stub = new GraphStub();
let baseUrl = '';
let cred: DecryptedCredential;

interface Case {
  name: 'facebook_page' | 'instagram';
  prefix: 'FB' | 'IG';
  make: (o: { reconcile: boolean; baseUrl?: string; timeoutMs?: number }) => PlatformAdapter;
  /** Đường dẫn Graph của bước gửi đầu tiên. */
  submitRoute: string;
  media: { url: string; kind: 'image' | 'video'; mediaId: string }[];
}

const client = (prefix: 'FB' | 'IG', url: string, timeoutMs: number) =>
  new GraphClient({ baseUrl: url, version: 'v21.0', timeoutMs }, prefix);

const CASES: Case[] = [
  {
    name: 'facebook_page',
    prefix: 'FB',
    make: (o) =>
      new FacebookAdapter({
        client: client('FB', o.baseUrl ?? baseUrl, o.timeoutMs ?? 2000),
        reconcile: o.reconcile,
        videoMaxBytes: 1_000_000_000,
      }),
    submitRoute: 'POST /feed',
    media: [],
  },
  {
    name: 'instagram',
    prefix: 'IG',
    make: (o) =>
      new InstagramAdapter({
        client: client('IG', o.baseUrl ?? baseUrl, o.timeoutMs ?? 2000),
        reconcile: o.reconcile,
      }),
    submitRoute: 'POST /media',
    media: [{ url: 'https://cdn.test/a.jpg', kind: 'image', mediaId: 'm1' }],
  },
];

beforeAll(async () => {
  baseUrl = await stub.start();
  cred = await new FakeCredentialVault().decrypt(
    await new FakeCredentialVault().encrypt(TOKEN, 'test-aad'),
    'test-aad',
  );
});
afterAll(async () => {
  await stub.stop();
});
beforeEach(() => {
  stub.clear();
});

const submitReq = (c: Case, text = 'Nội dung bài đăng') => ({
  text,
  media: c.media,
  contentHash: '',
  connectionId: 'conn-1',
  externalId: EXTERNAL,
  signal: new AbortController().signal,
});

describe.each(CASES)('hợp đồng bộ chuyển đổi $name', (c) => {
  it('1. gửi thành công: Facebook → published ngay; Instagram → processing rồi checkStatus → done', async () => {
    const adapter = c.make({ reconcile: false });
    if (c.name === 'facebook_page') {
      stub.on('POST /feed', { json: { id: '123_456' } });
      const r = await adapter.submit(cred, submitReq(c));
      expect(r).toEqual({
        kind: 'published',
        platformPostId: '123_456',
        permalink: 'https://www.facebook.com/123_456',
      });
    } else {
      stub.on('POST /media', { json: { id: 'container-9' } });
      const r = await adapter.submit(cred, submitReq(c));
      expect(r).toEqual({ kind: 'processing', processingId: 'container-9' });
      stub.on('GET /container-9', { json: { status_code: 'IN_PROGRESS' } });
      expect(
        await adapter.checkStatus(cred, 'container-9', { connectionId: 'c', externalId: EXTERNAL }),
      ).toEqual({
        kind: 'processing',
      });
      stub.on('GET /container-9', { json: { status_code: 'FINISHED' } });
      stub.on('POST /media_publish', { json: { id: 'ig-media-1' } });
      stub.on('GET /ig-media-1', { json: { permalink: 'https://www.instagram.com/p/XYZ/' } });
      expect(
        await adapter.checkStatus(cred, 'container-9', { connectionId: 'c', externalId: EXTERNAL }),
      ).toEqual({
        kind: 'done',
        platformPostId: 'ig-media-1',
        permalink: 'https://www.instagram.com/p/XYZ/',
      });
    }
  });

  it('2. hết thời gian SAU khi gửi → unknown (KHÔNG tạm thời)', async () => {
    stub.on(c.submitRoute, { delayMs: 800, json: { id: 'late' } });
    const adapter = c.make({ reconcile: false, timeoutMs: 150 });
    const r = await adapter.submit(cred, submitReq(c));
    expect(r.kind).toBe('failed');
    if (r.kind === 'failed') {
      expect(r.error.category).toBe('unknown');
      expect(r.error.rawCode).toBe(`${c.prefix}:TIMEOUT_AFTER_SEND`);
    }
  });

  it('2b. mất kết nối sau khi nhận yêu cầu → unknown', async () => {
    stub.on(c.submitRoute, { destroy: true });
    const r = await c.make({ reconcile: false }).submit(cred, submitReq(c));
    expect(r.kind === 'failed' && r.error.category).toBe('unknown');
  });

  it('2c. HTTP 5xx chung chung khi gửi → unknown (nền tảng có thể đã tạo bài)', async () => {
    stub.on(c.submitRoute, { status: 503, json: {} });
    const r = await c.make({ reconcile: false }).submit(cred, submitReq(c));
    expect(r.kind === 'failed' && r.error.category).toBe('unknown');
    expect(r.kind === 'failed' && r.error.rawCode).toBe('HTTP:503');
  });

  it('3. từ chối kết nối TRƯỚC khi gửi → tạm thời (chắc chắn chưa tới nền tảng)', async () => {
    // Cổng đóng: nghe rồi đóng ngay để lấy một cổng chắc chắn không ai nghe.
    const dead = new GraphStub();
    const url = await dead.start();
    await dead.stop();
    const r = await c.make({ reconcile: false, baseUrl: url }).submit(cred, submitReq(c));
    expect(r.kind).toBe('failed');
    if (r.kind === 'failed') {
      expect(r.error.category).toBe('transient');
      expect(r.error.rawCode).toBe(`${c.prefix}:NET_BEFORE_SEND`);
    }
  });

  it('4. giới hạn tốc độ → tạm thời, có retryAfterSec (từ Retry-After hoặc bảng)', async () => {
    stub.on(c.submitRoute, { status: 429, json: {}, headers: { 'Retry-After': '120' } });
    const r = await c.make({ reconcile: false }).submit(cred, submitReq(c));
    expect(r.kind === 'failed' && r.error.category).toBe('transient');
    expect(r.kind === 'failed' && r.error.retryAfterSec).toBe(120);

    stub.on(c.submitRoute, graphError(4));
    const r2 = await c.make({ reconcile: false }).submit(cred, submitReq(c));
    expect(r2.kind === 'failed' && r2.error.category).toBe('transient');
    expect(r2.kind === 'failed' && r2.error.retryAfterSec).toBe(600);
  });

  it('5. quyền hết hạn → cần người dùng + "Kết nối lại"', async () => {
    stub.on(c.submitRoute, graphError(190));
    const r = await c.make({ reconcile: false }).submit(cred, submitReq(c));
    expect(r.kind === 'failed' && r.error.category).toBe('user_action');
    expect(r.kind === 'failed' && r.error.remedies.map((x) => x.action)).toContain('reconnect');
  });

  it('6. mã lạ → unknown, không bao giờ đoán là tạm thời', async () => {
    stub.on(c.submitRoute, graphError(987654, 3));
    const r = await c.make({ reconcile: false }).submit(cred, submitReq(c));
    expect(r.kind === 'failed' && r.error.category).toBe('unknown');
    expect(c.make({ reconcile: false }).classifyError('ZZZ:1').category).toBe('unknown');
    expect(c.make({ reconcile: false }).classifyError('!!!').rawCode).toBe('UNKNOWN');
  });

  it('7. đối soát: có bài → found; chưa có → not_found; năng lực tắt → unsupported', async () => {
    const text = 'Khai trương 🎉  Ưu đãi';
    const on = c.make({ reconcile: true });
    const hash = on.contentHash(text);
    const q = {
      connectionId: 'c',
      externalId: EXTERNAL,
      contentHash: hash,
      from: new Date(Date.now() - 3_600_000),
      to: new Date(),
    };
    if (c.name === 'facebook_page') {
      stub.on('GET /posts', {
        json: {
          data: [
            { id: 'p-1', message: 'khác', permalink_url: 'https://fb.test/1' },
            { id: 'p-2', message: 'Khai trương 🎉 Ưu đãi', permalink_url: 'https://fb.test/2' },
          ],
        },
      });
    } else {
      stub.on('GET /media', {
        json: {
          data: [
            {
              id: 'p-2',
              caption: 'Khai trương 🎉 Ưu đãi',
              permalink: 'https://ig.test/2',
              timestamp: new Date().toISOString(),
            },
          ],
        },
      });
    }
    expect(await on.reconcile(cred, q)).toMatchObject({ kind: 'found', platformPostId: 'p-2' });
    stub.clear();
    stub.on(c.name === 'facebook_page' ? 'GET /posts' : 'GET /media', { json: { data: [] } });
    expect(await on.reconcile(cred, q)).toEqual({ kind: 'not_found' });
    expect(await c.make({ reconcile: false }).reconcile(cred, q)).toEqual({
      kind: 'unsupported',
      reason: 'capability',
    });
    expect(c.make({ reconcile: false }).capabilities.reconcile).toBe(false);
  });

  it('8. dấu nội dung ổn định qua chuẩn hóa Unicode/khoảng trắng/liên kết', () => {
    const a = c.make({ reconcile: false });
    const nfc = 'Cà phê ngon   quá';
    const nfd = 'Cà phê ngon quá'.normalize('NFD');
    expect(a.contentHash(nfc)).toBe(a.contentHash(nfd));
    expect(a.contentHash('Xem https://a.co/abc')).toBe(a.contentHash('Xem https://rút.gọn/xyz'));
    expect(a.contentHash('Xin chào')).not.toBe(a.contentHash('xin chào'));
    expect(a.contentHash('x')).toMatch(/^ch1:[0-9a-f]{64}$/);
  });

  it('9. mã quyền KHÔNG xuất hiện trong URL, nội dung yêu cầu, thông điệp lỗi hay ClassifiedError', async () => {
    stub.on(c.submitRoute, graphError(190));
    const adapter = c.make({ reconcile: true });
    const failed = await adapter.submit(cred, submitReq(c));
    stub.on('GET /' + EXTERNAL, graphError(190));
    const check = await adapter.checkAccount(cred, { connectionId: 'c', externalId: EXTERNAL });
    stub.on('GET /posts', graphError(190));
    for (const req of stub.requests) {
      expect(req.url).not.toContain(TOKEN);
      expect(req.body).not.toContain(TOKEN);
      expect(req.headers.authorization).toBe(`Bearer ${TOKEN}`); // đúng nơi duy nhất
    }
    expect(JSON.stringify({ failed, check })).not.toContain(TOKEN);
    expect(JSON.stringify({ failed, check })).not.toContain('secret-should-not-leak'); // nội dung thô của nền tảng
    expect(JSON.stringify(cred)).toBe('"[credential]"');
  });

  it('thiếu mã Page/tài khoản → lỗi an toàn (unknown), không gọi nền tảng', async () => {
    const r = await c
      .make({ reconcile: false })
      .submit(cred, { ...submitReq(c), externalId: undefined });
    expect(r.kind === 'failed' && r.error.category).toBe('unknown');
    expect(stub.requests).toHaveLength(0);
  });
});

describe('Instagram – quy tắc riêng', () => {
  const build = (i: 0 | 1) => {
    const c = CASES[i];
    if (c === undefined) throw new Error('thiếu ca');
    return c.make({ reconcile: false });
  };
  const ig = () => build(1);
  const fb = () => build(0);

  it('10. tài khoản không chuyên nghiệp → ineligible + "Kết nối lại"', async () => {
    stub.on('GET /' + EXTERNAL, { json: { id: EXTERNAL, account_type: 'PERSONAL' } });
    const r = await ig().checkAccount(cred, { connectionId: 'c', externalId: EXTERNAL });
    expect(r.kind).toBe('ineligible');
    if (r.kind === 'ineligible') {
      expect(r.error.category).toBe('user_action');
      expect(r.error.remedies.map((x) => x.action)).toContain('reconnect');
    }
  });

  it('tài khoản chuyên nghiệp: eligible + hạn mức 24 giờ còn lại', async () => {
    stub.on('GET /' + EXTERNAL, { json: { id: EXTERNAL, account_type: 'BUSINESS' } });
    stub.on('GET /content_publishing_limit', {
      json: { data: [{ quota_usage: 20, config: { quota_total: 25 } }] },
    });
    const r = await ig().checkAccount(cred, { connectionId: 'c', externalId: EXTERNAL });
    expect(r).toMatchObject({ kind: 'eligible', quotaRemaining: 5 });
    expect(ig().capabilities).toMatchObject({ asyncProcessing: true, reportsQuota: true });
  });

  it('bài nhiều ảnh → carousel (từng mục + container CAROUSEL)', async () => {
    stub.on(
      'POST /media',
      { json: { id: 'i1' } },
      { json: { id: 'i2' } },
      { json: { id: 'carousel-1' } },
    );
    const r = await ig().submit(cred, {
      ...submitReq(CASES[1]!),
      media: [
        { url: 'https://cdn.test/1.jpg', kind: 'image', mediaId: 'a' },
        { url: 'https://cdn.test/2.jpg', kind: 'image', mediaId: 'b' },
      ],
    });
    expect(r).toEqual({ kind: 'processing', processingId: 'carousel-1' });
    expect(stub.requests.at(-1)?.body).toContain('CAROUSEL');
  });

  it('quy tắc media: Instagram ảnh JPEG, không trộn; Facebook video theo cấu hình', () => {
    expect(ig().mediaRules()).toMatchObject({ allowMixed: false, image: { formats: ['jpeg'] } });
    const big = new FacebookAdapter({
      client: client('FB', baseUrl, 1000),
      reconcile: false,
      videoMaxBytes: 2_000_000_000,
    });
    expect(big.mediaRules().video?.maxBytes).toBe(2_000_000_000);
    expect(fb().mediaRules().video?.maxBytes).toBe(1_000_000_000);
    expect(fb().mediaRules().allowMixed).toBe(false);
  });

  it('Facebook: nhiều ảnh → đăng từng ảnh chưa công khai rồi một bài attached_media', async () => {
    stub.on('POST /photos', { json: { id: 'ph1' } }, { json: { id: 'ph2' } });
    stub.on('POST /feed', { json: { id: 'multi-1' } });
    const r = await fb().submit(cred, {
      ...submitReq(CASES[0]!),
      media: [
        { url: 'https://cdn.test/1.jpg', kind: 'image', mediaId: 'a' },
        { url: 'https://cdn.test/2.jpg', kind: 'image', mediaId: 'b' },
      ],
    });
    expect(r).toMatchObject({ kind: 'published', platformPostId: 'multi-1' });
    expect(stub.requests.at(-1)?.body).toContain('attached_media');
  });
});
