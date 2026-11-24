import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import { currentAccountId, DbQueryError, systemTx, tenantTx, type Db } from '../../../../core/db';
import { currentTx } from '../../../../core/db/transaction';
import { uuidV7 } from '../../../../core/ids/uuid-v7';
import type { AccountPublicApi } from '../../../account';
import {
  aiBudgets,
  aiReservations,
  systemBudgets,
  systemCostLedger,
  systemReservations,
} from '../db/schema';
import { aiCostLedger } from '../db/ai-cost-ledger.log-table';
import { AiError } from '../errors';
import { gatewayEvent } from '../events';
import { DbPriceSource, type ModelPriceSource, type PriceUnit } from '../prices/db-price-source';
import { RouteBook } from '../routing/route-book';
import type { AiSettings } from '../settings/ai-settings';
import type { ActiveIndustriesSource, AiTask, ModelTier } from '../../public-api';
import type {
  AttemptRoute,
  BudgetKey,
  BudgetSnapshot,
  BudgetStore,
  Crossed,
  LedgerDraft,
  ReserveMeta,
  ReserveResult,
  SettleHooks,
} from './budget-store';
import { minCallEstimate } from '../estimate';
import { cycleBounds } from './cycle';
import { isBudgetExhaustedSettled } from './budget-store';

// Kho ngân sách THẬT (015, FR-001…FR-010, contracts/ai-gateway-delta.md, data-model.md mục 2). Bảng `ai_gateway.*`.
// Bất biến KHÔNG THƯƠNG LƯỢNG (hiến chương III): `used + reserved <= cap` – giữ chỗ bằng MỘT câu lệnh cập nhật có
// điều kiện, `CHECK` của bảng là chốt cuối. Mọi chuyển trạng thái giữ chỗ là `UPDATE … WHERE state IN (…)` và CHỈ khi
// trúng một dòng mới được cộng/trừ ngân sách hay ghi sổ → quyết toán/trả gọi lại bao nhiêu lần cũng chỉ có tác dụng
// một lần (sổ `ai_cost_ledger` phân vùng nên không có UNIQUE theo `reservation_id`; tính idempotent dựa vào đây).
// Tài khoản: `tenantTx` (RLS); hệ thống (không có ngữ cảnh tài khoản): `systemTx` không tenant. Tiền: bigint micro-USD.

export interface DbBudgetStoreOptions {
  /** Trần tuần TẠM của ngân sách hệ thống, dùng khi thiếu nguồn số ngành hoặc số ngành = 0 (R-11). */
  systemWeeklyCap: number;
  /** Cổng đảo ngược số ngành đang hoạt động (module khác cắm); thiếu → trần tạm + `ai.industry_source_missing`. */
  activeIndustries?: ActiveIndustriesSource | undefined;
  /** Gọi TRONG giao dịch giữ chỗ của tài khoản – hẹn `ai_gateway.release_stale` sau 15 phút. */
  onReserved?: (tx: Db, reservation: { id: string; reservedAt: Date }) => Promise<void>;
  /** Trần/ngưỡng chụp vào dòng ngân sách lúc tạo (FR-011). */
  settings: AiSettings;
  /** Mốc chu kỳ của tài khoản trong ngữ cảnh (không cache). */
  accountApi: Pick<AccountPublicApi, 'getAiCycleAnchor'>;
  /** Tuyến + giá để suy `price_id` khi bên gọi không truyền (mặc định: đọc CSDL, đệm ngắn). */
  routes?: Pick<RouteBook, 'attemptsFor'>;
  prices?: ModelPriceSource;
}

const CURRENT_ACCOUNT = sql`account.current_account_id()`;
const n = (v: bigint | number | null | undefined): number => Number(v ?? 0);
const toMicro = (v: number): bigint => BigInt(Math.max(0, Math.ceil(v)));

type Scope = 'account' | 'system';
type Closed = 'held' | 'calling';
const OPEN_STATES: Closed[] = ['held', 'calling'];

interface BudgetRowLike {
  used: bigint;
  reserved: bigint;
  cap: bigint;
  soft_limit?: bigint;
  cycle_end?: string;
}

function snapshotOf(b: BudgetRowLike): BudgetSnapshot {
  return {
    used: n(b.used),
    reserved: n(b.reserved),
    cap: n(b.cap),
    softLimit: n(b.soft_limit ?? b.cap),
    ...(b.cycle_end !== undefined ? { cycleEnd: b.cycle_end } : {}),
  };
}

function isRequestKeyViolation(err: unknown): boolean {
  return (
    err instanceof DbQueryError &&
    err.code === '23505' &&
    (err.constraint === 'ai_reservations_request_key' ||
      err.constraint === 'system_reservations_request_key')
  );
}

