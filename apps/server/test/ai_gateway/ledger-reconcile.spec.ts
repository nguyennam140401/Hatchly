import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { currentAccountId } from '../../src/core/db';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import type { AiRequest } from '../../src/modules/ai_gateway';
import { makeOnCrossed } from '../../src/modules/ai_gateway/ai_gateway.module';
import { DbPriceSource } from '../../src/modules/ai_gateway/internal/prices/db-price-source';
import { QueueEmitter } from '../../src/modules/notifications/internal/emit';
import { makeAiHarness, type AiHarness } from '../contracts/ai/harness';
import {
  asOwner,
  createAccount,
  dbUrls,
  describeDb,
  makeDatabase,
  type TestDatabase,
} from '../db/helpers/db';
import { jobs } from '../queue/helpers/queue-db';
import { startTestProducer } from '../support/queue-test-kit';
import { insertPrice, reservationRows, stubRoutes, uniqueModel } from './helpers/price-fixtures';

// 015 US3 T037 (FR-015, FR-016, SC-006): sổ chi phí AI chỉ-thêm và khớp ngân sách.
// - Với mỗi (account, cycle): used = Σ cost_micro_usd − Σ over_cap_micro_usd (sai lệch 0), reserved = 0 khi xong.
// - Mỗi lời gọi đã quyết toán = đúng một dòng sổ; giữ chỗ đã trả không có dòng sổ.
// - anomaly over_estimate / unsettled ghi đúng (missing_usage: ràng buộc dữ liệu ở đây, đường tạo ra nó thuộc STT, T051).
// - Sổ ghi nhà cung cấp của TUYẾN thực sự trả kết quả (anthropic/openai/…), không phải nhãn bộ chuyển đổi 'primary'/'fallback'
//   (lệch này phát hiện ở vòng trước; mã sửa ở T042).
// - app/system không UPDATE/DELETE/TRUNCATE được sổ.

const req = (maxOutputTokens = 40): AiRequest => ({
  task: 'post_generation',
  prompt: { system: 'Bạn là trợ lý viết bài.', delta: 'Viết bài khai trương quán cà phê.' },
  maxOutputTokens,
});

interface Reconcile {
  used: string;
  reserved: string;
  cap: string;
  ledger_cost: string;
  ledger_over_cap: string;
  ledger_rows: string;
}

/** Đối soát bằng SQL: ngân sách từng chu kỳ so với tổng sổ (đọc bằng owner, lọc tường minh theo tài khoản). */
async function reconcile(accountId: string): Promise<Reconcile[]> {
  return asOwner(
    async (c) =>
      (
        await c.query<Reconcile>(
          `SELECT b.used::text, b.reserved::text, b.cap::text,
                  COALESCE(SUM(l.cost_micro_usd), 0)::text AS ledger_cost,
                  COALESCE(SUM(l.over_cap_micro_usd), 0)::text AS ledger_over_cap,
                  count(l.id)::text AS ledger_rows
             FROM ai_gateway.ai_budgets b
             LEFT JOIN ai_gateway.ai_cost_ledger l
               ON l.account_id = b.account_id AND l.cycle_start = b.cycle_start
            WHERE b.account_id = $1
            GROUP BY b.id, b.used, b.reserved, b.cap
            ORDER BY b.cycle_start`,
          [accountId],
        )
      ).rows,
  );
}

const expectReconciled = (rows: Reconcile[]) => {
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) {
    expect(BigInt(r.used)).toBe(BigInt(r.ledger_cost) - BigInt(r.ledger_over_cap)); // sai lệch 0 micro-USD
    expect(BigInt(r.reserved)).toBe(0n);
    expect(BigInt(r.used)).toBeLessThanOrEqual(BigInt(r.cap));
  }
};

