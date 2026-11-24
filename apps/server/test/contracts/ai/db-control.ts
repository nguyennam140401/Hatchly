import { currentAccountId } from '../../../src/core/db/transaction';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import type {
  BudgetStore,
  CostLedgerEntry,
  Reservation,
} from '../../../src/modules/ai_gateway/internal/budget/budget-store';
import type {
  FakeBudgetControl,
  FakeBudgetStore,
  FakeBudgetView,
} from '../../../src/modules/ai_gateway/internal/fake/fake-budget';
import { weekStart } from '../../../src/modules/ai_gateway/internal/budget/system-budget';
import { asOwner } from '../../db/helpers/db';

// 015 T018: phần ĐIỀU KHIỂN kiểm thử trên bảng THẬT `ai_gateway.*` cho bộ hợp đồng Cổng AI (thay phần điều khiển
// của kho `sandbox`). Mã sản xuất (DbBudgetStore) KHÔNG có các hàm này (số tiền, lùi giờ giữ chỗ, xóa sổ) nên QA
// viết ở đây, ghi bằng vai trò `owner` (chủ bảng, không bị RLS vì không FORCE) với lọc tường minh theo
// tài khoản của ngữ cảnh. Chỉ dùng trong kiểm thử.

export interface DbBudgetRow {
  cycle_start: string;
  cycle_end: string;
  used: number;
  reserved: number;
  cap: number;
  soft_limit: number;
  notified_80: boolean;
  notified_100: boolean;
}

const DEFAULT_CAP = 4_000_000;
const DEFAULT_SOFT = 2_000_000;
const DEFAULT_SYSTEM_CAP = 2_000_000;

const n = (v: string | number | null | undefined): number => Number(v ?? 0);

function requireAccount(): string {
  const id = currentAccountId();
  if (id === null) throw new Error('Thiếu ngữ cảnh tài khoản trong kiểm thử');
  return id;
}

/** Ngày bắt đầu chu kỳ kế (cùng ngày tháng sau – chỉ dùng cho dòng mồi kiểm thử, không phải logic sản xuất). */
function plusOneMonth(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m, 1));
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(d, last));
  return next.toISOString().slice(0, 10);
}

export class DbBudgetControl implements FakeBudgetControl {
  constructor(private readonly store: BudgetStore) {}

  private isSystem(): boolean {
    return currentAccountId() === null;
  }

  async setBudget(input: {
    used?: number | undefined;
    reserved?: number | undefined;
    cap?: number | undefined;
    cycleStart?: string | undefined;
  }): Promise<FakeBudgetView> {
    const accountId = requireAccount();
    const cycle = input.cycleStart ?? (await this.store.currentCycleStart());
    await asOwner(async (c) => {
      await c.query(
        `INSERT INTO ai_gateway.ai_budgets (id, account_id, cycle_start, cycle_end, cap, soft_limit)
         VALUES ($1, $2, $3::date, $4::date, $5, $6)
         ON CONFLICT (account_id, cycle_start) DO NOTHING`,
        [uuidV7(), accountId, cycle, plusOneMonth(cycle), DEFAULT_CAP, DEFAULT_SOFT],
      );
      // MỘT câu lệnh: CHECK `used + reserved <= cap` và `soft_limit < cap` xét trên dòng cuối.
      await c.query(
        `UPDATE ai_gateway.ai_budgets
            SET used = COALESCE($3::bigint, used),
                reserved = COALESCE($4::bigint, reserved),
                cap = COALESCE($5::bigint, cap),
                soft_limit = LEAST(soft_limit, COALESCE($5::bigint, cap) - 1),
                updated_at = now()
          WHERE account_id = $1 AND cycle_start = $2::date`,
        [accountId, cycle, input.used ?? null, input.reserved ?? null, input.cap ?? null],
      );
    });
    return this.getBudget();
  }

  async getBudget(): Promise<FakeBudgetView> {
    const accountId = requireAccount();
    const cycle = await this.store.currentCycleStart();
    const row = await asOwner(async (c) => {
      const r = await c.query<{
        used: string;
        reserved: string;
        cap: string;
        soft_limit: string;
        notified_80: boolean;
        notified_100: boolean;
      }>(
        `SELECT used::text, reserved::text, cap::text, soft_limit::text, notified_80, notified_100
           FROM ai_gateway.ai_budgets WHERE account_id = $1 AND cycle_start = $2::date`,
        [accountId, cycle],
      );
      return r.rows[0];
    });
    return {
      cycleStart: cycle,
      used: n(row?.used),
      reserved: n(row?.reserved),
      cap: row === undefined ? DEFAULT_CAP : n(row.cap),
      softLimit: row === undefined ? DEFAULT_SOFT : n(row.soft_limit),
      notified80: row?.notified_80 ?? false,
      notified100: row?.notified_100 ?? false,
    };
  }

