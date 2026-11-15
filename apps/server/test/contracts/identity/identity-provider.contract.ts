import { describe, expect, it } from 'vitest';
import {
  ProviderError,
  type IdentityProvider,
  type ProviderErrorKind,
} from '../../../src/modules/account/internal/auth/oauth/identity-provider';

// T019 (009, contracts/module-api.md mục 3): hợp đồng chung của nhà cung cấp đăng nhập – chạy trên bản
// giả lập (luôn) và bản thật (khi có khóa trong biến môi trường, như 005).

export interface IdentityProviderHarness {
  provider: IdentityProvider;
  /** Bí mật ứng dụng – KHÔNG được xuất hiện trong địa chỉ ủy quyền. */
  appSecret: string;
  /** Mã đổi được hồ sơ (bản thật không tự sinh được → undefined, ca bị bỏ qua). */
  validCode?: (() => string) | undefined;
  /** Mã chắc chắn bị nhà cung cấp từ chối. */
  rejectedCode: string;
  /** Mã khiến nhà cung cấp "gặp sự cố" (chỉ bản giả lập). */
  downCode?: string | undefined;
}

async function kindOf(run: () => Promise<unknown>): Promise<ProviderErrorKind | 'no_error'> {
  try {
    await run();
    return 'no_error';
  } catch (err) {
    expect(err).toBeInstanceOf(ProviderError);
    return (err as ProviderError).kind;
  }
}

export function describeIdentityProviderContract(make: () => IdentityProviderHarness): void {
  describe('hợp đồng nhà cung cấp đăng nhập', () => {
    const STATE = 'state_contract_0123456789';
    const VERIFIER = 'verifier_contract_0123456789_0123456789_0123456789';

    it('authorizationUrl chứa state (và code_challenge khi dùng PKCE), không chứa bí mật', async () => {
      const h = make();
      const url = await h.provider.authorizationUrl({
        state: STATE,
        codeVerifier: h.provider.usesPkce ? VERIFIER : null,
      });
      expect(url).toBeInstanceOf(URL);
      expect(url.searchParams.get('state')).toBe(STATE);
      if (h.provider.usesPkce) {
        expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        // Mã kiểm PKCE gốc không bao giờ rời máy chủ.
        expect(url.toString()).not.toContain(VERIFIER);
      }
      expect(url.toString()).not.toContain(h.appSecret);
    });

    it('exchange trả ProviderProfile đúng 5 trường, không có mã quyền', async (ctx) => {
      const h = make();
      if (h.validCode === undefined) {
        ctx.skip(); // bản thật cần người bấm đồng ý trên trình duyệt
        return;
      }
      const profile = await h.provider.exchange({
        code: h.validCode(),
        codeVerifier: h.provider.usesPkce ? VERIFIER : null,
      });
      expect(Object.keys(profile).sort()).toEqual(
        ['displayName', 'email', 'emailVerified', 'provider', 'subject'].sort(),
      );
      expect(profile.provider).toBe(h.provider.name);
      expect(profile.subject).not.toBe('');
      expect(typeof profile.emailVerified).toBe('boolean');
      if (profile.email === null) expect(profile.emailVerified).toBe(false);
      expect(JSON.stringify(profile)).not.toMatch(/access_token|id_token|refresh_token/i);
    });

    it('mã bị từ chối → ProviderError invalid_grant', async () => {
      const h = make();
      const kind = await kindOf(() =>
        h.provider.exchange({
          code: h.rejectedCode,
          codeVerifier: h.provider.usesPkce ? VERIFIER : null,
        }),
      );
      expect(kind).toBe('invalid_grant');
    });

    it('nhà cung cấp gặp sự cố → ProviderError unavailable', async (ctx) => {
      const h = make();
      if (h.downCode === undefined) {
        ctx.skip();
        return;
      }
      const down = h.downCode;
      const kind = await kindOf(() =>
        h.provider.exchange({ code: down, codeVerifier: h.provider.usesPkce ? VERIFIER : null }),
      );
      expect(kind).toBe('unavailable');
    });
  });
}
