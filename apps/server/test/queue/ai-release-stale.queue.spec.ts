// 005 T065 (research R8): việc `ai_gateway.release_stale` – giữ chỗ treo > 15 phút: `held` trả lại,
// `calling` quyết toán theo ước tính (sổ `unsettled`); chạy lại hai lần cùng kết quả; < 15 phút không đụng.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { tenantTx } from '../../src/core/db/transaction';
import { makeFakeAiBundle, type FakeAiBundle } from '../../src/modules/ai_gateway/internal/fake';
import {
  registerAiJobHandlers,
  releaseStaleJob,
  scheduleStaleRelease,
} from '../../src/modules/ai_gateway/jobs';
import { startTestProducer, startTestWorkers, expectIdempotent } from '../support/queue-test-kit';
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
import { enqueue } from '../../src/modules/queue';

describeDb('Việc trả giữ chỗ AI treo (005)', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  let bundle: FakeAiBundle;

  beforeAll(async () => {
    database = makeDatabase();
    stopProducer = await startTestProducer();
    await resetQueues();
    bundle = await makeFakeAiBundle('sandbox', {
      systemWeeklyCap: 2_000_000,
      onReserved: scheduleStaleRelease,
    });
    registerAiJobHandlers(bundle.store);
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });

  it('giữ chỗ hẹn việc trong cùng giao dịch; việc chạy → held trả lại, calling quyết toán theo ước tính', async () => {
    const a = await createAccount();
    const store = bundle.store;
    const ids = await withAccount(a, async () => {
      const key = { scope: 'account' as const, cycleStart: await store.currentCycleStart() };
      const held = await store.reserve(key, 1_000, {
        task: 'post_generation',
        modelTier: 'default',
      });
      const calling = await store.reserve(key, 5_000, {
        task: 'post_generation',
        modelTier: 'default',
      });
      if (!held.ok || !calling.ok) throw new Error('giữ chỗ phải thành công');
      await store.markCalling(calling.reservationId);
      await bundle.store.ageReservations(16 * 60_000);
      const young = await store.reserve(key, 7, { task: 'post_generation', modelTier: 'default' });
      if (!young.ok) throw new Error('giữ chỗ phải thành công');
      return {
        held: held.reservationId,
        calling: calling.reservationId,
        young: young.reservationId,
      };
    });
    const scheduled = await jobs("data->>'type' = 'ai_gateway.release_stale'");
    expect(scheduled).toHaveLength(3);
    expect(scheduled.every((j) => j.start_after.getTime() > Date.now() + 14 * 60_000)).toBe(true);
    // Thời gian trôi: việc của giữ chỗ cũ đến giờ.
    await asOwner((c) =>
      c.query(
        "UPDATE pgboss.job_common SET start_after = now() WHERE data->>'type' = 'ai_gateway.release_stale' AND data->'payload'->>'reservationId' = ANY($1)",
        [[ids.held, ids.calling]],
      ),
    );
    const workers = await startTestWorkers(1, { queues: ['ai_batch'] });
    try {
      await workers.drain();
    } finally {
      await workers.stop();
    }
    await withAccount(a, async () => {
      const states = Object.fromEntries((await store.reservations()).map((r) => [r.id, r.state]));
      expect(states).toEqual({
        [ids.held]: 'released',
        [ids.calling]: 'settled',
        [ids.young]: 'held',
      });
      expect(await bundle.store.getBudget()).toMatchObject({ used: 5_000, reserved: 7 });
      const ledger = await store.ledger();
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({ anomaly: 'unsettled', costMicroUsd: 5_000 });
    });

    // Chạy lại hai lần cho cùng kết quả (hiến pháp V).
    await expectIdempotent(
      releaseStaleJob,
      { reservationId: ids.held },
      {
        accountId: a,
        snapshot: () =>
          withAccount(a, async () => ({
            budget: await bundle.store.getBudget(),
            ledger: (await store.ledger()).length,
            states: (await store.reservations()).map((r) => r.state).sort(),
          })),
      },
    );
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