export class DbBudgetStore implements BudgetStore {
  private readonly routes: Pick<RouteBook, 'attemptsFor'>;
  private readonly prices: ModelPriceSource;

  constructor(private readonly opts: DbBudgetStoreOptions) {
    this.routes = opts.routes ?? new RouteBook({ ttlMs: 30_000 });
    this.prices = opts.prices ?? new DbPriceSource({ ttlMs: 30_000 });
  }

  private scopeOfContext(): Scope {
    return currentAccountId() === null ? 'system' : 'account';
  }

  private tx<T>(scope: Scope, fn: (db: Db) => Promise<T>): Promise<T> {
    return scope === 'account' ? tenantTx(fn) : systemTx(fn, { tenant: 'none' });
  }

  /**
   * Quy ước: KHÔNG gọi Cổng AI (reserve/markCalling/settle/release) bên trong `tenantTx`/`systemTx` của bên gọi.
   * `tenantTx` lồng nhau dùng lại giao dịch ngoài → khóa dòng ngân sách bị giữ suốt lời gọi nhà cung cấp, lỗi 23505 làm
   * giao dịch ngoài abort, hoàn tác giao dịch ngoài xóa giữ chỗ dù nhà cung cấp đã tính tiền. Phát hiện → lỗi lập trình.
   */
  private assertNoOuterTx(): void {
    if (currentTx() !== undefined) {
      throw new Error(
        'Cổng AI không được gọi bên trong tenantTx/systemTx của bên gọi (giữ khóa ngân sách suốt lời gọi nhà cung cấp) – xem apps/server/docs/database.md',
      );
    }
  }

  /**
   * Ước tính tối thiểu một lời gọi (1000 vào + 500 ra theo giá `cheap_vision` hiện hành, xem `minCallEstimate`) – nguồn
   * DUY NHẤT cho cờ 100%, `blocked` hiển thị và `getUsage` (giá từ CSDL, FR-020). Thiếu tuyến/giá → 0 kèm cảnh báo
   * `ai.price_missing` (không ném thiếu cấu hình; lỗi tải CSDL vẫn ném).
   */
  async minCallEstimateMicro(): Promise<number> {
    const [first] = await this.routes.attemptsFor('image_labeling', 'cheap_vision');
    const price =
      first === undefined
        ? null
        : await this.prices.priceFor(first.provider, first.modelId, 'token');
    if (price === null) {
      gatewayEvent('warn', 'ai.price_missing', {
        task: 'image_labeling',
        model_tier: 'cheap_vision',
        reason: 'price_not_found',
      });
      return 0;
    }
    return minCallEstimate({
      modelTier: 'cheap_vision',
      modelId: price.modelId,
      provider: price.provider,
      inputPerMTokMicroUsd: price.inputPerMTokMicroUsd ?? 0,
      outputPerMTokMicroUsd: price.outputPerMTokMicroUsd ?? 0,
      cachedInputPerMTokMicroUsd: price.cachedInputPerMTokMicroUsd ?? 0,
      effectiveFrom: price.effectiveFrom,
    });
  }

  // ------------------------------------------------------------------------------------------------------------
  // Chu kỳ (FR-014, T028)
  // ------------------------------------------------------------------------------------------------------------

  /** Ranh giới chu kỳ của tài khoản trong ngữ cảnh chứa thời điểm `at`; không có mốc hiệu lực → hết hạn mức. */
  private async boundsAt(at: Date): Promise<{ cycleStart: string; cycleEnd: string }> {
    const anchor = await this.opts.accountApi.getAiCycleAnchor();
    if (anchor === null) throw new AiError('AI_BUDGET_EXHAUSTED');
    return cycleBounds(anchor.anchorDate, at);
  }

  async currentCycleStart(): Promise<string> {
    return (await this.boundsAt(new Date())).cycleStart;
  }

  // ------------------------------------------------------------------------------------------------------------
  // Tuyến + giá (FR-020, FR-022)
  // ------------------------------------------------------------------------------------------------------------

