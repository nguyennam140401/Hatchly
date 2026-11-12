import { and, asc, eq, inArray, lt, max, sql } from 'drizzle-orm';
import { currentAccountId, systemTx, tenantTx, type Db } from '../../../../core/db';
import { uuidV7 } from '../../../../core/ids/uuid-v7';
import { gatewayEvent } from '../../../../core/gateways/op-log';
import { requireFakeAccount } from '../../../../dev/fake-components';
import {
  aiFakeBudgets,
  aiFakeCostLedger,
  aiFakeReservations,
  aiFakeSystemBudgets,
  aiFakeSystemCostLedger,
  aiFakeSystemReservations,
} from '../../../../dev/sandbox/schema';
import type { AiTask, ModelTier } from '../../public-api';
import {
  ACCOUNT_CAP_MICRO_USD,
  ACCOUNT_SOFT_LIMIT_MICRO_USD,
  type BudgetKey,
  type BudgetSnapshot,
  type CostLedgerEntry,
  type Crossed,
  type LedgerDraft,
  type Reservation,
  type ReserveMeta,
  type ReserveResult,
  type SettleHooks,
} from '../budget/budget-store';
import { defaultCycleStart, weekStart } from '../budget/system-budget';
import type { FakeBudgetStore, FakeBudgetView } from './fake-budget';

// Kho ngân sách chế độ `sandbox` (005, research R8) – bản nháp của bản thật WBS 3.1 (chỉ khác schema).
// Giữ chỗ = MỘT câu lệnh `UPDATE … WHERE used + reserved + est <= cap RETURNING`; `CHECK (used + reserved
// <= cap)` là chốt cuối. Tài khoản: tenantTx (RLS); hệ thống: systemTx không tenant (chỉ vai trò system).

export interface SandboxBudgetOptions {
  systemWeeklyCap: number;
  /** Gọi trong giao dịch giữ chỗ (tài khoản) – vd hẹn việc trả giữ chỗ treo sau 15 phút. */
  onReserved?: (tx: Db, reservation: { id: string; reservedAt: Date }) => Promise<void>;
}

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

type ResRow = typeof aiFakeReservations.$inferSelect | typeof aiFakeSystemReservations.$inferSelect;

function toReservation(r: ResRow, scope: 'account' | 'system'): Reservation {
  return {
    id: r.id,
    scope,
    key: 'cycle_start' in r ? r.cycle_start : r.week_start,
    estimateMicroUsd: n(r.estimate),
    modelTier: r.model_tier as ModelTier,
    task: r.task as AiTask,
    reservedAt: r.reserved_at,
    calledAt: r.called_at,
    state: r.state,
  };
}

export class SandboxBudgetStore implements FakeBudgetStore {
  constructor(private readonly opts: SandboxBudgetOptions) {}

  /** Giao dịch của phạm vi: tài khoản → tenantTx; hệ thống → systemTx không tenant. */
  private tx<T>(scope: 'account' | 'system', fn: (db: Db) => Promise<T>): Promise<T> {
    return scope === 'account' ? tenantTx(fn) : systemTx(fn, { tenant: 'none' });
  }

  private scopeOfContext(): 'account' | 'system' {
    return currentAccountId() === null ? 'system' : 'account';
  }

  private async ensureAccountBudget(db: Db, cycleStart: string): Promise<void> {
    await db
      .insert(aiFakeBudgets)
      .values({
        account_id: requireFakeAccount(),
        cycle_start: cycleStart,
        cap: BigInt(ACCOUNT_CAP_MICRO_USD),
        soft_limit: BigInt(ACCOUNT_SOFT_LIMIT_MICRO_USD),
      })
      .onConflictDoNothing({ target: [aiFakeBudgets.account_id, aiFakeBudgets.cycle_start] });
  }

  private async ensureSystemBudget(db: Db, week: string): Promise<void> {
    await db
      .insert(aiFakeSystemBudgets)
      .values({
        week_start: week,
        cap: BigInt(this.opts.systemWeeklyCap),
        soft_limit: BigInt(this.opts.systemWeeklyCap),
      })
      .onConflictDoNothing({ target: aiFakeSystemBudgets.week_start });
  }

