// Chính sách thử lại (research R7): lần thử lại thứ k dùng phần tử thứ k của mảng giãn cách (quá mảng →
// phần tử cuối), ngẫu nhiên ±≤ 20% để các việc cùng lỗi không dồn về một thời điểm.
import type { RetryMode } from './settings';

/** Biên ngẫu nhiên của giãn cách. */
export const RETRY_JITTER = 0.2;

/**
 * Số giây chờ trước lần thử lại kế tiếp.
 * @param retryIndex số lần đã thử lại trước đó (0 → lần thử lại đầu tiên)
 * @param random nguồn ngẫu nhiên [0, 1) – tiêm được để kiểm thử
 */
export function retryDelaySeconds(
  mode: RetryMode,
  delays: readonly number[],
  retryIndex: number,
  random: () => number = Math.random,
): number {
  const first = delays[0] ?? 60;
  // 'handler' (publish – ADR-04): chỉ bộ xử lý quyết giờ thử lại; lỗi không bắt được dùng phần tử đầu.
  if (mode !== 'schedule') return first;
  const base = delays[Math.min(Math.max(retryIndex, 0), delays.length - 1)] ?? first;
  const jitter = base * RETRY_JITTER * (2 * random() - 1);
  return Math.max(1, Math.round(base + jitter));
}
