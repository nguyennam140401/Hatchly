import { readFileSync } from 'node:fs';
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_LOG_DIR } from '../setup/log-capture';

// 015 US4 (T045 + T045a): kiểm thử HỢP ĐỒNG cho AnthropicAdapter / OpenAiAdapter trên MÁY CHỦ HTTP GIẢ cục bộ
// (http.createServer, không gọi mạng ngoài). Hợp đồng: specs/015-real-ai-gateway/contracts/provider-adapter.md mục 1–2.
//
// ĐỎ TẠM: toàn bộ tệp đỏ cho tới khi T046 (anthropic.ts), T047 (openai.ts) và T045b (traceId + noTrain ở provider.ts) xong;
// mọi ca báo cùng một lý do "Chưa có <Adapter>" (nạp động, không import tĩnh để tsc/lint không vỡ).
//
// GIẢ ĐỊNH về hình dạng mà dev cần khớp (nếu khác, QA sửa test theo - hỏi PM):
//   new AnthropicAdapter({ apiKey, baseURL })  /  new OpenAiAdapter({ apiKey, baseURL })   (baseURL trỏ vào máy chủ giả)
//   complete(model, prompt, maxOut, signal, opts?)  stream(model, prompt, maxOut, signal, opts?)
//   transcribe(model, audioUrl, signal, opts?)       với opts = { traceId?: string; noTrain?: boolean }  (T045b)
//   noTrain mặc định BẬT khi opts không nêu (an toàn mặc định, FR-025).

const KEY = 'sk-test-SECRETKEY-0123456789abcdef';
const TRACE = 'trace-0194f5a0-aaaa-7bbb-cccc-dddddddddddd';
const SYSTEM = 'SYSTEM_TXT: Bạn là trợ lý viết bài cho cửa hàng.';
const PROFILE_A = 'PROFILE_A: Quán cà phê Hoa Nắng, khách quen dân văn phòng.';
const PROFILE_B = 'PROFILE_B: Tiệm bánh Lúa Mới, khách gia đình.';
const TRENDS = 'TRENDS_TXT: tuần này mọi người quan tâm cà phê muối.';
const DELTA = 'PROMPT_CANARY_P1 Viết bài khai trương quán.';

interface CallOpts {
  traceId?: string;
  noTrain?: boolean;
}
interface ProviderResultLike {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  modelId: string;
  audioSeconds?: number;
}
interface PromptLike {
  task: string;
  parts: string[];
  images: { url: string; bytes: number }[];
}
interface AdapterLike {
  readonly provider: string;
  countInputTokens(model: string, p: PromptLike): Promise<number>;
  complete(
    model: string,
    p: PromptLike,
    maxOut: number,
    signal: AbortSignal,
    opts?: CallOpts,
  ): Promise<ProviderResultLike>;
  stream(
    model: string,
    p: PromptLike,
    maxOut: number,
    signal: AbortSignal,
    opts?: CallOpts,
  ): AsyncIterable<{ delta: string }> & { final: Promise<ProviderResultLike> };
  transcribe(
    model: string,
    audioUrl: string,
    signal: AbortSignal,
    opts?: CallOpts,
  ): Promise<ProviderResultLike>;
}

// ------------------------------------------------------------------------------------------------------------
// Máy chủ HTTP giả
// ------------------------------------------------------------------------------------------------------------

interface Recorded {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  raw: Buffer;
  json: Record<string, unknown> | undefined;
}
type Handler = (req: IncomingMessage, res: ServerResponse, rec: Recorded) => void;

let server: Server;
let base: string;
let recorded: Recorded[] = [];
let handler: Handler = (_req, res) => {
  res.statusCode = 500;
  res.end('{}');
};

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      let body: Record<string, unknown> | undefined;
      try {
        const parsed: unknown = JSON.parse(raw.toString('utf8'));
        if (parsed !== null && typeof parsed === 'object') body = parsed as Record<string, unknown>;
      } catch {
        body = undefined;
      }
      const rec: Recorded = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        raw,
        json: body,
      };
      recorded.push(rec);
      handler(req, res, rec);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) =>
    server.close(() => {
      r();
    }),
  );
});
beforeEach(() => {
  recorded = [];
});

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
};
const sse = (res: ServerResponse, frames: string[]) => {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/event-stream');
  res.end(frames.join(''));
};

