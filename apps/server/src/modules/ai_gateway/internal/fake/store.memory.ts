import { currentAccountId } from '../../../../core/db';
import { uuidV7 } from '../../../../core/ids/uuid-v7';
import { gatewayEvent } from '../../../../core/gateways/op-log';
import { requireFakeAccount } from '../../../../dev/fake-components';
import { memoryTx } from '../../../../dev/memory-tx';
import { syncPromise } from '../../../../dev/scenarios';
import {
  ACCOUNT_CAP_MICRO_USD,
  ACCOUNT_SOFT_LIMIT_MICRO_USD,
  crossedMarks,
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

// Kho ngân sách chế độ `memory` (005, research R8). `reserve`, `markCalling`, `release` đọc-ghi trong MỘT
// lượt đồng bộ (không await giữa đọc và ghi) → nguyên tử trong tiến trình. `settle`/`releaseStale` có
// `await onCrossed` nên chạy TUẦN TỰ theo khóa ngân sách (Map<key, Promise> – tương đương khóa dòng): đọc
// trạng thái hiện tại → onCrossed(memoryTx()) (ném → chưa ghi gì) → ghi đồng bộ lên giá trị HIỆN TẠI.
// Không dùng "ghi trước, lỗi thì bù ngược" (bù ngược có thể làm used + reserved vượt trần).

interface Budget {
  used: number;
  reserved: number;
  cap: number;
  softLimit: number;
  n80: boolean;
  n100: boolean;
}

interface Res extends Reservation {
  accountId: string | null;
  industryId: string | undefined;
}

interface AccountBudgets {
  cycles: Map<string, Budget>;
  current: string | undefined;
}

const keyOf = (accountId: string | null, period: string) => `${accountId ?? 'system'}:${period}`;

export class MemoryBudgetStore implements FakeBudgetStore {
  private readonly accounts = new Map<string, AccountBudgets>();
  private readonly system = new Map<string, Budget>();
  private readonly reservationsById = new Map<string, Res>();
  private readonly ledgerRows: CostLedgerEntry[] = [];
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly systemWeeklyCap: number) {}

  private account(accountId: string): AccountBudgets {
    let a = this.accounts.get(accountId);
    if (a === undefined) {
      a = { cycles: new Map(), current: undefined };
      this.accounts.set(accountId, a);
    }
    return a;
  }

  private cycleOf(accountId: string): string {
    return this.account(accountId).current ?? defaultCycleStart();
  }

  private budget(accountId: string | null, period: string): Budget {
    if (accountId === null) {
      let b = this.system.get(period);
      if (b === undefined) {
        b = { used: 0, reserved: 0, cap: this.systemWeeklyCap, softLimit: this.systemWeeklyCap, n80: false, n100: false };
        this.system.set(period, b);
      }
      return b;
    }
    const a = this.account(accountId);
    let b = a.cycles.get(period);
    if (b === undefined) {
      b = { used: 0, reserved: 0, cap: ACCOUNT_CAP_MICRO_USD, softLimit: ACCOUNT_SOFT_LIMIT_MICRO_USD, n80: false, n100: false };
      a.cycles.set(period, b);
    }
    return b;
  }

  /** (tài khoản | null, kỳ) của khóa trong ngữ cảnh hiện tại. */
  private resolveKey(key: BudgetKey): { accountId: string | null; period: string } {
    if (key.scope === 'system') return { accountId: null, period: key.weekStart };
    return { accountId: requireFakeAccount(), period: key.cycleStart };
  }

  private snap(b: Budget): BudgetSnapshot {
    return { used: b.used, reserved: b.reserved, cap: b.cap, softLimit: b.softLimit };
  }

  /** Chạy `fn` tuần tự theo khóa ngân sách. */
  private async locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    this.locks.set(key, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }

  currentCycleStart(): Promise<string> {
    return syncPromise(() => this.cycleOf(requireFakeAccount()));
  }

  reserve(key: BudgetKey, est: number, meta: ReserveMeta): Promise<ReserveResult> {
    return syncPromise(() => {
      const { accountId, period } = this.resolveKey(key);
      const b = this.budget(accountId, period);
      // Đọc và ghi trong cùng một lượt đồng bộ – không lời gọi nào chen giữa.
      if (b.used + b.reserved + est > b.cap) return { ok: false as const, snapshot: this.snap(b) };
      b.reserved += est;
      const id = uuidV7();
      this.reservationsById.set(id, {
        id,
        scope: key.scope,
        key: period,
        estimateMicroUsd: est,
        modelTier: meta.modelTier,
        task: meta.task,
        reservedAt: new Date(),
        calledAt: null,
        state: 'held',
        accountId,
        industryId: meta.industryId,
      });
      return { ok: true as const, reservationId: id, snapshot: this.snap(b) };
    });
  }

  private visible(id: string): Res | undefined {
    const r = this.reservationsById.get(id);
    if (r === undefined) return undefined;
    // Giữ chỗ của tài khoản khác không "nhìn thấy" được (như RLS).
    return r.accountId === currentAccountId() ? r : undefined;
  }

  markCalling(reservationId: string): Promise<void> {
    return syncPromise(() => {
      const r = this.visible(reservationId);
      if (r?.state === 'held') {
        r.state = 'calling';
        r.calledAt = new Date();
      }
    });
  }

  release(reservationId: string): Promise<void> {
    return syncPromise(() => {
      const r = this.visible(reservationId);
      if (r === undefined || (r.state !== 'held' && r.state !== 'calling')) return;
      const b = this.budget(r.accountId, r.key);
      b.reserved -= r.estimateMicroUsd;
      r.state = 'released';
    });
  }

  usage(key: BudgetKey): Promise<BudgetSnapshot> {
    return syncPromise(() => {
      const { accountId, period } = this.resolveKey(key);
      return this.snap(this.budget(accountId, period));
    });
  }

  /** Bước quyết toán dùng chung cho `settle` và nhánh `calling` của `releaseStale`. */
  private async settleLocked(
    r: Res,
    actual: number,
    ledger: LedgerDraft,
    anomaly: 'unsettled' | null,
    hooks: SettleHooks | undefined,
  ): Promise<Crossed> {
    if (r.state !== 'held' && r.state !== 'calling') return [];
    const b = this.budget(r.accountId, r.key);
    const preview = Math.min(b.used + actual, b.cap - (b.reserved - r.estimateMicroUsd));
    const crossed = r.accountId === null ? [] : crossedMarks(preview, b.cap, { n80: b.n80, n100: b.n100 });
    // Sự kiện thông báo "trong giao dịch": ném → chưa ghi gì.
    if (crossed.length > 0 && hooks?.onCrossed !== undefined) await hooks.onCrossed(memoryTx(), crossed);
    if (r.state !== 'held' && r.state !== 'calling') return [];
    // Ghi ĐỒNG BỘ lên giá trị hiện tại (không dùng bản sao).
    b.reserved -= r.estimateMicroUsd;
    const total = b.used + actual;
    const newUsed = Math.min(total, b.cap - b.reserved);
    const overCap = total - newUsed;
    b.used = newUsed;
    if (crossed.includes(80)) b.n80 = true;
    if (crossed.includes(100)) b.n100 = true;
    r.state = 'settled';
    this.ledgerRows.push({
      ...ledger,
      id: uuidV7(),
      scope: r.scope,
      accountId: r.accountId,
      cycleOrWeekStart: r.key,
      reservationId: r.id,
      industryId: r.industryId ?? ledger.industryId,
      costMicroUsd: actual,
      estimateMicroUsd: r.estimateMicroUsd,
      anomaly: anomaly ?? (actual > r.estimateMicroUsd ? 'over_estimate' : null),
      overCapMicroUsd: overCap,
      createdAt: new Date(),
    });
    return crossed;
  }

  async settle(
    reservationId: string,
    actual: number,
    ledger: LedgerDraft,
    hooks?: SettleHooks,
  ): Promise<{ crossed: Crossed }> {
    const r = this.visible(reservationId);
    if (r === undefined) return { crossed: [] };
    const crossed = await this.locked(keyOf(r.accountId, r.key), () =>
      this.settleLocked(r, actual, ledger, null, hooks),
    );
    return { crossed };
  }

  async releaseStale(
    olderThanMs: number,
    hooks?: SettleHooks,
  ): Promise<{ released: number; settledAtEstimate: number }> {
    const accountId = currentAccountId();
    const cutoff = Date.now() - olderThanMs;
    let released = 0;
    let settledAtEstimate = 0;
    const stale = [...this.reservationsById.values()].filter(
      (r) => r.accountId === accountId && r.reservedAt.getTime() < cutoff && (r.state === 'held' || r.state === 'calling'),
    );
    for (const r of stale) {
      await this.locked(keyOf(r.accountId, r.key), async () => {
        if (r.state === 'held') {
          const b = this.budget(r.accountId, r.key);
          b.reserved -= r.estimateMicroUsd;
          r.state = 'released';
          released++;
        } else if (r.state === 'calling') {
          // Có thể đã tốn tiền phía nhà cung cấp → quyết toán theo ước tính (tính dư, không thiếu).
          await this.settleLocked(
            r,
            r.estimateMicroUsd,
            {
              task: r.task,
              modelTier: r.modelTier,
              modelId: 'unknown',
              provider: 'unknown',
              inputTokens: 0,
              outputTokens: 0,
              cachedInputTokens: 0,
              traceId: null,
            },
            'unsettled',
            hooks,
          );
          settledAtEstimate++;
          gatewayEvent('warn', 'ai.unsettled_reservation', { task: r.task, model_tier: r.modelTier });
        }
      });
    }
    return { released, settledAtEstimate };
  }

  // ----- điều khiển (kiểm thử / dev) -----

  private view(cycleStart: string, b: Budget): FakeBudgetView {
    return { cycleStart, used: b.used, reserved: b.reserved, cap: b.cap, softLimit: b.softLimit, notified80: b.n80, notified100: b.n100 };
  }

  setBudget(input: { used?: number; reserved?: number; cap?: number; cycleStart?: string }): Promise<FakeBudgetView> {
    return syncPromise(() => {
      const accountId = requireFakeAccount();
      const a = this.account(accountId);
      if (input.cycleStart !== undefined) a.current = input.cycleStart;
      const cycle = this.cycleOf(accountId);
      const b = this.budget(accountId, cycle);
      if (input.cap !== undefined) b.cap = input.cap;
      if (input.used !== undefined) b.used = input.used;
      if (input.reserved !== undefined) b.reserved = input.reserved;
      return this.view(cycle, b);
    });
  }

  getBudget(): Promise<FakeBudgetView> {
    return syncPromise(() => {
      const accountId = requireFakeAccount();
      const cycle = this.cycleOf(accountId);
      return this.view(cycle, this.budget(accountId, cycle));
    });
  }

  setSystemBudget(input: { used?: number; reserved?: number; cap?: number; weekStart?: string }): Promise<void> {
    return syncPromise(() => {
      const b = this.budget(null, input.weekStart ?? weekStart());
      if (input.cap !== undefined) {
        b.cap = input.cap;
        b.softLimit = input.cap;
      }
      if (input.used !== undefined) b.used = input.used;
      if (input.reserved !== undefined) b.reserved = input.reserved;
    });
  }

  ledger(): Promise<CostLedgerEntry[]> {
    return syncPromise(() => {
      const accountId = currentAccountId();
      return this.ledgerRows.filter((l) => l.accountId === accountId).map((l) => ({ ...l }));
    });
  }

  reservations(): Promise<Reservation[]> {
    return syncPromise(() => {
      const accountId = currentAccountId();
      return [...this.reservationsById.values()]
        .filter((r) => r.accountId === accountId)
        .map(({ accountId: _a, industryId: _i, ...r }) => ({ ...r }));
    });
  }

  ageReservations(ms: number): Promise<void> {
    return syncPromise(() => {
      const accountId = currentAccountId();
      for (const r of this.reservationsById.values()) {
        if (r.accountId !== accountId) continue;
        r.reservedAt = new Date(r.reservedAt.getTime() - ms);
        if (r.calledAt !== null) r.calledAt = new Date(r.calledAt.getTime() - ms);
      }
    });
  }

  reset(): Promise<void> {
    return syncPromise(() => {
      const accountId = currentAccountId();
      if (accountId === null) this.system.clear();
      else this.accounts.delete(accountId);
      for (const [id, r] of this.reservationsById) if (r.accountId === accountId) this.reservationsById.delete(id);
      for (let i = this.ledgerRows.length - 1; i >= 0; i--) {
        if (this.ledgerRows[i]!.accountId === accountId) this.ledgerRows.splice(i, 1);
      }
    });
  }
}