  /** Mọi dòng ngân sách của tài khoản trong ngữ cảnh (mọi chu kỳ), mới nhất trước. */
  async budgetRows(): Promise<DbBudgetRow[]> {
    const accountId = requireAccount();
    return asOwner(async (c) => {
      const r = await c.query<Record<string, string | boolean>>(
        `SELECT cycle_start::text, cycle_end::text, used::text, reserved::text, cap::text,
                soft_limit::text, notified_80, notified_100
           FROM ai_gateway.ai_budgets WHERE account_id = $1 ORDER BY cycle_start DESC`,
        [accountId],
      );
      return r.rows.map((row) => ({
        cycle_start: String(row.cycle_start),
        cycle_end: String(row.cycle_end),
        used: n(row.used as string),
        reserved: n(row.reserved as string),
        cap: n(row.cap as string),
        soft_limit: n(row.soft_limit as string),
        notified_80: row.notified_80 === true,
        notified_100: row.notified_100 === true,
      }));
    });
  }

  /** Dòng ngân sách của một chu kỳ CŨ đã cạn trần và đã báo 80/100 (để chứng minh chu kỳ mới đặt lại). */
  async seedExhaustedPastCycle(cycleStart = '2020-01-15'): Promise<string> {
    const accountId = requireAccount();
    await asOwner((c) =>
      c.query(
        `INSERT INTO ai_gateway.ai_budgets
           (id, account_id, cycle_start, cycle_end, used, reserved, cap, soft_limit, notified_80, notified_100)
         VALUES ($1, $2, $3::date, $4::date, $5, 0, $5, $6, true, true)
         ON CONFLICT (account_id, cycle_start) DO NOTHING`,
        [uuidV7(), accountId, cycleStart, plusOneMonth(cycleStart), DEFAULT_CAP, DEFAULT_SOFT],
      ),
    );
    return cycleStart;
  }

  async setSystemBudget(input: {
    used?: number;
    reserved?: number;
    cap?: number;
    weekStart?: string;
  }): Promise<void> {
    const week = input.weekStart ?? weekStart();
    await asOwner(async (c) => {
      await c.query(
        `INSERT INTO ai_gateway.system_budgets (week_start, cap) VALUES ($1::date, $2)
         ON CONFLICT (week_start) DO NOTHING`,
        [week, input.cap ?? DEFAULT_SYSTEM_CAP],
      );
      await c.query(
        `UPDATE ai_gateway.system_budgets
            SET used = COALESCE($2::bigint, used),
                reserved = COALESCE($3::bigint, reserved),
                cap = COALESCE($4::bigint, cap),
                updated_at = now()
          WHERE week_start = $1::date`,
        [week, input.used ?? null, input.reserved ?? null, input.cap ?? null],
      );
    });
  }

  async ledger(): Promise<CostLedgerEntry[]> {
    if (this.isSystem()) {
      const rows = await asOwner(
        async (c) =>
          (
            await c.query<Record<string, string | number | null | Date>>(
              `SELECT id, week_start::text AS period, industry_id, reservation_id, task, model_tier, model_id,
                      provider, input_tokens, output_tokens, cached_input_tokens, cost_micro_usd::text,
                      estimate_micro_usd::text, anomaly, over_cap_micro_usd::text, trace_id, created_at
                 FROM ai_gateway.system_cost_ledger ORDER BY created_at, id`,
            )
          ).rows,
      );
      return rows.map((r) => ({
        id: String(r.id),
        scope: 'system' as const,
        accountId: null,
        cycleOrWeekStart: String(r.period),
        reservationId: String(r.reservation_id),
        industryId: r.industry_id === null ? undefined : String(r.industry_id),
        task: r.task as CostLedgerEntry['task'],
        modelTier: r.model_tier as CostLedgerEntry['modelTier'],
        modelId: String(r.model_id),
        provider: String(r.provider),
        inputTokens: Number(r.input_tokens),
        outputTokens: Number(r.output_tokens),
        cachedInputTokens: Number(r.cached_input_tokens),
        costMicroUsd: n(r.cost_micro_usd as string),
        estimateMicroUsd: n(r.estimate_micro_usd as string),
        anomaly: r.anomaly as CostLedgerEntry['anomaly'],
        overCapMicroUsd: n(r.over_cap_micro_usd as string),
        traceId: r.trace_id === null ? null : String(r.trace_id),
        createdAt: r.created_at as Date,
      }));
    }
    const accountId = requireAccount();
    const rows = await asOwner(
      async (c) =>
        (
          await c.query<Record<string, string | number | null | Date>>(
            `SELECT id, cycle_start::text AS period, reservation_id, task, model_tier, model_id, provider,
                    input_tokens, output_tokens, cached_input_tokens, cost_micro_usd::text,
                    estimate_micro_usd::text, anomaly, over_cap_micro_usd::text, trace_id, created_at
               FROM ai_gateway.ai_cost_ledger WHERE account_id = $1 ORDER BY created_at, id`,
            [accountId],
          )
        ).rows,
    );
    return rows.map((r) => ({
      id: String(r.id),
      scope: 'account' as const,
      accountId,
      cycleOrWeekStart: String(r.period),
      reservationId: String(r.reservation_id),
      task: r.task as CostLedgerEntry['task'],
      modelTier: r.model_tier as CostLedgerEntry['modelTier'],
      modelId: String(r.model_id),
      provider: String(r.provider),
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      cachedInputTokens: Number(r.cached_input_tokens),
      costMicroUsd: n(r.cost_micro_usd as string),
      estimateMicroUsd: n(r.estimate_micro_usd as string),
      anomaly: r.anomaly as CostLedgerEntry['anomaly'],
      overCapMicroUsd: n(r.over_cap_micro_usd as string),
      traceId: r.trace_id === null ? null : String(r.trace_id),
      createdAt: r.created_at as Date,
    }));
  }