/** Các yêu cầu tới điểm cuối sinh văn bản (không tính tải âm thanh). */
const apiCalls = () => recorded.filter((r) => r.method === 'POST');

// ------------------------------------------------------------------------------------------------------------
// Bảng kịch bản theo nhà cung cấp
// ------------------------------------------------------------------------------------------------------------

interface Flavor {
  name: 'anthropic' | 'openai';
  modulePath: string;
  exportName: string;
  endpoint: RegExp;
  ok(res: ServerResponse): void;
  stream(res: ServerResponse): void;
  /** Kết quả mong đợi của ok()/stream(). */
  expected: { text: string; inputTokens: number; outputTokens: number; cachedInputTokens: number };
  /** Lỗi 401 có "phản hồi" lặp lại khóa/lời nhắc (nhà cung cấp thật đôi khi làm vậy). */
  echoError(res: ServerResponse): void;
  authOk(h: IncomingHttpHeaders): boolean;
  maxTokensOf(b: Record<string, unknown>): unknown;
}

const SRC = resolve(__dirname, '..', '..', 'src', 'modules', 'ai_gateway', 'internal', 'providers');

const anthropic: Flavor = {
  name: 'anthropic',
  modulePath: resolve(SRC, 'anthropic.ts'),
  exportName: 'AnthropicAdapter',
  endpoint: /\/v1\/messages/,
  ok: (res) => {
    json(res, 200, {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-x',
      content: [{ type: 'text', text: 'Xin chào các bạn' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      // input_tokens của Anthropic KHÔNG gồm phần đọc từ đệm → adapter phải cộng để inputTokens là TỔNG (công thức giá).
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 4,
        cache_creation_input_tokens: 0,
      },
    });
  },
  stream: (res) => {
    const ev = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    sse(res, [
      ev('message_start', {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-x',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 10,
            output_tokens: 1,
            cache_read_input_tokens: 4,
            cache_creation_input_tokens: 0,
          },
        },
      }),
      ev('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }),
      ev('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Xin chào ' },
      }),
      ev('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'các bạn' },
      }),
      ev('content_block_stop', { type: 'content_block_stop', index: 0 }),
      ev('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 5 },
      }),
      ev('message_stop', { type: 'message_stop' }),
    ]);
  },
  expected: { text: 'Xin chào các bạn', inputTokens: 14, outputTokens: 5, cachedInputTokens: 4 },
  echoError: (res) => {
    json(res, 401, {
      type: 'error',
      error: {
        type: 'authentication_error',
        message: `invalid x-api-key ${KEY} while handling PROMPT_CANARY_P1`,
      },
    });
  },
  authOk: (h) => h['x-api-key'] === KEY,
  maxTokensOf: (b) => b.max_tokens,
};

const openai: Flavor = {
  name: 'openai',
  modulePath: resolve(SRC, 'openai.ts'),
  exportName: 'OpenAiAdapter',
  endpoint: /\/chat\/completions/,
  ok: (res) => {
    json(res, 200, {
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-x',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Xin chào các bạn', refusal: null },
          finish_reason: 'stop',
          logprobs: null,
        },
      ],
      // prompt_tokens của OpenAI ĐÃ gồm phần đệm.
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        prompt_tokens_details: { cached_tokens: 4 },
      },
    });
  },
  stream: (res) => {
    const chunk = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
    const head = { id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'gpt-x' };
    sse(res, [
      chunk({
        ...head,
        choices: [
          { index: 0, delta: { role: 'assistant', content: 'Xin chào ' }, finish_reason: null },
        ],
      }),
      chunk({
        ...head,
        choices: [{ index: 0, delta: { content: 'các bạn' }, finish_reason: null }],
      }),
      chunk({ ...head, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
      chunk({
        ...head,
        choices: [],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          prompt_tokens_details: { cached_tokens: 4 },
        },
      }),
      'data: [DONE]\n\n',
    ]);
  },
  expected: { text: 'Xin chào các bạn', inputTokens: 10, outputTokens: 5, cachedInputTokens: 4 },
  echoError: (res) => {
    json(res, 401, {
      error: {
        message: `Incorrect API key provided: ${KEY}. Request text: PROMPT_CANARY_P1`,
        type: 'invalid_request_error',
        code: 'invalid_api_key',
      },
    });
  },
  authOk: (h) => h.authorization === `Bearer ${KEY}`,
  maxTokensOf: (b) => b.max_completion_tokens ?? b.max_tokens,
};

