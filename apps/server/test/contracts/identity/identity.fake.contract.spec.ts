import { describe, expect, it, vi } from 'vitest';
import {
  encodeFakeCode,
  FakeIdentityProvider,
} from '../../../src/modules/account/internal/auth/oauth/fake.provider';
import {
  classifyCallbackError,
  ProviderError,
  PROVIDER_TIMEOUT_MS,
  withProviderTimeout,
} from '../../../src/modules/account/internal/auth/oauth/identity-provider';
import { describeIdentityProviderContract } from './identity-provider.contract';

// T019 (009): bản giả lập của nhà cung cấp đăng nhập – luôn chạy.

const WEB = 'http://app.test';

describe('Google (giả lập)', () => {
  describeIdentityProviderContract(() => ({
    provider: new FakeIdentityProvider('google', WEB),
    appSecret: 'khong-co-bi-mat-o-ban-gia-lap',
    validCode: () => encodeFakeCode({ scenario: 'google_verified', email: 'lan@example.test' }),
    rejectedCode: 'ma-khong-phai-cua-ban-gia-lap',
    downCode: encodeFakeCode({ scenario: 'provider_down' }),
  }));
});

describe('Facebook (giả lập)', () => {
  describeIdentityProviderContract(() => ({
    provider: new FakeIdentityProvider('facebook', WEB),
    appSecret: 'khong-co-bi-mat-o-ban-gia-lap',
    validCode: () => encodeFakeCode({ scenario: 'facebook_with_email', email: 'lan@example.test' }),
    rejectedCode: 'ma-khong-phai-cua-ban-gia-lap',
    downCode: encodeFakeCode({ scenario: 'provider_down' }),
  }));
});

describe('kịch bản của bản giả lập', () => {
  const google = new FakeIdentityProvider('google', WEB);
  const facebook = new FakeIdentityProvider('facebook', WEB);
  const g = (payload: Parameters<typeof encodeFakeCode>[0]) =>
    google.exchange({ code: encodeFakeCode(payload), codeVerifier: 'v' });
  const f = (payload: Parameters<typeof encodeFakeCode>[0]) =>
    facebook.exchange({ code: encodeFakeCode(payload), codeVerifier: null });

  it('google_verified / google_unverified theo đúng email_verified', async () => {
    expect(
      await g({ scenario: 'google_verified', email: 'a@x.test', name: 'An', sub: 's1' }),
    ).toEqual({
      provider: 'google',
      subject: 's1',
      email: 'a@x.test',
      emailVerified: true,
      displayName: 'An',
    });
    expect((await g({ scenario: 'google_unverified', email: 'a@x.test' })).emailVerified).toBe(
      false,
    );
  });

  it('facebook_with_email → đã xác minh; facebook_no_email → không email, chưa xác minh', async () => {
    expect(await f({ scenario: 'facebook_with_email', email: 'b@x.test' })).toMatchObject({
      email: 'b@x.test',
      emailVerified: true,
    });
    expect(await f({ scenario: 'facebook_no_email', email: 'b@x.test' })).toMatchObject({
      email: null,
      emailVerified: false,
    });
  });

  it('mã người dùng mặc định ổn định theo email, khác nhau giữa hai nhà cung cấp', async () => {
    const one = await g({ scenario: 'google_verified', email: 'c@x.test' });
    const two = await g({ scenario: 'google_verified', email: 'c@x.test' });
    const fb = await f({ scenario: 'facebook_with_email', email: 'c@x.test' });
    expect(one.subject).toBe(two.subject);
    expect(fb.subject).not.toBe(one.subject);
  });

  it('kịch bản của nhà cung cấp khác → malformed; cancel → cancelled', async () => {
    await expect(f({ scenario: 'google_verified' })).rejects.toMatchObject({ kind: 'malformed' });
    await expect(g({ scenario: 'cancel' })).rejects.toMatchObject({ kind: 'cancelled' });
  });
});

describe('phân loại lỗi và hạn chờ dùng chung', () => {
  it('tham số error của đường quay về', () => {
    expect(classifyCallbackError('access_denied')).toBe('cancelled');
    expect(classifyCallbackError('user_denied')).toBe('cancelled');
    expect(classifyCallbackError('server_error')).toBe('unavailable');
    expect(classifyCallbackError('temporarily_unavailable')).toBe('unavailable');
    expect(classifyCallbackError('invalid_scope')).toBe('malformed');
  });

  it('hết chờ 10 giây → unavailable', async () => {
    expect(PROVIDER_TIMEOUT_MS).toBe(10_000);
    vi.useFakeTimers();
    try {
      const pending = withProviderTimeout(() => new Promise<never>(() => undefined));
      const caught = pending.catch((err: unknown) => err);
      await vi.advanceTimersByTimeAsync(10_000);
      const err = await caught;
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).kind).toBe('unavailable');
    } finally {
      vi.useRealTimers();
    }
  });

  it('xong trước hạn → trả kết quả', async () => {
    await expect(withProviderTimeout(() => Promise.resolve(7), 50)).resolves.toBe(7);
  });
});
