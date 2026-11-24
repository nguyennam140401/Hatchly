import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { expect } from 'vitest';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import type { IndustryAccountsSource } from '../../../src/modules/ai_gateway';
import * as aiJobs from '../../../src/modules/ai_gateway/jobs';
import type { JobTypeDefinition } from '../../../src/modules/queue/public-api';
import { makeDbStore } from '../../contracts/ai/harness';
import { asOwner } from '../../db/helpers/db';
import { TEST_LOG_DIR } from '../../setup/log-capture';

// Bộ đồ nghề kiểm thử US7 (015, FR-033, R-11): phân bổ chi phí xu hướng cho tài khoản cùng ngành.
//
// HỢP ĐỒNG GIẢ ĐỊNH (T061, viết kiểm thử TRƯỚC mã) – chỉnh DUY NHẤT ở tệp này nếu dev đặt tên khác:
//  1. `jobs.ts` xuất `allocateTrendCostJob` = loại việc `ai_gateway.allocate_trend_cost`, hàng chờ `trends`,
//     phạm vi `system`, payload `z.strictObject({ weekStart: 'YYYY-MM-DD', industryId: uuid })`.
//  2. `registerAiJobHandlers(store, onCrossed?, deps?)` nhận tham số thứ ba `{ industryAccounts? }` (cổng đảo ngược
//     `IndustryAccountsSource`); không truyền nguồn → việc bị bỏ qua + cảnh báo `ai.industry_source_missing`.
//  3. Bộ xử lý duyệt hết các trang của `listAccountIds` (tới khi trang rỗng) để biết đủ danh sách tài khoản của ngành,
//     rồi mỗi tài khoản MỘT `systemTx` đặt ngữ cảnh tài khoản, `INSERT … ON CONFLICT DO NOTHING`.

export interface AllocationPayload {
  weekStart: string;
  industryId: string;
}

/** Loại việc phân bổ; chưa có mã → ném lỗi rõ ràng (ca kiểm thử THẤT BẠI đúng lý do, không phải lỗi biên dịch). */
export function allocationJob(): JobTypeDefinition<AllocationPayload> {
  const job = (aiJobs as Record<string, unknown>).allocateTrendCostJob;
  if (job === undefined) {
    throw new Error('Chưa có allocateTrendCostJob trong ai_gateway/jobs.ts (T061)');
  }
  return job as JobTypeDefinition<AllocationPayload>;
}

/**
 * Đăng ký bộ xử lý của Cổng AI trên kho thật với nguồn tài khoản theo ngành đã cho. Chỉ gọi MỘT lần cho mỗi tệp kiểm thử
 * (`registerAiJobHandlers` bỏ qua lần gọi sau).
 */
export async function registerAllocationHandler(
  source: IndustryAccountsSource | undefined,
): Promise<void> {
  const store = await makeDbStore();
  (aiJobs.registerAiJobHandlers as (...args: unknown[]) => void)(store, undefined, {
    industryAccounts: source,
  });
}

export interface ListCall {
  industryId: string;
  after: string | undefined;
  limit: number;
  returned: string[];
}

/** Nguồn tài khoản theo ngành trong bộ nhớ: sắp mã tăng dần, đúng ngữ nghĩa `{ after, limit }`, ghi lại từng lời gọi. */
export function makeIndustrySource(industries: Map<string, string[]>): {
  source: IndustryAccountsSource;
  calls: ListCall[];
} {
  const calls: ListCall[] = [];
  return {
    calls,
    source: {
      listAccountIds: (industryId, page) => {
        const all = [...(industries.get(industryId) ?? [])].sort();
        const returned = all
          .filter((id) => page.after === undefined || id > page.after)
          .slice(0, page.limit);
        calls.push({ industryId, after: page.after, limit: page.limit, returned });
        return Promise.resolve(returned);
      },
    },
  };
}

/** Tạo `n` tài khoản `active` bằng một câu lệnh; trả mã sắp tăng dần. */
export async function bulkAccounts(n: number): Promise<string[]> {
  const ids = Array.from({ length: n }, () => uuidV7()).sort();
  await asOwner((c) =>
    c.query("INSERT INTO account.accounts (id, status) SELECT unnest($1::uuid[]), 'active'", [ids]),
  );
  return ids;
}

/** Thêm một dòng `system_cost_ledger` (nguồn của phân bổ) bằng vai trò owner. Trả mã dòng. */
export async function seedSystemLedger(input: {
  weekStart: string;
  industryId: string;
  cost: number;
}): Promise<string> {
  const id = uuidV7();
  await asOwner((c) =>
    c.query(
      `INSERT INTO ai_gateway.system_cost_ledger
         (id, week_start, industry_id, reservation_id, task, model_tier, model_id, provider,
          cost_micro_usd, estimate_micro_usd)
       VALUES ($1, $2::date, $3, $4, 'trend_summary', 'cheap', 'qa-model', 'qa-provider', $5, $5)`,
      [id, input.weekStart, input.industryId, uuidV7(), input.cost],
    ),
  );
  return id;
}

export interface AllocationRow {
  account_id: string;
  week_start: string;
  industry_id: string;
  cost: number;
  shared_ledger_id: string;
}

/** Mọi dòng `ai_trend_allocations` của (tuần, ngành), sắp theo (dòng sổ nguồn, mã tài khoản). */
export async function allocationRows(
  weekStart: string,
  industryId: string,
): Promise<AllocationRow[]> {
  return asOwner(async (c) => {
    const r = await c.query<{
      account_id: string;
      week_start: string;
      industry_id: string;
      cost: string;
      shared_ledger_id: string;
    }>(
      `SELECT account_id::text, week_start::text, industry_id::text, cost_micro_usd::text AS cost,
              shared_ledger_id::text
         FROM ai_gateway.ai_trend_allocations
        WHERE week_start = $1::date AND industry_id = $2
        ORDER BY shared_ledger_id, account_id`,
      [weekStart, industryId],
    );
    return r.rows.map((x) => ({ ...x, cost: Number(x.cost) }));
  });
}

/** Phần chia theo từng tài khoản (tăng dần theo mã) của MỘT dòng sổ nguồn; tài khoản không có dòng → 0. */
export function sharesOf(rows: AllocationRow[], ledgerId: string, accounts: string[]): number[] {
  const byAccount = new Map(
    rows.filter((r) => r.shared_ledger_id === ledgerId).map((r) => [r.account_id, r.cost]),
  );
  return [...accounts].sort().map((a) => byAccount.get(a) ?? 0);
}

export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** Số lần chuỗi xuất hiện trong nhật ký của tệp kiểm thử đang chạy. */
export function logOccurrences(needle: string): number {
  const file = resolve(
    TEST_LOG_DIR,
    `${basename(expect.getState().testPath ?? '').replace(/\.[cm]?ts$/, '')}.ndjson`,
  );
  try {
    return readFileSync(file, 'utf8').split(needle).length - 1;
  } catch {
    return 0;
  }
}

/** Dọn dữ liệu mồi của một nhóm ngành/tuần (sổ nguồn + dòng phân bổ), vai trò owner. */
export async function cleanupAllocations(industryIds: string[]): Promise<void> {
  if (industryIds.length === 0) return;
  await asOwner(async (c) => {
    await c.query('DELETE FROM ai_gateway.ai_trend_allocations WHERE industry_id = ANY($1)', [
      industryIds,
    ]);
    await c.query('DELETE FROM ai_gateway.system_cost_ledger WHERE industry_id = ANY($1)', [
      industryIds,
    ]);
  });
}