// ------------------------------------------------------------------------------------------------------------
// Tiện ích
// ------------------------------------------------------------------------------------------------------------

async function make(f: Flavor, extra: Record<string, unknown> = {}): Promise<AdapterLike> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(/* @vite-ignore */ f.modulePath)) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Chưa có ${f.exportName} (T046/T047): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const Ctor = mod[f.exportName] as (new (o: Record<string, unknown>) => AdapterLike) | undefined;
  if (Ctor === undefined) throw new Error(`${f.exportName} chưa được xuất (T046/T047)`);
  return new Ctor({ apiKey: KEY, baseURL: base, ...extra });
}

const prompt = (over: Partial<PromptLike> = {}, profile = PROFILE_A): PromptLike => ({
  task: 'post_generation',
  parts: [SYSTEM, profile, TRENDS, DELTA],
  images: [],
  ...over,
});

const live = () => new AbortController().signal;

/** Mọi chuỗi `text` (và `content` dạng chuỗi) trong thân yêu cầu, theo thứ tự xuất hiện, kèm cờ cache_control của khối đó. */
function textBlocks(body: unknown): { text: string; cached: boolean }[] {
  const out: { text: string; cached: boolean }[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (v === null || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (typeof o.text === 'string') out.push({ text: o.text, cached: 'cache_control' in o });
    if (typeof o.content === 'string') out.push({ text: o.content, cached: 'cache_control' in o });
    for (const [k, child] of Object.entries(o)) {
      if (k === 'text' || (k === 'content' && typeof child === 'string')) continue;
      walk(child);
    }
  };
  const b = body as Record<string, unknown>;
  walk(b.system);
  walk(b.messages);
  return out;
}

/** Đọc hết luồng (bỏ nội dung). */
async function drain(s: AsyncIterable<{ delta: string }>): Promise<number> {
  let n = 0;
  for await (const chunk of s) n += chunk.delta.length;
  return n;
}

/** Chỉ số khối cuối cùng có `cache_control` (-1 nếu không có). */
function lastCachedIndex(blocks: { cached: boolean }[]): number {
  for (let i = blocks.length - 1; i >= 0; i--) if (blocks[i]!.cached) return i;
  return -1;
}

function logFile(): string {
  try {
    return readFileSync(resolve(TEST_LOG_DIR, 'providers.contract.spec.ndjson'), 'utf8');
  } catch {
    return '';
  }
}

function errText(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur instanceof Error; i++) {
    parts.push(cur.name, cur.message, cur.stack ?? '');
    try {
      parts.push(JSON.stringify(cur, Object.getOwnPropertyNames(cur)));
    } catch {
      /* vòng tham chiếu: bỏ qua */
    }
    cur = cur.cause;
  }
  if (!(err instanceof Error)) parts.push(String(err));
  return parts.join('\n');
}

const failure = async (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => {
      throw new Error('mong đợi bị từ chối nhưng lại thành công');
    },
    (e: unknown) => e,
  );

// ------------------------------------------------------------------------------------------------------------
// Bộ kiểm thử dùng chung cho cả hai nhà cung cấp
// ------------------------------------------------------------------------------------------------------------

