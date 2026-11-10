import { describe, expect, it } from 'vitest';
import type { Actor } from '../../src/core/context/actor.types';
import { SessionCache } from '../../src/core/auth/session-cache';
import { hashToken } from '../../src/core/auth/cookies';

// T020 (R3, data-model.md mục 7): TTL ≤ 60 giây và ≤ hạn tuyệt đối, tối đa 10.000 mục, evict.

const actor = (userId: string): Actor => ({
  kind: 'user',
  userId,
  accountId: 'acc',
  role: 'owner',
  emailVerified: true,
  sessionId: `s-${userId}`,
});

function cacheAt(start = 1_000_000) {
  const clock = { t: start };
  const cache = new SessionCache();
  cache.now = () => clock.t;
  return { cache, clock };
}

const far = new Date(9_999_999_999_999);

describe('SessionCache', () => {
  it('hết hạn sau 60 giây', () => {
    const { cache, clock } = cacheAt();
    const key = hashToken('a');
    cache.set(key, actor('u1'), far);
    clock.t += 59_999;
    expect(cache.get(key)).toMatchObject({ userId: 'u1' });
    clock.t += 1;
    expect(cache.get(key)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('không sống quá hạn tuyệt đối của phiên', () => {
    const { cache, clock } = cacheAt();
    const key = hashToken('b');
    cache.set(key, actor('u1'), new Date(clock.t + 5_000));
    clock.t += 5_000;
    expect(cache.get(key)).toBeUndefined();
  });

  it('tối đa maxEntries mục, đầy thì bỏ mục cũ nhất', () => {
    const { cache } = cacheAt();
    expect(cache.maxEntries).toBe(10_000);
    cache.maxEntries = 3;
    for (const t of ['1', '2', '3', '4']) cache.set(hashToken(t), actor(t), far);
    expect(cache.size).toBe(3);
    expect(cache.get(hashToken('1'))).toBeUndefined();
    expect(cache.get(hashToken('4'))).toBeDefined();
  });

  it('giới hạn 10.000 mục mặc định', () => {
    const { cache } = cacheAt();
    for (let i = 0; i < 10_050; i++) cache.set(hashToken(String(i)), actor(String(i)), far);
    expect(cache.size).toBe(10_000);
    expect(cache.get(hashToken('0'))).toBeUndefined();
    expect(cache.get(hashToken('10049'))).toBeDefined();
  });

  it('evict và evictWhere', () => {
    const { cache } = cacheAt();
    cache.set(hashToken('x'), actor('u1'), far);
    cache.set(hashToken('y'), actor('u1'), far);
    cache.set(hashToken('z'), actor('u2'), far);
    cache.evict(hashToken('x'));
    expect(cache.get(hashToken('x'))).toBeUndefined();
    cache.evictWhere((a) => a.kind === 'user' && a.userId === 'u1');
    expect(cache.get(hashToken('y'))).toBeUndefined();
    expect(cache.get(hashToken('z'))).toBeDefined();
  });
});