  async reservations(): Promise<Reservation[]> {
    const system = this.isSystem();
    const accountId = system ? null : requireAccount();
    const rows = await asOwner(
      async (c) =>
        (
          await c.query<Record<string, string | Date | null>>(
            system
              ? `SELECT id, week_start::text AS period, estimate::text, model_tier, task, reserved_at, called_at, state
                   FROM ai_gateway.system_reservations ORDER BY reserved_at, id`
              : `SELECT id, cycle_start::text AS period, estimate::text, model_tier, task, reserved_at, called_at, state
                   FROM ai_gateway.ai_reservations WHERE account_id = $1 ORDER BY reserved_at, id`,
            system ? [] : [accountId],
          )
        ).rows,
    );
    return rows.map((r) => ({
      id: String(r.id),
      scope: system ? ('system' as const) : ('account' as const),
      key: String(r.period),
      estimateMicroUsd: n(r.estimate as string),
      modelTier: r.model_tier as Reservation['modelTier'],
      task: r.task as Reservation['task'],
      reservedAt: r.reserved_at as Date,
      calledAt: (r.called_at as Date | null) ?? null,
      state: r.state as Reservation['state'],
    }));
  }

  async ageReservations(ms: number): Promise<void> {
    const system = this.isSystem();
    const accountId = system ? null : requireAccount();
    const delta = `${Math.trunc(ms)} milliseconds`;
    await asOwner((c) =>
      system
        ? c.query(
            `UPDATE ai_gateway.system_reservations
                SET reserved_at = reserved_at - $1::interval, called_at = called_at - $1::interval
              WHERE state IN ('held', 'calling')`,
            [delta],
          )
        : c.query(
            `UPDATE ai_gateway.ai_reservations
                SET reserved_at = reserved_at - $2::interval, called_at = called_at - $2::interval
              WHERE account_id = $1 AND state IN ('held', 'calling')`,
            [accountId, delta],
          ),
    );
  }

  async reset(): Promise<void> {
    const system = this.isSystem();
    const accountId = system ? null : requireAccount();
    await asOwner(async (c) => {
      if (system) {
        await c.query('DELETE FROM ai_gateway.system_cost_ledger');
        await c.query('DELETE FROM ai_gateway.system_reservations');
        await c.query('UPDATE ai_gateway.system_budgets SET used = 0, reserved = 0');
        return;
      }
      await c.query('DELETE FROM ai_gateway.ai_cost_ledger WHERE account_id = $1', [accountId]);
      await c.query('DELETE FROM ai_gateway.ai_reservations WHERE account_id = $1', [accountId]);
      await c.query('DELETE FROM ai_gateway.ai_budgets WHERE account_id = $1', [accountId]);
    });
  }
}

/**
 * Ghép `DbBudgetStore` (mã sản xuất) với phần điều khiển kiểm thử thành một `FakeBudgetStore`. Mọi phương thức là
 * thuộc tính RIÊNG của đối tượng để bộ hợp đồng (mục 3) có thể bọc `store[k]` để quan sát bất biến.
 */
export function composeDbStore(store: BudgetStore, control: DbBudgetControl): FakeBudgetStore {
  // Nguồn `minEstimate` DUY NHẤT (giá CSDL) cho `getUsage()` ở chế độ db: phải chuyển tiếp, nếu không Cổng rơi về sổ giá giả.
  const minCall = store.minCallEstimateMicro?.bind(store);
  // `attemptRoute`: tuyến + giá THẬT của từng lượt (chính/dự phòng) để Cổng gọi, ước tính và quyết toán đúng mô hình/giá.
  const attemptRoute = store.attemptRoute?.bind(store);
  return {
    ...(minCall !== undefined ? { minCallEstimateMicro: () => minCall() } : {}),
    ...(attemptRoute !== undefined
      ? { attemptRoute: (task, tier, attempt) => attemptRoute(task, tier, attempt) }
      : {}),
    currentCycleStart: () => store.currentCycleStart(),
    reserve: (key, est, meta) => store.reserve(key, est, meta),
    markCalling: (id) => store.markCalling(id),
    settle: (id, actual, ledger, hooks) => store.settle(id, actual, ledger, hooks),
    release: (id) => store.release(id),
    usage: (key) => store.usage(key),
    releaseStale: (olderThanMs, hooks) => store.releaseStale(olderThanMs, hooks),
    setBudget: (b) => control.setBudget(b),
    getBudget: () => control.getBudget(),
    setSystemBudget: (b) => control.setSystemBudget(b),
    ledger: () => control.ledger(),
    reservations: () => control.reservations(),
    ageReservations: (ms) => control.ageReservations(ms),
    reset: () => control.reset(),
  };
}
