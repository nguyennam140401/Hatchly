import { createHash } from 'node:crypto';
import {
  ProviderError,
  type IdentityProvider,
  type ProviderName,
  type ProviderProfile,
} from './identity-provider';

// Nhà cung cấp đăng nhập GIẢ LẬP (009, contracts/module-api.md mục 6) – chỉ khi OAUTH_DRIVER=fake
// (development/test; staging/production từ chối khởi động). Không gọi mạng: địa chỉ ủy quyền trỏ về
// trang `GET /api/v1/dev/oauth/fake/authorize`, mã giả mang kịch bản và được đọc lại ở `exchange`.

export const FAKE_SCENARIOS = [
  'google_verified',
  'google_unverified',
  'facebook_with_email',
  'facebook_no_email',
  'cancel',
  'provider_down',
] as const;
export type FakeScenario = (typeof FAKE_SCENARIOS)[number];

export const FAKE_AUTHORIZE_PATH = '/api/v1/dev/oauth/fake/authorize';
const CODE_PREFIX = 'fake.';

export interface FakeCodePayload {
  scenario: FakeScenario;
  sub?: string | undefined;
  email?: string | undefined;
  name?: string | undefined;
}

/** Kịch bản dùng được với nhà cung cấp nào (`cancel`, `provider_down` dùng cho cả hai). */
export function scenarioFits(scenario: FakeScenario, provider: ProviderName): boolean {
  if (scenario === 'cancel' || scenario === 'provider_down') return true;
  return scenario.startsWith(`${provider}_`);
}

/** Mã giả mang kịch bản (base64url của JSON) – chỉ có nghĩa với bản giả lập. */
export function encodeFakeCode(payload: FakeCodePayload): string {
  return CODE_PREFIX + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeFakeCode(code: string): FakeCodePayload {
  if (!code.startsWith(CODE_PREFIX)) throw new ProviderError('invalid_grant', 'not_a_fake_code');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(code.slice(CODE_PREFIX.length), 'base64url').toString('utf8'));
  } catch {
    throw new ProviderError('invalid_grant', 'undecodable_fake_code');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new ProviderError('invalid_grant', 'undecodable_fake_code');
  }
  const p = parsed as Record<string, unknown>;
  const scenario = FAKE_SCENARIOS.find((s) => s === p.scenario);
  if (scenario === undefined) throw new ProviderError('malformed', 'unknown_scenario');
  const text = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);
  return { scenario, sub: text(p.sub), email: text(p.email), name: text(p.name) };
}

export class FakeIdentityProvider implements IdentityProvider {
  readonly usesPkce: boolean;

  constructor(
    readonly name: ProviderName,
    private readonly webBaseUrl: string,
  ) {
    this.usesPkce = name === 'google';
  }

  authorizationUrl(input: { state: string; codeVerifier: string | null }): Promise<URL> {
    const url = new URL(`${this.webBaseUrl}${FAKE_AUTHORIZE_PATH}`);
    url.searchParams.set('provider', this.name);
    url.searchParams.set('state', input.state);
    if (this.usesPkce) {
      if (input.codeVerifier === null) {
        return Promise.reject(new ProviderError('malformed', 'missing_code_verifier'));
      }
      url.searchParams.set(
        'code_challenge',
        createHash('sha256').update(input.codeVerifier, 'ascii').digest('base64url'),
      );
      url.searchParams.set('code_challenge_method', 'S256');
    }
    return Promise.resolve(url);
  }

  exchange(input: { code: string; codeVerifier: string | null }): Promise<ProviderProfile> {
    try {
      return Promise.resolve(this.profileOf(decodeFakeCode(input.code), input.codeVerifier));
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new ProviderError('malformed'));
    }
  }

  private profileOf(payload: FakeCodePayload, codeVerifier: string | null): ProviderProfile {
    if (payload.scenario === 'provider_down') throw new ProviderError('unavailable', 'fake_down');
    if (payload.scenario === 'cancel') throw new ProviderError('cancelled', 'fake_cancel');
    if (!scenarioFits(payload.scenario, this.name)) {
      throw new ProviderError('malformed', 'scenario_provider_mismatch');
    }
    if (this.usesPkce && codeVerifier === null) {
      throw new ProviderError('invalid_grant', 'missing_code_verifier');
    }
    const email = payload.email ?? 'nguoi.dung@example.test';
    // Mã người dùng mặc định ổn định theo email → đăng nhập lại ra cùng danh tính.
    const subject =
      payload.sub ??
      `fake-${this.name}-${createHash('sha256').update(email, 'utf8').digest('hex').slice(0, 16)}`;
    const displayName = payload.name ?? 'Người dùng thử';
    switch (payload.scenario) {
      case 'google_verified':
      case 'facebook_with_email':
        return { provider: this.name, subject, email, emailVerified: true, displayName };
      case 'google_unverified':
        return { provider: this.name, subject, email, emailVerified: false, displayName };
      case 'facebook_no_email':
        return { provider: this.name, subject, email: null, emailVerified: false, displayName };
    }
  }
}
