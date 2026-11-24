// T059 (015 US7, FR-033, R-11): phân bổ chi phí xu hướng dùng chung cho tài khoản cùng ngành, ghi `ai_trend_allocations`.
// Viết TRƯỚC mã (T061): thất bại cho tới khi có `allocateTrendCostJob` + bộ xử lý (xem hợp đồng giả định ở
// helpers/allocation-kit.ts). Bảng tenant do vai trò `system` ghi: mỗi tài khoản một `systemTx` đặt ngữ cảnh tài khoản.
// Bất biến: tổng phần chia = chi phí dòng sổ nguồn (số nguyên); phần dư gán xác định cho mã nhỏ nhất; chạy lại không
// nhân đôi; KHÔNG chạm `ai_budgets` (% khách thấy không đổi, FR-032).
import { afterAll, beforeAll, expect, it } from 'vitest';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import {
  asOwner,
  createAccount,
  describeDb,
  makeDatabase,
  type TestDatabase,
} from '../db/helpers/db';
import { expectIdempotent, runJobInline } from '../support/queue-test-kit';
import {
  allocationJob,
  allocationRows,
  bulkAccounts,
  cleanupAllocations,
  makeIndustrySource,
  registerAllocationHandler,
  seedSystemLedger,
  sharesOf,
  sum,
} from './helpers/allocation-kit';

const WEEK = '2035-03-05'; // thứ Hai
const industries = new Map<string, string[]>();
const { source, calls } = makeIndustrySource(industries);
const used: string[] = [];

/** Ngành mới (mã riêng) với `n` tài khoản. */
async function newIndustry(n: number): Promise<{ industryId: string; accounts: string[] }> {
  const industryId = uuidV7();
  used.push(industryId);
  const accounts = await bulkAccounts(n);
  industries.set(industryId, accounts);
  return { industryId, accounts };
}

const run = (industryId: string, weekStart = WEEK) =>
  runJobInline(allocationJob(), { weekStart, industryId });

