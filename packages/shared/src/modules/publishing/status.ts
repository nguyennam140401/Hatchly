// Bảng gộp trạng thái đăng "xấu nhất" của một bài nhiều kênh (UI/UX mục 7, data-model.md mục 5).
import type { AttemptStatus } from '../content/post.js';

/** Thứ tự mức độ cần chú ý – số càng lớn càng "xấu". */
const SEVERITY: Record<AttemptStatus, number> = {
  succeeded: 0,
  cancelled: 0,
  scheduled: 1,
  processing: 2,
  retry_wait: 3,
  unknown: 4,
  needs_check: 5,
  needs_user: 6,
};

/** Trạng thái xấu nhất trong các mục (rỗng → null). */
export function worstAttemptStatus(statuses: readonly AttemptStatus[]): AttemptStatus | null {
  let worst: AttemptStatus | null = null;
  for (const s of statuses) {
    if (worst === null || SEVERITY[s] > SEVERITY[worst]) worst = s;
  }
  return worst;
}

/** Nhãn người dùng + biểu tượng (chữ + biểu tượng, không chỉ dựa vào màu – nguyên tắc VI). */
export const ATTEMPT_STATUS_LABELS: Record<AttemptStatus, { labelVi: string; icon: string }> = {
  scheduled: { labelVi: 'Đã lên lịch', icon: 'clock' },
  processing: { labelVi: 'Đang đăng', icon: 'loader' },
  retry_wait: { labelVi: 'Đang thử lại', icon: 'refresh' },
  needs_user: { labelVi: 'Cần bạn xử lý', icon: 'alert' },
  unknown: { labelVi: 'Đang kiểm tra', icon: 'search' },
  needs_check: { labelVi: 'Cần kiểm tra', icon: 'alert' },
  succeeded: { labelVi: 'Đã đăng', icon: 'check' },
  cancelled: { labelVi: 'Đã hủy', icon: 'x' },
};