  /**
   * Tuyến + giá của LƯỢT `attempt` (0 chính, 1 dự phòng) – để cổng gọi nhà cung cấp, ước tính và quyết toán đúng
   * mô hình/giá của lượt đó (khớp với dòng giữ chỗ). Cùng đường suy với `reserve`.
   */
  async attemptRoute(
    task: AiTask,
    modelTier: ModelTier,
    attempt: number,
  ): Promise<AttemptRoute | null> {
    const attempts = await this.routes.attemptsFor(task, modelTier);
    const chosen = attempts[attempt];
    if (chosen === undefined) {
      if (attempt === 0 || attempts.length === 0) {
        gatewayEvent('error', 'ai.route_missing', {
          task,
          model_tier: modelTier,
          reason: 'route_not_found',
        });
        throw new AiError('AI_NOT_CONFIGURED');
      }
      return null; // hết lượt: loại việc chưa bật dự phòng
    }
    const unit: PriceUnit = modelTier === 'stt' ? 'audio_minute' : 'token';
    const rec = await this.prices.priceFor(chosen.provider, chosen.modelId, unit);
    if (rec === null) {
      gatewayEvent('error', 'ai.price_missing', {
        task,
        model_tier: modelTier,
        provider: chosen.provider,
        model_id: chosen.modelId,
        reason: 'price_not_found',
      });
      throw new AiError('AI_NOT_CONFIGURED');
    }
    const route = { provider: chosen.provider, modelId: chosen.modelId };
    return {
      provider: route.provider,
      modelId: route.modelId,
      priceId: rec.priceId,
      price: {
        modelTier,
        modelId: rec.modelId,
        provider: rec.provider,
        inputPerMTokMicroUsd: rec.inputPerMTokMicroUsd ?? 0,
        outputPerMTokMicroUsd: rec.outputPerMTokMicroUsd ?? 0,
        cachedInputPerMTokMicroUsd: rec.cachedInputPerMTokMicroUsd ?? 0,
        ...(rec.perMinuteMicroUsd !== null
          ? { perAudioMinuteMicroUsd: rec.perMinuteMicroUsd }
          : {}),
        billingGranularitySec: rec.billingGranularitySec,
        effectiveFrom: rec.effectiveFrom,
      },
    };
  }

  private async resolvePrice(
    meta: ReserveMeta,
  ): Promise<{ provider: string; modelId: string; priceId: string }> {
    let { provider, modelId } = meta;
    if (provider === undefined || modelId === undefined) {
      const attempts = await this.routes.attemptsFor(meta.task, meta.modelTier);
      const wanted = meta.attempt ?? 0;
      let first = attempts[wanted];
      if (first === undefined && wanted > 0 && attempts[0] !== undefined) {
        // Lượt dự phòng nhưng cấu hình không còn tuyến thứ hai (vd tắt dự phòng cho loại việc): không để lỗi cấu hình
        // chặn lời gọi đã đi tiếp, ghi cảnh báo để truy vết.
        gatewayEvent('warn', 'ai.route_missing', {
          task: meta.task,
          model_tier: meta.modelTier,
          reason: 'route_not_found',
        });
        first = attempts[0];
      }
      if (first === undefined) {
        gatewayEvent('error', 'ai.route_missing', {
          task: meta.task,
          model_tier: meta.modelTier,
          reason: 'route_not_found',
        });
        throw new AiError('AI_NOT_CONFIGURED');
      }
      provider = first.provider;
      modelId = first.modelId;
    }
    let priceId = meta.priceId;
    if (priceId === undefined) {
      const unit: PriceUnit = meta.modelTier === 'stt' ? 'audio_minute' : 'token';
      const record = await this.prices.priceFor(provider, modelId, unit);
      if (record === null) {
        gatewayEvent('error', 'ai.price_missing', {
          task: meta.task,
          model_tier: meta.modelTier,
          provider,
          model_id: modelId,
          reason: 'price_not_found',
        });
        throw new AiError('AI_NOT_CONFIGURED');
      }
      priceId = record.priceId;
    }
    return { provider, modelId, priceId };
  }

  // ------------------------------------------------------------------------------------------------------------
  // Giữ chỗ (FR-008, FR-037a)
  // ------------------------------------------------------------------------------------------------------------

  async reserve(key: BudgetKey, est: number, meta: ReserveMeta): Promise<ReserveResult> {
    this.assertNoOuterTx();
    const route = await this.resolvePrice(meta);
    const estimate = toMicro(est);
    try {
      return key.scope === 'account'
        ? await tenantTx((db) => this.reserveAccount(db, key.cycleStart, estimate, meta, route))
        : await systemTx((db) => this.reserveSystem(db, key.weekStart, estimate, meta, route), {
            tenant: 'none',
          });
    } catch (err) {
      // Hai yêu cầu cùng mã chạy đồng thời: giao dịch thua bị hoàn tác (không để lại giữ chỗ nửa vời) → in_progress.
      if (isRequestKeyViolation(err)) {
        return {
          ok: false,
          duplicate: true,
          status: 'in_progress',
          snapshot: await this.usage(key),
        };
      }
      throw err;
    }
  }

