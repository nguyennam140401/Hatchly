import { createHmac } from 'node:crypto';
import {
  ProviderError,
  withProviderTimeout,
  type IdentityProvider,
  type ProviderProfile,
} from './identity-provider';

// Nhà cung cấp đăng nhập THẬT qua thư viện `arctic` 3.7.0 (009, research R1–R3). Chữ ký của thư viện
// ghi ở đầu `identity-provider.ts`. Gói chỉ có bản ESM, mã máy chủ build ra CommonJS → nạp bằng
// `await import('arctic')`. Mã quyền của nhà cung cấp chỉ sống trong một lời gọi `exchange`: không
// ghi CSDL, không ghi nhật ký, không trả ra ngoài (FR-005). Không lấy ảnh đại diện (FR-006).

// ESLint (tsconfig Bundler) không suy được kiểu của `import()` có `resolution-mode`; tsc build (Node16)
// thì cần đúng cú pháp này cho gói ESM-only. Kiểu thật vẫn được kiểm khi build.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
type Arctic = typeof import('arctic', { with: { 'resolution-mode': 'import' } });
let arcticModule: Promise<Arctic> | undefined;
function arctic(): Promise<Arctic> {
  arcticModule ??= import('arctic');
  return arcticModule;
}

/** Sinh `state` và `code_verifier` bằng hàm của thư viện giao thức (nguyên tắc VII). */
export async function generateOAuthSecrets(): Promise<{ state: string; codeVerifier: string }> {
  const lib = await arctic();
  return { state: lib.generateState(), codeVerifier: lib.generateCodeVerifier() };
}

/** Đổi lỗi của `arctic`/fetch thành `ProviderError` phân loại được. */
async function classify<T>(fn: () => Promise<T>): Promise<T> {
  const lib = await arctic();
  try {
    return await withProviderTimeout(fn);
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if (err instanceof lib.OAuth2RequestError) {
      // `invalid_grant`: mã đã dùng/hết hạn/sai. Mã khác (vd invalid_client) là lỗi cấu hình phía ta.
      throw new ProviderError(
        err.code === 'invalid_grant' ? 'invalid_grant' : 'malformed',
        err.code,
      );
    }
    if (err instanceof lib.ArcticFetchError) throw new ProviderError('unavailable', 'fetch_failed');
    if (
      err instanceof lib.UnexpectedResponseError ||
      err instanceof lib.UnexpectedErrorResponseBodyError
    ) {
      throw new ProviderError(
        err.status >= 500 ? 'unavailable' : 'malformed',
        `http_${err.status}`,
      );
    }
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new ProviderError('unavailable', 'timeout');
    }
    throw new ProviderError('malformed', 'unexpected');
  }
}

const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export class GoogleIdentityProvider implements IdentityProvider {
  readonly name = 'google' as const;
  readonly usesPkce = true;

  constructor(
    private readonly config: { clientId: string; clientSecret: string; redirectUri: string },
  ) {}

  private async client() {
    const { Google } = await arctic();
    return new Google(this.config.clientId, this.config.clientSecret, this.config.redirectUri);
  }

  async authorizationUrl(input: { state: string; codeVerifier: string | null }): Promise<URL> {
    if (input.codeVerifier === null) throw new ProviderError('malformed', 'missing_code_verifier');
    const client = await this.client();
    return client.createAuthorizationURL(input.state, input.codeVerifier, [
      'openid',
      'profile',
      'email',
    ]);
  }

  async exchange(input: { code: string; codeVerifier: string | null }): Promise<ProviderProfile> {
    const verifier = input.codeVerifier;
    if (verifier === null) throw new ProviderError('invalid_grant', 'missing_code_verifier');
    const client = await this.client();
    const { decodeIdToken } = await arctic();
    return classify(async () => {
      const tokens = await client.validateAuthorizationCode(input.code, verifier);
      // ID token nhận trực tiếp từ điểm cuối đổi mã qua TLS (OIDC Core 3.1.3.7) – vẫn kiểm iss/aud/exp.
      let claims: Record<string, unknown>;
      try {
        claims = decodeIdToken(tokens.idToken()) as Record<string, unknown>;
      } catch {
        throw new ProviderError('malformed', 'id_token_undecodable');
      }
      const { iss, aud, exp, sub, email, name } = claims;
      if (typeof iss !== 'string' || !GOOGLE_ISSUERS.has(iss)) {
        throw new ProviderError('malformed', 'id_token_iss');
      }
      if (aud !== this.config.clientId) throw new ProviderError('malformed', 'id_token_aud');
      if (typeof exp !== 'number' || exp * 1000 <= Date.now()) {
        throw new ProviderError('malformed', 'id_token_exp');
      }
      if (typeof sub !== 'string' || sub === '')
        throw new ProviderError('malformed', 'id_token_sub');
      const hasEmail = typeof email === 'string' && email !== '';
      return {
        provider: 'google',
        subject: sub,
        email: hasEmail ? email : null,
        // Đúng giá trị `email_verified` của Google – không suy diễn.
        emailVerified: hasEmail && claims.email_verified === true,
        displayName: typeof name === 'string' && name.trim() !== '' ? name.trim() : null,
      };
    });
  }
}