  async currentCycleStart(): Promise<string> {
    const [row] = await tenantTx((db) =>
      db.select({ c: max(aiFakeBudgets.cycle_start) }).from(aiFakeBudgets),
    );
    return row?.c ?? defaultCycleStart();
  }

  reserve(key: BudgetKey, est: number, meta: ReserveMeta): Promise<ReserveResult> {
    const e = BigInt(est);
    if (key.scope === 'account') {
      return tenantTx(async (db) => {
        await this.ensureAccountBudget(db, key.cycleStart);
        const [row] = await db
          .update(aiFakeBudgets)
          .set({ reserved: sql`${aiFakeBudgets.reserved} + ${e}` })
          .where(
            and(
              eq(aiFakeBudgets.account_id, sql`account.current_account_id()`),
              eq(aiFakeBudgets.cycle_start, key.cycleStart),
              sql`${aiFakeBudgets.used} + ${aiFakeBudgets.reserved} + ${e} <= ${aiFakeBudgets.cap}`,
            ),
          )
          .returning({
            used: aiFakeBudgets.used,
            reserved: aiFakeBudgets.reserved,
            cap: aiFakeBudgets.cap,
            softLimit: aiFakeBudgets.soft_limit,
          });
        if (row === undefined) return { ok: false, snapshot: await this.readAccount(db, key.cycleStart) };
        const id = uuidV7();
        const reservedAt = new Date();
        await db.insert(aiFakeReservations).values({
          id,
          account_id: requireFakeAccount(),
          cycle_start: key.cycleStart,
          estimate: e,
          model_tier: meta.modelTier,
          task: meta.task,
          reserved_at: reservedAt,
        });
        await this.opts.onReserved?.(db, { id, reservedAt });
        return {
          ok: true,
          reservationId: id,
          snapshot: { used: n(row.used), reserved: n(row.reserved), cap: n(row.cap), softLimit: n(row.softLimit) },
        };
      });
    }
    return systemTx(
      async (db) => {
        await this.ensureSystemBudget(db, key.weekStart);
        const [row] = await db
          .update(aiFakeSystemBudgets)
          .set({ reserved: sql`${aiFakeSystemBudgets.reserved} + ${e}` })
          .where(
            and(
              eq(aiFakeSystemBudgets.week_start, key.weekStart),
              sql`${aiFakeSystemBudgets.used} + ${aiFakeSystemBudgets.reserved} + ${e} <= ${aiFakeSystemBudgets.cap}`,
            ),
          )
          .returning({
            used: aiFakeSystemBudgets.used,
            reserved: aiFakeSystemBudgets.reserved,
            cap: aiFakeSystemBudgets.cap,
            softLimit: aiFakeSystemBudgets.soft_limit,
          });
        if (row === undefined) return { ok: false, snapshot: await this.readSystem(db, key.weekStart) };
        const id = uuidV7();
        await db.insert(aiFakeSystemReservations).values({
          id,
          week_start: key.weekStart,
          industry_id: meta.industryId ?? null,
          estimate: e,
          model_tier: meta.modelTier,
          task: meta.task,
        });
        return {
          ok: true,
          reservationId: id,
          snapshot: { used: n(row.used), reserved: n(row.reserved), cap: n(row.cap), softLimit: n(row.softLimit) },
        };
      },
      { tenant: 'none' },
    );
  }

  private async readAccount(db: Db, cycleStart: string): Promise<BudgetSnapshot> {
    const [b] = await db
      .select()
      .from(aiFakeBudgets)
      .where(eq(aiFakeBudgets.cycle_start, cycleStart))
      .limit(1);
    return b === undefined
      ? { used: 0, reserved: 0, cap: ACCOUNT_CAP_MICRO_USD, softLimit: ACCOUNT_SOFT_LIMIT_MICRO_USD }
      : { used: n(b.used), reserved: n(b.reserved), cap: n(b.cap), softLimit: n(b.soft_limit) };
  }