  private async reserveAccount(
    db: Db,
    cycleStart: string,
    est: bigint,
    meta: ReserveMeta,
    route: { provider: string; modelId: string; priceId: string },
  ): Promise<ReserveResult> {
    const byCycle = and(
      eq(aiBudgets.account_id, CURRENT_ACCOUNT),
      eq(aiBudgets.cycle_start, cycleStart),
    );
    if (meta.requestId !== undefined) {
      const [dup] = await db
        .select({ state: aiReservations.state })
        .from(aiReservations)
        .where(
          and(
            eq(aiReservations.account_id, CURRENT_ACCOUNT),
            eq(aiReservations.cycle_start, cycleStart),
            eq(aiReservations.request_id, meta.requestId),
            sql`${aiReservations.state} <> 'released'`,
          ),
        )
        .limit(1);
      if (dup !== undefined) {
        const status = dup.state === 'settled' ? 'settled' : 'in_progress';
        return {
          ok: false,
          duplicate: true,
          status,
          snapshot: await this.readAccount(db, cycleStart),
        };
      }
    }
    const tryReserve = () =>
      db
        .update(aiBudgets)
        .set({ reserved: sql`${aiBudgets.reserved} + ${est}` })
        .where(
          and(byCycle, sql`${aiBudgets.used} + ${aiBudgets.reserved} + ${est} <= ${aiBudgets.cap}`),
        )
        .returning({
          used: aiBudgets.used,
          reserved: aiBudgets.reserved,
          cap: aiBudgets.cap,
          soft_limit: aiBudgets.soft_limit,
          cycle_end: aiBudgets.cycle_end,
        });
    let [row] = await tryReserve();
    if (row === undefined) {
      const [existing] = await db.select().from(aiBudgets).where(byCycle).limit(1);
      if (existing !== undefined) {
        // Dòng có thể do giao dịch khác vừa commit SAU lần UPDATE đầu (đầu chu kỳ): câu UPDATE có điều kiện chạy lại
        // (câu lệnh mới thấy dòng đã commit); chỉ khi vẫn 0 hàng mới là hết ngân sách thật.
        [row] = await tryReserve();
        if (row === undefined) return { ok: false, snapshot: snapshotOf(existing) };
      }
    }
    if (row === undefined) {
      // Chưa có dòng của chu kỳ: tạo (chụp trần/ngưỡng từ cấu hình), hai yêu cầu đầu chu kỳ đồng thời → đúng một dòng.
      const bounds = await this.boundsAt(new Date(`${cycleStart}T12:00:00+07:00`));
      const settings = await this.opts.settings.get();
      await db
        .insert(aiBudgets)
        .values({
          account_id: CURRENT_ACCOUNT,
          cycle_start: cycleStart,
          cycle_end: bounds.cycleEnd,
          cap: toMicro(settings.accountCap),
          soft_limit: toMicro(settings.softLimit),
        })
        .onConflictDoNothing({ target: [aiBudgets.account_id, aiBudgets.cycle_start] });
      [row] = await tryReserve();
      if (row === undefined) return { ok: false, snapshot: await this.readAccount(db, cycleStart) };
    }
    const id = uuidV7();
    const reservedAt = new Date();
    await db.insert(aiReservations).values({
      id,
      account_id: CURRENT_ACCOUNT,
      cycle_start: cycleStart,
      task: meta.task,
      model_tier: meta.modelTier,
      provider: route.provider,
      model_id: route.modelId,
      price_id: route.priceId,
      estimate: est,
      request_id: meta.requestId ?? null,
      trace_id: meta.traceId ?? null,
      reserved_at: reservedAt,
    });
    await this.opts.onReserved?.(db, { id, reservedAt });
    return { ok: true, reservationId: id, snapshot: snapshotOf(row) };
  }

  /**
   * Trần của tuần mới = số ngành đang hoạt động × mức/ngành (cấu hình `ai_settings`), chụp cả hai số vào dòng tuần.
   * Thiếu nguồn số ngành, hoặc số ngành = 0 (không thể đặt trần 0 vì CHECK cap > 0 và không được chặn xu hướng):
   * dùng trần tạm cấu hình, số ngành/mức null, kèm cảnh báo `ai.industry_source_missing`.
   */
  private async systemWeekCap(): Promise<{
    cap: bigint;
    industryCount: number | null;
    perIndustry: bigint | null;
  }> {
    const fallback = {
      cap: toMicro(this.opts.systemWeeklyCap),
      industryCount: null,
      perIndustry: null,
    };
    const source = this.opts.activeIndustries;
    if (source === undefined) {
      gatewayEvent('warn', 'ai.industry_source_missing', { reason: 'industry_source_missing' });
      return fallback;
    }
    const count = await source.countActiveIndustries();
    if (!Number.isInteger(count) || count <= 0) {
      gatewayEvent('warn', 'ai.industry_source_missing', { reason: 'industry_source_missing' });
      return fallback;
    }
    const settings = await this.opts.settings.get();
    const per = toMicro(settings.perIndustryWeekly);
    return { cap: BigInt(count) * per, industryCount: count, perIndustry: per };
  }

