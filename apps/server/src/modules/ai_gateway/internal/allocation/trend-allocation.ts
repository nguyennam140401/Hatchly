import { and, asc, eq } from 'drizzle-orm';
import { systemTx } from '../../../../core/db';
import { runForAccount } from '../../../queue';
import { aiTrendAllocations, systemCostLedger } from '../db/schema';
import { gatewayEvent } from '../events';
import type { IndustryAccountsSource } from '../../public-api';

// Phân bổ chi phí xu hướng dùng chung cho tài khoản cùng ngành (015 US7, FR-033, R-11, data-model 2.4).
// Mỗi dòng `system_cost_ledger` của (tuần, ngành) được CHIA RIÊNG: phần nguyên chia đều, phần dư (cost mod n) gán 1 micro-USD
// cho các mã tài khoản NHỎ NHẤT theo thứ tự tăng dần → tổng phần chia luôn bằng chi phí, kết quả xác định theo (dòng sổ,
// danh sách tài khoản). Mỗi tài khoản MỘT `systemTx` đặt ngữ cảnh tài khoản (bảng tenant, RLS vẫn áp dụng) và
// `INSERT … ON CONFLICT DO NOTHING` theo khóa duy nhất (account_id, week_start, industry_id, shared_ledger_id) → chạy lại,
// chạy đồng thời hay chạy dở đều không nhân đôi. KHÔNG cộng vào `ai_budgets.used` (khách không thấy – FR-032).

const PAGE_SIZE = 200;

/** Duyệt hết các trang (sắp theo mã tăng dần) tới khi gặp trang RỖNG; trang ngắn không phải dấu hiệu hết. */
async function listAllAccountIds(
  source: IndustryAccountsSource,
  industryId: string,
): Promise<string[]> {
  const all: string[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await source.listAccountIds(industryId, {
      ...(after !== undefined ? { after } : {}),
      limit: PAGE_SIZE,
    });
    if (page.length === 0) return all;
    all.push(...page);
    after = page[page.length - 1];
  }
}

/** Phần chia của MỘT dòng sổ cho `n` tài khoản đã sắp tăng dần: phần dư cho các mã nhỏ nhất. */
export function splitCost(cost: bigint, n: number): bigint[] {
  if (n <= 0) return [];
  const count = BigInt(n);
  const base = cost / count;
  const rest = Number(cost % count);
  return Array.from({ length: n }, (_, i) => (i < rest ? base + 1n : base));
}

export interface AllocateResult {
  /** `false` khi thiếu nguồn tài khoản theo ngành (việc bị bỏ qua). */
  ran: boolean;
  ledgerRows: number;
  accounts: number;
}

export async function allocateTrendCost(
  input: { weekStart: string; industryId: string },
  source: IndustryAccountsSource | undefined,
): Promise<AllocateResult> {
  if (source === undefined) {
    // Không ném: tránh đốt hàng chờ khi chưa có hiện thực cổng đảo ngược (R-11).
    gatewayEvent('warn', 'ai.industry_source_missing', {
      reason: 'industry_source_missing',
      week_start: input.weekStart,
    });
    return { ran: false, ledgerRows: 0, accounts: 0 };
  }
  const ledger = await systemTx(
    (db) =>
      db
        .select({ id: systemCostLedger.id, cost: systemCostLedger.cost_micro_usd })
        .from(systemCostLedger)
        .where(
          and(
            eq(systemCostLedger.week_start, input.weekStart),
            eq(systemCostLedger.industry_id, input.industryId),
          ),
        )
        .orderBy(asc(systemCostLedger.created_at), asc(systemCostLedger.id)),
    { tenant: 'none' },
  );
  if (ledger.length === 0) return { ran: true, ledgerRows: 0, accounts: 0 };
  const accountIds = await listAllAccountIds(source, input.industryId);
  if (accountIds.length === 0) return { ran: true, ledgerRows: ledger.length, accounts: 0 };
  // Thứ tự gán phần dư dựa trên mã tăng dần của chính danh sách này (không tin thứ tự nguồn trả).
  const sorted = [...accountIds].sort();
  const shares = ledger.map((l) => splitCost(l.cost, sorted.length));
  for (const [index, accountId] of sorted.entries()) {
    const values = ledger.map((l, row) => ({
      // `shares[row]` luôn có đủ `sorted.length` phần (xem splitCost).
      // Mã lấy từ danh sách của nguồn (không từ đầu vào người dùng); chính sách RLS (WITH CHECK) buộc khớp ngữ cảnh.
      account_id: accountId,
      week_start: input.weekStart,
      industry_id: input.industryId,
      cost_micro_usd: shares[row]?.[index] ?? 0n,
      shared_ledger_id: l.id,
    }));
    await runForAccount(accountId, () =>
      systemTx(
        async (db) => {
          await db
            .insert(aiTrendAllocations)
            .values(values)
            .onConflictDoNothing({
              target: [
                aiTrendAllocations.account_id,
                aiTrendAllocations.week_start,
                aiTrendAllocations.industry_id,
                aiTrendAllocations.shared_ledger_id,
              ],
            });
        },
        { tenant: 'from-context' },
      ).catch((err: unknown) => {
        // Tài khoản đã bị xóa giữa chừng → bỏ qua phần của họ (không chặn cả ngành).
        if ((err as { code?: unknown } | null)?.code === 'TENANT_NOT_FOUND') return;
        throw err;
      }),
    );
  }
  return { ran: true, ledgerRows: ledger.length, accounts: sorted.length };
}