describe.each([anthropic, openai])('$name – hợp đồng bộ chuyển đổi', (f) => {
  const ok: Handler = (_req, res) => {
    f.ok(res);
  };

  it('complete: kết quả chuẩn hóa (văn bản, token vào TỔNG, token ra, token đệm, mô hình) + gửi khóa đúng cách', async () => {
    handler = ok;
    const a = await make(f);
    expect(a.provider).toBe(f.name);
    const r = await a.complete('model-x', prompt(), 400, live(), { traceId: TRACE });
    expect(r).toMatchObject(f.expected);
    expect(typeof r.modelId).toBe('string');
    expect(apiCalls()).toHaveLength(1);
    const call = apiCalls()[0]!;
    expect(call.url).toMatch(f.endpoint);
    expect(f.authOk(call.headers)).toBe(true);
    expect(call.json!.model).toBe('model-x');
  });

  it('max_tokens ở phía nhà cung cấp = maxOut của yêu cầu (complete và stream)', async () => {
    handler = ok;
    const a = await make(f);
    await a.complete('model-x', prompt(), 321, live(), { traceId: TRACE });
    expect(f.maxTokensOf(apiCalls()[0]!.json!)).toBe(321);

    handler = (_req, res) => {
      f.stream(res);
    };
    const s = a.stream('model-x', prompt(), 123, live(), { traceId: TRACE });
    await drain(s);
    await s.final;
    expect(f.maxTokensOf(apiCalls()[1]!.json!)).toBe(123);
  });

  it('stream: trả từng đoạn đúng thứ tự, final có token thực', async () => {
    handler = (_req, res) => {
      f.stream(res);
    };
    const a = await make(f);
    const s = a.stream('model-x', prompt(), 200, live(), { traceId: TRACE });
    const deltas: string[] = [];
    for await (const c of s) deltas.push(c.delta);
    expect(deltas.join('')).toBe(f.expected.text);
    expect(deltas.length).toBeGreaterThan(1);
    expect(await s.final).toMatchObject(f.expected);
  });

  it('lời nhắc ghép đúng thứ tự cố định: hệ thống → hồ sơ → xu hướng → phần thay đổi', async () => {
    handler = ok;
    const a = await make(f);
    await a.complete('model-x', prompt(), 100, live(), { traceId: TRACE });
    const text = JSON.stringify(apiCalls()[0]!.json);
    const pos = [SYSTEM, PROFILE_A, TRENDS, DELTA].map((s) =>
      text.indexOf(JSON.stringify(s).slice(1, -1)),
    );
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((x, y) => x - y)).toEqual(pos);
  });

  it('không trộn hồ sơ nhiều tài khoản: yêu cầu của B không chứa hồ sơ A (và ngược lại), không giữ trạng thái giữa các lời gọi', async () => {
    handler = ok;
    const a = await make(f);
    await a.complete('model-x', prompt({}, PROFILE_A), 100, live(), { traceId: TRACE });
    await a.complete('model-x', prompt({}, PROFILE_B), 100, live(), { traceId: TRACE });
    const [first, second] = apiCalls().map((c) => JSON.stringify(c.json));
    expect(first).toContain('PROFILE_A');
    expect(first).not.toContain('PROFILE_B');
    expect(second).toContain('PROFILE_B');
    expect(second).not.toContain('PROFILE_A');
  });

  it('ảnh: chỉ khung hình thu nhỏ do bên gọi cấp, mỗi ảnh đúng một khối, không đổi url', async () => {
    handler = ok;
    const a = await make(f);
    const images = [
      { url: 'https://cdn.example/tenants/t1/frame-1.jpg', bytes: 20_000 },
      { url: 'https://cdn.example/tenants/t1/frame-2.jpg', bytes: 21_000 },
    ];
    await a.complete('model-x', prompt({ task: 'image_labeling', images }), 100, live(), {
      traceId: TRACE,
    });
    const text = JSON.stringify(apiCalls()[0]!.json);
    for (const im of images) expect(text.split(im.url)).toHaveLength(2); // đúng 1 lần
    expect(text).toMatch(f.name === 'anthropic' ? /"type":"image"/ : /"type":"image_url"/);
  });

  it('countInputTokens: cục bộ, KHÔNG gọi mạng, chặn trên (≥ ceil(byte UTF-8 / 3))', async () => {
    handler = ok;
    const a = await make(f);
    const p = prompt();
    const n = await a.countInputTokens('model-x', p);
    expect(recorded).toHaveLength(0);
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(Math.ceil(Buffer.byteLength(p.parts.join('\n'), 'utf8') / 3));
  });

  // -------------------------------------------------------------------------- lỗi + hủy

  describe('chuẩn hóa lỗi, không thử lại bên trong', () => {
    const cases: [string, Handler][] = [
      [
        '5xx',
        (_req, res) => {
          json(res, 500, { error: { message: 'boom PROMPT_CANARY_P1' } });
        },
      ],
      [
        '503 quá tải',
        (_req, res) => {
          json(res, 503, { error: { message: 'overloaded' } });
        },
      ],
      [
        '429',
        (_req, res) => {
          res.setHeader('retry-after', '1');
          json(res, 429, { error: { message: 'rate limited' } });
        },
      ],
      [
        'lỗi mạng (ngắt kết nối)',
        (req) => {
          req.socket.destroy();
        },
      ],
      [
        '401 phản hồi lặp lại khóa/lời nhắc',
        (_req, res) => {
          f.echoError(res);
        },
      ],
      [
        '400 yêu cầu sai',
        (_req, res) => {
          json(res, 400, { error: { message: 'bad request PROMPT_CANARY_P1' } });
        },
      ],
    ];
    it.each(cases)(
      '%s → ném lỗi, đúng 1 yêu cầu (không thử lại), thông điệp không lộ khóa/lời nhắc',
      async (_name, h) => {
        handler = h;
        const a = await make(f);
        const err = await failure(a.complete('model-x', prompt(), 100, live(), { traceId: TRACE }));
        expect(err).toBeInstanceOf(Error);
        const text = errText(err);
        expect(text).not.toContain(KEY);
        expect(text).not.toContain('SECRETKEY');
        expect(text).not.toContain('PROMPT_CANARY_');
        expect(text).not.toContain(PROFILE_A);
        expect(apiCalls()).toHaveLength(1);
      },
    );

    it('lỗi khi trả dần (5xx) → final và vòng lặp đều bị từ chối, 1 yêu cầu', async () => {
      handler = (_req, res) => {
        json(res, 500, { error: { message: 'boom' } });
      };
      const a = await make(f);
      const s = a.stream('model-x', prompt(), 100, live(), { traceId: TRACE });
      const finalErr = failure(s.final);
      const iterErr = failure(drain(s));
      expect(await iterErr).toBeInstanceOf(Error);
      expect(await finalErr).toBeInstanceOf(Error);
      expect(apiCalls()).toHaveLength(1);
    });
  });

  describe('AbortSignal', () => {
    it('hủy khi nhà cung cấp treo → complete bị từ chối nhanh (không đợi tới hạn của SDK)', async () => {
      handler = () => {
        /* treo, không trả lời */
      };
      const a = await make(f);
      const c = new AbortController();
      const t0 = Date.now();
      const p = failure(a.complete('model-x', prompt(), 100, c.signal, { traceId: TRACE }));
      setTimeout(() => {
        c.abort();
      }, 80);
      expect(await p).toBeInstanceOf(Error);
      expect(Date.now() - t0).toBeLessThan(3_000);
      expect(apiCalls()).toHaveLength(1); // không thử lại sau khi hủy
    });

    it('thời gian chờ (AbortSignal.timeout) → bị từ chối, được chuẩn hóa như lỗi nhà cung cấp', async () => {
      handler = () => {
        /* treo */
      };
      const a = await make(f);
      const err = await failure(
        a.complete('model-x', prompt(), 100, AbortSignal.timeout(100), { traceId: TRACE }),
      );
      expect(err).toBeInstanceOf(Error);
      expect(errText(err)).not.toContain(KEY);
      expect(apiCalls()).toHaveLength(1);
    });

    it('tín hiệu đã hủy sẵn → bị từ chối, không (hoặc không hoàn tất) gọi nhà cung cấp', async () => {
      handler = ok;
      const a = await make(f);
      const c = new AbortController();
      c.abort();
      const err = await failure(a.complete('model-x', prompt(), 100, c.signal, { traceId: TRACE }));
      expect(err).toBeInstanceOf(Error);
    });

    it('stream bị hủy giữa chừng → final bị từ chối, vòng lặp dừng', async () => {
      handler = (_req, res) => {
        res.statusCode = 200;
        res.setHeader('content-type', 'text/event-stream');
        res.write(': mở luồng\n\n'); // treo sau khi mở luồng
      };
      const a = await make(f);
      const c = new AbortController();
      const s = a.stream('model-x', prompt(), 100, c.signal, { traceId: TRACE });
      const finalErr = failure(s.final);
      const iterErr = failure(drain(s));
      setTimeout(() => {
        c.abort();
      }, 80);
      expect(await finalErr).toBeInstanceOf(Error);
      await iterErr.catch(() => undefined);
    });
  });

  // -------------------------------------------------------------------------- FR-036 / FR-025 (T045a)

  describe('FR-036: mã theo dõi truyền xuống nhà cung cấp', () => {
    it('traceId nằm trong tiêu đề hoặc siêu dữ liệu của yêu cầu, KHÔNG nằm trong nội dung lời nhắc (complete)', async () => {
      handler = ok;
      const a = await make(f);
      await a.complete('model-x', prompt(), 100, live(), { traceId: TRACE });
      const call = apiCalls()[0]!;
      const carried = JSON.stringify(call.headers) + JSON.stringify(call.json);
      expect(carried).toContain(TRACE);
      for (const b of textBlocks(call.json)) expect(b.text).not.toContain(TRACE);
    });

    it('traceId cũng được truyền ở stream', async () => {
      handler = (_req, res) => {
        f.stream(res);
      };
      const a = await make(f);
      const s = a.stream('model-x', prompt(), 100, live(), { traceId: TRACE });
      await drain(s);
      await s.final;
      const call = apiCalls()[0]!;
      expect(JSON.stringify(call.headers) + JSON.stringify(call.json)).toContain(TRACE);
      for (const b of textBlocks(call.json)) expect(b.text).not.toContain(TRACE);
    });
  });

  describe('FR-017/FR-026: nhật ký không có khóa, lời nhắc, kết quả', () => {
    it('sau mọi ca thành công/lỗi ở trên, tệp nhật ký thao tác không chứa khóa API, lời nhắc hay văn bản kết quả', async () => {
      handler = (_req, res) => {
        f.echoError(res);
      };
      const a = await make(f);
      await failure(a.complete('model-x', prompt(), 100, live(), { traceId: TRACE }));
      handler = ok;
      await a.complete('model-x', prompt(), 100, live(), { traceId: TRACE });
      const logs = logFile();
      expect(logs).not.toContain(KEY);
      expect(logs).not.toContain('SECRETKEY');
      expect(logs).not.toContain('PROMPT_CANARY_');
      expect(logs).not.toContain('Xin chào các bạn');
      expect(logs).not.toContain(PROFILE_A);
    });
  });
});

