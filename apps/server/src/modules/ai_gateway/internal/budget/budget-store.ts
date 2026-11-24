import type { Db } from '../../../../core';
import type { AiTask, ModelTier } from '../../public-api';
import type { PriceEntry } from '../prices/price-book';

// Kho ngân sách AI (005, contracts/ai-gateway.md mục 3, research R7–R8). Bất biến KHÔNG THƯƠNG LƯỢNG:
// `used + reserved <= cap` ở mọi thời điểm (hiến pháp III). Giữ chỗ bằng MỘT cập nhật có điều kiện; mọi
// chuyển trạng thái giữ chỗ là cập nhật có điều kiện theo trạng thái hiện tại. Tiền: số nguyên micro-USD.

/** Tài khoản: theo chu kỳ (tài khoản lấy từ ngữ cảnh – không có trong khóa); hệ thống: theo tuần. */
export type BudgetKey =
  { scope: 'account'; cycleStart: string } | { scope: 'system'; weekStart: string };

export interface BudgetSnapshot {
  used: number;
  reserved: number;
  cap: number;
  softLimit: number;
  /**
   * Ngày đầu chu kỳ kế (`YYYY-MM-DD`, UTC+7) – CHỈ kho thật điền (đọc từ dòng ngân sách / `cycleBounds`, đúng cả khi
   * chu kỳ bị kẹp ngày cuối tháng). Kho giả không điền → bên gọi tự suy ra.
   */
  cycleEnd?: string | undefined;
}

export interface ReserveMeta {
  task: AiTask;
  modelTier: ModelTier;
  industryId?: string | undefined;
  /** Mã yêu cầu logic (015, FR-037a): cùng mã trong cùng chu kỳ/tuần không giữ chỗ lại. */
  requestId?: string | undefined;
  /**
   * Tuyến + dòng giá đã chọn (015, FR-020): kho thật lưu vào giữ chỗ (`price_id` NOT NULL). Bỏ trống → kho thật tự suy
   * từ tuyến rank 1 của bậc + giá hiệu lực; kho giả bỏ qua cả ba trường.
   */
  provider?: string | undefined;
  modelId?: string | undefined;
  priceId?: string | undefined;
  traceId?: string | undefined;
  /**
   * Thứ tự lượt gọi (0 = chính, 1 = dự phòng): kho thật chọn tuyến `attempts[attempt]` của bậc để ghi đúng nhà cung
   * cấp/mô hình/giá của lượt dự phòng. Không có tuyến thứ tự đó → dùng tuyến chính (kèm cảnh báo). Kho giả bỏ qua.
   */
  attempt?: number | undefined;
}

/** Tuyến đã chọn cho một lượt gọi + dòng giá tương ứng (đã ghi vào giữ chỗ qua `provider/modelId/priceId`). */
export interface AttemptRoute {
  provider: string;
  modelId: string;
  priceId: string;
  price: PriceEntry;
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
  /** Chỉ STT: số giây âm thanh THỰC nhà cung cấp báo (không kẹp 300); thiếu khi nhà cung cấp không báo. */
  audioSeconds?: number | undefined;
  /**
   * Gắn `anomaly` vào sổ (`missing_usage`: quyết toán theo ước tính vì nhà cung cấp chưa báo usage;
   * `over_estimate`: STT dài hơn 300 s nên chi phí thực vượt ước tính).
   */
  anomaly?: 'missing_usage' | 'over_estimate' | undefined;
}

export interface CostLedgerEntry extends Omit<LedgerDraft, 'anomaly'> {
  id: string;
  scope: 'account' | 'system';
  accountId: string | null;
  cycleOrWeekStart: string;
  reservationId: string;
  /** Chi phí THỰC (không kẹp); với `unsettled` = ước tính. */
  costMicroUsd: number;
  estimateMicroUsd: number;
  anomaly: 'over_estimate' | 'unsettled' | 'missing_usage' | null;
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
  onCrossed?: (tx: Db, crossed: Crossed, cycleStart: string) => Promise<void>;
}

export type ReserveResult =
  | { ok: true; reservationId: string; snapshot: BudgetSnapshot }
  | { ok: false; duplicate?: false; snapshot: BudgetSnapshot }
  /** Mã yêu cầu đã có giữ chỗ không ở `released`: `settled` → đã xong; `held|calling` → đang xử lý. */
  | {
      ok: false;
      duplicate: true;
      status: 'settled' | 'in_progress';
      snapshot: BudgetSnapshot;
    };

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
   * Ước tính tối thiểu một lời gọi (micro-USD) – CHỈ kho thật cài (giá từ CSDL); kho giả không có → cổng tự tính từ sổ
   * giá giả. Một nguồn cho cả `blocked` hiển thị lẫn cờ 100%.
   */
  minCallEstimateMicro?(): Promise<number>;
  /**
   * Tuyến + giá của lượt gọi `attempt` (0 chính, 1 dự phòng) – CHỈ kho thật cài. Cổng dùng nó để gọi nhà cung cấp,
   * ước tính giữ chỗ và quyết toán đúng mô hình/giá của lượt đó. Kho giả không có → giữ hành vi theo bậc (giá lượt chính).
   * Theo `RouteBook.attemptsFor`: không còn lượt thứ `attempt` (vd loại việc chưa bật dự phòng) → `null` (hết lượt);
   * thiếu tuyến chính hoặc thiếu giá của lượt → ném `AI_NOT_CONFIGURED` (kèm `ai.route_missing`/`ai.price_missing`).
   */
  attemptRoute?(task: AiTask, modelTier: ModelTier, attempt: number): Promise<AttemptRoute | null>;
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

/**
 * Đã hết ngân sách theo số ĐÃ QUYẾT TOÁN (không tính giữ chỗ đang chạy): `used` không bao giờ giảm nên trạng thái này
 * bền. Dùng cho mốc 100% (`notified_100`) và thông báo "đã hết giới hạn AI" – tránh báo sai khi giữ chỗ của lượt khác
 * sau đó được trả lại. Cùng nguồn `minCallEstimate` với `isBudgetBlocked`. Số nguyên micro-USD.
 */
export function isBudgetExhaustedSettled(
  b: { used: number; cap: number },
  minCallEstimate: number,
): boolean {
  // Quy ước biên thống nhất: đúng biên used + minEstimate == cap tính là hết (<=), cùng `isBudgetBlocked`.
  return b.cap - b.used <= minCallEstimate || b.used >= b.cap;
}

/**
 * Trạng thái `blocked` HIỂN THỊ tức thời của `getUsage()` (hiến chương III): tính cả giữ chỗ đang chạy, có thể tạm
 * thời và đổi lại khi giữ chỗ được trả. KHÔNG dùng cho cờ/thông báo 100% (xem `isBudgetExhaustedSettled`).
 */
export function isBudgetBlocked(
  b: { used: number; reserved: number; cap: number },
  minCallEstimate: number,
): boolean {
  const spent = b.used + b.reserved;
  // Biên `<=`: used + reserved + minEstimate == cap vẫn là bị chặn (khớp `isBudgetExhaustedSettled`).
  return b.cap - spent <= minCallEstimate || spent >= b.cap;
}

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
