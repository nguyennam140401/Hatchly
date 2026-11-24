import { beforeAll, describe, expect, it } from 'vitest';
import { runWithJobContext } from '../../src/core/context/bind-account';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import type { AiRequest } from '../../src/modules/ai_gateway';
import { AiGatewayService } from '../../src/modules/ai_gateway/internal/gateway.service';
import { ProviderCallError } from '../../src/modules/ai_gateway/internal/providers/provider-error';
import { makeAiHarness, type AiHarness } from '../contracts/ai/harness';
import { spied, StubAdapter, type Spy } from './helpers/stub-adapter';

// 015 T081 (FR-036, hiến chương VIII): mã theo dõi đi xuyên suốt module gọi -> Cổng AI -> nhà cung cấp, và là MỘT giá trị
// duy nhất ở ba nơi: `opts.traceId` bộ chuyển đổi nhận, dòng sổ chi phí (`traceId`; cột `trace_id` ở bản CSDL thật, xem
// fr036-trace.db.spec.ts) và `AiResult.traceId`. Có `traceId` trong yêu cầu thì giữ nguyên; không có thì sinh mới (mỗi lời
// gọi một mã). Kho bộ nhớ (pnpm test); nhà cung cấp là bản giả ghi lại `opts`.

const req = (over: Partial<AiRequest> = {}): AiRequest => ({
  task: 'post_generation',
  prompt: { system: 'Bạn là trợ lý viết bài.', delta: 'Viết bài khai trương quán cà phê.' },
  maxOutputTokens: 400,
  ...over,
});

let h: AiHarness;
beforeAll(async () => {
  h = await makeAiHarness('memory', () => Promise.resolve(uuidV7()), {
    onCrossed: () => Promise.resolve(),
    count: () => Promise.resolve(0),
  });
});

function rig() {
  const primary = new StubAdapter('stub-primary');
  const fallback = new StubAdapter('stub-fallback');
  const spy: Spy = { settles: [] };
  const gw = new AiGatewayService({
    store: spied(h.bundle.store, spy),
    prices: h.bundle.prices,
    primary,
    fallback,
    providerTimeoutMs: 2_000,
    firstTokenTimeoutMs: 2_000,
  });
  return { primary, fallback, gw };
}

const inAccount = <T>(fn: () => Promise<T>): Promise<T> => h.inAccount(uuidV7(), fn);
const TRACE = 'trace-fr036:abc.123_XYZ';

describe('FR-036 đầu-cuối: traceId qua Cổng AI', () => {
  it('generate có traceId trong yêu cầu: bộ chuyển đổi, sổ chi phí và AiResult cùng đúng giá trị đó', async () => {
    await inAccount(async () => {
      const { gw, primary } = rig();
      const result = await gw.generate(req({ traceId: TRACE }));
      expect(result.traceId).toBe(TRACE);
      expect(primary.receivedOpts.map((o) => o?.traceId)).toEqual([TRACE]);
      const ledger = await h.fake.ledger();
      expect(ledger).toHaveLength(1);
      expect(ledger[0]!.traceId).toBe(TRACE);
    });
  });

  it('generate không có traceId trong yêu cầu: lấy mã của ngữ cảnh việc/yêu cầu đang chạy (API → hàng chờ → Worker), ba nơi cùng giá trị', async () => {
    const CTX = `ctx-${uuidV7()}`;
    await runWithJobContext({ traceId: CTX, accountId: uuidV7() }, async () => {
      const { gw, primary } = rig();
      const result = await gw.generate(req());
      expect(result.traceId).toBe(CTX);
      expect(primary.receivedOpts.map((o) => o?.traceId)).toEqual([CTX]);
      expect((await h.fake.ledger()).map((l) => l.traceId)).toEqual([CTX]);
    });
  });

  it('traceId trong yêu cầu thắng mã của ngữ cảnh; hai ngữ cảnh khác nhau cho hai mã khác nhau', async () => {
    const seen: string[] = [];
    for (let i = 0; i < 2; i++) {
      await inAccount(async () => {
        const { gw, primary } = rig();
        const result = await gw.generate(req());
        expect(result.traceId).toBeTruthy();
        expect(primary.receivedOpts.map((o) => o?.traceId)).toEqual([result.traceId]);
        expect((await h.fake.ledger()).map((l) => l.traceId)).toEqual([result.traceId]);
        seen.push(result.traceId);
      });
    }
    expect(new Set(seen).size).toBe(2);
    await runWithJobContext({ traceId: 'ctx-khac', accountId: uuidV7() }, async () => {
      const { gw } = rig();
      expect((await gw.generate(req({ traceId: TRACE }))).traceId).toBe(TRACE);
    });
  });

  it('generateStream có traceId: bộ chuyển đổi nhận đúng mã, kết quả và sổ cùng mã', async () => {
    await inAccount(async () => {
      const { gw, primary } = rig();
      const out = await gw.generateStream(req({ traceId: TRACE })).result;
      expect(out.traceId).toBe(TRACE);
      expect(primary.receivedOpts.map((o) => o?.traceId)).toEqual([TRACE]);
      const ledger = await h.fake.ledger();
      expect(ledger).toHaveLength(1);
      expect(ledger[0]!.traceId).toBe(TRACE);
    });
  });

  it('chuyển tuyến dự phòng: lượt dự phòng mang CÙNG traceId với lượt chính, sổ và kết quả cùng mã', async () => {
    await inAccount(async () => {
      const { gw, primary, fallback } = rig();
      primary.onComplete = () =>
        Promise.reject(new ProviderCallError('stub-primary', 'server', 500));
      const result = await gw.generate(req({ traceId: TRACE }));
      expect(result.traceId).toBe(TRACE);
      expect(primary.receivedOpts.map((o) => o?.traceId)).toEqual([TRACE]);
      expect(fallback.receivedOpts.map((o) => o?.traceId)).toEqual([TRACE]);
      const ledger = await h.fake.ledger();
      expect(ledger.map((l) => l.traceId)).toEqual([TRACE]);
    });
  });

  it('traceId không rò vào lời nhắc: bộ chuyển đổi nhận mã qua opts, không qua nội dung prompt', async () => {
    await inAccount(async () => {
      const { gw, primary } = rig();
      let seenPrompt = '';
      primary.onComplete = () =>
        Promise.resolve({
          text: 'ok',
          inputTokens: 1,
          outputTokens: 1,
          cachedInputTokens: 0,
          modelId: 'm',
        });
      const orig = primary.complete.bind(primary);
      primary.complete = (m, p, max, signal, opts) => {
        seenPrompt = JSON.stringify(p);
        return orig(m, p, max, signal, opts);
      };
      await gw.generate(req({ traceId: TRACE }));
      expect(seenPrompt).not.toContain(TRACE);
    });
  });
});
