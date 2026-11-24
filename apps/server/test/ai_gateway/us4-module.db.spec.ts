import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { APP_CONFIG, type AppConfig } from '../../src/core';
import { runWithJobContext } from '../../src/core/context/bind-account';
import { loadConfig } from '../../src/core/config/load-config';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { AI_GATEWAY, AiError, type AiGatewayPublicApi } from '../../src/modules/ai_gateway';
import {
  AI_REAL_PARTS,
  AiGatewayModule,
  type RealAiParts,
} from '../../src/modules/ai_gateway/ai_gateway.module';
import { DbPriceSource } from '../../src/modules/ai_gateway/internal/prices/db-price-source';
import { AiSettings } from '../../src/modules/ai_gateway/internal/settings/ai-settings';
import { ACCOUNT_PUBLIC_API } from '../../src/modules/account';
import { NOTIFICATIONS } from '../../src/modules/notifications';
import { TEST_AUTH_ENV } from '../helpers/auth-env';
import {
  dbUrls,
  describeDb,
  makeDatabase,
  createAccount,
  type TestDatabase,
} from '../db/helpers/db';
import { startTestProducer } from '../support/queue-test-kit';
import { insertPrice, reservationRows, uniqueModel } from './helpers/price-fixtures';

// 015 US4 (reviews/us4.md mục 2, 6) ở tầng module `AI_GATEWAY_DRIVER=real`: phần nối cấu hình → bộ chuyển đổi.
//  - Dựng LƯỜI: tuyến đổi sang nhà cung cấp KHÔNG có trong `enabledProviders()` lúc khởi động nhưng khóa đã nạp → dựng được
//    ở lần gọi đầu và gọi ra ngoài đúng (api.anthropic.com, `fetch` giả); khóa thiếu → AI_NOT_CONFIGURED, không in khóa.
//  - STT: danh sách host cho phép suy từ S3_PUBLIC_ENDPOINT/S3_ENDPOINT (+ tên miền con) và AI_STT_ALLOWED_HOSTS; rỗng → từ chối.
// `fetch` toàn cục bị thay bằng bản giả TRƯỚC khi dựng module (SDK lấy `fetch` lúc dựng) → không gọi mạng ngoài.
// Chạy `pnpm test:db`.

const ANT = 'sk-ant-KEYCANARY-aaaaaaaaaaaaaaaa';
const OAI = 'sk-oai-KEYCANARY-bbbbbbbbbbbbbbbb';
const HOUR = 3_600_000;
const REAL_FETCH = globalThis.fetch;

function configWith(extra: Record<string, string>): AppConfig {
  return loadConfig({
    APP_ENV: 'test',
    LOG_LEVEL: 'error',
    ...TEST_AUTH_ENV,
    DATABASE_APP_URL: dbUrls.app,
    DATABASE_SUPPORT_URL: dbUrls.support,
    DATABASE_SYSTEM_URL: dbUrls.system,
    AI_GATEWAY_DRIVER: 'real',
    ...extra,
  });
}

function stubsFor(config: AppConfig) {
  @Global()
  @Module({
    providers: [
      { provide: APP_CONFIG, useValue: config },
      { provide: NOTIFICATIONS, useValue: { emit: () => Promise.resolve() } },
      {
        provide: ACCOUNT_PUBLIC_API,
        useValue: { getAiCycleAnchor: () => Promise.resolve({ anchorDate: '2026-01-01' }) },
      },
    ],
    exports: [APP_CONFIG, NOTIFICATIONS, ACCOUNT_PUBLIC_API],
  })
  class StubModule {}
  return StubModule;
}

interface RouteStub {
  /** Nhà cung cấp "đã bật" lúc khởi động (chỉ những nhà cung cấp này được dựng ngay). */
  startup: string[];
  /** Tuyến của mọi bậc/loại việc. */
  route: { provider: string; modelId: string };
}