  private async reserveSystem(
    db: Db,
    weekStart: string,
    est: bigint,
    meta: ReserveMeta,
    route: { provider: string; modelId: string; priceId: string },
  ): Promise<ReserveResult> {
    const byWeek = eq(systemBudgets.week_start, weekStart);
    if (meta.requestId !== undefined) {
      const [dup] = await db
        .select({ state: systemReservations.state })
        .from(systemReservations)
        .where(
          and(
            eq(systemReservations.week_start, weekStart),
            eq(systemReservations.request_id, meta.requestId),
            sql`${systemReservations.state} <> 'released'`,
          ),
        )
        .limit(1);
      if (dup !== undefined) {
        const status = dup.state === 'settled' ? 'settled' : 'in_progress';
        return {
          ok: false,
          duplicate: true,
          status,
          snapshot: await this.readSystem(db, weekStart),
        };
      }
    }
    const tryReserve = () =>
      db
        .update(systemBudgets)
        .set({ reserved: sql`${systemBudgets.reserved} + ${est}`, updated_at: sql`now()` })
        .where(
          and(
            byWeek,
            sql`${systemBudgets.used} + ${systemBudgets.reserved} + ${est} <= ${systemBudgets.cap}`,
          ),
        )
        .returning({
          used: systemBudgets.used,
          reserved: systemBudgets.reserved,
          cap: systemBudgets.cap,
        });
    let [row] = await tryReserve();
    if (row === undefined) {
      const [existing] = await db.select().from(systemBudgets).where(byWeek).limit(1);
      if (existing !== undefined) {
        // Dòng có thể vừa được giao dịch khác commit sau lần UPDATE đầu: chạy lại câu có điều kiện một lần.
        [row] = await tryReserve();
        if (row === undefined) return { ok: false, snapshot: snapshotOf(existing) };
      }
    }
    if (row === undefined) {
      // Chưa có dòng của tuần: số ngành CHỈ được hỏi ở đây (một lần khi tạo) và trần được CHỤP vào dòng (FR-032a).
      const week = await this.systemWeekCap();
      await db
        .insert(systemBudgets)
        .values({
          week_start: weekStart,
          cap: week.cap,
          industry_count: week.industryCount,
          per_industry_micro_usd: week.perIndustry,
        })
        .onConflictDoNothing({ target: systemBudgets.week_start });
      [row] = await tryReserve();
    }
    if (row === undefined) return { ok: false, snapshot: await this.readSystem(db, weekStart) };
    const id = uuidV7();
    await db.insert(systemReservations).values({
      id,
      week_start: weekStart,
      industry_id: meta.industryId ?? null,
      task: meta.task,
      model_tier: meta.modelTier,
      provider: route.provider,
      model_id: route.modelId,
      price_id: route.priceId,
      estimate: est,
      request_id: meta.requestId ?? null,
      trace_id: meta.traceId ?? null,
    });
    return { ok: true, reservationId: id, snapshot: snapshotOf(row) };
  }

  // ------------------------------------------------------------------------------------------------------------
  // Đọc mức dùng
  // ------------------------------------------------------------------------------------------------------------

  private async readAccount(db: Db, cycleStart: string): Promise<BudgetSnapshot> {
    const [b] = await db
      .select()
      .from(aiBudgets)
      .where(and(eq(aiBudgets.account_id, CURRENT_ACCOUNT), eq(aiBudgets.cycle_start, cycleStart)))
      .limit(1);
    if (b !== undefined) return snapshotOf(b);
    // Chưa có dòng: giá trị sẽ được chụp khi tạo.
    const settings = await this.opts.settings.get();
    const bounds = await this.boundsAt(new Date(`${cycleStart}T12:00:00+07:00`));
    return {
      used: 0,
      reserved: 0,
      cap: settings.accountCap,
      softLimit: settings.softLimit,
      cycleEnd: bounds.cycleEnd,
    };
  }

  private async readSystem(db: Db, weekStart: string): Promise<BudgetSnapshot> {
    const [b] = await db
      .select()
      .from(systemBudgets)
      .where(eq(systemBudgets.week_start, weekStart))
      .limit(1);
    if (b !== undefined) return snapshotOf(b);
    const cap = this.opts.systemWeeklyCap;
    return { used: 0, reserved: 0, cap, softLimit: cap };
  }

