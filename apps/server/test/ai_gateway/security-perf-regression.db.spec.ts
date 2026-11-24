import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { metrics } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiError, type AiRequest } from '../../src/modules/ai_gateway';
import { AiGatewayService } from '../../src/modules/ai_gateway/internal/gateway.service';
import { DbPriceSource } from '../../src/modules/ai_gateway/internal/prices/db-price-source';
import type { AiProviderAdapter } from '../../src/modules/ai_gateway/internal/providers/provider';
import { AnthropicAdapter } from '../../src/modules/ai_gateway/internal/providers/anthropic';
import { OpenAiAdapter } from '../../src/modules/ai_gateway/internal/providers/openai';
import { ProviderCallError } from '../../src/modules/ai_gateway/internal/providers/provider-error';
import { TEST_LOG_DIR } from '../setup/log-capture';
import { makeAiHarness, type AiHarness } from '../contracts/ai/harness';
import {
  asOwner,
  createAccount,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from '../db/helpers/db';
import { startTestProducer } from '../support/queue-test-kit';
import { insertPrice, stubRoutes, uniqueModel } from './helpers/price-fixtures';

// 015 T075 (hiến chương III/VII, SC-003, FR-017/FR-026): hồi quy bảo mật + hiệu năng trên CSDL THẬT.
//  (A) Khóa API mẫu (giá trị đặt cho ANTHROPIC_API_KEY / OPENAI_API_KEY) đi qua bộ chuyển đổi THẬT tới máy chủ HTTP giả cục bộ
//      (không gọi mạng ngoài). Máy chủ cố tình in lại khóa + lời nhắc trong thân lỗi 401, như nhà cung cấp thật đôi khi làm.
//      Khóa KHÔNG được xuất hiện trong: nhật ký thao tác, sổ chi phí/giữ chỗ/ngân sách, chỉ số OpenTelemetry, thông báo,
//      thông điệp/ngăn xếp/JSON của `AiError` và `ProviderCallError`.
//  (B) `reserve` p95 ≤ 50 ms trên CSDL thật, 200 lần (SC-003).
//  (C) Bản sửa race ở `db-budget-store.reserveAccount`: 20 vòng × 12 giữ chỗ đầu chu kỳ ở nhiều tài khoản MỚI chạy chồng nhau
//      → không một giữ chỗ nào bị từ chối sai khi ngân sách còn nguyên.
// Chạy `pnpm test:db`.

const ANTHROPIC_KEY = 'sk-ant-api03-QA_SAMPLE_KEY_ANTHROPIC_0123456789abcdef';
const OPENAI_KEY = 'sk-proj-QA_SAMPLE_KEY_OPENAI_0123456789abcdef';
const KEYS = [ANTHROPIC_KEY, OPENAI_KEY] as const;
/** Mảnh nhận dạng khóa: bắt cả khi khóa bị cắt/đổi định dạng trong thông điệp. */
const KEY_FRAGMENTS = ['QA_SAMPLE_KEY', '0123456789abcdef'] as const;
const PROMPT_CANARY = 'PROMPT_CANARY_T075';
const RESULT_CANARY = 'Xin chào các bạn QA_RESULT_CANARY_T075';

const HOUR = 3_600_000;
const req = (): AiRequest => ({
  task: 'post_generation',
  prompt: {
    system: 'Bạn là trợ lý viết bài.',
    delta: `${PROMPT_CANARY} Viết bài khai trương quán cà phê.`,
  },
  maxOutputTokens: 300,
});

function expectNoKey(text: string, where: string): void {
  for (const k of [...KEYS, ...KEY_FRAGMENTS]) {
    expect(text.includes(k), `${where} lộ khóa API (${k.slice(0, 8)}…)`).toBe(false);
  }
}

/** Mọi thông tin quan sát được của một lỗi: thông điệp, ngăn xếp, trường riêng (cả không đếm được), JSON, nguyên nhân. */
function errorSurface(err: unknown): string {
  const parts: string[] = [String(err)];
  if (err instanceof Error) {
    parts.push(err.message, err.stack ?? '', JSON.stringify(err, Object.getOwnPropertyNames(err)));
    const cause = (err as { cause?: unknown }).cause;
    if (cause !== undefined) parts.push(errorSurface(cause));
  }
  return parts.join('\n');
}

describeDb('Cổng AI thật – hồi quy bảo mật (khóa API) và hiệu năng (T075)', () => {
  let database: TestDatabase;
  let h: AiHarness;
  let stopProducer: () => Promise<void>;
  let server: Server;
  let base: string;
  let reader: PeriodicExportingMetricReader;
  const model = { a: uniqueModel('sec-a'), b: uniqueModel('sec-b') };
  const crossed: unknown[] = [];

  /** `echo401`: nhà cung cấp in lại khóa + lời nhắc trong lỗi. `ok`: trả kết quả hợp lệ. */
  let mode: 'echo401' | 'ok' = 'ok';

  const respond = (_req: IncomingMessage, res: ServerResponse): void => {
    res.setHeader('content-type', 'application/json');
    const url = _req.url ?? '';
    if (mode === 'echo401') {
      res.statusCode = 401;
      res.end(
        JSON.stringify({
          type: 'error',
          error: {
            type: 'authentication_error',
            message: `invalid key ${ANTHROPIC_KEY} / ${OPENAI_KEY} while handling ${PROMPT_CANARY}`,
          },
        }),
      );
      return;
    }
    res.statusCode = 200;
    if (url.includes('/v1/messages')) {
      res.end(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: model.a.modelId,
          content: [{ type: 'text', text: RESULT_CANARY }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        }),
      );
      return;
    }
    res.end(
      JSON.stringify({
        id: 'chatcmpl-1',
        object: 'chat.completion',
        created: 1,
        model: model.b.modelId,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: RESULT_CANARY, refusal: null },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
  };

  beforeAll(async () => {
    database = makeDatabase({ unit: 'worker', poolMax: 20 });
    stopProducer = await startTestProducer();
    // Chỉ số: bộ đọc trong bộ nhớ, đăng ký TRƯỚC lần ghi đầu của `metrics.ts` (tạo công cụ đo muộn).
    reader = new PeriodicExportingMetricReader({
      exporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
      exportIntervalMillis: 3_600_000,
    });
    metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
    server = createServer((rq, rs) => {
      rq.on('data', () => undefined);
      rq.on('end', () => {
        respond(rq, rs);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const m of [model.a, model.b]) {
      await insertPrice(m, {
        effectiveFrom: new Date(Date.now() - HOUR),
        input: 1_000_000,
        output: 2_000_000,
        cached: 100_000,
      });
    }
    h = await makeAiHarness(
      'db',
      () => createAccount(),
      {
        onCrossed: (_tx, c, cycleStart) => {
          crossed.push({ c, cycleStart });
          return Promise.resolve();
        },
        count: () => Promise.resolve(0),
      },
      { routes: stubRoutes(model.a, model.b), prices: new DbPriceSource({ ttlMs: 0 }) },
    );
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) =>
      server.close(() => {
        r();
      }),
    );
    await stopProducer();
    await database.close();
  });

  function realGateway(): { gw: AiGatewayService; anthropic: AnthropicAdapter } {
    const anthropic = new AnthropicAdapter({ apiKey: ANTHROPIC_KEY, baseURL: base });
    const openai = new OpenAiAdapter({ apiKey: OPENAI_KEY, baseURL: base });
    const adapterFor = (provider: string): AiProviderAdapter | undefined =>
      provider === model.a.provider
        ? anthropic
        : provider === model.b.provider
          ? openai
          : undefined;
    const gw = new AiGatewayService({
      store: h.bundle.store,
      primary: anthropic,
      fallback: openai,
      adapterFor,
      providerTimeoutMs: 5_000,
      firstTokenTimeoutMs: 5_000,
    });
    return { gw, anthropic };
  }

  /** Mọi dòng CSDL của tài khoản mà Cổng AI ghi (sổ, giữ chỗ, ngân sách) dưới dạng chuỗi JSON. */
  async function dumpAccountRows(accountId: string): Promise<string> {
    const out: string[] = [];
    for (const table of ['ai_cost_ledger', 'ai_reservations', 'ai_budgets']) {
      const r = await asOwner((c) =>
        c.query<{ j: string }>(
          `SELECT to_jsonb(t)::text AS j FROM ai_gateway.${table} t WHERE account_id = $1`,
          [accountId],
        ),
      );
      out.push(...r.rows.map((x) => x.j));
    }
    return out.join('\n');
  }

  function logFileText(): string {
    try {
      return readFileSync(resolve(TEST_LOG_DIR, 'security-perf-regression.db.spec.ndjson'), 'utf8');
    } catch {
      return '';
    }
  }

  async function metricsText(): Promise<string> {
    const { resourceMetrics } = await reader.collect();
    return JSON.stringify(
      resourceMetrics.scopeMetrics.flatMap((s) =>
        s.metrics.map((m) => ({
          name: m.descriptor.name,
          points: (m.dataPoints as { attributes: unknown; value: unknown }[]).map((p) => ({
            attributes: p.attributes,
            value: p.value,
          })),
        })),
      ),
    );
  }

  describe('(A) khóa API không lộ ra ngoài', () => {
    it('hai nhà cung cấp cùng trả 401 có in lại khóa → AI_PROVIDER_UNAVAILABLE, không khóa trong lỗi/sổ/giữ chỗ/nhật ký/chỉ số', async () => {
      mode = 'echo401';
      const accountId = await createAccount();
      const { gw } = realGateway();
      const err = await h
        .inAccount(accountId, () => gw.generate(req()))
        .then(
          () => undefined,
          (e: unknown) => e,
        );
      expect(err).toBeInstanceOf(AiError);
      expect((err as AiError).code).toBe('AI_PROVIDER_UNAVAILABLE');
      expectNoKey(errorSurface(err), 'AiError');

      // Lỗi lượt đầu bị nuốt bởi dự phòng; đảm bảo cả hai bộ chuyển đổi đều không lộ khóa khi tự ném lỗi.
      const anthropic = new AnthropicAdapter({ apiKey: ANTHROPIC_KEY, baseURL: base });
      const openai = new OpenAiAdapter({ apiKey: OPENAI_KEY, baseURL: base });
      for (const [adapter, id] of [
        [anthropic, model.a.modelId],
        [openai, model.b.modelId],
      ] as const) {
        const e = await adapter
          .complete(
            id,
            { task: 'post_generation', parts: ['hệ thống', req().prompt.delta], images: [] },
            100,
            AbortSignal.timeout(5_000),
          )
          .then(
            () => undefined,
            (x: unknown) => x,
          );
        expect(e, adapter.provider).toBeInstanceOf(ProviderCallError);
        expect((e as ProviderCallError).kind).toBe('auth');
        expectNoKey(errorSurface(e), `ProviderCallError(${adapter.provider})`);
        expect(errorSurface(e)).not.toContain(PROMPT_CANARY);
      }

      // Cổng đã trả giữ chỗ khi lỗi và không ghi sổ cho lời gọi hỏng; mọi dòng ghi cho tài khoản đều sạch khóa/lời nhắc.
      const rows = await dumpAccountRows(accountId);
      expect(rows).not.toBe('');
      expectNoKey(rows, 'sổ/giữ chỗ/ngân sách');
      expect(rows).not.toContain(PROMPT_CANARY);
      const budget = await h.inAccount(accountId, () => h.fake.getBudget());
      expect(budget).toMatchObject({ used: 0, reserved: 0 });
    });

    it('lời gọi thành công cả hai nhà cung cấp: sổ ghi token thực, không khóa, không văn bản kết quả/lời nhắc', async () => {
      mode = 'ok';
      const accountId = await createAccount();
      const { gw } = realGateway();
      const r = await h.inAccount(accountId, () => gw.generate(req()));
      expect(r.text).toContain('QA_RESULT_CANARY_T075');
      const rows = await dumpAccountRows(accountId);
      expectNoKey(rows, 'sổ thành công');
      expect(rows).not.toContain(PROMPT_CANARY);
      expect(rows).not.toContain('QA_RESULT_CANARY_T075');
      const ledger = await h.inAccount(accountId, () => h.fake.ledger());
      expect(ledger).toHaveLength(1);
    });

    it('thông báo ngưỡng phát ra (nếu có) không chứa khóa', async () => {
      expect(crossed.length).toBeGreaterThanOrEqual(0);
      expectNoKey(JSON.stringify(crossed), 'thông báo ngưỡng');
    });

    it('chỉ số OpenTelemetry: không khóa, không lời nhắc; nhãn không có account_id/số tiền ở bộ đếm sự kiện và nhà cung cấp', async () => {
      const text = await metricsText();
      expect(text.length).toBeGreaterThan(2);
      expectNoKey(text, 'chỉ số');
      expect(text).not.toContain(PROMPT_CANARY);
      const all = JSON.parse(text) as {
        name: string;
        points: { attributes: Record<string, unknown> }[];
      }[];
      const provider = all.find((m) => m.name === 'ai_gateway_provider_calls_total');
      expect(provider, 'đã đo lời gọi nhà cung cấp').toBeDefined();
      for (const name of ['ai_gateway_provider_calls_total', 'ai_gateway_events_total']) {
        for (const p of all.find((m) => m.name === name)?.points ?? []) {
          expect(Object.keys(p.attributes), name).not.toContain('account_id');
          expect(Object.keys(p.attributes).join(','), name).not.toMatch(/micro|usd|cost|key/i);
        }
      }
    });

    it('nhật ký thao tác (log-capture): không khóa, không lời nhắc, không văn bản kết quả', () => {
      const logs = logFileText();
      expect(logs.length).toBeGreaterThan(0);
      expectNoKey(logs, 'nhật ký thao tác');
      expect(logs).not.toContain(PROMPT_CANARY);
      expect(logs).not.toContain('QA_RESULT_CANARY_T075');
      // Có ghi sự kiện lỗi nhà cung cấp (xác nhận quét không rỗng vô nghĩa).
      expect(logs).toMatch(/ai\.provider_error|provider/);
    });
  });

  describe('(B) hiệu năng giữ chỗ (SC-003)', () => {
    it('reserve p95 ≤ 50 ms trên CSDL thật, 200 lần', async () => {
      const accountId = await createAccount();
      await withAccount(accountId, async () => {
        const store = h.bundle.store;
        const key = { scope: 'account' as const, cycleStart: await store.currentCycleStart() };
        // Khởi động nóng: tạo dòng ngân sách + kết nối, không tính vào mẫu.
        for (let i = 0; i < 5; i++) {
          const w = await store.reserve(key, 10, { task: 'post_generation', modelTier: 'default' });
          if (w.ok) await store.release(w.reservationId);
        }
        const times: number[] = [];
        for (let i = 0; i < 200; i++) {
          const t0 = performance.now();
          const r = await store.reserve(key, 10, {
            task: 'post_generation',
            modelTier: 'default',
          });
          times.push(performance.now() - t0);
          expect(r.ok).toBe(true);
          if (r.ok) await store.release(r.reservationId);
        }
        times.sort((x, y) => x - y);
        const p95 = times[Math.floor(times.length * 0.95)]!;
        console.info(
          `[T075] reserve p50=${times[100]!.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${times[199]!.toFixed(1)}ms`,
        );
        expect(p95).toBeLessThanOrEqual(50);
      });
    }, 120_000);
  });

  describe('(C) giữ chỗ đầu chu kỳ đồng thời không bị từ chối sai', () => {
    const ROUNDS = 20;
    const CALLS = 12;
    const ACCOUNTS_PER_ROUND = 3;

    it(`${ROUNDS} vòng × ${CALLS} lời gọi đầu chu kỳ ở ${ACCOUNTS_PER_ROUND} tài khoản mới chồng nhau: 0 từ chối sai`, async () => {
      let rejected = 0;
      let attempts = 0;
      for (let round = 0; round < ROUNDS; round++) {
        const ids = await Promise.all(
          Array.from({ length: ACCOUNTS_PER_ROUND }, () => createAccount()),
        );
        await Promise.all(
          ids.map((accountId) =>
            h.inAccount(accountId, async () => {
              const store = h.bundle.store;
              const key = {
                scope: 'account' as const,
                cycleStart: await store.currentCycleStart(),
              };
              const results = await Promise.all(
                Array.from({ length: CALLS }, () =>
                  store.reserve(key, 10, { task: 'post_generation', modelTier: 'default' }),
                ),
              );
              attempts += results.length;
              rejected += results.filter((r) => !r.ok).length;
              const b = await h.fake.getBudget();
              expect(b.reserved).toBe(results.filter((r) => r.ok).length * 10);
              for (const r of results) if (r.ok) await store.release(r.reservationId);
              expect((await h.fake.getBudget()).reserved).toBe(0);
            }),
          ),
        );
      }
      expect(attempts).toBe(ROUNDS * ACCOUNTS_PER_ROUND * CALLS);
      expect(rejected, 'giữ chỗ bị từ chối sai khi ngân sách còn nguyên').toBe(0);
    }, 300_000);
  });
});
