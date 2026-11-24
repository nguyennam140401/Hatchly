import { afterAll, beforeAll, expect, it } from 'vitest';
import { AiError } from '../../src/modules/ai_gateway';
import { startTestProducer } from '../support/queue-test-kit';
import { makeAiHarness, type AiHarness } from '../contracts/ai/harness';
import {
  createAccount,
  describeDb,
  makeDatabase,
  ownerClient,
  withAccount,
  type TestDatabase,
} from '../db/helpers/db';

// T021 (015, SC-001, SC-002, SC-003, hiến chương III): đồng thời trên kho THẬT `DbBudgetStore`.
// Khác bộ hợp đồng (mục 3): quan sát bất biến từ MỘT KẾT NỐI ĐỘC LẬP (owner) trong lúc các lời gọi đang chạy – thấy đúng
// trạng thái đã commit mà người dùng khác thấy – và đối soát sổ (SC-006). Viết TRƯỚC mã: thất bại tới khi có T025–T031.
// Ghi chú tên tệp: đuôi `.db.spec.ts` để vitest bộ nhớ (`pnpm test`) bỏ qua; tasks.md ghi `concurrency.spec.ts`.

const ROUNDS = 100;
const CALLS = 25;
const CAP = 100_000;

describeDb('Cổng AI thật – đồng thời sát trần', () => {
  let database: TestDatabase;
  let h: AiHarness;

  let stopProducer: () => Promise<void>;

  beforeAll(async () => {
    database = makeDatabase({ unit: 'worker', poolMax: 20 });
    // Kho thật hẹn `release_stale` trong giao dịch giữ chỗ → cần nhà sản xuất hàng chờ.
    stopProducer = await startTestProducer();
    h = await makeAiHarness('db', () => createAccount(), {
      onCrossed: () => Promise.resolve(),
      count: () => Promise.resolve(0),
    });
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });

  const req = (maxOutputTokens: number) => ({
    task: 'post_generation' as const,
    prompt: { system: 'Bạn là trợ lý viết bài.', delta: 'Viết bài khai trương quán cà phê.' },
    maxOutputTokens,
  });

  function seeded(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it(`${ROUNDS} vòng × ${CALLS} lời gọi song song sát trần: used + reserved ≤ cap ở MỌI lần quan sát, reserved = 0 khi xong, sổ khớp`, async () => {
    const accountId = await createAccount();
    const observer = await ownerClient();
    let violations = 0;
    let samples = 0;
    let watching = false;
    const watch = async () => {
      while (watching) {
        const r = await observer.query<{ used: string; reserved: string; cap: string }>(
          'SELECT used::text, reserved::text, cap::text FROM ai_gateway.ai_budgets WHERE account_id = $1',
          [accountId],
        );
        for (const row of r.rows) {
          samples++;
          if (
            BigInt(row.used) + BigInt(row.reserved) > BigInt(row.cap) ||
            BigInt(row.reserved) < 0n
          )
            violations++;
        }
      }
    };
    try {
      await h.inAccount(accountId, async () => {
        const g = h.gateway({ providerTimeoutMs: 5_000 });
        const rand = seeded(20261124);
        let ok = 0;
        let blocked = 0;
        for (let round = 0; round < ROUNDS; round++) {
          await h.fake.setBudget({ used: 0, reserved: 0, cap: CAP });
          await h.fake.script(
            Array.from({ length: CALLS * 2 }, () => ({
              latencyMs: Math.floor(rand() * 5),
              ...(rand() < 0.1 ? { fail: 'error' as const } : {}),
              actualCostMultiplier: rand() < 0.1 ? 3 : 1,
            })),
          );
          const calls0 = h.bundle.primary.calls.length + h.bundle.fallback.calls.length;
          watching = true;
          const watcher = watch();
          const results = await Promise.allSettled(
            Array.from({ length: CALLS }, () => g.generate(req(200 + Math.floor(rand() * 1800)))),
          );
          watching = false;
          await watcher;
          for (const r of results) {
            if (r.status === 'fulfilled') ok++;
            else if ((r.reason as AiError).code === 'AI_BUDGET_EXHAUSTED') blocked++;
            else if ((r.reason as AiError).code !== 'AI_PROVIDER_UNAVAILABLE') throw r.reason;
          }
          // Kết thúc vòng: không còn giữ chỗ mở; used không vượt trần; sổ đối soát (SC-006).
          const b = await h.fake.getBudget();
          expect(b.reserved).toBe(0);
          expect(b.used).toBeLessThanOrEqual(b.cap);
          const ledger = await h.fake.ledger();
          expect(b.used).toBe(
            ledger.reduce((s, l) => s + l.costMicroUsd, 0) -
              ledger.reduce((s, l) => s + l.overCapMicroUsd, 0),
          );
          const reservations = await h.fake.reservations();
          expect(reservations.every((r) => r.state === 'settled' || r.state === 'released')).toBe(
            true,
          );
          expect(reservations.filter((r) => r.state === 'settled')).toHaveLength(ledger.length);
          // SC-002: lời gọi bị chặn không tới nhà cung cấp → số lời gọi nhà cung cấp = số giữ chỗ đã tạo.
          const callsMade = h.bundle.primary.calls.length + h.bundle.fallback.calls.length - calls0;
          expect(callsMade).toBe(reservations.length);
          await h.fake.reset();
        }
        expect(ok).toBeGreaterThan(0);
        expect(blocked).toBeGreaterThan(0);
      });
    } finally {
      watching = false;
      await observer.end();
    }
    expect(samples).toBeGreaterThan(0);
    expect(violations).toBe(0);
  }, 600_000);

  it('200 giữ chỗ song song 1 000 µUSD với trần 100 000 → đúng 100 thành công, reserved = 100 000', async () => {
    const accountId = await createAccount();
    await withAccount(accountId, async () => {
      const store = h.bundle.store;
      const key = { scope: 'account' as const, cycleStart: await store.currentCycleStart() };
      await h.fake.setBudget({ used: 0, reserved: 0, cap: CAP });
      const results = await Promise.all(
        Array.from({ length: 200 }, () =>
          store.reserve(key, 1_000, { task: 'post_generation', modelTier: 'default' }),
        ),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(100);
      expect(results.filter((r) => !r.ok)).toHaveLength(100);
      expect(await h.fake.getBudget()).toMatchObject({ used: 0, reserved: CAP });
      for (const r of results) if (r.ok) await store.release(r.reservationId);
      expect((await h.fake.getBudget()).reserved).toBe(0);
    });
  });

  it('hai tài khoản độc lập: A cạn trần không chặn B', async () => {
    const [a, b] = [await createAccount(), await createAccount()];
    await h.inAccount(a, () => h.fake.setBudget({ used: 4_000_000 }));
    await h.inAccount(a, async () => {
      const err = await h
        .gateway()
        .generate(req(50))
        .catch((e: unknown) => e);
      expect((err as AiError).code).toBe('AI_BUDGET_EXHAUSTED');
    });
    await h.inAccount(b, async () => {
      const r = await h.gateway().generate(req(50));
      expect(r.text).toMatch(/^\[fake:/);
    });
  });

  it('SC-003: reserve p95 ≤ 50 ms (200 lần tuần tự trên CSDL cục bộ)', async () => {
    const accountId = await createAccount();
    await withAccount(accountId, async () => {
      const store = h.bundle.store;
      const key = { scope: 'account' as const, cycleStart: await store.currentCycleStart() };
      const times: number[] = [];
      for (let i = 0; i < 200; i++) {
        const t0 = performance.now();
        const r = await store.reserve(key, 10, { task: 'post_generation', modelTier: 'default' });
        times.push(performance.now() - t0);
        if (r.ok) await store.release(r.reservationId);
      }
      times.sort((x, y) => x - y);
      expect(times[Math.floor(times.length * 0.95)]!).toBeLessThanOrEqual(50);
    });
  });
});
