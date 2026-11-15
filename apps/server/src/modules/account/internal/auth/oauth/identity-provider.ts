// Nhà cung cấp đăng nhập (009, contracts/module-api.md mục 3, research R1–R3).
//
// Chữ ký THỰC TẾ của `arctic` 3.7.0 (đọc từ node_modules/arctic/dist/*.d.ts – không dựa trí nhớ):
//   - Gói chỉ có bản ESM (`"type": "module"`). Mã máy chủ biên dịch ra CommonJS (tsconfig.build:
//     Node16) nên PHẢI nạp bằng `await import('arctic')`, không `import` tĩnh.
//   - `new Google(clientId, clientSecret, redirectURI)`
//       `.createAuthorizationURL(state: string, codeVerifier: string, scopes: string[]): URL` (PKCE S256)
//       `.validateAuthorizationCode(code: string, codeVerifier: string): Promise<OAuth2Tokens>`
//   - `new Facebook(clientId, clientSecret, redirectURI)`
//       `.createAuthorizationURL(state: string, scopes: string[]): URL` (không PKCE)
//       `.validateAuthorizationCode(code: string): Promise<OAuth2Tokens>`
//     Địa chỉ ủy quyền và đổi mã của Facebook cố định trong thư viện (Graph v16.0);
//     `FACEBOOK_GRAPH_VERSION` chỉ áp dụng cho lời gọi `/me` do ta thực hiện.
//   - `OAuth2Tokens`: `.accessToken(): string`, `.idToken(): string` (ném nếu thiếu trường).
//   - `generateState(): string`, `generateCodeVerifier(): string`
//   - `decodeIdToken(idToken: string): object` – CHỈ giải mã phần tải, không kiểm chữ ký. ID token nhận
//     trực tiếp từ điểm cuối đổi mã của Google qua TLS nên được tin theo OpenID Connect Core 3.1.3.7;
//     ta vẫn kiểm `iss`, `aud`, `exp`.
//   - Lỗi: `OAuth2RequestError { code, description, uri, state }` (nhà cung cấp trả lỗi OAuth, vd
//     `invalid_grant`), `ArcticFetchError` (không gọi được), `UnexpectedResponseError { status }`,
//     `UnexpectedErrorResponseBodyError { status, data }`.
//   - Thư viện không có tham số hết thời gian chờ → bọc bằng `Promise.race` 10 giây.

export type ProviderName = 'google' | 'facebook';

export const PROVIDER_NAMES: readonly ProviderName[] = ['google', 'facebook'];

export function isProviderName(value: string): value is ProviderName {
  return value === 'google' || value === 'facebook';
}

/** Tên hiển thị trong thông điệp và thư. */
export const PROVIDER_LABELS: Record<ProviderName, string> = {
  google: 'Google',
  facebook: 'Facebook',
};

/** Hồ sơ lấy từ nhà cung cấp – KHÔNG có mã quyền (FR-005). Không lấy ảnh đại diện (FR-006). */
export interface ProviderProfile {
  provider: ProviderName;
  /** Mã người dùng phía nhà cung cấp (Google `sub`, Facebook `id`). */
  subject: string;
  email: string | null;
  /**
   * Nhà cung cấp khẳng định email thuộc về người này. Google: `email_verified` của ID token.
   * Facebook: có trả email = đã xác minh (research R3). Đây là tín hiệu DUY NHẤT quyết định nhánh
   * "đã xác minh" / "tự nhập" của research R4.
   */
  emailVerified: boolean;
  displayName: string | null;
}

export type ProviderErrorKind = 'cancelled' | 'invalid_grant' | 'unavailable' | 'malformed';

/** Lỗi phân loại được của nhà cung cấp. `detail` là mã gốc – chỉ đưa vào `support.detail`/nhật ký. */
export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    readonly detail?: string,
  ) {
    super(`PROVIDER_${kind.toUpperCase()}`);
    this.name = 'ProviderError';
  }
}

export interface IdentityProvider {
  readonly name: ProviderName;
  /** Có dùng PKCE không (Google: có). Lượt chỉ lưu `code_verifier` khi cần. */
  readonly usesPkce: boolean;
  /** Địa chỉ chuyển sang nhà cung cấp; `codeVerifier` chỉ dùng với Google. */
  authorizationUrl(input: { state: string; codeVerifier: string | null }): Promise<URL>;
  /** Đổi mã lấy hồ sơ. KHÔNG trả mã quyền ra ngoài; ném `ProviderError` phân loại được. */
  exchange(input: { code: string; codeVerifier: string | null }): Promise<ProviderProfile>;
}

/** Token DI: bản đồ nhà cung cấp theo tên; rỗng khi đăng nhập qua nhà cung cấp chưa bật. */
export const IDENTITY_PROVIDERS = Symbol('IDENTITY_PROVIDERS');
export type IdentityProviders = ReadonlyMap<ProviderName, IdentityProvider>;

/** Hạn chờ một lời gọi tới nhà cung cấp (contracts/module-api.md mục 3). */
export const PROVIDER_TIMEOUT_MS = 10_000;

/** Chạy `fn` với hạn chờ; quá hạn → `ProviderError('unavailable')`. */
export async function withProviderTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number = PROVIDER_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new ProviderError('unavailable', 'timeout'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Phân loại tham số `error` nhà cung cấp gửi về đường quay lại (RFC 6749 mục 4.1.2.1). Người dùng bấm
 * "Hủy" → `cancelled`; nhà cung cấp trục trặc → `unavailable`; còn lại là lỗi giao thức.
 */
export function classifyCallbackError(error: string): ProviderErrorKind {
  if (error === 'access_denied' || error === 'user_denied' || error === 'user_cancelled') {
    return 'cancelled';
  }
  if (error === 'server_error' || error === 'temporarily_unavailable') return 'unavailable';
  return 'malformed';
}