  usage(key: BudgetKey): Promise<BudgetSnapshot> {
    return key.scope === 'account'
      ? tenantTx((db) => this.readAccount(db, key.cycleStart))
      : systemTx((db) => this.readSystem(db, key.weekStart), { tenant: 'none' });
  }

  // ------------------------------------------------------------------------------------------------------------
  // Chuyển trạng thái giữ chỗ (FR-009) – luôn `UPDATE … WHERE state = :expected`
  // ------------------------------------------------------------------------------------------------------------

  async markCalling(reservationId: string): Promise<void> {
    this.assertNoOuterTx();
    const scope = this.scopeOfContext();
    await this.tx(scope, async (db) => {
      const table = scope === 'account' ? aiReservations : systemReservations;
      await db
        .update(table)
        .set({ state: 'calling', called_at: sql`now()` })
        .where(and(eq(table.id, reservationId), eq(table.state, 'held')));
    });
  }

  /** Trả giữ chỗ trong giao dịch đang mở; `true` khi thật sự đổi trạng thái (gọi lại → `false`, không đổi gì). */
  private async releaseInTx(db: Db, scope: Scope, reservationId: string): Promise<boolean> {
    if (scope === 'account') {
      const [r] = await db
        .update(aiReservations)
        .set({ state: 'released', closed_at: sql`now()` })
        .where(
          and(eq(aiReservations.id, reservationId), inArray(aiReservations.state, OPEN_STATES)),
        )
        .returning({ estimate: aiReservations.estimate, cycle_start: aiReservations.cycle_start });
      if (r === undefined) return false;
      await db
        .update(aiBudgets)
        .set({ reserved: sql`${aiBudgets.reserved} - ${r.estimate}` })
        .where(
          and(eq(aiBudgets.account_id, CURRENT_ACCOUNT), eq(aiBudgets.cycle_start, r.cycle_start)),
        );
      return true;
    }
    const [r] = await db
      .update(systemReservations)
      .set({ state: 'released', closed_at: sql`now()` })
      .where(
        and(
          eq(systemReservations.id, reservationId),
          inArray(systemReservations.state, OPEN_STATES),
        ),
      )
      .returning({
        estimate: systemReservations.estimate,
        week_start: systemReservations.week_start,
      });
    if (r === undefined) return false;
    await db
      .update(systemBudgets)
      .set({ reserved: sql`${systemBudgets.reserved} - ${r.estimate}`, updated_at: sql`now()` })
      .where(eq(systemBudgets.week_start, r.week_start));
    return true;
  }

  async release(reservationId: string): Promise<void> {
    this.assertNoOuterTx();
    const scope = this.scopeOfContext();
    await this.tx(scope, (db) => this.releaseInTx(db, scope, reservationId));
  }

  // ------------------------------------------------------------------------------------------------------------
  // Quyết toán (FR-008, FR-015)
  // ------------------------------------------------------------------------------------------------------------

  /**
   * Quyết toán trong giao dịch đang mở. Trả `null` khi giữ chỗ đã đóng (không đổi gì – idempotent), ngược lại danh
   * sách mốc vừa vượt. `actual = 'estimate'`: theo ước tính (giữ chỗ `calling` treo, `anomaly = 'unsettled'`).
   */
  private async settleInTx(
    db: Db,
    scope: Scope,
    reservationId: string,
    actual: number | 'estimate',
    draft: LedgerDraft | null,
    anomaly: 'unsettled' | null,
    hooks: SettleHooks | undefined,
    minEstimate: number,
  ): Promise<Crossed | null> {
    return scope === 'account'
      ? this.settleAccount(db, reservationId, actual, draft, anomaly, hooks, minEstimate)
      : this.settleSystem(db, reservationId, actual, draft, anomaly);
  }