describeDb('Phân bổ chi phí xu hướng cho tài khoản cùng ngành (015 US7)', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = makeDatabase({ unit: 'worker', poolMax: 8 });
    await registerAllocationHandler(source);
  });
  afterAll(async () => {
    await cleanupAllocations(used);
    await database.close();
  });

  it('chia đều: 9 000 cho 3 tài khoản → mỗi tài khoản 3 000, ghi đủ tuần/ngành/dòng sổ nguồn', async () => {
    const { industryId, accounts } = await newIndustry(3);
    const ledgerId = await seedSystemLedger({ weekStart: WEEK, industryId, cost: 9_000 });
    await run(industryId);
    const rows = await allocationRows(WEEK, industryId);
    expect(rows).toHaveLength(3);
    expect(sharesOf(rows, ledgerId, accounts)).toEqual([3_000, 3_000, 3_000]);
    for (const r of rows) {
      expect(r).toMatchObject({
        week_start: WEEK,
        industry_id: industryId,
        shared_ledger_id: ledgerId,
      });
    }
    expect(new Set(rows.map((r) => r.account_id))).toEqual(new Set(accounts));
  });

  it('phần dư của phép chia nguyên gán xác định cho mã nhỏ nhất; tổng luôn bằng chi phí', async () => {
    const a = await newIndustry(3);
    const ledgerA = await seedSystemLedger({
      weekStart: WEEK,
      industryId: a.industryId,
      cost: 10_000,
    });
    await run(a.industryId);
    const sharesA = sharesOf(await allocationRows(WEEK, a.industryId), ledgerA, a.accounts);
    expect(sharesA).toEqual([3_334, 3_333, 3_333]); // dư 1 → mã nhỏ nhất
    expect(sum(sharesA)).toBe(10_000);

    const b = await newIndustry(4);
    const ledgerB = await seedSystemLedger({ weekStart: WEEK, industryId: b.industryId, cost: 10 });
    await run(b.industryId);
    const sharesB = sharesOf(await allocationRows(WEEK, b.industryId), ledgerB, b.accounts);
    expect(sharesB).toEqual([3, 3, 2, 2]); // dư 2 → hai mã nhỏ nhất
    expect(sum(sharesB)).toBe(10);
  });

  it('chi phí nhỏ hơn số tài khoản: 2 cho 3 tài khoản → hai mã nhỏ nhất mỗi người 1, tổng = 2, không phần âm', async () => {
    const { industryId, accounts } = await newIndustry(3);
    const ledgerId = await seedSystemLedger({ weekStart: WEEK, industryId, cost: 2 });
    await run(industryId);
    const shares = sharesOf(await allocationRows(WEEK, industryId), ledgerId, accounts);
    expect(shares).toEqual([1, 1, 0]);
    expect(sum(shares)).toBe(2);
  });

  it('phân công phần dư ổn định: xóa kết quả rồi chạy lại cho đúng cùng số tiền của từng tài khoản', async () => {
    const { industryId, accounts } = await newIndustry(3);
    const ledgerId = await seedSystemLedger({ weekStart: WEEK, industryId, cost: 10_001 });
    await run(industryId);
    const first = sharesOf(await allocationRows(WEEK, industryId), ledgerId, accounts);
    expect(sum(first)).toBe(10_001);
    await asOwner((c) =>
      c.query('DELETE FROM ai_gateway.ai_trend_allocations WHERE industry_id = $1', [industryId]),
    );
    await run(industryId);
    expect(sharesOf(await allocationRows(WEEK, industryId), ledgerId, accounts)).toEqual(first);
  });

  it('nhiều dòng sổ cùng ngành/tuần: mỗi dòng chia riêng, tổng theo từng dòng bằng chi phí dòng đó', async () => {
    const { industryId, accounts } = await newIndustry(3);
    const l1 = await seedSystemLedger({ weekStart: WEEK, industryId, cost: 6_000 });
    const l2 = await seedSystemLedger({ weekStart: WEEK, industryId, cost: 3_001 });
    await run(industryId);
    const rows = await allocationRows(WEEK, industryId);
    expect(rows).toHaveLength(6);
    expect(sharesOf(rows, l1, accounts)).toEqual([2_000, 2_000, 2_000]);
    const s2 = sharesOf(rows, l2, accounts);
    expect(s2).toEqual([1_001, 1_000, 1_000]);
    expect(sum(s2)).toBe(3_001);
  });

  it('chạy lại hai lần cho cùng kết quả: không nhân đôi dòng, không đổi số tiền (hiến chương V)', async () => {
    const { industryId, accounts } = await newIndustry(5);
    const ledgerId = await seedSystemLedger({ weekStart: WEEK, industryId, cost: 12_345 });
    await expectIdempotent(
      allocationJob(),
      { weekStart: WEEK, industryId },
      { snapshot: () => allocationRows(WEEK, industryId) },
    );
    const rows = await allocationRows(WEEK, industryId);
    expect(rows).toHaveLength(5);
    expect(sum(sharesOf(rows, ledgerId, accounts))).toBe(12_345);
  });

  it('khóa duy nhất (tài khoản, tuần, ngành, dòng sổ): chèn trùng bị CSDL từ chối', async () => {
    const { industryId, accounts } = await newIndustry(2);
    const ledgerId = await seedSystemLedger({ weekStart: WEEK, industryId, cost: 4_000 });
    await run(industryId);
    await expect(
      asOwner((c) =>
        c.query(
          `INSERT INTO ai_gateway.ai_trend_allocations
             (id, account_id, week_start, industry_id, cost_micro_usd, shared_ledger_id)
           VALUES ($1, $2, $3::date, $4, 1, $5)`,
          [uuidV7(), accounts[0], WEEK, industryId, ledgerId],
        ),
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('chạy dở (hai tài khoản chưa được ghi) → chạy lại bổ sung đúng phần thiếu, giữ nguyên phần đã ghi', async () => {
    const { industryId, accounts } = await newIndustry(4);
    const ledgerId = await seedSystemLedger({ weekStart: WEEK, industryId, cost: 10_003 });
    await run(industryId);
    const full = await allocationRows(WEEK, industryId);
    const gone = [accounts[1]!, accounts[3]!];
    await asOwner((c) =>
      c.query(
        'DELETE FROM ai_gateway.ai_trend_allocations WHERE industry_id = $1 AND account_id = ANY($2)',
        [industryId, gone],
      ),
    );
    await run(industryId);
    const after = await allocationRows(WEEK, industryId);
    expect(after).toEqual(full);
    expect(sum(sharesOf(after, ledgerId, accounts))).toBe(10_003);
  });

  it('dòng sổ phát sinh sau lần chạy trước: chạy lại chỉ thêm phần của dòng mới, dòng cũ giữ nguyên', async () => {
    const { industryId, accounts } = await newIndustry(3);
    const l1 = await seedSystemLedger({ weekStart: WEEK, industryId, cost: 3_000 });
    await run(industryId);
    const before = await allocationRows(WEEK, industryId);
    const l2 = await seedSystemLedger({ weekStart: WEEK, industryId, cost: 900 });
    await run(industryId);
    const after = await allocationRows(WEEK, industryId);
    expect(after).toHaveLength(6);
    expect(after.filter((r) => r.shared_ledger_id === l1)).toEqual(before);
    expect(sharesOf(after, l2, accounts)).toEqual([300, 300, 300]);
  });

  it('KHÔNG cộng vào ai_budgets: used/reserved/cap của khách giữ nguyên, không sinh dòng ngân sách mới', async () => {
    const { industryId, accounts } = await newIndustry(3);
    const withBudget = accounts[0]!;
    await asOwner((c) =>
      c.query(
        `INSERT INTO ai_gateway.ai_budgets (id, account_id, cycle_start, cycle_end, used, cap, soft_limit)
         VALUES ($1, $2, '2035-03-01', '2035-04-01', 777, 4000000, 2000000)`,
        [uuidV7(), withBudget],
      ),
    );
    const snapshot = () =>
      asOwner(async (c) => {
        const r = await c.query<Record<string, string>>(
          `SELECT account_id::text, cycle_start::text, used::text, reserved::text, cap::text,
                  notified_80, notified_100
             FROM ai_gateway.ai_budgets WHERE account_id = ANY($1) ORDER BY account_id, cycle_start`,
          [accounts],
        );
        return r.rows;
      });
    const before = await snapshot();
    await seedSystemLedger({ weekStart: WEEK, industryId, cost: 30_000 });
    await run(industryId);
    expect(await allocationRows(WEEK, industryId)).toHaveLength(3);
    const after = await snapshot();
    expect(after).toEqual(before);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ used: '777', reserved: '0' });
  });

  it('chỉ chia đúng (tuần, ngành): dòng sổ tuần/ngành khác và tài khoản ngành khác không có dòng phân bổ', async () => {
    const mine = await newIndustry(2);
    const other = await newIndustry(2);
    await seedSystemLedger({ weekStart: WEEK, industryId: mine.industryId, cost: 2_000 });
    await seedSystemLedger({ weekStart: WEEK, industryId: other.industryId, cost: 8_000 });
    await seedSystemLedger({ weekStart: '2035-03-12', industryId: mine.industryId, cost: 6_000 });
    await run(mine.industryId);
    expect((await allocationRows(WEEK, mine.industryId)).map((r) => r.cost)).toEqual([
      1_000, 1_000,
    ]);
    expect(await allocationRows(WEEK, other.industryId)).toEqual([]);
    expect(await allocationRows('2035-03-12', mine.industryId)).toEqual([]);
    const strays = await asOwner((c) =>
      c.query('SELECT 1 FROM ai_gateway.ai_trend_allocations WHERE account_id = ANY($1)', [
        other.accounts,
      ]),
    );
    expect(strays.rowCount).toBe(0);
  });

  it('ngành không có tài khoản, hoặc chưa có chi phí trong tuần → không ghi gì, không ném lỗi', async () => {
    const empty = await newIndustry(0);
    await seedSystemLedger({ weekStart: WEEK, industryId: empty.industryId, cost: 5_000 });
    await expect(run(empty.industryId)).resolves.not.toThrow();
    expect(await allocationRows(WEEK, empty.industryId)).toEqual([]);

    const noCost = await newIndustry(3);
    await expect(run(noCost.industryId)).resolves.not.toThrow();
    expect(await allocationRows(WEEK, noCost.industryId)).toEqual([]);
  });

  it('phân trang theo mã tăng dần: 250 tài khoản, con trỏ `after` = mã cuối trang trước, đủ 250 dòng, tổng = chi phí', async () => {
    const { industryId, accounts } = await newIndustry(250);
    const cost = 250 * 1_000 + 37; // dư 37 → 37 mã nhỏ nhất mỗi người +1
    const ledgerId = await seedSystemLedger({ weekStart: WEEK, industryId, cost });
    calls.length = 0;
    await run(industryId);

    const mine = calls.filter((c) => c.industryId === industryId);
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(mine[0]!.after).toBeUndefined();
    let last: string | undefined;
    const seen: string[] = [];
    for (const call of mine) {
      expect(Number.isInteger(call.limit) && call.limit > 0).toBe(true);
      expect(call.after).toBe(last);
      expect(call.returned).toEqual([...call.returned].sort());
      seen.push(...call.returned);
      if (call.returned.length > 0) last = call.returned[call.returned.length - 1];
    }
    expect(seen).toEqual(accounts); // mỗi mã đúng một lần, theo thứ tự tăng dần

    const rows = await allocationRows(WEEK, industryId);
    expect(rows).toHaveLength(250);
    const shares = sharesOf(rows, ledgerId, accounts);
    expect(sum(shares)).toBe(cost);
    expect(shares.slice(0, 37).every((s) => s === 1_001)).toBe(true);
    expect(shares.slice(37).every((s) => s === 1_000)).toBe(true);
  });

  it('tiền đề: tài khoản dựng bằng createAccount() cũng nhận phần chia (không phụ thuộc cách tạo tài khoản)', async () => {
    const industryId = uuidV7();
    used.push(industryId);
    const a = await createAccount();
    const b = await createAccount();
    industries.set(industryId, [a, b]);
    const ledgerId = await seedSystemLedger({ weekStart: WEEK, industryId, cost: 5 });
    await run(industryId);
    const shares = sharesOf(await allocationRows(WEEK, industryId), ledgerId, [a, b]);
    expect(sum(shares)).toBe(5);
    expect(shares).toEqual([3, 2]);
  });
});