describeDb('Sổ chi phí AI – đối soát với ngân sách, bất thường, chỉ-thêm', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  let h: AiHarness;

  beforeAll(async () => {
    database = makeDatabase({ unit: 'worker', poolMax: 10 });
    stopProducer = await startTestProducer();
    h = await makeAiHarness('db', () => createAccount(), {
      onCrossed: makeOnCrossed(new QueueEmitter()),
      count: async (type) =>
        (
          await jobs(
            "data->>'type' = 'notifications.deliver' AND data->>'accountId' = $1 AND data->'payload'->'event'->>'type' = $2",
            [currentAccountId(), type],
          )
        ).length,
    });
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });

  describe('used = Σ cost − Σ over_cap, mỗi lời gọi đúng một dòng sổ', () => {
    it('chuỗi hỗn hợp (bình thường, quyết toán theo ước tính, vượt ước tính, kẹp trần) khớp tuyệt đối, anomaly đúng', async () => {
      const accountId = await h.newAccount();
      await h.inAccount(accountId, async () => {
        const gw = h.gateway({ providerTimeoutMs: 5_000 });
        const store = h.bundle.store;

        // 3 lời gọi bình thường.
        for (let i = 0; i < 3; i++) await gw.generate(req(40 + i));

        // 1 giữ chỗ treo ở `calling` > 15 phút → quyết toán theo ước tính, anomaly = unsettled.
        const key = { scope: 'account' as const, cycleStart: await store.currentCycleStart() };
        const stale = await store.reserve(key, 5_000, {
          task: 'post_generation',
          modelTier: 'default',
        });
        if (!stale.ok) throw new Error('giữ chỗ phải thành công');
        await store.markCalling(stale.reservationId);
        await h.fake.ageReservations(16 * 60_000);
        expect(await store.releaseStale(15 * 60_000)).toEqual({
          released: 0,
          settledAtEstimate: 1,
        });

        // 1 lời gọi chi phí thực > ước tính nhưng còn trong trần → over_estimate, over_cap = 0.
        await h.fake.script([{ actualCostMultiplier: 50, outputTokens: 20 }], 'primary');
        await gw.generate(req(20));

        // 1 giữ chỗ bị trả lại (lỗi trước khi gọi) → không có dòng sổ.
        const released = await store.reserve(key, 777, {
          task: 'post_generation',
          modelTier: 'default',
        });
        if (!released.ok) throw new Error('giữ chỗ phải thành công');
        await store.release(released.reservationId);

        // 1 lời gọi vượt trần: phần còn lại 1.000 đủ ước tính nhưng chi phí thực x50 vượt → kẹp, over_cap > 0.
        const before = await h.fake.getBudget();
        await h.fake.setBudget({ cap: before.used + 1_000 });
        await h.fake.script([{ actualCostMultiplier: 50, outputTokens: 40 }], 'primary');
        await gw.generate(req(40));

        const ledger = await h.fake.ledger();
        expect(ledger).toHaveLength(6);
        const byAnomaly = (a: string | null) => ledger.filter((l) => l.anomaly === a);
        expect(byAnomaly(null)).toHaveLength(3);
        expect(byAnomaly('unsettled')).toHaveLength(1);
        expect(byAnomaly('over_estimate')).toHaveLength(2);

        const [unsettled] = byAnomaly('unsettled');
        expect(unsettled).toMatchObject({
          costMicroUsd: 5_000,
          estimateMicroUsd: 5_000,
          inputTokens: 0,
          outputTokens: 0,
          overCapMicroUsd: 0,
        });
        for (const l of byAnomaly(null)) {
          expect(l.costMicroUsd).toBeLessThanOrEqual(l.estimateMicroUsd);
          expect(l.overCapMicroUsd).toBe(0);
        }
        for (const l of byAnomaly('over_estimate')) {
          expect(l.costMicroUsd).toBeGreaterThan(l.estimateMicroUsd);
        }
        // Chỉ dòng bị kẹp trần có over_cap > 0 (dòng cuối); chi phí thực KHÔNG bị kẹp trong sổ.
        const overCap = ledger.filter((l) => l.overCapMicroUsd > 0);
        expect(overCap).toHaveLength(1);
        expect(overCap[0]!.anomaly).toBe('over_estimate');

        expectReconciled(await reconcile(accountId));
        const [row] = await reconcile(accountId);
        expect(row).toMatchObject({ ledger_rows: '6', used: row!.cap });

        // Mỗi dòng sổ ↔ đúng một giữ chỗ đã quyết toán; giữ chỗ đã trả không có sổ.
        const reservations = await reservationRows(accountId);
        const settled = reservations.filter((r) => r.state === 'settled').map((r) => r.id);
        expect(settled).toHaveLength(6);
        expect(ledger.map((l) => l.reservationId).sort()).toEqual([...settled].sort());
        expect(reservations.filter((r) => r.state === 'released')).toHaveLength(1);
        expect(reservations.filter((r) => ['held', 'calling'].includes(r.state))).toHaveLength(0);
      });
    });

    it('nhiều lời gọi đồng thời ở hai tài khoản: mỗi (tài khoản, chu kỳ) khớp riêng, không lẫn sổ', async () => {
      const [a, b] = [await h.newAccount(), await h.newAccount()];
      const run = (accountId: string, n: number) =>
        h.inAccount(accountId, async () => {
          const gw = h.gateway({ providerTimeoutMs: 5_000 });
          await Promise.all(Array.from({ length: n }, (_, i) => gw.generate(req(20 + i))));
          return h.fake.ledger();
        });
      const [la, lb] = await Promise.all([run(a, 8), run(b, 5)]);
      expect(la).toHaveLength(8);
      expect(lb).toHaveLength(5);
      expect(la.every((l) => l.accountId === a)).toBe(true);
      expect(lb.every((l) => l.accountId === b)).toBe(true);
      const [ra] = await reconcile(a);
      const [rb] = await reconcile(b);
      expectReconciled([ra!]);
      expectReconciled([rb!]);
      expect(ra!.ledger_rows).toBe('8');
      expect(rb!.ledger_rows).toBe('5');
      expect(BigInt(ra!.used)).toBe(BigInt(la.reduce((s, l) => s + l.costMicroUsd, 0)));
    });

    it('quyết toán gọi lại cùng giữ chỗ không thêm dòng sổ, không cộng số dùng lần hai', async () => {
      const accountId = await h.newAccount();
      await h.inAccount(accountId, async () => {
        const store = h.bundle.store;
        const key = { scope: 'account' as const, cycleStart: await store.currentCycleStart() };
        const r = await store.reserve(key, 3_000, {
          task: 'post_generation',
          modelTier: 'default',
        });
        if (!r.ok) throw new Error('giữ chỗ phải thành công');
        await store.markCalling(r.reservationId);
        const draft = {
          task: 'post_generation' as const,
          modelTier: 'default' as const,
          modelId: 'm',
          provider: 'p',
          inputTokens: 1,
          outputTokens: 1,
          cachedInputTokens: 0,
          traceId: null,
        };
        await store.settle(r.reservationId, 2_000, draft);
        await store.settle(r.reservationId, 2_000, draft);
        await store.release(r.reservationId);
        expect(await h.fake.ledger()).toHaveLength(1);
        expectReconciled(await reconcile(accountId));
        expect(await h.fake.getBudget()).toMatchObject({ used: 2_000, reserved: 0 });
      });
    });
  });

  describe('sổ ghi nhà cung cấp của TUYẾN thực sự trả kết quả (T042)', () => {
    it('chính thành công: provider/model của tuyến rank 1 (không phải nhãn "primary"), khớp dòng giữ chỗ', async () => {
      const m1 = uniqueModel('r1');
      const m2 = uniqueModel('r2');
      const past = new Date(Date.now() - 3_600_000);
      await insertPrice(m1, { effectiveFrom: past });
      await insertPrice(m2, { effectiveFrom: past, input: 500_000, output: 900_000 });
      const gw = await h.db!.gatewayWith({
        routes: stubRoutes(m1, m2),
        prices: new DbPriceSource({ ttlMs: 0 }),
      });
      const accountId = await h.newAccount();
      await h.inAccount(accountId, async () => {
        await gw.generate(req());
        const [entry] = await h.fake.ledger();
        expect(entry).toMatchObject({ provider: m1.provider, modelId: m1.modelId });
        expect(entry!.provider).not.toBe('primary');
        const [res] = await reservationRows(accountId);
        expect(entry!.provider).toBe(res!.provider);
        expect(entry!.modelId).toBe(res!.model_id);
      });
    });

    it('chính lỗi → dự phòng: sổ ghi provider/model của tuyến rank 2 (không phải nhãn "fallback")', async () => {
      const m1 = uniqueModel('f1');
      const m2 = uniqueModel('f2');
      const past = new Date(Date.now() - 3_600_000);
      await insertPrice(m1, { effectiveFrom: past });
      await insertPrice(m2, { effectiveFrom: past, input: 500_000, output: 900_000 });
      const gw = await h.db!.gatewayWith({
        routes: stubRoutes(m1, m2),
        prices: new DbPriceSource({ ttlMs: 0 }),
      });
      const accountId = await h.newAccount();
      await h.inAccount(accountId, async () => {
        await h.fake.script([{ fail: 'error' }], 'primary');
        await gw.generate(req());
        const [entry] = await h.fake.ledger();
        expect(entry).toMatchObject({ provider: m2.provider, modelId: m2.modelId });
        expect(entry!.provider).not.toBe('fallback');
        expect((await reservationRows(accountId)).map((r) => [r.provider, r.state])).toEqual([
          [m1.provider, 'released'],
          [m2.provider, 'settled'],
        ]);
        expectReconciled(await reconcile(accountId));
      });
    });

    it('luồng (generateStream): sổ ghi nhà cung cấp của tuyến, không phải nhãn bộ chuyển đổi', async () => {
      const m1 = uniqueModel('s1');
      await insertPrice(m1, { effectiveFrom: new Date(Date.now() - 3_600_000) });
      const gw = await h.db!.gatewayWith({
        routes: stubRoutes(m1),
        prices: new DbPriceSource({ ttlMs: 0 }),
      });
      const accountId = await h.newAccount();
      await h.inAccount(accountId, async () => {
        const stream = gw.generateStream(req());
        let chunks = 0;
        for await (const chunk of stream) chunks += chunk.delta.length > 0 ? 1 : 0;
        expect(chunks).toBeGreaterThan(0);
        await stream.result;
        const [entry] = await h.fake.ledger();
        expect(entry).toMatchObject({ provider: m1.provider, modelId: m1.modelId });
      });
    });
  });

  describe('sổ chỉ-thêm (SC-006): app/system không sửa, xóa được', () => {
    it('UPDATE / DELETE / TRUNCATE bằng vai trò app và system → 42501; dòng sổ nguyên vẹn', async () => {
      const accountId = await h.newAccount();
      await h.inAccount(accountId, async () => {
        await h.gateway().generate(req());
      });
      const count = () =>
        asOwner(
          async (c) =>
            (
              await c.query<{ n: string; cost: string }>(
                `SELECT count(*)::text AS n, COALESCE(sum(cost_micro_usd), 0)::text AS cost
                   FROM ai_gateway.ai_cost_ledger WHERE account_id = $1`,
                [accountId],
              )
            ).rows[0]!,
        );
      const before = await count();
      expect(before.n).toBe('1');
      for (const role of ['app', 'system'] as const) {
        const c = new Client({ connectionString: dbUrls[role] });
        await c.connect();
        try {
          for (const sql of [
            'UPDATE ai_gateway.ai_cost_ledger SET cost_micro_usd = 0',
            'UPDATE ai_gateway.ai_cost_ledger SET anomaly = NULL, over_cap_micro_usd = 0',
            'DELETE FROM ai_gateway.ai_cost_ledger',
            'TRUNCATE ai_gateway.ai_cost_ledger',
          ]) {
            const err = await c.query(sql).catch((e: unknown) => e);
            expect((err as { code?: string }).code, `${role}: ${sql}`).toBe('42501');
          }
        } finally {
          await c.end();
        }
      }
      expect(await count()).toEqual(before);
    });

    it('ràng buộc dữ liệu: anomaly ∈ {over_estimate, unsettled, missing_usage}; số tiền không âm', async () => {
      const accountId = await createAccount();
      const insert = (over: { anomaly?: string | null; cost?: number; overCap?: number }) =>
        asOwner((c) =>
          c
            .query(
              `INSERT INTO ai_gateway.ai_cost_ledger
                 (id, account_id, cycle_start, reservation_id, task, model_tier, model_id, provider,
                  cost_micro_usd, estimate_micro_usd, anomaly, over_cap_micro_usd)
               VALUES ($1, $2, '2026-11-01', $3, 'post_generation', 'default', 'm', 'p', $4, 100, $5, $6)`,
              [
                uuidV7(),
                accountId,
                uuidV7(),
                over.cost ?? 100,
                over.anomaly ?? null,
                over.overCap ?? 0,
              ],
            )
            .then(() => null)
            .catch((e: unknown) => e as { code?: string }),
        );
      for (const ok of ['over_estimate', 'unsettled', 'missing_usage', null]) {
        expect(await insert({ anomaly: ok }), String(ok)).toBeNull();
      }
      for (const bad of [{ anomaly: 'bogus' }, { cost: -1 }, { overCap: -1 }]) {
        expect((await insert(bad))?.code, JSON.stringify(bad)).toBe('23514');
      }
      await asOwner((c) =>
        c.query('DELETE FROM ai_gateway.ai_cost_ledger WHERE account_id = $1', [accountId]),
      );
    });
  });
});