async function build(config: AppConfig, stub: RouteStub) {
  const parts = {
    prices: new DbPriceSource({ ttlMs: 0 }),
    routes: {
      enabledProviders: () => Promise.resolve(stub.startup),
      attemptsFor: () => Promise.resolve([stub.route]),
    },
    settings: new AiSettings({ ttlMs: 0 }),
    activeIndustries: undefined,
    industryAccounts: undefined,
  } as unknown as RealAiParts;
  const ref = await Test.createTestingModule({
    imports: [stubsFor(config), AiGatewayModule.forUnit('worker')],
  })
    .overrideProvider(AI_REAL_PARTS)
    .useValue(parts)
    .compile();
  return { ref, gw: ref.get<AiGatewayPublicApi>(AI_GATEWAY) };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const anthropicOk = () =>
  json(200, {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-x',
    content: [{ type: 'text', text: 'Xin chào các bạn' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  });

/** `fetch` giả: gom mọi lời gọi; `handlers` trả Response theo tiền tố URL, còn lại → ném (không ra mạng). */
function fakeFetch(handlers: Record<string, () => Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = urlOfInput(input);
    for (const [prefix, h] of Object.entries(handlers)) {
      if (url.startsWith(prefix)) return Promise.resolve(h());
    }
    // `data:` là URL nội bộ của Node/undici (không ra mạng) – cho đi tiếp.
    if (url.startsWith('data:')) return REAL_FETCH(input, init);
    return Promise.reject(new TypeError(`fetch không được phép tới ${new URL(url).hostname}`));
  });
}

const urlOfInput = (input: Parameters<typeof fetch>[0]): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

const urlsOf = (spy: ReturnType<typeof fakeFetch>) =>
  spy.mock.calls.map((c) => urlOfInput(c[0])).filter((u) => !u.startsWith('data:'));

describeDb('Cổng AI – module real: bộ chuyển đổi lười và host STT (US4)', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;

  beforeAll(async () => {
    database = makeDatabase({ unit: 'worker', poolMax: 6 });
    stopProducer = await startTestProducer();
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const inFreshAccount = async <T>(fn: (id: string) => Promise<T>): Promise<T> => {
    const id = await createAccount();
    return runWithJobContext({ traceId: uuidV7(), accountId: id }, () => fn(id));
  };
  const genReq = {
    task: 'post_generation' as const,
    prompt: { system: 'S', delta: 'LAZY_CANARY Viết bài.' },
    maxOutputTokens: 100,
  };

  describe('dựng lười (mục 6)', () => {
    it('tuyến đổi sang anthropic (chưa dựng lúc khởi động) nhưng khóa đã nạp → dựng ở lần gọi đầu, gọi api.anthropic.com với khóa, settle', async () => {
      const m = { provider: 'anthropic', modelId: uniqueModel('lazy').modelId };
      await insertPrice(m, { effectiveFrom: new Date(Date.now() - HOUR) });
      const spy = fakeFetch({ 'https://api.anthropic.com': anthropicOk });
      const { ref, gw } = await build(configWith({ ANTHROPIC_API_KEY: ANT, OPENAI_API_KEY: OAI }), {
        startup: ['openai'], // anthropic KHÔNG được dựng lúc khởi động
        route: m,
      });
      try {
        await inFreshAccount(async (id) => {
          expect(urlsOf(spy)).toEqual([]); // chưa gọi gì trước lần dùng đầu
          const out = await gw.generate(genReq);
          expect(out.text).toBe('Xin chào các bạn');
          expect(urlsOf(spy).filter((u) => u.startsWith('https://api.anthropic.com'))).toHaveLength(
            1,
          );
          const init = spy.mock.calls[0]![1];
          expect(new Headers(init?.headers).get('x-api-key')).toBe(ANT);
          expect((await reservationRows(id)).map((r) => [r.state, r.provider])).toEqual([
            ['settled', 'anthropic'],
          ]);
          // Lần gọi thứ hai dùng lại bộ chuyển đổi đã dựng (không dựng lại, vẫn một nhà cung cấp).
          await gw.generate(genReq);
          expect(urlsOf(spy).filter((u) => u.startsWith('https://api.anthropic.com'))).toHaveLength(
            2,
          );
        });
      } finally {
        await ref.close();
      }
    });

    it('khóa của nhà cung cấp thiếu → AI_NOT_CONFIGURED trước khi giữ chỗ, không gọi mạng, thông điệp không in khóa còn lại', async () => {
      const m = { provider: 'anthropic', modelId: uniqueModel('nokey').modelId };
      await insertPrice(m, { effectiveFrom: new Date(Date.now() - HOUR) });
      const spy = fakeFetch({});
      const { ref, gw } = await build(configWith({ OPENAI_API_KEY: OAI }), {
        startup: ['openai'],
        route: m,
      });
      try {
        await inFreshAccount(async (id) => {
          const err = await gw.generate(genReq).catch((e: unknown) => e);
          expect(err).toBeInstanceOf(AiError);
          expect((err as AiError).code).toBe('AI_NOT_CONFIGURED');
          const text = `${(err as Error).message}\n${(err as Error).stack ?? ''}`;
          expect(text).not.toContain('KEYCANARY');
          expect(text).not.toContain('LAZY_CANARY');
          expect(urlsOf(spy)).toEqual([]);
          expect(await reservationRows(id)).toEqual([]);
        });
      } finally {
        await ref.close();
      }
    });

    it('nhà cung cấp lạ trong tuyến → AI_NOT_CONFIGURED (không ném lỗi thô, không dựng)', async () => {
      const m = { provider: 'khong-ton-tai', modelId: uniqueModel('unk').modelId };
      await insertPrice(m, { effectiveFrom: new Date(Date.now() - HOUR) });
      fakeFetch({});
      const { ref, gw } = await build(configWith({ ANTHROPIC_API_KEY: ANT, OPENAI_API_KEY: OAI }), {
        startup: ['openai'],
        route: m,
      });
      try {
        await inFreshAccount(async () => {
          const err = await gw.generate(genReq).catch((e: unknown) => e);
          expect((err as AiError).code).toBe('AI_NOT_CONFIGURED');
        });
      } finally {
        await ref.close();
      }
    });
  });

  describe('host tải âm thanh STT suy từ cấu hình (mục 2)', () => {
    const stt = async (env: Record<string, string>) => {
      const m = { provider: 'openai', modelId: uniqueModel('stt').modelId };
      await insertPrice(m, {
        unit: 'audio_minute',
        perMinute: 6_000,
        effectiveFrom: new Date(Date.now() - HOUR),
      });
      const spy = fakeFetch({
        'https://bucket.cdn.s3.example.vn': () =>
          new Response(Buffer.alloc(1024, 3), { headers: { 'content-type': 'audio/mpeg' } }),
        'https://cdn.s3.example.vn': () =>
          new Response(Buffer.alloc(1024, 3), { headers: { 'content-type': 'audio/mpeg' } }),
        'https://s3-internal.example.vn': () =>
          new Response(Buffer.alloc(1024, 3), { headers: { 'content-type': 'audio/mpeg' } }),
        'https://x.media.extra-host.test': () =>
          new Response(Buffer.alloc(1024, 3), { headers: { 'content-type': 'audio/mpeg' } }),
        'https://api.openai.com': () => json(200, { text: 'xin chào các bạn', duration: 20 }),
      });
      const built = await build(
        configWith({ OPENAI_API_KEY: OAI, ANTHROPIC_API_KEY: ANT, ...env }),
        {
          startup: ['openai'],
          route: m,
        },
      );
      return { ...built, spy };
    };
    const call = (gw: AiGatewayPublicApi, audioUrl: string) =>
      gw.transcribe({ audioUrl, durationSec: 20, language: 'vi' });

    it('S3_PUBLIC_ENDPOINT, S3_ENDPOINT (+ tên miền con) và AI_STT_ALLOWED_HOSTS được phép; host khác bị từ chối trước khi tải', async () => {
      const { ref, gw, spy } = await stt({
        S3_PUBLIC_ENDPOINT: 'https://cdn.s3.example.vn',
        S3_ENDPOINT: 'https://s3-internal.example.vn',
        AI_STT_ALLOWED_HOSTS: ' media.extra-host.test , ',
      });
      try {
        await inFreshAccount(async () => {
          for (const url of [
            'https://bucket.cdn.s3.example.vn/tenants/t/a.mp3?X-Amz-Signature=SIGSECRET',
            'https://cdn.s3.example.vn/tenants/t/a.mp3',
            'https://s3-internal.example.vn/tenants/t/a.mp3',
            'https://x.media.extra-host.test/a.m4a',
          ]) {
            expect((await call(gw, url)).text).toBe('xin chào các bạn');
          }
          const before = urlsOf(spy).length;
          const err = await call(
            gw,
            'https://evil.example.org/a.mp3?X-Amz-Signature=SIGSECRET',
          ).catch((e: unknown) => e);
          expect((err as AiError).code).toBe('AI_PROVIDER_UNAVAILABLE');
          expect(urlsOf(spy).slice(before)).toEqual([]); // không tải, không gọi chuyển giọng nói
          const text = `${(err as Error).message}\n${(err as Error).stack ?? ''}`;
          expect(text).not.toContain('SIGSECRET');
          // Mọi lần tải âm thanh đã dùng redirect:'error'.
          const audioCalls = spy.mock.calls.filter((c) => {
            const u = urlOfInput(c[0]);
            return u.startsWith('https://') && !u.includes('api.openai.com');
          });
          expect(audioCalls.length).toBeGreaterThanOrEqual(4);
          for (const c of audioCalls) expect(c[1]?.redirect).toBe('error');
        });
      } finally {
        await ref.close();
      }
    });

    it('không có S3 và không có AI_STT_ALLOWED_HOSTS → từ chối mọi URL âm thanh, không giữ chỗ nào còn treo', async () => {
      const { ref, gw, spy } = await stt({});
      try {
        await inFreshAccount(async (id) => {
          const err = await call(gw, 'https://bucket.cdn.s3.example.vn/a.mp3').catch(
            (e: unknown) => e,
          );
          expect((err as AiError).code).toBe('AI_PROVIDER_UNAVAILABLE');
          expect(urlsOf(spy)).toEqual([]);
          expect((await reservationRows(id)).map((r) => r.state)).toEqual(['released']);
        });
      } finally {
        await ref.close();
      }
    });
  });

  // Dự phòng khi test chạy lại trên mạng thật: bảo đảm `fetch` thật còn nguyên sau mọi ca.
  it('khôi phục fetch toàn cục sau các ca', () => {
    vi.restoreAllMocks();
    expect(globalThis.fetch).toBe(REAL_FETCH);
  });
});
