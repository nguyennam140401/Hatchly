import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asOwner, describeDb } from '../db/helpers/db';
import {
  createTestApp,
  randomIp,
  registerAndVerify,
  uniqueEmail,
  type ErrorBody,
  type TestApp,
} from './helpers/app';
import { AccessMatrixTestModule } from './support/access-matrix.module';

// T081 – đo đạc: SC-006 (không phân biệt được email có/không qua thời gian; chống dò theo email) và
// SC-002 (p95 đăng nhập ≤ 2 giây với tham số argon2 THẬT; guard thêm ≤ 20 ms p95 khi cache trúng).

const LOGIN = '/api/v1/auth/login';
const REAL_ARGON2 = { ARGON2_MEMORY_KIB: '19456', ARGON2_TIME_COST: '2' };

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;

async function timed(fn: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

const clearThrottle = () => asOwner((c) => c.query('DELETE FROM account.auth_throttle'));

describeDb('Đo thời gian xác thực', () => {
  describe('tham số argon2 thật', () => {
    let t: TestApp;
    let email: string;
    let password: string;
    beforeAll(async () => {
      t = await createTestApp({ env: REAL_ARGON2 });
      ({ email, password } = await registerAndVerify(t));
    });
    afterAll(async () => {
      await t.close();
    });

    it('SC-006: 200 lần đăng nhập sai với email có/không có – chênh trung bình < 50 ms, cùng thông điệp', async () => {
      const known: number[] = [];
      const unknown: number[] = [];
      const messages = new Set<string>();
      for (let i = 0; i < 100; i++) {
        // Xóa bộ đếm (ngoài phần đo) để mọi lần đều thật sự chạy kiểm tra mật khẩu.
        if (i % 4 === 0) await clearThrottle();
        for (const [target, bucket] of [
          [email, known],
          [uniqueEmail('khong'), unknown],
        ] as const) {
          const agent = t.agent();
          let body: unknown;
          bucket.push(
            await timed(async () => {
              body = (await agent.post(LOGIN, { email: target, password: 'sai-mat-khau-do' })).body;
            }),
          );
          messages.add((body as ErrorBody).error.message);
        }
      }
      expect(messages.size).toBe(1);
      expect(Math.abs(mean(known) - mean(unknown))).toBeLessThan(50);
    }, 180_000);

    it('SC-002: p95 đăng nhập đúng ≤ 2 giây', async () => {
      await clearThrottle();
      const durations: number[] = [];
      for (let i = 0; i < 40; i++) {
        durations.push(await timed(() => t.agent().post(LOGIN, { email, password })));
      }
      expect(percentile(durations, 95)).toBeLessThanOrEqual(2_000);
    }, 120_000);
  });

  describe('tham số argon2 nhỏ', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await createTestApp({ extraImports: [AccessMatrixTestModule] });
    });
    afterAll(async () => {
      await t.close();
    });

    it('SC-006: 1.000 lần thử cho một email từ nhiều địa chỉ mạng → tối đa 5 lần được đánh giá', async () => {
      await clearThrottle();
      const { email, me } = await registerAndVerify(t);
      const statuses = new Map<number, number>();
      for (let i = 0; i < 1_000; i++) {
        const r = await t
          .agent({ ip: randomIp() })
          .post(LOGIN, { email, password: `doan-${i}-xx` });
        statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1);
      }
      expect(statuses.get(401)).toBe(5);
      expect(statuses.get(429)).toBe(995);
      const evaluated = await asOwner(async (c) => {
        const r = await c.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM infra.audit_log
            WHERE action = 'auth.login.failed' AND actor_id = $1`,
          [me.user.id],
        );
        return Number(r.rows[0]?.n);
      });
      expect(evaluated).toBe(5);
    }, 300_000);

    it('SC-002: guard thêm ≤ 20 ms p95 khi bộ nhớ đệm trúng', async () => {
      const { agent } = await registerAndVerify(t);
      await agent.get('/api/v1/__test/customer-unverified'); // làm nóng bộ nhớ đệm
      const guarded: number[] = [];
      const open: number[] = [];
      for (let i = 0; i < 200; i++) {
        guarded.push(await timed(() => agent.get('/api/v1/__test/customer-unverified')));
        open.push(await timed(() => agent.get('/api/v1/__test/public')));
      }
      expect(percentile(guarded, 95) - percentile(open, 95)).toBeLessThanOrEqual(20);
    }, 120_000);
  });
});
