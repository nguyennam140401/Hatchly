import { z } from 'zod';
import type { Db } from '../../core';
import {
  defineJobType,
  defineSchedule,
  enqueue,
  noRetry,
  registerJobHandler,
  registerPartitionedLog,
  type NoRetry,
} from '../queue';
import { countActiveAccounts, type AccountPublicApi } from '../account';
import { checkThresholds } from './internal/alerts/threshold-check';
import { reconcileInvoices } from './internal/alerts/invoice-reconcile';
import { allocateTrendCost } from './internal/allocation/trend-allocation';
import type { IndustryAccountsSource } from './public-api';
import type { BudgetStore, Crossed } from './internal/budget/budget-store';
import { AiError, type AiErrorCode } from './internal/errors';

// Sổ chi phí AI (015, FR-015/FR-016): phân vùng theo tháng, tạo trước 2 tháng, giữ 12 tháng (Hiến pháp VII).
registerPartitionedLog({
  table: 'ai_gateway.ai_cost_ledger',
  ensureFunction: 'ai_gateway.ensure_ai_cost_ledger_partitions',
  monthsAhead: 2,
  retentionMonths: 12,
  dropFunction: 'ai_gateway.drop_ai_cost_ledger_partitions_before',
});

// Việc nền của Cổng AI (005, research R8): trả / quyết toán giữ chỗ treo > 15 phút.
// - `ai_gateway.release_stale` (tenant): hẹn trong CÙNG giao dịch giữ chỗ, chạy sau 15 phút trong ngữ
//   cảnh tài khoản của việc (RLS – không quét chéo tài khoản). Idempotent: giữ chỗ đã đóng → không làm gì.
// - `ai_gateway.release_stale_system` (system, mỗi phút): giữ chỗ của ngân sách hệ thống (xu hướng).

export const STALE_RESERVATION_MS = 15 * 60_000;

/** Lỗi Cổng AI không đáng thử lại: hết ngân sách, trùng yêu cầu, chưa cấu hình (FR-037, không đốt hàng chờ). */
const NO_RETRY_CODES: ReadonlySet<AiErrorCode> = new Set([
  'AI_BUDGET_EXHAUSTED',
  'AI_SYSTEM_BUDGET_EXHAUSTED',
  'AI_DUPLICATE_REQUEST',
  'AI_NOT_CONFIGURED',
]);

/**
 * Dùng trong `catch` của bộ xử lý nền gọi Cổng AI: lỗi không thử lại → `noRetry(...)` (kết thúc lượt, không vào việc
 * hỏng); `AI_PROVIDER_UNAVAILABLE` và lỗi khác được ném lại để hàng chờ thử lại theo chính sách (≤ 2 lần ở `ai_batch`).
 * Lý do chỉ là mã lỗi – không chứa lời nhắc hay số tiền.
 */
export function noRetryOnAiError(err: unknown): NoRetry {
  if (err instanceof AiError && NO_RETRY_CODES.has(err.code)) return noRetry(err.code);
  throw err;
}

export const releaseStaleJob = defineJobType({
  name: 'ai_gateway.release_stale',
  queue: 'ai_batch',
  scope: 'tenant',
  version: 1,
  payload: z.strictObject({ reservationId: z.uuid() }),
});

export const releaseStaleSystemJob = defineJobType({
  name: 'ai_gateway.release_stale_system',
  queue: 'scheduled',
  scope: 'system',
  version: 1,
  payload: z.strictObject({}),
});

// 015 US7: phân bổ chi phí xu hướng (hàng chờ `trends`, hệ thống). Khóa chống trùng `ai_alloc:{weekStart}:{industryId}` do
// bên tạo việc (module `trends`, sau lần thu thập tuần) đặt qua `allocateTrendDedupeKey`.
export const allocateTrendCostJob = defineJobType({
  name: 'ai_gateway.allocate_trend_cost',
  queue: 'trends',
  scope: 'system',
  version: 1,
  payload: z.strictObject({
    weekStart: z
      .string()
      .max(10)
      .regex(/^\d{4}-\d{2}-\d{2}$/),
    industryId: z.uuid(),
  }),
});

export function allocateTrendDedupeKey(weekStart: string, industryId: string): string {
  return `ai_alloc:${weekStart}:${industryId}`;
}

// 015 US8: cảnh báo vận hành (hàng chờ `scheduled`, hệ thống, payload rỗng; khóa `scheduled:<tên>:{slot}` do bộ hẹn giờ đặt).
export const checkThresholdsJob = defineJobType({
  name: 'ai_gateway.check_thresholds',
  queue: 'scheduled',
  scope: 'system',
  version: 1,
  payload: z.strictObject({}),
});

export const reconcileInvoicesJob = defineJobType({
  name: 'ai_gateway.reconcile_invoices',
  queue: 'scheduled',
  scope: 'system',
  version: 1,
  payload: z.strictObject({}),
});

