import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { OpenAiAdapter } from '../../src/modules/ai_gateway/internal/providers/openai';
import { ProviderCallError } from '../../src/modules/ai_gateway/internal/providers/provider-error';
import { TEST_LOG_DIR } from '../setup/log-capture';

// 015 US4 (reviews/us4.md mục 1, 2): chuyển giọng nói của OpenAiAdapter trên máy chủ HTTP giả cục bộ.
//  - Tên tệp gửi đi là `audio.<đuôi>` (đuôi URL → content-type → mặc định mp3) vì điểm cuối nhận biết định dạng theo đuôi.
//  - SSRF: chỉ host trong danh sách (kể cả tên miền con), https, không chuyển hướng, trần byte, lỗi không lộ URL ký sẵn.
// Máy chủ giả chỉ phục vụ `baseURL` của test (ngoại lệ duy nhất cho http); các URL "https://..." khác được chặn hoặc
// chặn bằng `fetch` giả (vi.spyOn) nên KHÔNG có lời gọi mạng ngoài.

const KEY = 'sk-test-SECRETKEY-0123456789abcdef';
const SIG = 'SIGSECRET123';
const S3_HOST = 's3.example.vn';
const REAL_FETCH = globalThis.fetch;

let server: Server;
let base: string;
let origin: string; // http://127.0.0.1:<cổng>
let recorded: { method: string; url: string; raw: Buffer }[] = [];
let handler: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => {
  res.statusCode = 500;
  res.end('{}');
};

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      recorded.push({ method: req.method ?? '', url: req.url ?? '', raw: Buffer.concat(chunks) });
      handler(req, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  base = origin;
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
afterEach(() => {
  vi.restoreAllMocks();
});

const AUDIO = Buffer.alloc(2048, 7);

/** GET → âm thanh với `content-type` cho trước; POST → kết quả chuyển giọng nói. */
function audioHandler(contentType: string, body: Buffer = AUDIO): typeof handler {
  return (req, res) => {
    if (req.method === 'GET') {
      res.statusCode = 200;
      res.setHeader('content-type', contentType);
      res.end(body);
      return;
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ text: 'xin chào các bạn', duration: 12 }));
  };
}
function audioServer(contentType: string, body: Buffer = AUDIO) {
  handler = audioHandler(contentType, body);
}

const posts = () => recorded.filter((r) => r.method === 'POST');
const gets = () => recorded.filter((r) => r.method === 'GET');
const live = () => new AbortController().signal;
const make = (extra: Partial<ConstructorParameters<typeof OpenAiAdapter>[0]> = {}) =>
  new OpenAiAdapter({ apiKey: KEY, baseURL: base, ...extra });

/** Tên tệp trong phần multipart của yêu cầu chuyển giọng nói. */
function uploadedFilename(): string | undefined {
  return /filename="([^"]*)"/.exec(posts()[0]?.raw.toString('latin1') ?? '')?.[1];
}

const failure = async (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => {
      throw new Error('mong đợi bị từ chối nhưng lại thành công');
    },
    (e: unknown) => e,
  );

function errText(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur instanceof Error; i++) {
    parts.push(cur.name, cur.message, cur.stack ?? '');
    try {
      parts.push(JSON.stringify(cur, Object.getOwnPropertyNames(cur)));
    } catch {
      /* vòng tham chiếu */
    }
    cur = cur.cause;
  }
  return parts.join('\n');
}

function logFile(): string {
  try {
    return readFileSync(resolve(TEST_LOG_DIR, 'us4-stt-ssrf.spec.ndjson'), 'utf8');
  } catch {
    return '';
  }
}

/** Mọi lời gọi `fetch` toàn cục có URL chứa `part`. */
function fetchCallsTo(spy: MockInstance<typeof fetch>, part: string) {
  return spy.mock.calls.filter((c) => urlOf(c[0]).includes(part));
}
const urlOf = (input: Parameters<typeof fetch>[0]): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

