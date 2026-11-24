import { gatewayEvent } from '../events';
import { thresholdRatio } from '../db/summary-functions';

// Cảnh báo vận hành tỷ lệ tài khoản chạm ngưỡng mềm (015 US8 T066, FR-034, hiến chương VIII): > 5% tài khoản hoạt động có
// used + reserved ≥ soft_limit (2 USD) ở chu kỳ hiện hành → `ai.threshold_ratio_high` (mức warn, phạm vi hệ thống).
// Tử số từ hàm tổng hợp SQL (chỉ đếm ai_budgets); mẫu số từ giao diện công khai của module Tài khoản (hiến chương IV) –
// hai số lấy trong cùng một lần chạy, không cache. Nhật ký KHÔNG mang số tiền hay mã tài khoản (chỉ số lượng).

/** Ngưỡng cảnh báo: tỷ lệ > 5% (đúng 5% thì không). Tính bằng số nguyên: soft × 100 > active × 5. */
export const THRESHOLD_RATIO_ALERT_PERCENT = 5;

export interface ThresholdCheckResult {
  softAccounts: number;
  activeAccounts: number;
  alerted: boolean;
}

export async function checkThresholds(
  countActiveAccounts: () => Promise<number>,
  at: Date = new Date(),
): Promise<ThresholdCheckResult> {
  const [{ softAccounts }, activeAccounts] = await Promise.all([
    thresholdRatio(at),
    countActiveAccounts(),
  ]);
  const alerted =
    activeAccounts > 0 && softAccounts * 100 > activeAccounts * THRESHOLD_RATIO_ALERT_PERCENT;
  if (alerted) {
    gatewayEvent('warn', 'ai.threshold_ratio_high', { count: softAccounts });
  }
  return { softAccounts, activeAccounts, alerted };
}