// ------------------------------------------------------------------------------------------------------------
// Đặc thù từng nhà cung cấp
// ------------------------------------------------------------------------------------------------------------

describe('anthropic – tiền tố lời nhắc cố định (prompt cache) và cờ không huấn luyện', () => {
  it('đánh dấu cache_control ở HẾT phần tiền tố (hệ thống + hồ sơ + xu hướng), phần thay đổi nằm SAU dấu đó', async () => {
    handler = (_req, res) => {
      anthropic.ok(res);
    };
    const a = await make(anthropic);
    await a.complete('model-x', prompt(), 100, live(), { traceId: TRACE });
    const blocks = textBlocks(apiCalls()[0]!.json);
    const idx = lastCachedIndex(blocks);
    expect(idx).toBeGreaterThanOrEqual(0);
    const prefix = blocks
      .slice(0, idx + 1)
      .map((b) => b.text)
      .join('\n');
    expect(prefix).toContain(SYSTEM);
    expect(prefix).toContain(PROFILE_A);
    expect(prefix).toContain(TRENDS);
    expect(prefix).not.toContain(DELTA);
    expect(
      blocks
        .slice(idx + 1)
        .map((b) => b.text)
        .join('\n'),
    ).toContain(DELTA);
  });

  it('hai lời gọi cùng tiền tố, khác phần thay đổi → tiền tố byte-for-byte giống nhau (để trúng cache)', async () => {
    handler = (_req, res) => {
      anthropic.ok(res);
    };
    const a = await make(anthropic);
    await a.complete('model-x', prompt(), 100, live(), { traceId: TRACE });
    await a.complete(
      'model-x',
      prompt({ parts: [SYSTEM, PROFILE_A, TRENDS, 'PROMPT_CANARY_P2 Viết bài khác.'] }),
      100,
      live(),
      { traceId: 'trace-other' },
    );
    const prefixOf = (i: number) => {
      const blocks = textBlocks(apiCalls()[i]!.json);
      const idx = lastCachedIndex(blocks);
      return JSON.stringify(blocks.slice(0, idx + 1));
    };
    expect(prefixOf(0)).toBe(prefixOf(1));
  });

  it('FR-025: API Anthropic không có cờ chuẩn → KHÔNG gửi tiêu đề/trường giả; noTrain (mặc định, true, false) được nhận không lỗi', async () => {
    handler = (_req, res) => {
      anthropic.ok(res);
    };
    const a = await make(anthropic);
    // Cam kết không-huấn-luyện của Anthropic nằm ở hợp đồng thương mại (docs/ai-gateway-providers.md), không bịa cờ.
    for (const opts of [
      { traceId: TRACE },
      { traceId: TRACE, noTrain: true },
      { traceId: TRACE, noTrain: false },
    ]) {
      const r = await a.complete('model-x', prompt(), 100, live(), opts);
      expect(r).toMatchObject(anthropic.expected);
    }
    expect(apiCalls()).toHaveLength(3);
    for (const call of apiCalls()) {
      const names = [...Object.keys(call.headers), ...Object.keys(call.json ?? {})].join(' ');
      expect(names).not.toMatch(
        /no[-_]?train|do[-_]?not[-_]?train|zero[-_]?retention|opt[-_]?out|store/i,
      );
    }
  });

  it('transcribe không được hỗ trợ → ném lỗi (không gọi mạng)', async () => {
    handler = () => undefined;
    const a = await make(anthropic);
    const err = await failure(a.transcribe('m', `${base}/audio/a.mp3`, live(), { traceId: TRACE }));
    expect(err).toBeInstanceOf(Error);
    expect(apiCalls()).toHaveLength(0);
  });
});