/** `fetch` giả: URL https của kho tệp giả trả âm thanh; mọi URL khác đi tiếp tới `fetch` thật (máy chủ giả cục bộ). */
function stubS3Fetch(hostPrefix: string, contentType = 'audio/mpeg') {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(hostPrefix)) {
      return Promise.resolve(
        new Response(AUDIO, { status: 200, headers: { 'content-type': contentType } }),
      );
    }
    return REAL_FETCH(input, init);
  });
}

describe('openai STT – tên tệp gửi đi có đuôi đúng (reviews/us4.md mục 1)', () => {
  const cases: [string, string, string, string][] = [
    ['đuôi URL (mp3)', '/audio/a.mp3', 'audio/mpeg', 'audio.mp3'],
    [
      'đuôi URL thắng content-type (m4a, content-type mpeg)',
      '/audio/a.m4a',
      'audio/mpeg',
      'audio.m4a',
    ],
    ['đuôi URL viết hoa (WAV)', '/audio/Ghi-Am.WAV', 'application/octet-stream', 'audio.wav'],
    ['không đuôi URL → content-type webm', '/audio/a', 'audio/webm', 'audio.webm'],
    [
      'đuôi lạ (.bin) → content-type có tham số (wav)',
      '/audio/a.bin',
      'audio/wav; charset=binary',
      'audio.wav',
    ],
    ['content-type video/mp4 → mp4', '/audio/clip', 'video/mp4', 'audio.mp4'],
    ['không suy ra được → mặc định mp3', '/audio/a', 'application/octet-stream', 'audio.mp3'],
    ['không có content-type và đuôi lạ → mặc định mp3', '/audio/a.php', '', 'audio.mp3'],
  ];
  it.each(cases)('%s', async (_name, path, contentType, expected) => {
    audioServer(contentType);
    const r = await make().transcribe(
      'whisper-x',
      `${base}${path}?X-Amz-Signature=${SIG}`,
      live(),
      {
        traceId: 't1',
      },
    );
    expect(r.text).toBe('xin chào các bạn');
    expect(posts()).toHaveLength(1);
    expect(uploadedFilename()).toBe(expected);
  });

  it('đuôi trong chuỗi truy vấn không được tính (chỉ lấy từ đường dẫn)', async () => {
    audioServer('audio/ogg');
    await make().transcribe('whisper-x', `${base}/audio/noext?name=evil.wav`, live());
    expect(uploadedFilename()).toBe('audio.ogg');
  });
});

