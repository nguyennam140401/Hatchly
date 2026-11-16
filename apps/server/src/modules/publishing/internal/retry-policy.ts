// Chính sách thử lại và đối soát (research R4, R5, R7). Hàm THUẦN: nhận thời điểm làm tham số để kiểm thử bằng
// đồng hồ giả. Giá trị là cấu hình (data-model mục 5) – không có hằng số rải trong luồng đăng.

export interface PublishSettings {
  /** Quá giờ hẹn bao lâu thì không tự đăng (giây). */
  maxLateSec: number;
  /** Giãn cách thử lại lỗi tạm thời (giây), tối đa 5 lần. */
  transientDelaysSec: readonly number[];
  /** Cửa sổ thử lại tối đa kể từ lần lỗi tạm thời đầu tiên (giây). */
  transientWindowSec: number;
  reconcileFirstDelaySec: number;
  reconcilePollSec: number;
  reconcileGiveUpAfterSec: number;
  awaitProcessingMaxSec: { image: number; video: number };
  /** Cửa sổ lùi khi tìm bài lúc đối soát (giây trước `submitted_at`). */
  reconcileLookbackSec: number;
}

export const DEFAULT_PUBLISH_SETTINGS: PublishSettings = {
  maxLateSec: 3600,
  transientDelaysSec: [60, 180, 360, 600, 600],
  transientWindowSec: 1800,
  reconcileFirstDelaySec: 120,
  reconcilePollSec: 120,
  reconcileGiveUpAfterSec: 600,
  awaitProcessingMaxSec: { image: 600, video: 1800 },
  reconcileLookbackSec: 300,
};

export type TransientDecision =
  { kind: 'retry'; delaySec: number; attemptNo: number } | { kind: 'exhausted' };

/**
 * Lỗi tạm thời lần thứ `attemptsSoFar + 1`: thử lại sau `delaySec` hoặc hết lượt (5 lần / 30 phút, cái nào đến trước).
 * `platformRetryAfterSec` lớn hơn giãn cách thì lấy giá trị lớn hơn nhưng vẫn không vượt cửa sổ.
 */
export function nextTransientDelay(
  attemptsSoFar: number,
  windowStartedAt: Date | null,
  now: Date,
  platformRetryAfterSec: number | undefined,
  settings: PublishSettings = DEFAULT_PUBLISH_SETTINGS,
): TransientDecision {
  if (attemptsSoFar >= settings.transientDelaysSec.length) return { kind: 'exhausted' };
  const start = windowStartedAt ?? now;
  const base = settings.transientDelaysSec[attemptsSoFar] ?? 600;
  const delaySec = Math.max(base, platformRetryAfterSec ?? 0);
  const elapsedSec = (now.getTime() - start.getTime()) / 1000;
  if (elapsedSec + delaySec > settings.transientWindowSec) return { kind: 'exhausted' };
  return { kind: 'retry', delaySec, attemptNo: attemptsSoFar + 1 };
}

export type ReconcileAction =
  { kind: 'wait'; delaySec: number } | { kind: 'check_now' } | { kind: 'give_up' };

/**
 * Lịch đối soát (R5): lần đầu sau `reconcileFirstDelaySec` kể từ `submitted_at`, rồi mỗi `reconcilePollSec` đến mốc
 * `reconcileGiveUpAfterSec`. `lastCheckedAt` = lần đối soát gần nhất (null nếu chưa).
 */
export function nextReconcileAction(
  submittedAt: Date,
  lastCheckedAt: Date | null,
  now: Date,
  settings: PublishSettings = DEFAULT_PUBLISH_SETTINGS,
): ReconcileAction {
  const sinceSubmit = (now.getTime() - submittedAt.getTime()) / 1000;
  if (sinceSubmit < settings.reconcileFirstDelaySec) {
    return { kind: 'wait', delaySec: Math.ceil(settings.reconcileFirstDelaySec - sinceSubmit) };
  }
  if (lastCheckedAt === null) return { kind: 'check_now' };
  const sinceCheck = (now.getTime() - lastCheckedAt.getTime()) / 1000;
  if (sinceCheck < settings.reconcilePollSec) {
    return { kind: 'wait', delaySec: Math.ceil(settings.reconcilePollSec - sinceCheck) };
  }
  return { kind: 'check_now' };
}

/** Đã quá mốc bỏ cuộc đối soát chưa (`not_found` sau 10 phút → thử lại một lần hoặc "Cần kiểm tra"). */
export function reconcileExpired(
  submittedAt: Date,
  now: Date,
  settings: PublishSettings = DEFAULT_PUBLISH_SETTINGS,
): boolean {
  return (now.getTime() - submittedAt.getTime()) / 1000 >= settings.reconcileGiveUpAfterSec;
}

/** Lượt vào `processing` lần ĐẦU mà đã quá giờ hẹn hơn ngưỡng → không tự đăng (R7, FR-009). */
export function isTooLate(
  scheduledAt: Date,
  dbNow: Date,
  settings: PublishSettings = DEFAULT_PUBLISH_SETTINGS,
): boolean {
  return (dbNow.getTime() - scheduledAt.getTime()) / 1000 > settings.maxLateSec;
}