  private async readSystem(db: Db, week: string): Promise<BudgetSnapshot> {
    const [b] = await db
      .select()
      .from(aiFakeSystemBudgets)
      .where(eq(aiFakeSystemBudgets.week_start, week))
      .limit(1);
    const cap = this.opts.systemWeeklyCap;
    return b === undefined
      ? { used: 0, reserved: 0, cap, softLimit: cap }
      : { used: n(b.used), reserved: n(b.reserved), cap: n(b.cap), softLimit: n(b.soft_limit) };
  }

  async markCalling(reservationId: string): Promise<void> {
    const scope = this.scopeOfContext();
    const table = scope === 'account' ? aiFakeReservations : aiFakeSystemReservations;
    await this.tx(scope, (db) =>
      db
        .update(table)
        .set({ state: 'calling', called_at: new Date() })
        .where(and(eq(table.id, reservationId), eq(table.state, 'held'))),
    );
  }

  async release(reservationId: string): Promise<void> {
    const scope = this.scopeOfContext();
    await this.tx(scope, async (db) => {
      if (scope === 'account') {
        const [r] = await db
          .update(aiFakeReservations)
          .set({ state: 'released', closed_at: new Date() })
          .where(and(eq(aiFakeReservations.id, reservationId), inArray(aiFakeReservations.state, ['held', 'calling'])))
          .returning();
        if (r === undefined) return;
        await db
          .update(aiFakeBudgets)
          .set({ reserved: sql`${aiFakeBudgets.reserved} - ${r.estimate}` })
          .where(eq(aiFakeBudgets.cycle_start, r.cycle_start));
      } else {
        const [r] = await db
          .update(aiFakeSystemReservations)
          .set({ state: 'released', closed_at: new Date() })
          .where(
            and(eq(aiFakeSystemReservations.id, reservationId), inArray(aiFakeSystemReservations.state, ['held', 'calling'])),
          )
          .returning();
        if (r === undefined) return;
        await db
          .update(aiFakeSystemBudgets)
          .set({ reserved: sql`${aiFakeSystemBudgets.reserved} - ${r.estimate}` })
          .where(eq(aiFakeSystemBudgets.week_start, r.week_start));
      }
    });
  }

  usage(key: BudgetKey): Promise<BudgetSnapshot> {
    return key.scope === 'account'
      ? tenantTx((db) => this.readAccount(db, key.cycleStart))
      : systemTx((db) => this.readSystem(db, key.weekStart), { tenant: 'none' });
  }

