import { afterAll, beforeAll, expect, it } from 'vitest';
import { createAccount, describeDb, makeDatabase, withAccount, type TestDatabase } from '../../db/helpers/db';
import { describeAiGatewayContract } from './ai-gateway.contract';
import { makeAiHarness, type AiHarness } from './harness';

// 005 T051: Cổng AI – bản giả lập, kho `sandbox` (bảng sandbox.ai_fake_*, RLS, CHECK) – pnpm test:db.
// Mục 14: p95 của `reserve` ≤ 50 ms qua 200 lần trên CSDL cục bộ (hiến pháp III).

let harness: AiHarness;
let database: TestDatabase;

describeDb('Cổng AI – bản giả lập (sandbox)', () => {
  beforeAll(async () => {
    // unit worker: có bể system cho ngân sách hệ thống (systemTx).
    database = makeDatabase({ unit: 'worker', poolMax: 10 });
    harness = await makeAiHarness('sandbox', () => createAccount());
  });
  afterAll(async () => {
    await database.close();
  });

  describeAiGatewayContract(() => harness, { concurrencyRounds: 100, callsPerRound: 25 });

  it('14. reserve p95 ≤ 50 ms (200 lần)', async () => {
    const accountId = await createAccount();
    await withAccount(accountId, async () => {
      const store = harness.bundle.store;
      const key = { scope: 'account' as const, cycleStart: await store.currentCycleStart() };
      const times: number[] = [];
      for (let i = 0; i < 200; i++) {
        const t0 = performance.now();
        const r = await store.reserve(key, 10, { task: 'post_generation', modelTier: 'default' });
        times.push(performance.now() - t0);
        if (r.ok) await store.release(r.reservationId);
      }
      times.sort((a, b) => a - b);
      const p95 = times[Math.floor(times.length * 0.95)]!;
      expect(p95).toBeLessThanOrEqual(50);
    });
  });
});
