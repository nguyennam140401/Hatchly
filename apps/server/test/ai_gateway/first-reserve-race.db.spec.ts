import { afterAll, beforeAll, expect, it } from 'vitest';
import { makeAiHarness, type AiHarness } from '../contracts/ai/harness';
import { createAccount, describeDb, makeDatabase, type TestDatabase } from '../db/helpers/db';
import { startTestProducer } from '../support/queue-test-kit';

// 015 (hồi quy, hiến chương III và FR-008): nhiều lời gọi ĐẦU TIÊN của một chu kỳ mới đến cùng lúc – dòng `ai_budgets` chưa có,
// mọi lời gọi đều cùng tạo dòng. Ngân sách còn nguyên (4 USD) nên MỌI giữ chỗ phải thành công; một giữ chỗ bị từ chối ở đây là
// từ chối SAI (người dùng thấy "hết hạn mức" khi chưa dùng đồng nào).
// Nguyên nhân nghi ngờ (đã khoanh vùng khi điều tra ca `ledger-reconcile.spec.ts` "hai tài khoản" đỏ một lần với
// AI_BUDGET_EXHAUSTED): `DbBudgetStore.reserveAccount` chạy `UPDATE … WHERE used+reserved+est <= cap` (chưa có dòng → 0 hàng),
// rồi `SELECT` kiểm tra dòng tồn tại. Giữa hai câu lệnh (READ COMMITTED) giao dịch khác kịp commit dòng vừa tạo → SELECT thấy
// dòng → mã trả `ok:false` dù ngân sách còn nhiều (src/modules/ai_gateway/internal/budget/db-budget-store.ts, nhánh
// `existing !== undefined`). Cửa sổ rất hẹp nên ca lặp nhiều vòng để bắt. GIẢ THUYẾT CHƯA XÁC MINH: chưa tái hiện được
// (80 vòng × 12 lời gọi, 4 tiến trình song song, cả thư mục test/ai_gateway đều xanh); ca giữ như lưới an toàn hồi quy.

const ROUNDS = 80;
const CALLS = 12;
const META = { task: 'post_generation', modelTier: 'default' } as const;

describeDb('Cổng AI thật – giữ chỗ đầu chu kỳ đồng thời không bị từ chối sai', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  let h: AiHarness;

  beforeAll(async () => {
    database = makeDatabase({ unit: 'worker', poolMax: 20 });
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

  it(`${ROUNDS} tài khoản mới × ${CALLS} giữ chỗ song song: không giữ chỗ nào bị từ chối khi ngân sách còn nguyên`, async () => {
    let rejected = 0;
    for (let round = 0; round < ROUNDS; round++) {
      const accountId = await h.newAccount();
      await h.inAccount(accountId, async () => {
        const store = h.bundle.store;
        const key = { scope: 'account' as const, cycleStart: await store.currentCycleStart() };
        const results = await Promise.all(
          Array.from({ length: CALLS }, () => store.reserve(key, 10, META)),
        );
        const bad = results.filter((r) => !r.ok);
        rejected += bad.length;
        if (bad.length === 0) {
          expect((await h.fake.getBudget()).reserved).toBe(CALLS * 10);
        }
        for (const r of results) if (r.ok) await store.release(r.reservationId);
      });
    }
    expect(rejected, 'giữ chỗ bị từ chối sai khi ngân sách còn nguyên').toBe(0);
  });
});