  /** Các bước quyết toán trong MỘT giao dịch đang mở. */
  private async settleInTx(
    db: Db,
    scope: 'account' | 'system',
    reservationId: string,
    actualOrEstimate: number | 'estimate',
    ledger: LedgerDraft,
    anomaly: 'unsettled' | null,
    hooks: SettleHooks | undefined,
  ): Promise<Crossed> {
    if (scope === 'account') {
      const [r] = await db
        .select()
        .from(aiFakeReservations)
        .where(and(eq(aiFakeReservations.id, reservationId), inArray(aiFakeReservations.state, ['held', 'calling'])))
        .for('update');
      if (r === undefined) return [];
      const est = n(r.estimate);
      const actual = actualOrEstimate === 'estimate' ? est : actualOrEstimate;
      const [b] = await db
        .select()
        .from(aiFakeBudgets)
        .where(eq(aiFakeBudgets.cycle_start, r.cycle_start))
        .for('update');
      if (b === undefined) throw new Error('Thiếu dòng ngân sách của giữ chỗ');
      const reservedAfter = n(b.reserved) - est;
      const total = n(b.used) + actual;
      const usedAfter = Math.min(total, n(b.cap) - reservedAfter);
      await db
        .update(aiFakeBudgets)
        .set({ reserved: BigInt(reservedAfter), used: BigInt(usedAfter) })
        .where(eq(aiFakeBudgets.id, b.id));
      // Cờ mốc: cập nhật có điều kiện `= false` – chỉ cờ thực sự đổi mới vào `crossed`.
      const crossed: Crossed = [];
      const f80 = await db
        .update(aiFakeBudgets)
        .set({ notified_80: true })
        .where(and(eq(aiFakeBudgets.id, b.id), eq(aiFakeBudgets.notified_80, false), sql`${aiFakeBudgets.used} * 100 >= ${aiFakeBudgets.cap} * 80`))
        .returning({ id: aiFakeBudgets.id });
      if (f80.length > 0) crossed.push(80);
      const f100 = await db
        .update(aiFakeBudgets)
        .set({ notified_100: true })
        .where(and(eq(aiFakeBudgets.id, b.id), eq(aiFakeBudgets.notified_100, false), sql`${aiFakeBudgets.used} >= ${aiFakeBudgets.cap}`))
        .returning({ id: aiFakeBudgets.id });
      if (f100.length > 0) crossed.push(100);
      await db.insert(aiFakeCostLedger).values({
        account_id: requireFakeAccount(),
        cycle_start: r.cycle_start,
        reservation_id: r.id,
        task: ledger.task,
        model_tier: ledger.modelTier,
        model_id: ledger.modelId,
        provider: ledger.provider,
        input_tokens: ledger.inputTokens,
        output_tokens: ledger.outputTokens,
        cached_input_tokens: ledger.cachedInputTokens,
        cost_micro_usd: BigInt(actual),
        estimate_micro_usd: BigInt(est),
        anomaly: anomaly ?? (actual > est ? 'over_estimate' : null),
        over_cap_micro_usd: BigInt(total - usedAfter),
        trace_id: ledger.traceId,
      });
      await db
        .update(aiFakeReservations)
        .set({ state: 'settled', closed_at: new Date() })
        .where(and(eq(aiFakeReservations.id, r.id), inArray(aiFakeReservations.state, ['held', 'calling'])));
      if (crossed.length > 0 && hooks?.onCrossed !== undefined) await hooks.onCrossed(db, crossed);
      return crossed;
    }
    const [r] = await db
      .select()
      .from(aiFakeSystemReservations)
      .where(
        and(eq(aiFakeSystemReservations.id, reservationId), inArray(aiFakeSystemReservations.state, ['held', 'calling'])),
      )
      .for('update');
    if (r === undefined) return [];
    const est = n(r.estimate);
    const actual = actualOrEstimate === 'estimate' ? est : actualOrEstimate;
    const [b] = await db
      .select()
      .from(aiFakeSystemBudgets)
      .where(eq(aiFakeSystemBudgets.week_start, r.week_start))
      .for('update');
    if (b === undefined) throw new Error('Thiếu dòng ngân sách hệ thống');
    const reservedAfter = n(b.reserved) - est;
    const total = n(b.used) + actual;
    const usedAfter = Math.min(total, n(b.cap) - reservedAfter);
    await db
      .update(aiFakeSystemBudgets)
      .set({ reserved: BigInt(reservedAfter), used: BigInt(usedAfter) })
      .where(eq(aiFakeSystemBudgets.week_start, r.week_start));
    await db.insert(aiFakeSystemCostLedger).values({
      week_start: r.week_start,
      industry_id: r.industry_id,
      reservation_id: r.id,
      task: ledger.task,
      model_tier: ledger.modelTier,
      model_id: ledger.modelId,
      provider: ledger.provider,
      input_tokens: ledger.inputTokens,
      output_tokens: ledger.outputTokens,
      cached_input_tokens: ledger.cachedInputTokens,
      cost_micro_usd: BigInt(actual),
      estimate_micro_usd: BigInt(est),
      anomaly: anomaly ?? (actual > est ? 'over_estimate' : null),
      over_cap_micro_usd: BigInt(total - usedAfter),
      trace_id: ledger.traceId,
    });
    await db
      .update(aiFakeSystemReservations)
      .set({ state: 'settled', closed_at: new Date() })
      .where(eq(aiFakeSystemReservations.id, r.id));
    return [];
  }