  private async settleAccount(
    db: Db,
    reservationId: string,
    actual: number | 'estimate',
    draft: LedgerDraft | null,
    anomaly: 'unsettled' | null,
    hooks: SettleHooks | undefined,
    minEstimate: number,
  ): Promise<Crossed | null> {
    // Cổng idempotent: chỉ giao dịch nào đổi được `held|calling → settled` mới cộng ngân sách và ghi sổ.
    const [r] = await db
      .update(aiReservations)
      .set({ state: 'settled', closed_at: sql`now()` })
      .where(and(eq(aiReservations.id, reservationId), inArray(aiReservations.state, OPEN_STATES)))
      .returning();
    if (r === undefined) return null;
    const est = r.estimate;
    const cost = actual === 'estimate' ? est : toMicro(actual);
    const [b] = await db
      .select()
      .from(aiBudgets)
      .where(
        and(eq(aiBudgets.account_id, CURRENT_ACCOUNT), eq(aiBudgets.cycle_start, r.cycle_start)),
      )
      .for('update');
    if (b === undefined) throw new Error('Thiếu dòng ngân sách của giữ chỗ');
    const reservedAfter = b.reserved - est;
    const total = b.used + cost;
    const room = b.cap - reservedAfter;
    const usedAfter = total < room ? total : room;
    await db
      .update(aiBudgets)
      .set({ reserved: reservedAfter, used: usedAfter })
      .where(eq(aiBudgets.id, b.id));
    // Cờ mốc: cập nhật có điều kiện `= false` – chỉ cờ thực sự đổi mới vào `crossed`.
    const crossed: Crossed = [];
    const f80 = await db
      .update(aiBudgets)
      .set({ notified_80: true })
      .where(
        and(
          eq(aiBudgets.id, b.id),
          eq(aiBudgets.notified_80, false),
          sql`${aiBudgets.used} * 100 >= ${aiBudgets.cap} * 80`,
        ),
      )
      .returning({ id: aiBudgets.id });
    if (f80.length > 0) crossed.push(80);
    // Mốc 100% chỉ theo số ĐÃ QUYẾT TOÁN (used + minEstimate >= cap), KHÔNG tính giữ chỗ của lượt khác: reserve chặn
    // trước khi `used` chạm đúng trần nên không dùng `used >= cap`; giữ chỗ được trả sau đó không làm cờ báo sai.
    // Cờ bật bằng UPDATE … WHERE notified_100 = false → một lần/chu kỳ.
    if (isBudgetExhaustedSettled({ used: n(usedAfter), cap: n(b.cap) }, minEstimate)) {
      const f100 = await db
        .update(aiBudgets)
        .set({ notified_100: true })
        .where(and(eq(aiBudgets.id, b.id), eq(aiBudgets.notified_100, false)))
        .returning({ id: aiBudgets.id });
      if (f100.length > 0) crossed.push(100);
    }
    await db.insert(aiCostLedger).values({
      account_id: CURRENT_ACCOUNT,
      cycle_start: r.cycle_start,
      reservation_id: r.id,
      request_id: r.request_id,
      task: draft?.task ?? r.task,
      model_tier: draft?.modelTier ?? r.model_tier,
      model_id: draft?.modelId ?? r.model_id,
      provider: draft?.provider ?? r.provider,
      input_tokens: draft?.inputTokens ?? 0,
      output_tokens: draft?.outputTokens ?? 0,
      cached_input_tokens: draft?.cachedInputTokens ?? 0,
      audio_seconds: draft?.audioSeconds ?? null,
      cost_micro_usd: cost,
      estimate_micro_usd: est,
      anomaly: anomaly ?? draft?.anomaly ?? (cost > est ? 'over_estimate' : null),
      over_cap_micro_usd: total - usedAfter,
      trace_id: draft?.traceId ?? r.trace_id,
    });
    // Phát sự kiện TRONG giao dịch: ném → hoàn tác cả cờ, sổ lẫn chuyển trạng thái (nguyên tắc IV).
    if (crossed.length > 0 && hooks?.onCrossed !== undefined) {
      await hooks.onCrossed(db, crossed, r.cycle_start);
    }
    return crossed;
  }

  private async settleSystem(
    db: Db,
    reservationId: string,
    actual: number | 'estimate',
    draft: LedgerDraft | null,
    anomaly: 'unsettled' | null,
  ): Promise<Crossed | null> {
    const [r] = await db
      .update(systemReservations)
      .set({ state: 'settled', closed_at: sql`now()` })
      .where(
        and(
          eq(systemReservations.id, reservationId),
          inArray(systemReservations.state, OPEN_STATES),
        ),
      )
      .returning();
    if (r === undefined) return null;
    const est = r.estimate;
    const cost = actual === 'estimate' ? est : toMicro(actual);
    const [b] = await db
      .select()
      .from(systemBudgets)
      .where(eq(systemBudgets.week_start, r.week_start))
      .for('update');
    if (b === undefined) throw new Error('Thiếu dòng ngân sách hệ thống');
    const reservedAfter = b.reserved - est;
    const total = b.used + cost;
    const room = b.cap - reservedAfter;
    const usedAfter = total < room ? total : room;
    await db
      .update(systemBudgets)
      .set({ reserved: reservedAfter, used: usedAfter, updated_at: sql`now()` })
      .where(eq(systemBudgets.week_start, r.week_start));
    await db.insert(systemCostLedger).values({
      week_start: r.week_start,
      industry_id: r.industry_id,
      reservation_id: r.id,
      request_id: r.request_id,
      task: draft?.task ?? r.task,
      model_tier: draft?.modelTier ?? r.model_tier,
      model_id: draft?.modelId ?? r.model_id,
      provider: draft?.provider ?? r.provider,
      input_tokens: draft?.inputTokens ?? 0,
      output_tokens: draft?.outputTokens ?? 0,
      cached_input_tokens: draft?.cachedInputTokens ?? 0,
      audio_seconds: draft?.audioSeconds ?? null,
      cost_micro_usd: cost,
      estimate_micro_usd: est,
      anomaly: anomaly ?? draft?.anomaly ?? (cost > est ? 'over_estimate' : null),
      over_cap_micro_usd: total - usedAfter,
      trace_id: draft?.traceId ?? r.trace_id,
    });
    return [];
  }

