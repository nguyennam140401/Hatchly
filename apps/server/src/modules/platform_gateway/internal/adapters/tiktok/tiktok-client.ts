// Máy khách TikTok Open API bọc `fetch` có sẵn của Node (010 T079, contracts/meta-tiktok-adapters.md mục 4) – KHÔNG SDK ngoài.
// Quy tắc bảo mật (hiến pháp VII): mã quyền chỉ đi trong tiêu đề `Authorization`; `code`, `client_secret`, `refresh_token` đi trong
// THÂN form (POST), KHÔNG BAO GIỜ trong URL/nhật ký/thông điệp lỗi. Lỗi đưa ra là `TiktokError` chỉ có mã gốc đã lọc – KHÔNG mang
// `message`/`log_id` do TikTok trả (có thể chứa dữ liệu). [POC-2 / TikTok review] chi tiết điểm cuối là giả định cần kiểm chứng.
export interface TiktokClientOptions {
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export class TiktokError extends Error {
  /** `TT:<mã>` đã lọc `[A-Za-z0-9_.:-]{1,64}`. */
  readonly rawCode: string;
  readonly httpStatus: number | null;
  readonly sent: boolean;

  constructor(init: { rawCode: string; httpStatus: number | null; sent: boolean }) {
    super(`TikTok API lỗi ${init.rawCode}`);
    this.name = 'TiktokError';
    this.rawCode = init.rawCode;
    this.httpStatus = init.httpStatus;
    this.sent = init.sent;
  }
}

const clean = (s: string): string => s.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 64);

function networkFailure(err: unknown): { code: string; sent: boolean } {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'AbortError' || name === 'TimeoutError') return { code: 'TIMEOUT_AFTER_SEND', sent: true };
  const code = (err as { cause?: { code?: string } } | null)?.cause?.code ?? '';
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code)) {
    return { code: 'NET_BEFORE_SEND', sent: false };
  }
  return { code: 'NET_AFTER_SEND', sent: true };
}

export class TiktokClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: TiktokClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Gọi một điểm cuối. `token` (nếu có) chỉ đi trong tiêu đề; `form` là thân form (bí mật OAuth). Trả JSON; lỗi ⇒ `TiktokError`. */
  async request<T>(
    method: 'GET' | 'POST',
    path: string,
    init: {
      token?: string;
      query?: Record<string, string>;
      form?: Record<string, string>;
      body?: Record<string, unknown>;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const url = new URL(`${this.opts.baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`);
    for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
    const timeout = AbortSignal.timeout(this.opts.timeoutMs);
    const signal = init.signal === undefined ? timeout : AbortSignal.any([timeout, init.signal]);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          Accept: 'application/json',
          ...(init.token !== undefined && init.token !== ''
            ? { Authorization: `Bearer ${init.token}` }
            : {}),
          ...(init.form !== undefined
            ? { 'Content-Type': 'application/x-www-form-urlencoded' }
            : {}),
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(init.form !== undefined ? { body: new URLSearchParams(init.form).toString() } : {}),
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal,
      });
    } catch (err) {
      const f = networkFailure(err);
      throw new TiktokError({ rawCode: `TT:${f.code}`, httpStatus: null, sent: f.sent });
    }
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    // TikTok trả HTTP 200 kèm `error.code !== 'ok'` ở nhiều điểm cuối, và OAuth trả `error` dạng chuỗi – coi là lỗi theo mã.
    const body = payload as { error?: unknown } | null;
    const objCode = (body?.error as { code?: unknown } | undefined)?.code;
    const stringErr = typeof body?.error === 'string' && body.error !== '' ? body.error : undefined;
    const failed = stringErr !== undefined || (typeof objCode === 'string' && objCode !== 'ok');
    if (res.ok && !failed) return payload as T;
    const raw = stringErr ?? (typeof objCode === 'string' && objCode !== 'ok' ? objCode : `HTTP_${res.status}`);
    throw new TiktokError({ rawCode: `TT:${clean(raw)}`, httpStatus: res.status, sent: true });
  }
}