  async settle(
    reservationId: string,
    actual: number,
    ledger: LedgerDraft,
    hooks?: SettleHooks,
  ): Promise<{ crossed: Crossed }> {
    const scope = this.scopeOfContext();
    const crossed = await this.tx(scope, (db) =>
      this.settleInTx(db, scope, reservationId, actual, ledger, null, hooks),
    );
    return { crossed };
  }

  async releaseStale(
    olderThanMs: number,
    hooks?: SettleHooks,
  ): Promise<{ released: number; settledAtEstimate: number }> {
    const scope = this.scopeOfContext();
    const cutoff = new Date(Date.now() - olderThanMs);
    const table = scope === 'account' ? aiFakeReservations : aiFakeSystemReservations;
    const stale = await this.tx(scope, (db) =>
      db
        .select({ id: table.id, state: table.state, task: table.task, tier: table.model_tier })
        .from(table)
        .where(and(inArray(table.state, ['held', 'calling']), lt(table.reserved_at, cutoff)))
        .orderBy(asc(table.reserved_at)),
    );
    let released = 0;
    let settledAtEstimate = 0;
    for (const s of stale) {
      if (s.state === 'held') {
        await this.release(s.id);
        released++;
        continue;
      }
      // `calling`: có thể đã tốn tiền → quyết toán theo ước tính, mỗi giữ chỗ một giao dịch.
      const crossed = await this.tx(scope, (db) =>
        this.settleInTx(
          db,
          scope,
          s.id,
          'estimate',
          {
            task: s.task as AiTask,
            modelTier: s.tier as ModelTier,
            modelId: 'unknown',
            provider: 'unknown',
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            traceId: null,
          },
          'unsettled',
          hooks,
        ),
      );
      void crossed;
      settledAtEstimate++;
      gatewayEvent('warn', 'ai.unsettled_reservation', { task: s.task, model_tier: s.tier });
    }
    return { released, settledAtEstimate };
  }

  // ----- điều khiển (kiểm thử / dev) -----

  async setBudget(input: { used?: number; reserved?: number; cap?: number; cycleStart?: string }): Promise<FakeBudgetView> {
    const cycle = input.cycleStart ?? (await this.currentCycleStart());
    await tenantTx(async (db) => {
      await this.ensureAccountBudget(db, cycle);
      await db
        .update(aiFakeBudgets)
        .set({
          ...(input.used !== undefined ? { used: BigInt(input.used) } : {}),
          ...(input.reserved !== undefined ? { reserved: BigInt(input.reserved) } : {}),
          ...(input.cap !== undefined ? { cap: BigInt(input.cap) } : {}),
        })
        .where(eq(aiFakeBudgets.cycle_start, cycle));
    });
    return this.getBudget();
  }

  async getBudget(): Promise<FakeBudgetView> {
    const cycle = await this.currentCycleStart();
    return tenantTx(async (db) => {
      const [b] = await db.select().from(aiFakeBudgets).where(eq(aiFakeBudgets.cycle_start, cycle)).limit(1);
      return {
        cycleStart: cycle,
        used: n(b?.used),
        reserved: n(b?.reserved),
        cap: b === undefined ? ACCOUNT_CAP_MICRO_USD : n(b.cap),
        softLimit: b === undefined ? ACCOUNT_SOFT_LIMIT_MICRO_USD : n(b.soft_limit),
        notified80: b?.notified_80 ?? false,
        notified100: b?.notified_100 ?? false,
      };
    });
  }

  async setSystemBudget(input: { used?: number; reserved?: number; cap?: number; weekStart?: string }): Promise<void> {
    const week = input.weekStart ?? weekStart();
    await systemTx(
      async (db) => {
        await this.ensureSystemBudget(db, week);
        await db
          .update(aiFakeSystemBudgets)
          .set({
            ...(input.used !== undefined ? { used: BigInt(input.used) } : {}),
            ...(input.reserved !== undefined ? { reserved: BigInt(input.reserved) } : {}),
            ...(input.cap !== undefined ? { cap: BigInt(input.cap), soft_limit: BigInt(input.cap) } : {}),
          })
          .where(eq(aiFakeSystemBudgets.week_start, week));
      },
      { tenant: 'none' },
    );
  }