  async settle(
    reservationId: string,
    actual: number,
    ledger: LedgerDraft,
    hooks?: SettleHooks,
  ): Promise<{ crossed: Crossed }> {
    this.assertNoOuterTx();
    const scope = this.scopeOfContext();
    const minEstimate = scope === 'account' ? await this.minCallEstimateMicro() : 0;
    const crossed = await this.tx(scope, (db) =>
      this.settleInTx(db, scope, reservationId, actual, ledger, null, hooks, minEstimate),
    );
    return { crossed: crossed ?? [] };
  }

  // ------------------------------------------------------------------------------------------------------------
  // Giữ chỗ treo (FR-009, FR-010)
  // ------------------------------------------------------------------------------------------------------------

  async releaseStale(
    olderThanMs: number,
    hooks?: SettleHooks,
  ): Promise<{ released: number; settledAtEstimate: number }> {
    const scope = this.scopeOfContext();
    const cutoff = new Date(Date.now() - olderThanMs);
    const minEstimate = scope === 'account' ? await this.minCallEstimateMicro() : 0;
    const stale = await this.tx(scope, (db) =>
      scope === 'account'
        ? db
            .select({
              id: aiReservations.id,
              state: aiReservations.state,
              task: aiReservations.task,
              tier: aiReservations.model_tier,
            })
            .from(aiReservations)
            .where(
              and(
                eq(aiReservations.account_id, CURRENT_ACCOUNT),
                inArray(aiReservations.state, OPEN_STATES),
                lt(aiReservations.reserved_at, cutoff),
              ),
            )
            .orderBy(asc(aiReservations.reserved_at))
        : db
            .select({
              id: systemReservations.id,
              state: systemReservations.state,
              task: systemReservations.task,
              tier: systemReservations.model_tier,
            })
            .from(systemReservations)
            .where(
              and(
                inArray(systemReservations.state, OPEN_STATES),
                lt(systemReservations.reserved_at, cutoff),
              ),
            )
            .orderBy(asc(systemReservations.reserved_at)),
    );
    let released = 0;
    let settledAtEstimate = 0;
    for (const s of stale) {
      if (s.state === 'held') {
        // `held`: chưa gọi nhà cung cấp → trả lại.
        if (await this.tx(scope, (db) => this.releaseInTx(db, scope, s.id))) released++;
        continue;
      }
      // `calling`: có thể đã tốn tiền → quyết toán theo ước tính (kẹp trần), mỗi giữ chỗ một giao dịch.
      // Một giữ chỗ lỗi (vd `onCrossed` ném bền) KHÔNG được chặn cả lô: bắt lỗi, ghi cảnh báo, quyết toán lại KHÔNG
      // kèm hook (chấp nhận mất 1 thông báo hơn là để giữ chỗ treo làm phình `reserved`); vẫn lỗi → bỏ qua, làm tiếp.
      let done: Crossed | null = null;
      try {
        done = await this.tx(scope, (db) =>
          this.settleInTx(db, scope, s.id, 'estimate', null, 'unsettled', hooks, minEstimate),
        );
      } catch {
        gatewayEvent('warn', 'ai.settle_failed', {
          task: s.task,
          model_tier: s.tier,
          reason: 'settle_failed',
        });
        if (hooks?.onCrossed === undefined) continue;
        try {
          done = await this.tx(scope, (db) =>
            this.settleInTx(db, scope, s.id, 'estimate', null, 'unsettled', undefined, minEstimate),
          );
        } catch {
          continue;
        }
      }
      if (done !== null) {
        settledAtEstimate++;
        gatewayEvent('warn', 'ai.unsettled_reservation', { task: s.task, model_tier: s.tier });
      }
    }
    return { released, settledAtEstimate };
  }
}
