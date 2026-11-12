import type { Db } from '../../../../core';
import type { AiTask, ModelTier } from '../../public-api';

// Kho ngân sách AI (005, contracts/ai-gateway.md mục 3, research R7–R8). Bất biến KHÔNG THƯƠNG LƯỢNG:
// `used + reserved <= cap` ở mọi thời điểm (hiến pháp III). Giữ chỗ bằng MỘT cập nhật có điều kiện; mọi
// chuyển trạng thái giữ chỗ là cập nhật có điều kiện theo trạng thái hiện tại. Tiền: số nguyên micro-USD.

/** Tài khoản: theo chu kỳ (tài khoản lấy từ ngữ cảnh – không có trong khóa); hệ thống: theo tuần. */
export type BudgetKey =
  | { scope: 'account'; cycleStart: string }
  | { scope: 'system'; weekStart: string };

export interface BudgetSnapshot {
  used: number;
  reserved: number;
  cap: number;
  softLimit: number;
}

export interface ReserveMeta {
  task: AiTask;
  modelTier: ModelTier;
  industryId?: string | undefined;
}

export type ReservationState = 'held' | 'calling' | 'settled' | 'released';

export interface Reservation {
  id: string;
  scope: 'account' | 'system';
  key: string;
  estimateMicroUsd: number;
  modelTier: ModelTier;
  task: AiTask;
  reservedAt: Date;
  calledAt: Date | null;
  state: ReservationState;
}

/** Phần sổ chi phí do Cổng AI cung cấp khi quyết toán (phần còn lại do kho tính). */
export interface LedgerDraft {
  task: AiTask;
  modelTier: ModelTier;
  modelId: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  traceId: string | null;
  industryId?: string | undefined;
}

export interface CostLedgerEntry extends LedgerDraft {
  id: string;
  scope: 'account' | 'system';
  accountId: string | null;
  cycleOrWeekStart: string;
  reservationId: string;
  /** Chi phí THỰC (không kẹp); với `unsettled` = ước tính. */
  costMicroUsd: number;
  estimateMicroUsd: number;
  anomaly: 'over_estimate' | 'unsettled' | null;
  /** Phần bị kẹp vì vượt trần (≥ 0). */
  overCapMicroUsd: number;
  createdAt: Date;
}

export type Crossed = (80 | 100)[];

export interface SettleHooks {
  /**
   * Chạy TRONG giao dịch quyết toán khi vượt mốc mới (80/100%). Ném → hủy cả giao dịch: không cờ, không
   * sổ, giữ chỗ giữ nguyên (nguyên tắc IV). Chế độ memory: `tx = memoryTx()`.
   */
  onCrossed?: (tx: Db, crossed: Crossed) => Promise<void>;
}

export type ReserveResult =
  | { ok: true; reservationId: string; snapshot: BudgetSnapshot }
  | { ok: false; snapshot: BudgetSnapshot };

export interface BudgetStore {
  /** Chu kỳ hiện hành của tài khoản trong ngữ cảnh (`YYYY-MM-DD`). */
  currentCycleStart(): Promise<string>;
  reserve(key: BudgetKey, est: number, meta: ReserveMeta): Promise<ReserveResult>;
  /** `held → calling`, đặt `calledAt` – NGAY TRƯỚC mỗi lần gọi nhà cung cấp. */
  markCalling(reservationId: string): Promise<void>;
  /** Một giao dịch: trừ giữ chỗ, cộng chi phí (kẹp trần), cờ 80/100, sổ, `→ settled`, rồi onCrossed. */
  settle(
    reservationId: string,
    actual: number,
    ledger: LedgerDraft,
    hooks?: SettleHooks,
  ): Promise<{ crossed: Crossed }>;
  /** Từ `held` hoặc `calling`; gọi lại / đã đóng = không làm gì. */
  release(reservationId: string): Promise<void>;
  usage(key: BudgetKey): Promise<BudgetSnapshot>;
  /**
   * Giữ chỗ treo trong ngữ cảnh hiện tại (tài khoản, hoặc hệ thống khi không có tài khoản): `held` quá hạn
   * → `released`; `calling` quá hạn → quyết toán theo ƯỚC TÍNH (kẹp trần) + sổ `anomaly='unsettled'`.
   */
  releaseStale(
    olderThanMs: number,
    hooks?: SettleHooks,
  ): Promise<{ released: number; settledAtEstimate: number }>;
}

/** Trần / ngưỡng mềm mặc định của tài khoản (micro-USD): 4 USD / 2 USD. */
export const ACCOUNT_CAP_MICRO_USD = 4_000_000;
export const ACCOUNT_SOFT_LIMIT_MICRO_USD = 2_000_000;

/** Mốc vừa vượt (theo `used` sau quyết toán), chưa từng báo trong chu kỳ. */
export function crossedMarks(
  used: number,
  cap: number,
  notified: { n80: boolean; n100: boolean },
): Crossed {
  const out: Crossed = [];
  if (cap <= 0) return out;
  if (!notified.n80 && used * 100 >= cap * 80) out.push(80);
  if (!notified.n100 && used >= cap) out.push(100);
  return out;
}