describe('openai – cờ không huấn luyện/không lưu và chuyển giọng nói', () => {
  it('FR-025: thân yêu cầu có store = false (mặc định, và khi bên gọi đặt noTrain = true)', async () => {
    handler = (_req, res) => {
      openai.ok(res);
    };
    const a = await make(openai);
    await a.complete('model-x', prompt(), 100, live(), { traceId: TRACE });
    await a.complete('model-x', prompt(), 100, live(), { traceId: TRACE, noTrain: true });
    for (const call of apiCalls()) expect(call.json!.store).toBe(false);
  });

  it('FR-025: stream cũng đặt store = false', async () => {
    handler = (_req, res) => {
      openai.stream(res);
    };
    const a = await make(openai);
    const s = a.stream('model-x', prompt(), 100, live(), { traceId: TRACE });
    await drain(s);
    await s.final;
    expect(apiCalls()[0]!.json!.store).toBe(false);
  });

  describe('transcribe', () => {
    const audioHandler: Handler = (req, res) => {
      if (req.method === 'GET') {
        res.statusCode = 200;
        res.setHeader('content-type', 'audio/mpeg');
        res.end(Buffer.alloc(2048, 7));
        return;
      }
      json(res, 200, { text: 'xin chào các bạn', duration: 900 });
    };

    it('tải âm thanh từ audioUrl rồi gửi tới điểm cuối chuyển giọng nói; trả văn bản; audioSeconds = thời lượng THỰC nhà cung cấp báo (không kẹp)', async () => {
      handler = audioHandler;
      const a = await make(openai);
      const r = await a.transcribe('whisper-x', `${base}/audio/a.mp3`, live(), { traceId: TRACE });
      expect(r.text).toBe('xin chào các bạn');
      expect(r.audioSeconds).toBe(900);
      const post = apiCalls()[0]!;
      expect(post.url).toMatch(/\/audio\/transcriptions/);
      expect(openai.authOk(post.headers)).toBe(true);
      expect(post.raw.toString('latin1')).toContain('whisper-x');
    });

    it('lỗi 5xx → ném lỗi, đúng 1 yêu cầu chuyển giọng nói, không lộ khóa', async () => {
      handler = (req, res) => {
        if (req.method === 'GET') {
          audioHandler(req, res, recorded[recorded.length - 1]!);
          return;
        }
        json(res, 500, { error: { message: `boom ${KEY}` } });
      };
      const a = await make(openai);
      const err = await failure(
        a.transcribe('whisper-x', `${base}/audio/a.mp3`, live(), { traceId: TRACE }),
      );
      expect(err).toBeInstanceOf(Error);
      expect(errText(err)).not.toContain(KEY);
      expect(apiCalls()).toHaveLength(1);
    });

    it('hủy khi đang chờ → bị từ chối nhanh', async () => {
      handler = (req, res) => {
        if (req.method === 'GET') {
          audioHandler(req, res, recorded[recorded.length - 1]!);
        }
        /* POST: treo */
      };
      const a = await make(openai);
      const c = new AbortController();
      const p = failure(
        a.transcribe('whisper-x', `${base}/audio/a.mp3`, c.signal, { traceId: TRACE }),
      );
      setTimeout(() => {
        c.abort();
      }, 150);
      expect(await p).toBeInstanceOf(Error);
    });
  });
});