describe('openai STT – SSRF (reviews/us4.md mục 2)', () => {
  const allow = [S3_HOST];

  it.each([
    ['host ngoài danh sách', `https://evil.example.org/a.mp3?X-Amz-Signature=${SIG}`],
    [
      'host chỉ trùng hậu tố, không phải tên miền con',
      `https://evils3.example.vn/a.mp3?X-Amz-Signature=${SIG}`,
    ],
    [
      'host của kho nằm ở vế trước (s3.example.vn.evil.com)',
      `https://${S3_HOST}.evil.com/a.mp3?X-Amz-Signature=${SIG}`,
    ],
    ['địa chỉ metadata nội bộ', `https://169.254.169.254/latest/meta-data?X-Amz-Signature=${SIG}`],
    [
      'http (không phải https) tới host trong danh sách',
      `http://${S3_HOST}/a.mp3?X-Amz-Signature=${SIG}`,
    ],
    ['URL có tài khoản:mật khẩu', `https://user:pw@${S3_HOST}/a.mp3?X-Amz-Signature=${SIG}`],
    ['giao thức khác (file:)', `file:///etc/passwd?X-Amz-Signature=${SIG}`],
    ['chuỗi không phải URL', `không-phải-url?X-Amz-Signature=${SIG}`],
  ])(
    'từ chối: %s – không tải, không gọi chuyển giọng nói, lỗi không chứa URL ký sẵn',
    async (_n, url) => {
      audioServer('audio/mpeg');
      const spy = vi.spyOn(globalThis, 'fetch');
      const err = await failure(
        make({ sttAllowedHosts: allow }).transcribe('whisper-x', url, live()),
      );
      expect(err).toBeInstanceOf(ProviderCallError);
      expect((err as ProviderCallError).kind).toBe('bad_request');
      expect(fetchCallsTo(spy, 'evil')).toHaveLength(0);
      expect(fetchCallsTo(spy, S3_HOST)).toHaveLength(0);
      expect(fetchCallsTo(spy, '169.254')).toHaveLength(0);
      expect(recorded).toHaveLength(0); // máy chủ giả không nhận gì (không tải, không POST)
      const text = errText(err);
      expect(text).not.toContain(SIG);
      expect(text).not.toContain('X-Amz');
      expect(text).not.toContain(KEY);
    },
  );

  it('danh sách host rỗng (hoặc không nêu) → từ chối mọi URL https', async () => {
    const spy = stubS3Fetch(`https://${S3_HOST}`);
    for (const opts of [{ sttAllowedHosts: [] }, {}]) {
      const err = await failure(
        make(opts).transcribe('whisper-x', `https://${S3_HOST}/a.mp3`, live()),
      );
      expect((err as ProviderCallError).kind).toBe('bad_request');
    }
    expect(fetchCallsTo(spy, S3_HOST)).toHaveLength(0);
    expect(posts()).toHaveLength(0);
  });

  it.each([
    ['host đúng danh sách', `https://${S3_HOST}/tenants/t1/a.mp3?X-Amz-Signature=${SIG}`],
    [
      'tên miền con của host trong danh sách',
      `https://bucket.${S3_HOST}/tenants/t1/a.mp3?X-Amz-Signature=${SIG}`,
    ],
    ['host viết hoa', `https://BUCKET.${S3_HOST.toUpperCase()}/tenants/t1/a.mp3`],
  ])(
    'cho phép: %s – tải đúng một lần với redirect:"error", rồi gửi chuyển giọng nói',
    async (_n, url) => {
      audioServer('audio/mpeg'); // chỉ cho POST tới máy chủ giả
      const spy = stubS3Fetch(`https://`);
      const r = await make({ sttAllowedHosts: [S3_HOST] }).transcribe('whisper-x', url, live());
      expect(r.text).toBe('xin chào các bạn');
      const mine = spy.mock.calls.filter((c) => urlOf(c[0]).toLowerCase().includes(S3_HOST));
      expect(mine).toHaveLength(1);
      expect(mine[0]![1]?.redirect).toBe('error');
      expect(posts()).toHaveLength(1);
      expect(uploadedFilename()).toBe('audio.mp3');
    },
  );

  it('host thêm qua cấu hình (AI_STT_ALLOWED_HOSTS) cũng được phép, kèm tên miền con', async () => {
    audioServer('audio/mpeg');
    stubS3Fetch('https://');
    const a = make({ sttAllowedHosts: ['media.vn-cloud.test'] });
    expect(
      (await a.transcribe('whisper-x', 'https://x.media.vn-cloud.test/a.wav', live())).text,
    ).toBe('xin chào các bạn');
    const err = await failure(a.transcribe('whisper-x', `https://${S3_HOST}/a.wav`, live()));
    expect((err as ProviderCallError).kind).toBe('bad_request');
  });

  it('chuyển hướng (302) bị từ chối, không theo sang địa chỉ đích, không gọi chuyển giọng nói', async () => {
    const ok = audioHandler('audio/mpeg');
    handler = (req, res) => {
      if (req.url?.startsWith('/audio/redir') === true) {
        res.statusCode = 302;
        res.setHeader('location', '/audio/target.mp3');
        res.end();
        return;
      }
      ok(req, res);
    };
    const err = await failure(
      make().transcribe('whisper-x', `${base}/audio/redir.mp3?X-Amz-Signature=${SIG}`, live()),
    );
    expect(err).toBeInstanceOf(ProviderCallError);
    expect(gets().map((g) => g.url.split('?')[0])).toEqual(['/audio/redir.mp3']);
    expect(posts()).toHaveLength(0);
    expect(errText(err)).not.toContain(SIG);
  });

  describe('trần dung lượng', () => {
    it('đúng bằng trần thì nhận, hơn 1 byte thì từ chối (tải theo luồng, không có content-length)', async () => {
      const cap = 2048;
      audioServer('audio/mpeg', Buffer.alloc(cap, 1));
      await make({ sttMaxBytes: cap }).transcribe('whisper-x', `${base}/a.mp3`, live());
      expect(posts()).toHaveLength(1);

      recorded = [];
      const ok = audioHandler('audio/mpeg');
      handler = (req, res) => {
        if (req.method !== 'GET') {
          ok(req, res);
          return;
        }
        res.statusCode = 200; // không content-length → chunked
        res.setHeader('content-type', 'audio/mpeg');
        res.write(Buffer.alloc(1500, 1));
        setTimeout(() => {
          res.end(Buffer.alloc(cap + 1 - 1500, 1));
        }, 30);
      };
      const err = await failure(
        make({ sttMaxBytes: cap }).transcribe(
          'whisper-x',
          `${base}/a.mp3?X-Amz-Signature=${SIG}`,
          live(),
        ),
      );
      expect((err as ProviderCallError).kind).toBe('bad_request');
      expect(posts()).toHaveLength(0);
      expect(errText(err)).not.toContain(SIG);
    });

    it('trần mặc định 25 MB: content-length khai báo 26 MB bị từ chối ngay, không gọi chuyển giọng nói', async () => {
      handler = (_req, res) => {
        res.writeHead(200, {
          'content-type': 'audio/mpeg',
          'content-length': String(26 * 1024 * 1024),
        });
        res.flushHeaders();
        setTimeout(() => {
          res.destroy();
        }, 300);
      };
      const err = await failure(
        make().transcribe('whisper-x', `${base}/a.mp3?X-Amz-Signature=${SIG}`, live()),
      );
      expect(err).toBeInstanceOf(ProviderCallError);
      expect((err as ProviderCallError).kind).toBe('bad_request');
      expect(posts()).toHaveLength(0);
      expect(errText(err)).not.toContain(SIG);
    });
  });

  describe('lỗi không lộ URL ký sẵn', () => {
    it('kho tệp trả 404 → bad_request kèm mã HTTP, thông điệp sạch', async () => {
      handler = (_req, res) => {
        res.statusCode = 404;
        res.end(`not found ${SIG}`);
      };
      const err = await failure(
        make().transcribe(
          'whisper-x',
          `${base}/a.mp3?X-Amz-Signature=${SIG}&X-Amz-Credential=AKIAQAQ`,
          live(),
        ),
      );
      expect(err).toBeInstanceOf(ProviderCallError);
      expect((err as ProviderCallError).status).toBe(404);
      const text = errText(err);
      expect(text).not.toContain(SIG);
      expect(text).not.toContain('AKIAQAQ');
      expect(text).not.toContain('X-Amz');
    });

    it('kho tệp không kết nối được (từ chối kết nối) → lỗi mạng, thông điệp sạch', async () => {
      const err = await failure(
        make().transcribe('whisper-x', `http://127.0.0.1:1/a.mp3?X-Amz-Signature=${SIG}`, live()),
      );
      expect(err).toBeInstanceOf(ProviderCallError);
      expect(errText(err)).not.toContain(SIG);
    });

    it('nhà cung cấp chuyển giọng nói trả 5xx lặp lại khóa → không lộ khóa, không lộ URL', async () => {
      handler = (req, res) => {
        if (req.method === 'GET') {
          res.setHeader('content-type', 'audio/mpeg');
          res.end(AUDIO);
          return;
        }
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: { message: `boom ${KEY} ${SIG}` } }));
      };
      const err = await failure(
        make().transcribe('whisper-x', `${base}/a.mp3?X-Amz-Signature=${SIG}`, live()),
      );
      const text = errText(err);
      expect(text).not.toContain(KEY);
      expect(text).not.toContain(SIG);
    });

    it('nhật ký thao tác không chứa URL ký sẵn sau mọi ca ở trên', () => {
      const logs = logFile();
      expect(logs).not.toContain(SIG);
      expect(logs).not.toContain('X-Amz-Signature');
      expect(logs).not.toContain(KEY);
    });
  });
});
