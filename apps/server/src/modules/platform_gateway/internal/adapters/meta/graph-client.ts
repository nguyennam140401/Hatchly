import { revealCredential, type DecryptedCredential } from '../../vault/credential-vault';

// Máy khách Graph API của Meta bọc `fetch` có sẵn của Node (013 R9) – KHÔNG SDK ngoài để cố định phiên bản và dễ
// giả lập. Quy tắc bảo mật (nguyên tắc VII): mã quyền CHỈ đi trong tiêu đề `Authorization`, KHÔNG vào URL, KHÔNG vào
// thông điệp lỗi/nhật ký; mọi lỗi đưa ra là `GraphError` chỉ có mã gốc đã lọc.
//
// Phân biệt lỗi mạng TRƯỚC khi gửi (`sent = false`: từ chối kết nối, DNS → chắc chắn nền tảng chưa nhận) với SAU khi gửi
// (`sent = true`: hết thời gian, mất kết nối giữa chừng → không biết nền tảng đã nhận chưa).

export interface GraphClientOptions {
  baseUrl: string;
  /** Phiên bản Graph API CỐ ĐỊNH theo cấu hình (vd `v21.0`). */
  version: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export class GraphError extends Error {
  /** `<NỀN TẢNG>:<mã>[:<mã phụ>]` đã lọc `[A-Za-z0-9_.:-]{1,64}` – chưa gồm tiền tố nền tảng. */
  readonly rawCode: string;
  readonly httpStatus: number | null;
  /** Yêu cầu đã rời máy (nền tảng CÓ THỂ đã nhận). */
  readonly sent: boolean;
  readonly retryAfterSec: number | undefined;

  constructor(init: {
    rawCode: string;
    httpStatus: number | null;
    sent: boolean;
    retryAfterSec?: number;
  }) {
    super(`Graph API lỗi ${init.rawCode}`);
    this.name = 'GraphError';
    this.rawCode = init.rawCode;
    this.httpStatus = init.httpStatus;
    this.sent = init.sent;
    this.retryAfterSec = init.retryAfterSec;
  }
}

const SAFE = /[^A-Za-z0-9_.:-]/g;
const clean = (s: string) => s.replace(SAFE, '').slice(0, 64);

/** Lỗi `fetch` Node (`TypeError: fetch failed` + `cause.code`) → đã gửi hay chưa. */
function networkFailure(err: unknown): { code: string; sent: boolean } {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'AbortError' || name === 'TimeoutError')
    return { code: 'TIMEOUT_AFTER_SEND', sent: true };
  const cause = (err as { cause?: { code?: string } } | null)?.cause;
  const code = typeof cause?.code === 'string' ? cause.code : '';
  // Chưa kết nối được tới máy chủ → chắc chắn chưa gửi.
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code)) {
    return { code: 'NET_BEFORE_SEND', sent: false };
  }
  return { code: 'NET_AFTER_SEND', sent: true };
}

export class GraphClient {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly opts: GraphClientOptions,
    private readonly platformPrefix: 'FB' | 'IG',
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * Gọi Graph API. Trả JSON; lỗi → `GraphError`. `signal` hủy từ bên ngoài (hết thời gian của Cổng).
   * `body` gửi dạng JSON; `query` là tham số KHÔNG nhạy cảm (mã quyền không bao giờ đặt ở đây).
   */
  async call<T>(
    cred: DecryptedCredential,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    init: {
      query?: Record<string, string>;
      body?: Record<string, unknown>;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    return this.callWithToken<T>(revealCredential(cred), method, path, init);
  }

  /**
   * Như `call` nhưng nhận mã dạng chuỗi – CHỈ cho luồng kết nối (010) khi mã vừa nhận từ nền tảng và chưa vào kho mã
   * (đổi mã, liệt kê Page, `debug_token` bằng mã ứng dụng). Mã vẫn chỉ đi trong tiêu đề `Authorization`.
   */
  async callWithToken<T>(
    token: string,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    init: {
      query?: Record<string, string>;
      body?: Record<string, unknown>;
      form?: Record<string, string>;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const url = new URL(
      `${this.opts.baseUrl.replace(/\/+$/, '')}/${this.opts.version}/${path.replace(/^\/+/, '')}`,
    );
    for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
    const timeout = AbortSignal.timeout(this.opts.timeoutMs);
    const signal = init.signal === undefined ? timeout : AbortSignal.any([timeout, init.signal]);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          ...(token === '' ? {} : { Authorization: `Bearer ${token}` }),
          Accept: 'application/json',
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(init.form !== undefined
            ? { 'Content-Type': 'application/x-www-form-urlencoded' }
            : {}),
        },
        // Bí mật OAuth (code, client_secret, fb_exchange_token) đi trong THÂN form, không bao giờ trong URL/nhật ký.
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        ...(init.form !== undefined ? { body: new URLSearchParams(init.form).toString() } : {}),
        signal,
      });
    } catch (err) {
      const f = networkFailure(err);
      throw new GraphError({
        rawCode: `${this.platformPrefix}:${f.code}`,
        httpStatus: null,
        sent: f.sent,
      });
    }
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    if (res.ok) return payload as T;
    throw this.toError(res, payload);
  }

  private toError(res: Response, payload: unknown): GraphError {
    const e = (payload as { error?: { code?: number; error_subcode?: number } } | null)?.error;
    const retryHeader = Number(res.headers.get('retry-after'));
    const retryAfterSec =
      Number.isFinite(retryHeader) && retryHeader > 0 ? Math.ceil(retryHeader) : undefined;
    let rawCode: string;
    if (e?.code !== undefined) {
      rawCode = `${this.platformPrefix}:${e.code}${e.error_subcode !== undefined ? `:${e.error_subcode}` : ''}`;
    } else {
      rawCode = `HTTP:${res.status}`;
    }
    return new GraphError({
      rawCode: clean(rawCode),
      httpStatus: res.status,
      // Đã nhận phản hồi HTTP nghĩa là yêu cầu đã tới nền tảng.
      sent: true,
      ...(retryAfterSec !== undefined ? { retryAfterSec } : {}),
    });
  }
}
