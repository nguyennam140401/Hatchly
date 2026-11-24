import { afterAll, beforeAll, expect, it } from 'vitest';
import { AiError } from '../../src/modules/ai_gateway';
import { makeFakeAiBundle } from '../../src/modules/ai_gateway/internal/fake';
import { AiGatewayService } from '../../src/modules/ai_gateway/internal/gateway.service';
import { composeDbStore, DbBudgetControl } from '../contracts/ai/db-control';
import { makeAiHarness, makeDbStore } from '../contracts/ai/harness';
import { expectCustomerSafeRemedy } from '../contracts/ai/message-assert';
import { startTestProducer } from '../support/queue-test-kit';
import {
  asOwner,
  createAccount,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from '../db/helpers/db';

// T024 (015, FR-014, Edge Case "tài khoản chưa có chu kỳ hiệu lực", contracts/ai-gateway-delta.md mục 2 và 4):
// `getAiCycleAnchor()` trả `null` (chưa kích hoạt / gói hết hạn / tài khoản bị khóa) → Cổng AI từ chối như hết hạn mức
// (`AI_BUDGET_EXHAUSTED`), KHÔNG tạo dòng ngân sách, KHÔNG giữ chỗ, KHÔNG ghi sổ, KHÔNG gọi nhà cung cấp.
// Viết TRƯỚC mã (T025/T028). Ghi chú tên tệp: `.db.spec.ts` để vitest bộ nhớ bỏ qua; tasks.md ghi `.spec.ts`.

const req = {
  task: 'post_generation' as const,
  prompt: { system: 'Bạn là trợ lý viết bài.', delta: 'Viết bài khai trương quán cà phê.' },
  maxOutputTokens: 100,
};

describeDb('Cổng AI thật – tài khoản không có chu kỳ hiệu lực', () => {
  let database: TestDatabase;

  let stopProducer: () => Promise<void>;

  beforeAll(async () => {
    database = makeDatabase({ unit: 'worker', poolMax: 5 });
    // Ca đối chứng giữ chỗ thật → hẹn `release_stale` cần nhà sản xuất hàng chờ.
    stopProducer = await startTestProducer();
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });

  const rowCounts = (accountId: string) =>
    asOwner(async (c) => {
      const q = async (table: string) =>
        Number(
          (
            await c.query<{ n: string }>(
              `SELECT count(*)::text AS n FROM ai_gateway.${table} WHERE account_id = $1`,
              [accountId],
            )
          ).rows[0]!.n,
        );
      return {
        budgets: await q('ai_budgets'),
        reservations: await q('ai_reservations'),
        ledger: await q('ai_cost_ledger'),
      };
    });

  /** Cổng AI với kho thật nhưng mốc chu kỳ do kiểm thử tiêm. */
  async function gatewayWithAnchor(anchor: () => Promise<{ anchorDate: string } | null>) {
    const bundle = await makeFakeAiBundle('sandbox', { systemWeeklyCap: 2_000_000 });
    const raw = await makeDbStore({ accountApi: { getAiCycleAnchor: anchor } });
    const store = composeDbStore(raw, new DbBudgetControl(raw));
    const gateway = new AiGatewayService({
      store,
      prices: bundle.prices,
      primary: bundle.primary,
      fallback: bundle.fallback,
      providerTimeoutMs: 300,
      firstTokenTimeoutMs: 300,
    });
    const calls = () => bundle.primary.calls.length + bundle.fallback.calls.length;
    return { gateway, calls };
  }

  it('getAiCycleAnchor() = null (tiêm) → generate: AI_BUDGET_EXHAUSTED, không tạo ngân sách, 0 lời gọi nhà cung cấp', async () => {
    const accountId = await createAccount();
    let asked = 0;
    const { gateway, calls } = await gatewayWithAnchor(() => {
      asked++;
      return Promise.resolve(null);
    });
    await withAccount(accountId, async () => {
      const err = await gateway.generate(req).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AiError);
      expect((err as AiError).code).toBe('AI_BUDGET_EXHAUSTED');
      expect((err as AiError).messageVi).toContain('giới hạn AI');
      expectCustomerSafeRemedy((err as AiError).messageVi);
      expect((err as AiError).retryable).toBe(false);
      // Không phải "thiếu cấu hình": đây là hết hạn mức (FR-022 phân biệt hai trường hợp).
      expect((err as AiError).code).not.toBe('AI_NOT_CONFIGURED');
    });
    expect(asked).toBeGreaterThan(0); // thật sự hỏi mốc chu kỳ mỗi lần (không cache)
    expect(calls()).toBe(0);
    expect(await rowCounts(accountId)).toEqual({ budgets: 0, reservations: 0, ledger: 0 });
  });

  it('cũng áp dụng cho transcribe và gọi lặp nhiều lần: mỗi lần đều từ chối, vẫn 0 dòng', async () => {
    const accountId = await createAccount();
    const { gateway, calls } = await gatewayWithAnchor(() => Promise.resolve(null));
    await withAccount(accountId, async () => {
      for (let i = 0; i < 3; i++) {
        const err = await gateway.generate(req).catch((e: unknown) => e);
        expect((err as AiError).code).toBe('AI_BUDGET_EXHAUSTED');
      }
      const err = await gateway
        .transcribe({ audioUrl: 'https://x/a.mp3', durationSec: 30, language: 'vi' })
        .catch((e: unknown) => e);
      expect((err as AiError).code).toBe('AI_BUDGET_EXHAUSTED');
    });
    expect(calls()).toBe(0);
    expect(await rowCounts(accountId)).toEqual({ budgets: 0, reservations: 0, ledger: 0 });
  });

  for (const status of ['suspended', 'expired', 'deleting'] as const) {
    it(`tài khoản thật ở trạng thái "${status}" (AccountPublicApi thật trả null) → AI_BUDGET_EXHAUSTED, không tạo ngân sách`, async () => {
      const accountId = await createAccount(status);
      const h = await makeAiHarness('db', () => createAccount(), {
        onCrossed: () => Promise.resolve(),
        count: () => Promise.resolve(0),
      });
      const calls0 = h.bundle.primary.calls.length + h.bundle.fallback.calls.length;
      await h.inAccount(accountId, async () => {
        const err = await h
          .gateway()
          .generate(req)
          .catch((e: unknown) => e);
        expect((err as AiError).code).toBe('AI_BUDGET_EXHAUSTED');
      });
      expect(h.bundle.primary.calls.length + h.bundle.fallback.calls.length).toBe(calls0);
      expect(await rowCounts(accountId)).toEqual({ budgets: 0, reservations: 0, ledger: 0 });
    });
  }

  it('đối chứng: tài khoản active có chu kỳ → chạy bình thường và tạo đúng một dòng ngân sách', async () => {
    const accountId = await createAccount('active');
    const { gateway, calls } = await gatewayWithAnchor(() =>
      Promise.resolve({
        anchorDate: new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10),
      }),
    );
    await withAccount(accountId, async () => {
      const r = await gateway.generate(req);
      expect(r.text).toMatch(/^\[fake:/);
    });
    expect(calls()).toBe(1);
    expect(await rowCounts(accountId)).toEqual({ budgets: 1, reservations: 1, ledger: 1 });
  });
});