let alertSchedulesDefined = false;

/**
 * Khai báo lịch cảnh báo (Worker, driver `real`): kiểm ngưỡng mỗi 5 phút (khung 5 phút, khóa `scheduled:ai_gateway.check_thresholds:{slot}` nên mỗi khung chỉ một lượt;
 * cảnh báo ≤ 15 phút – SC-013); đối soát hóa đơn 02:00 giờ Việt Nam hằng ngày
 * (đối soát ngày hôm trước). Gọi lại nhiều lần an toàn.
 */
export function defineAlertSchedules(): void {
  if (alertSchedulesDefined) return;
  alertSchedulesDefined = true;
  defineSchedule({
    name: 'ai_gateway.check_thresholds',
    cron: '*/5 * * * *',
    tz: 'UTC',
    jobType: checkThresholdsJob,
  });
  defineSchedule({
    name: 'ai_gateway.reconcile_invoices',
    cron: '0 2 * * *',
    tz: 'Asia/Ho_Chi_Minh',
    jobType: reconcileInvoicesJob,
  });
}

let scheduled = false;

/**
 * Khai báo lịch mỗi phút dọn giữ chỗ treo của ngân sách hệ thống (Worker): kho `sandbox` và kho thật (driver `real`).
 * Ngân sách hệ thống không hẹn việc theo từng giữ chỗ (việc `release_stale` là việc tenant) nên lịch này là đường dọn
 * duy nhất. Gọi lại nhiều lần an toàn.
 */
export function defineStaleSystemSchedule(): void {
  if (scheduled) return;
  scheduled = true;
  defineSchedule({
    name: 'ai_gateway.release_stale_system',
    cron: '* * * * *',
    tz: 'UTC',
    jobType: releaseStaleSystemJob,
  });
}

/** Hẹn việc trả giữ chỗ treo – gọi trong giao dịch giữ chỗ (`onReserved` của kho sandbox). */
export async function scheduleStaleRelease(
  _tx: Db,
  reservation: { id: string; reservedAt: Date },
): Promise<void> {
  await enqueue(
    releaseStaleJob,
    { reservationId: reservation.id },
    {
      runAfter: new Date(reservation.reservedAt.getTime() + STALE_RESERVATION_MS + 5_000),
      dedupeKey: `ai_release_stale:${reservation.id}`,
    },
  );
}

let handlersRegistered = false;

/**
 * Đăng ký bộ xử lý (CHỈ Worker). Việc tenant chạy trong ngữ cảnh tài khoản của việc: trả / quyết toán mọi
 * giữ chỗ treo của tài khoản (idempotent – chạy lại hai lần cho cùng kết quả). Gọi lại nhiều lần an toàn.
 */
export interface AiJobDeps {
  /** Cổng đảo ngược tài khoản theo ngành (module `trends`/`context` cắm); thiếu → việc phân bổ bị bỏ qua + cảnh báo. */
  industryAccounts?: IndustryAccountsSource | undefined;
  /** Mẫu số của cảnh báo ngưỡng; mặc định: hiện thực của module Tài khoản (hàm công khai). */
  accounts?: Pick<AccountPublicApi, 'countActiveAccounts'> | undefined;
}

export function registerAiJobHandlers(
  store: BudgetStore,
  onCrossed?: (tx: Db, crossed: Crossed, cycleStart: string) => Promise<void>,
  deps: AiJobDeps = {},
): void {
  if (handlersRegistered) return;
  handlersRegistered = true;
  registerJobHandler(releaseStaleJob, async () => {
    // Chu kỳ của mốc vừa vượt do kho báo (giữ chỗ treo có thể thuộc chu kỳ cũ); KHÔNG hỏi mốc chu kỳ hiện hành –
    // tài khoản hết hạn/bị khóa vẫn phải được dọn giữ chỗ.
    await store.releaseStale(
      STALE_RESERVATION_MS,
      onCrossed === undefined
        ? undefined
        : { onCrossed: (tx, crossed, cycleStart) => onCrossed(tx, crossed, cycleStart) },
    );
  });
  registerJobHandler(releaseStaleSystemJob, async () => {
    await store.releaseStale(STALE_RESERVATION_MS);
  });
  registerJobHandler(allocateTrendCostJob, async (payload) => {
    // Lỗi tạm của nguồn tài khoản ném lên → hàng chờ thử lại; dòng đã ghi giữ nguyên (ON CONFLICT DO NOTHING).
    await allocateTrendCost(payload, deps.industryAccounts);
  });
  registerJobHandler(checkThresholdsJob, async () => {
    await checkThresholds(() => (deps.accounts?.countActiveAccounts ?? countActiveAccounts)());
  });
  registerJobHandler(reconcileInvoicesJob, async () => {
    await reconcileInvoices();
  });
}
