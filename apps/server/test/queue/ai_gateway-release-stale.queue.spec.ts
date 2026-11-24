// T023 (015, FR-009/FR-010, Edge Case "tiến trình chết giữa chừng", hiến chương V): việc `ai_gateway.release_stale` trên kho
// THẬT `DbBudgetStore` – giữ chỗ treo > 15 phút: `held` → `released`; `calling` → quyết toán theo ƯỚC TÍNH (kẹp trần) + sổ
// `anomaly = 'unsettled'`; chạy dọn hai lần cho cùng kết quả. Tệp mới cho kho thật; `ai-release-stale.queue.spec.ts` hiện có
// là của bản giả lập sandbox (005). Viết TRƯỚC mã (T025/T026/T030): thất bại cho tới khi có `DbBudgetStore`.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { tenantTx } from '../../src/core/db/transaction';
import type { Crossed } from '../../src/modules/ai_gateway/internal/budget/budget-store';
import type { FakeBudgetStore } from '../../src/modules/ai_gateway/internal/fake';
import {
  registerAiJobHandlers,
  releaseStaleJob,
  STALE_RESERVATION_MS,
} from '../../src/modules/ai_gateway/jobs';
import { enqueue } from '../../src/modules/queue';
import { composeDbStore, DbBudgetControl } from '../contracts/ai/db-control';
import { makeDbStore } from '../contracts/ai/harness';
import { expectIdempotent, startTestProducer, startTestWorkers } from '../support/queue-test-kit';
import {
  asOwner,
  createAccount,
  describeDb,
  jobs,
  makeDatabase,
  resetQueues,
  withAccount,
  type TestDatabase,
} from './helpers/queue-db';

const META = { task: 'post_generation' as const, modelTier: 'default' as const };
const CAP = 4_000_000;

