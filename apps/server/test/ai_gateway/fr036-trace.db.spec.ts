import { afterAll, beforeAll, expect, it } from 'vitest';
import type { AiRequest } from '../../src/modules/ai_gateway';
import { AiGatewayService } from '../../src/modules/ai_gateway/internal/gateway.service';
import { DbPriceSource } from '../../src/modules/ai_gateway/internal/prices/db-price-source';
import type { AiProviderAdapter } from '../../src/modules/ai_gateway/internal/providers/provider';
import { makeAiHarness, type AiHarness } from '../contracts/ai/harness';
import {
  asOwner,
  createAccount,
  describeDb,
  makeDatabase,
  type TestDatabase,
} from '../db/helpers/db';
import { startTestProducer } from '../support/queue-test-kit';
import { insertPrice, stubRoutes, uniqueModel } from './helpers/price-fixtures';
import { StubAdapter } from './helpers/stub-adapter';

// 015 T081 (FR-036, hiến chương VIII) trên kho THẬT: `opts.traceId` bộ chuyển đổi nhận = `ai_cost_ledger.trace_id` (cột
// thật, không chỉ đối tượng trả về) = `AiResult.traceId`; có traceId yêu cầu thì giữ nguyên. Chạy `pnpm test:db`.

const HOUR = 3_600_000;
const TRACE = 'trace-fr036:db.123_XYZ';
const req = (over: Partial<AiRequest> = {}): AiRequest => ({
  task: 'post_generation',
  prompt: { system: 'Bạn là trợ lý viết bài.', delta: 'Viết bài khai trương quán cà phê.' },
  maxOutputTokens: 400,
  ...over,
});

describeDb('FR-036 đầu-cuối trên kho thật: traceId bộ chuyển đổi = sổ chi phí = kết quả', () => {
  const a = uniqueModel('a');
  const b = uniqueModel('b');
  let database: TestDatabase;
  let h: AiHarness;
  let stopProducer: () => Promise<void>;

  beforeAll(async () => {
    database = makeDatabase({ unit: 'worker', poolMax: 10 });
    stopProducer = await startTestProducer();
    for (const m of [a, b]) {
      await insertPrice(m, {
        effectiveFrom: new Date(Date.now() - HOUR),
        input: 1_000_000,
        output: 2_000_000,
        cached: 100_000,
      });
    }
    h = await makeAiHarness(
      'db',
      () => createAccount(),
      { onCrossed: () => Promise.resolve(), count: () => Promise.resolve(0) },
      { routes: stubRoutes(a, b), prices: new DbPriceSource({ ttlMs: 0 }) },
    );
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });

  function rig() {
    const primary = new StubAdapter(a.provider);
    const fallback = new StubAdapter(b.provider);
    const adapterFor = (provider: string): AiProviderAdapter | undefined =>
      provider === a.provider ? primary : fallback;
    const gw = new AiGatewayService({
      store: h.bundle.store,
      primary,
      fallback,
      adapterFor,
      providerTimeoutMs: 3_000,
      firstTokenTimeoutMs: 3_000,
    });
    return { primary, fallback, gw };
  }

  const columnTraceIds = (accountId: string) =>
    asOwner(async (c) =>
      (
        await c.query<{ trace_id: string | null }>(
          `SELECT trace_id FROM ai_gateway.ai_cost_ledger WHERE account_id = $1 ORDER BY created_at, id`,
          [accountId],
        )
      ).rows.map((r) => r.trace_id),
    );

  it('generate có traceId yêu cầu: cột trace_id, opts bộ chuyển đổi và AiResult cùng một giá trị', async () => {
    const id = await createAccount();
    await h.inAccount(id, async () => {
      const { gw, primary } = rig();
      const result = await gw.generate(req({ traceId: TRACE }));
      expect(result.traceId).toBe(TRACE);
      expect(primary.receivedOpts.map((o) => o?.traceId)).toEqual([TRACE]);
    });
    expect(await columnTraceIds(id)).toEqual([TRACE]);
  });

  it('generateStream không có traceId yêu cầu: dùng mã của ngữ cảnh, cột trace_id khớp opts và kết quả', async () => {
    const id = await createAccount();
    await h.inAccount(id, async () => {
      const { gw, primary } = rig();
      const out = await gw.generateStream(req()).result;
      expect(out.traceId).toBeTruthy();
      expect(primary.receivedOpts.map((o) => o?.traceId)).toEqual([out.traceId]);
      expect(await columnTraceIds(id)).toEqual([out.traceId]);
    });
  });
});
