import type { OAuthConfig } from '../../../../../core';
import { FacebookIdentityProvider, GoogleIdentityProvider } from './arctic.providers';
import { FakeIdentityProvider } from './fake.provider';
import type { IdentityProvider, IdentityProviders, ProviderName } from './identity-provider';

// Chọn bản cài đặt nhà cung cấp theo OAUTH_DRIVER (009, T023). `off` (staging/production chưa đặt
// biến) → bản đồ rỗng: điểm cuối bắt đầu trả 503 PROVIDER_UNAVAILABLE, đăng nhập bằng email vẫn chạy.

/** Địa chỉ quay về đăng ký với nhà cung cấp (contracts/module-api.md mục 6). */
export function oauthRedirectUri(webBaseUrl: string, provider: ProviderName): string {
  return `${webBaseUrl}/api/v1/auth/oauth/${provider}/callback`;
}

export function buildIdentityProviders(
  oauth: OAuthConfig,
  webBaseUrl: string,
  appEnv: string,
): IdentityProviders {
  const map = new Map<ProviderName, IdentityProvider>();
  // Bản giả lập cho đăng nhập bằng danh tính tùy ý → chỉ development/test, kể cả khi bước kiểm tra
  // cấu hình bị bỏ qua (lớp chặn thứ hai, cùng với assertNoFakes).
  const devOnly = appEnv === 'development' || appEnv === 'test';
  if (oauth.driver === 'fake' && devOnly) {
    map.set('google', new FakeIdentityProvider('google', webBaseUrl));
    map.set('facebook', new FakeIdentityProvider('facebook', webBaseUrl));
  } else if (oauth.driver === 'real') {
    if (oauth.google !== null) {
      map.set(
        'google',
        new GoogleIdentityProvider({
          ...oauth.google,
          redirectUri: oauthRedirectUri(webBaseUrl, 'google'),
        }),
      );
    }
    if (oauth.facebook !== null) {
      map.set(
        'facebook',
        new FacebookIdentityProvider({
          ...oauth.facebook,
          redirectUri: oauthRedirectUri(webBaseUrl, 'facebook'),
          graphVersion: oauth.facebookGraphVersion,
        }),
      );
    }
  }
  return map;
}