describeDb('Việc trả giữ chỗ AI treo – kho thật (015)', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  let store: FakeBudgetStore;
  const crossedEvents: { accountId: string; crossed: Crossed }[] = [];

  beforeAll(async () => {
    database = makeDatabase();
    stopProducer = await startTestProducer();
    await resetQueues();
    const raw = await makeDbStore(); // onReserved = scheduleStaleRelease (hẹn việc trong giao dịch giữ chỗ)
    store = composeDbStore(raw, new DbBudgetControl(raw));
    registerAiJobHandlers(store, (_tx, crossed) => {
      crossedEvents.push({ accountId: 'job', crossed });
      return Promise.resolve();
    });
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });

  /** Cho việc của các giữ chỗ đến giờ chạy rồi chạy Worker thật tới khi hàng chờ `ai_batch` rỗng. */
  async function runDue(reservationIds: string[]): Promise<void> {
    await asOwner((c) =>
      c.query(
        "UPDATE pgboss.job_common SET start_after = now() WHERE data->>'type' = 'ai_gateway.release_stale' AND data->'payload'->>'reservationId' = ANY($1)",
        [reservationIds],
      ),
    );
    const workers = await startTestWorkers(1, { queues: ['ai_batch'] });
    try {
      await workers.drain();
    } finally {
      await workers.stop();
    }
  }

  async function seed(accountId: string) {
    return withAccount(accountId, async () => {
      const key = { scope: 'account' as const, cycleStart: await store.currentCycleStart() };
      const held = await store.reserve(key, 1_000, META);
      const calling = await store.reserve(key, 5_000, META);
      if (!held.ok || !calling.ok) throw new Error('giữ chỗ phải thành công');
      await store.markCalling(calling.reservationId);
      await store.ageReservations(16 * 60_000);
      const young = await store.reserve(key, 7, META);
      if (!young.ok) throw new Error('giữ chỗ phải thành công');
      return {
        held: held.reservationId,
        calling: calling.reservationId,
        young: young.reservationId,
      };
    });
  }

  it('giữ chỗ hẹn việc +15 phút trong cùng giao dịch; việc chạy → held trả lại, calling quyết toán theo ước tính, < 15 phút không đụng', async () => {
    const a = await createAccount();
    const ids = await seed(a);
    const scheduled = await jobs(
      "data->>'type' = 'ai_gateway.release_stale' AND data->>'accountId' = $1",
      [a],
    );
    expect(scheduled).toHaveLength(3);
    expect(scheduled.every((j) => j.start_after.getTime() > Date.now() + 14 * 60_000)).toBe(true);
    expect(scheduled.every((j) => j.data.accountId === a)).toBe(true);

    await runDue([ids.held, ids.calling]);

    await withAccount(a, async () => {
      const states = Object.fromEntries((await store.reservations()).map((r) => [r.id, r.state]));
      expect(states).toEqual({
        [ids.held]: 'released',
        [ids.calling]: 'settled',
        [ids.young]: 'held',
      });
      expect(await store.getBudget()).toMatchObject({ used: 5_000, reserved: 7 });
      const ledger = await store.ledger();
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({
        anomaly: 'unsettled',
        costMicroUsd: 5_000,
        estimateMicroUsd: 5_000,
        overCapMicroUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        reservationId: ids.calling,
      });
    });

    // Chạy lại hai lần cho cùng kết quả (hiến chương V): ảnh chụp trước = sau.
    await expectIdempotent(
      releaseStaleJob,
      { reservationId: ids.held },
      {
        accountId: a,
        snapshot: () =>
          withAccount(a, async () => ({
            budget: await store.getBudget(),
            ledger: (await store.ledger()).length,
            states: (await store.reservations()).map((r) => r.state).sort(),
          })),
      },
    );
    await expectIdempotent(
      releaseStaleJob,
      { reservationId: ids.calling },
      {
        accountId: a,
        snapshot: () =>
          withAccount(a, async () => ({
            budget: await store.getBudget(),
            ledger: (await store.ledger()).length,
          })),
      },
    );
  });

  it('calling treo với ước tính bằng đúng trần: quyết toán theo ước tính không vượt trần (used + reserved ≤ cap), cờ 80 và 100 bật đúng một lần', async () => {
    const a = await createAccount();
    crossedEvents.length = 0;
    const id = await withAccount(a, async () => {
      const key = { scope: 'account' as const, cycleStart: await store.currentCycleStart() };
      const r = await store.reserve(key, CAP, META);
      if (!r.ok) throw new Error('giữ chỗ bằng đúng trần phải thành công');
      await store.markCalling(r.reservationId);
      await store.ageReservations(16 * 60_000);
      return r.reservationId;
    });
    await runDue([id]);
    await withAccount(a, async () => {
      const b = await store.getBudget();
      expect(b).toMatchObject({ used: CAP, reserved: 0, notified80: true, notified100: true });
      expect(b.used + b.reserved).toBeLessThanOrEqual(b.cap);
      const [entry] = await store.ledger();
      expect(entry).toMatchObject({ anomaly: 'unsettled', costMicroUsd: CAP, overCapMicroUsd: 0 });
    });
    expect(crossedEvents).toHaveLength(1);
    expect(crossedEvents[0]!.crossed.sort((x, y) => x - y)).toEqual([80, 100]);
    // Chạy lại: không phát lại mốc, không thêm dòng sổ.
    await expectIdempotent(
      releaseStaleJob,
      { reservationId: id },
      {
        accountId: a,
        snapshot: () =>
          withAccount(a, async () => ({
            b: await store.getBudget(),
            n: (await store.ledger()).length,
          })),
      },
    );
    expect(crossedEvents).toHaveLength(1);
  });

  it('chỉ dọn giữ chỗ của tài khoản trong việc: giữ chỗ treo của tài khoản khác không bị đụng (RLS)', async () => {
    const [a, b] = [await createAccount(), await createAccount()];
    const idsA = await seed(a);
    const idsB = await seed(b);
    // Chỉ việc của A đến giờ.
    await runDue([idsA.held, idsA.calling]);
    await withAccount(a, async () => {
      const states = (await store.reservations()).map((r) => r.state).sort();
      expect(states).toEqual(['held', 'released', 'settled']);
    });
    await withAccount(b, async () => {
      const byId = Object.fromEntries((await store.reservations()).map((r) => [r.id, r.state]));
      expect(byId).toEqual({
        [idsB.held]: 'held',
        [idsB.calling]: 'calling',
        [idsB.young]: 'held',
      });
      expect(await store.getBudget()).toMatchObject({ used: 0, reserved: 1_000 + 5_000 + 7 });
      expect(await store.ledger()).toEqual([]);
    });
  });

  it('ngưỡng 15 phút: ngay dưới ngưỡng không đụng, quá ngưỡng thì dọn (releaseStale trực tiếp, hai lần như một lần)', async () => {
    const a = await createAccount();
    await withAccount(a, async () => {
      const key = { scope: 'account' as const, cycleStart: await store.currentCycleStart() };
      const r = await store.reserve(key, 100, META);
      if (!r.ok) throw new Error('giữ chỗ phải thành công');
      await store.ageReservations(STALE_RESERVATION_MS - 60_000); // 14 phút
      expect(await store.releaseStale(STALE_RESERVATION_MS)).toEqual({
        released: 0,
        settledAtEstimate: 0,
      });
      expect((await store.getBudget()).reserved).toBe(100);
      await store.ageReservations(2 * 60_000); // 16 phút
      expect(await store.releaseStale(STALE_RESERVATION_MS)).toEqual({
        released: 1,
        settledAtEstimate: 0,
      });
      expect(await store.releaseStale(STALE_RESERVATION_MS)).toEqual({
        released: 0,
        settledAtEstimate: 0,
      });
      expect(await store.getBudget()).toMatchObject({ used: 0, reserved: 0 });
      expect(await store.ledger()).toEqual([]);
    });
  });

  it('giao dịch giữ chỗ hủy → không có việc hẹn', async () => {
    const a = await createAccount();
    const before = (await jobs("data->>'type' = 'ai_gateway.release_stale'")).length;
    await withAccount(a, () =>
      tenantTx(async () => {
        await enqueue(releaseStaleJob, { reservationId: crypto.randomUUID() });
        throw new Error('hủy');
      }),
    ).catch(() => undefined);
    expect((await jobs("data->>'type' = 'ai_gateway.release_stale'")).length).toBe(before);
  });
});