export class FacebookIdentityProvider implements IdentityProvider {
  readonly name = 'facebook' as const;
  readonly usesPkce = false;

  constructor(
    private readonly config: {
      appId: string;
      appSecret: string;
      redirectUri: string;
      /** Chỉ áp dụng cho lời gọi `/me`; địa chỉ ủy quyền/đổi mã cố định trong `arctic`. */
      graphVersion: string;
    },
  ) {}

  private async client() {
    const { Facebook } = await arctic();
    return new Facebook(this.config.appId, this.config.appSecret, this.config.redirectUri);
  }

  async authorizationUrl(input: { state: string; codeVerifier: string | null }): Promise<URL> {
    const client = await this.client();
    return client.createAuthorizationURL(input.state, ['public_profile', 'email']);
  }

  async exchange(input: { code: string; codeVerifier: string | null }): Promise<ProviderProfile> {
    const client = await this.client();
    return classify(async () => {
      const tokens = await client.validateAuthorizationCode(input.code);
      // Mã quyền chỉ nằm trong biến cục bộ này: dùng cho ĐÚNG MỘT lời gọi /me rồi bỏ.
      const accessToken = tokens.accessToken();
      const proof = createHmac('sha256', this.config.appSecret).update(accessToken).digest('hex');
      const url = new URL(`https://graph.facebook.com/${this.config.graphVersion}/me`);
      url.searchParams.set('fields', 'id,name,email');
      url.searchParams.set('appsecret_proof', proof);
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(10_000),
        });
      } catch (err) {
        if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
          throw new ProviderError('unavailable', 'timeout');
        }
        throw new ProviderError('unavailable', 'fetch_failed');
      }
      if (!response.ok) {
        throw new ProviderError(
          response.status >= 500 ? 'unavailable' : 'malformed',
          `me_http_${response.status}`,
        );
      }
      let body: Record<string, unknown>;
      try {
        body = (await response.json()) as Record<string, unknown>;
      } catch {
        throw new ProviderError('malformed', 'me_not_json');
      }
      const { id, name, email } = body;
      if (typeof id !== 'string' || id === '') throw new ProviderError('malformed', 'me_no_id');
      const hasEmail = typeof email === 'string' && email !== '';
      return {
        provider: 'facebook',
        subject: id,
        email: hasEmail ? email : null,
        // Research R3, quickstart mục 3: Facebook chỉ trả email đã được xác nhận với họ, nên CÓ trả
        // email = đã xác minh; KHÔNG trả = chưa. Đây là chỗ DUY NHẤT quyết định độ tin của email
        // Facebook – đổi quy tắc thì đổi ở đây và cập nhật research R3.
        emailVerified: hasEmail,
        displayName: typeof name === 'string' && name.trim() !== '' ? name.trim() : null,
      };
    });
  }
}
