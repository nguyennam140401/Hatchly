import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { resolveAuthConfig } from '../../src/core/config/auth-config';
import { resolveOAuthConfig } from '../../src/core/config/oauth-config';
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
  it('009: bốn bộ đếm mới – mail_invite 3/giờ, mail_link_confirm 3/giờ, oauth_start_ip 30/giờ, invite_account theo cấu hình', async () => {
    setActiveDatabase(dbA.service);
    const app = loadConfig({
      APP_ENV: 'test',
      ...TEST_AUTH_ENV,
      DATABASE_APP_URL: dbUrls.app,
      INVITE_MAX_PER_ACCOUNT_PER_DAY: '2',
    });
    const limited = new ThrottleService(resolveAuthConfig(app), resolveOAuthConfig(app));
    const run = async (kind: Parameters<ThrottleService['consume']>[0], key: string, n: number) => {
      const out: boolean[] = [];
      for (let i = 0; i < n; i++) out.push(await limited.consume(kind, key));
      return out;
    };
    expect(await run('mail_invite', email(), 4)).toEqual([true, true, true, false]);
    expect(await run('mail_link_confirm', email(), 4)).toEqual([true, true, true, false]);
    const ip = `198.51.100.${Math.floor(Math.random() * 250)}-${randomBytes(2).toString('hex')}`;
    const starts = await run('oauth_start_ip', ip, 31);
    expect(starts.slice(0, 30).every(Boolean)).toBe(true);
    expect(starts[30]).toBe(false);
    // Khóa theo mã tài khoản; ngưỡng lấy từ INVITE_MAX_PER_ACCOUNT_PER_DAY; tài khoản khác không ảnh hưởng.
    const account = randomBytes(8).toString('hex');
    expect(await run('invite_account', account, 3)).toEqual([true, true, false]);
    expect(await limited.consume('invite_account', randomBytes(8).toString('hex'))).toBe(true);
    // Không có cấu hình 009 (bản dựng cũ của kiểm thử) → mặc định 10.
    const fallback = await (async () => {
      const key = randomBytes(8).toString('hex');
      const out: boolean[] = [];
      for (let i = 0; i < 11; i++) out.push(await throttle.consume('invite_account', key));
      return out;
    })();
    expect(fallback.filter(Boolean)).toHaveLength(10);
    // Các bộ đếm này chỉ đếm, không chặn đăng nhập.
    expect((await limited.check('mail_invite', email())).blocked).toBe(false);
  });
});