  async ledger(): Promise<CostLedgerEntry[]> {
    const scope = this.scopeOfContext();
    if (scope === 'account') {
      const accountId = requireFakeAccount();
      const rows = await tenantTx((db) => db.select().from(aiFakeCostLedger).orderBy(asc(aiFakeCostLedger.created_at)));
      return rows.map((r) => ({
        id: r.id,
        scope: 'account' as const,
        accountId,
        cycleOrWeekStart: r.cycle_start,
        reservationId: r.reservation_id,
        task: r.task as AiTask,
        modelTier: r.model_tier as ModelTier,
        modelId: r.model_id,
        provider: r.provider,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        cachedInputTokens: r.cached_input_tokens,
        costMicroUsd: n(r.cost_micro_usd),
        estimateMicroUsd: n(r.estimate_micro_usd),
        anomaly: r.anomaly,
        overCapMicroUsd: n(r.over_cap_micro_usd),
        traceId: r.trace_id,
        createdAt: r.created_at,
      }));
    }
    const rows = await systemTx((db) => db.select().from(aiFakeSystemCostLedger).orderBy(asc(aiFakeSystemCostLedger.created_at)), {
      tenant: 'none',
    });
    return rows.map((r) => ({
      id: r.id,
      scope: 'system' as const,
      accountId: null,
      cycleOrWeekStart: r.week_start,
      reservationId: r.reservation_id,
      industryId: r.industry_id ?? undefined,
      task: r.task as AiTask,
      modelTier: r.model_tier as ModelTier,
      modelId: r.model_id,
      provider: r.provider,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      cachedInputTokens: r.cached_input_tokens,
      costMicroUsd: n(r.cost_micro_usd),
      estimateMicroUsd: n(r.estimate_micro_usd),
      anomaly: r.anomaly,
      overCapMicroUsd: n(r.over_cap_micro_usd),
      traceId: r.trace_id,
      createdAt: r.created_at,
    }));
  }

  async reservations(): Promise<Reservation[]> {
    const scope = this.scopeOfContext();
    if (scope === 'account') {
      const rows = await tenantTx((db) => db.select().from(aiFakeReservations).orderBy(asc(aiFakeReservations.reserved_at)));
      return rows.map((r) => toReservation(r, 'account'));
    }
    const rows = await systemTx(
      (db) => db.select().from(aiFakeSystemReservations).orderBy(asc(aiFakeSystemReservations.reserved_at)),
      { tenant: 'none' },
    );
    return rows.map((r) => toReservation(r, 'system'));
  }

  async ageReservations(ms: number): Promise<void> {
    const scope = this.scopeOfContext();
    const table = scope === 'account' ? aiFakeReservations : aiFakeSystemReservations;
    const delta = sql.raw(`interval '${Math.trunc(ms)} milliseconds'`);
    await this.tx(scope, (db) =>
      db
        .update(table)
        .set({
          reserved_at: sql`${table.reserved_at} - ${delta}`,
          called_at: sql`${table.called_at} - ${delta}`,
        })
        .where(inArray(table.state, ['held', 'calling'])),
    );
  }

  async reset(): Promise<void> {
    const scope = this.scopeOfContext();
    if (scope === 'account') {
      await tenantTx(async (db) => {
        await db.delete(aiFakeCostLedger);
        await db.delete(aiFakeReservations);
        await db.delete(aiFakeBudgets);
      });
      return;
    }
    await systemTx(
      async (db) => {
        await db.delete(aiFakeSystemCostLedger);
        await db.delete(aiFakeSystemReservations);
        await db.update(aiFakeSystemBudgets).set({ used: 0n, reserved: 0n });
      },
      { tenant: 'none' },
    );
  }
}
