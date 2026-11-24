import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AnthropicAdapter } from '../../src/modules/ai_gateway/internal/providers/anthropic';
import { ProviderCallError } from '../../src/modules/ai_gateway/internal/providers/provider-error';
import type { OrderedPrompt } from '../../src/modules/ai_gateway/internal/providers/provider';

// 015 US4 (reviews/us4.md mục 4, 5) ở tầng bộ chuyển đổi Anthropic, trên máy chủ HTTP giả cục bộ:
//  - `cache_creation_input_tokens` được báo riêng (`cacheWriteInputTokens`) và vẫn nằm TRONG `inputTokens` (tổng).
//  - luồng đứt SAU `message_start` → `ProviderCallError.partialUsage` mang phần đầu vào đã biết; đứt TRƯỚC thì không có.

const KEY = 'sk-test-SECRETKEY-0123456789abcdef';

let server: Server;
let base: string;
let handler: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => {
  res.statusCode = 500;
  res.end('{}');
};
let hits = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      hits++;
      handler(req, res);
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
  hits = 0;
});

const prompt: OrderedPrompt = {
  task: 'post_generation',
  parts: ['HỆ THỐNG', 'HỒ SƠ', 'XU HƯỚNG', 'Viết bài.'],
  images: [],
};
const live = () => new AbortController().signal;
const adapter = () => new AnthropicAdapter({ apiKey: KEY, baseURL: base });

const ev = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
const messageStart = (usage: Record<string, number>) =>
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
      usage,
    },
  });
const delta = (text: string) =>
  ev('content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  });
const blockStart = ev('content_block_start', {
  type: 'content_block_start',
  index: 0,
  content_block: { type: 'text', text: '' },
});

const USAGE = {
  input_tokens: 10,
  output_tokens: 1,
  cache_read_input_tokens: 4,
  cache_creation_input_tokens: 6,
};

describe('anthropic – cache_creation báo riêng, nằm trong tổng đầu vào', () => {
  it('complete: inputTokens = thường + đọc + ghi đệm; cacheWriteInputTokens = ghi đệm; cachedInputTokens = đọc', async () => {
    handler = (_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-x',
          content: [{ type: 'text', text: 'Xin chào' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { ...USAGE, output_tokens: 5 },
        }),
      );
    };
    const r = await adapter().complete('m', prompt, 100, live());
    expect(r).toMatchObject({
      inputTokens: 20,
      outputTokens: 5,
      cachedInputTokens: 4,
      cacheWriteInputTokens: 6,
    });
  });

  it('complete: không ghi đệm → KHÔNG có cacheWriteInputTokens (công thức cũ)', async () => {
    handler = (_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-x',
          content: [{ type: 'text', text: 'Xin chào' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { ...USAGE, output_tokens: 5, cache_creation_input_tokens: 0 },
        }),
      );
    };
    const r = await adapter().complete('m', prompt, 100, live());
    expect(r.inputTokens).toBe(14);
    expect(r.cacheWriteInputTokens).toBeUndefined();
  });

  it('stream đủ: final mang cacheWriteInputTokens từ message_start', async () => {
    handler = (_req, res) => {
      res.setHeader('content-type', 'text/event-stream');
      res.end(
        [
          messageStart(USAGE),
          blockStart,
          delta('Xin chào'),
          ev('message_delta', {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: 5 },
          }),
          ev('message_stop', { type: 'message_stop' }),
        ].join(''),
      );
    };
    const s = adapter().stream('m', prompt, 100, live());
    for await (const c of s) expect(c.delta).toBe('Xin chào');
    expect(await s.final).toMatchObject({
      inputTokens: 20,
      outputTokens: 5,
      cachedInputTokens: 4,
      cacheWriteInputTokens: 6,
    });
  });
});

describe('anthropic – luồng đứt: partialUsage', () => {
  const cutAfter = (frames: string[]) => {
    handler = (_req, res) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/event-stream');
      res.write(frames.join(''));
      // Đợi dữ liệu tới client rồi ngắt kết nối giữa chừng (không có message_stop).
      setTimeout(() => {
        res.destroy();
      }, 60);
    };
  };

  async function consume(): Promise<{ got: string; err: unknown }> {
    const s = adapter().stream('m', prompt, 100, live());
    let got = '';
    let err: unknown;
    const fin = s.final.catch((e: unknown) => {
      err = e;
    });
    try {
      for await (const c of s) got += c.delta;
    } catch (e) {
      err ??= e;
    }
    await fin;
    return { got, err };
  }

  it('đứt SAU message_start và sau vài chữ → lỗi mang partialUsage (đầu vào đã biết, gồm đọc/ghi đệm), chữ đã nhận vẫn tới được bên gọi', async () => {
    cutAfter([messageStart(USAGE), blockStart, delta('Xin '), delta('chào ')]);
    const { got, err } = await consume();
    expect(got).toBe('Xin chào ');
    expect(err).toBeInstanceOf(ProviderCallError);
    expect((err as ProviderCallError).partialUsage).toMatchObject({
      inputTokens: 20,
      cachedInputTokens: 4,
      cacheWriteInputTokens: 6,
    });
    expect((err as ProviderCallError).partialUsage?.outputTokens).toBeGreaterThanOrEqual(1);
    expect(hits).toBe(1); // không thử lại bên trong
  });

  it('đứt TRƯỚC message_start (chưa có usage) → lỗi KHÔNG có partialUsage', async () => {
    cutAfter([': mở luồng\n\n']);
    const { got, err } = await consume();
    expect(got).toBe('');
    expect(err).toBeInstanceOf(ProviderCallError);
    expect((err as ProviderCallError).partialUsage).toBeUndefined();
  });

  it('thông điệp lỗi luồng đứt không chứa khóa hay nội dung đã sinh', async () => {
    cutAfter([messageStart(USAGE), blockStart, delta('CANARY_CONTENT_XYZ')]);
    const { err } = await consume();
    const text = `${(err as Error).name}\n${(err as Error).message}\n${(err as Error).stack ?? ''}`;
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('CANARY_CONTENT_XYZ');
  });
});
