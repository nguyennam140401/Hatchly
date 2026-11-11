import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { resolveAuthConfig } from '../../src/core/config/auth-config';
import { loadConfig } from '../../src/core/config/load-config';
import { setActiveDatabase } from '../../src/core/db/database';
import { ThrottleService } from '../../src/modules/account/internal/auth/throttle.service';
import { TEST_AUTH_ENV } from '../helpers/auth-env';
import { asOwner, dbUrls, describeDb, makeDatabase, type TestDatabase } from './helpers/db';

// T033 (FR-007, R6, SC-006): bộ đếm nguyên tử trong account.auth_throttle – đúng ngưỡng khi nhiều
// bản API (nhiều bể kết nối) cùng đếm, đếm song song không mất lần nào, hết cửa sổ thì đặt lại.

describeDb('ThrottleService', () => {
  let dbA: TestDatabase;
  let dbB: TestDatabase;
  let throttle: ThrottleService;

  beforeAll(() => {
    const config = resolveAuthConfig(
      loadConfig({ APP_ENV: 'test', ...TEST_AUTH_ENV, DATABASE_APP_URL: dbUrls.app }),
    );
    throttle = new ThrottleService(config);
    dbA = makeDatabase({ unit: 'api', poolMax: 10 });
    dbB = makeDatabase({ unit: 'api', poolMax: 2 });
  });
  afterAll(async () => {
    await dbA.close();
    await dbB.close();
  });

  const email = () => `dò.${randomBytes(4).toString('hex')}@example.test`;

  it('login_email: 5 lần sai từ 2 bể app khác nhau → bị chặn 15 phút', async () => {
    const e = email();
    for (let i = 0; i < 5; i++) {
      // Xen kẽ hai "bản API".
      setActiveDatabase(i % 2 === 0 ? dbA.service : dbB.service);
      expect((await throttle.check('login_email', e)).blocked).toBe(false);
      expect(await throttle.hit('login_email', e)).toBe(i + 1);
    }
    setActiveDatabase(dbA.service);
    const state = await throttle.check('login_email', e);
    expect(state.blocked).toBe(true);
    expect(state.retryAfterSeconds).toBeGreaterThan(14 * 60);
    expect(state.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
  });

  it('song song 20 lần chỉ đếm đúng 20', async () => {
    setActiveDatabase(dbA.service);
    const ip = `203.0.113.${Math.floor(Math.random() * 250)}-${randomBytes(2).toString('hex')}`;
    const counts = await Promise.all(
      Array.from({ length: 20 }, () => throttle.hit('login_ip', ip)),
    );
    expect([...counts].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('consume giới hạn thư 3 lần/giờ', async () => {
    setActiveDatabase(dbA.service);
    const e = email();
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await throttle.consume('mail_reset', e));
    expect(results).toEqual([true, true, true, false]);
    // Giới hạn thư không chặn (blockMinutes null).
    expect((await throttle.check('mail_reset', e)).blocked).toBe(false);
  });

  it('hết cửa sổ (và hết chặn) → đếm lại từ 1', async () => {
    setActiveDatabase(dbA.service);
    const e = email();
    for (let i = 0; i < 5; i++) await throttle.hit('login_email', e);
    await asOwner((c) =>
      c.query(
        `UPDATE account.auth_throttle SET window_start = now() - interval '1 hour',
           blocked_until = now() - interval '1 second' WHERE kind = 'login_email' AND count >= 5`,
      ),
    );
    expect((await throttle.check('login_email', e)).blocked).toBe(false);
    expect(await throttle.hit('login_email', e)).toBe(1);
  });

  it('reset xóa bộ đếm; khóa lưu là HMAC (không có email dạng rõ)', async () => {
    setActiveDatabase(dbA.service);
    const e = email();
    await throttle.hit('login_email', e);
    const stored = await asOwner(async (c) => {
      const r = await c.query<{ key_hash: Buffer }>(
        `SELECT key_hash FROM account.auth_throttle WHERE kind = 'login_email'`,
      );
      return r.rows.map((row) => row.key_hash.toString('utf8'));
    });
    expect(stored.some((k) => k.includes(e))).toBe(false);
    await throttle.reset('login_email', e);
    expect(await throttle.hit('login_email', e)).toBe(1);
  });
});
