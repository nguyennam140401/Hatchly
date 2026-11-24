// Tính chu kỳ ngân sách AI từ mốc của tài khoản (015, R-05, FR-014). Thuần hàm – không đọc CSDL, không đọc đồng hồ
// ngoài tham số `at`. Mọi ngày tính theo UTC+7 (giờ Việt Nam) dạng `YYYY-MM-DD`.
// Quy ước chu kỳ (Hiến pháp): lặp hằng tháng theo ngày của mốc; tháng không có ngày đó → ngày cuối tháng
// (vd mốc 31/01 → 28/02 (29/02 năm nhuận) → 31/03 → 30/04).

export { weekStart } from './system-budget';

const VN_OFFSET_MS = 7 * 3_600_000;

export interface CycleBounds {
  /** Ngày đầu chu kỳ (gồm). */
  cycleStart: string;
  /** Ngày đầu chu kỳ kế tiếp (không gồm) – luôn lớn hơn `cycleStart`. */
  cycleEnd: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Số ngày của tháng `month` (1–12) năm `year`. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Ngày bắt đầu chu kỳ của tháng `(year, month)` cho mốc `anchorDay` (kẹp về ngày cuối tháng). */
function startInMonth(year: number, month: number, anchorDay: number): string {
  return `${year}-${pad(month)}-${pad(Math.min(anchorDay, daysInMonth(year, month)))}`;
}

function parseAnchor(anchorDate: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(anchorDate);
  if (m === null) throw new Error(`anchorDate không hợp lệ: ${anchorDate}`);
  const day = Number(m[3]);
  const check = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, day));
  if (
    check.getUTCFullYear() !== Number(m[1]) ||
    check.getUTCMonth() !== Number(m[2]) - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new Error(`anchorDate không hợp lệ: ${anchorDate}`);
  }
  return day;
}

/** Chu kỳ chứa thời điểm `at` của tài khoản có mốc `anchorDate` (`YYYY-MM-DD`, UTC+7). */
export function cycleBounds(anchorDate: string, at: Date = new Date()): CycleBounds {
  const anchorDay = parseAnchor(anchorDate);
  const local = new Date(at.getTime() + VN_OFFSET_MS);
  let year = local.getUTCFullYear();
  let month = local.getUTCMonth() + 1;
  const today = `${year}-${pad(month)}-${pad(local.getUTCDate())}`;

  let cycleStart = startInMonth(year, month, anchorDay);
  if (cycleStart > today) {
    // Chưa tới ngày mốc của tháng này → chu kỳ bắt đầu từ tháng trước.
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
    cycleStart = startInMonth(year, month, anchorDay);
  }
  let nextMonth = month + 1;
  let nextYear = year;
  if (nextMonth === 13) {
    nextMonth = 1;
    nextYear += 1;
  }
  return { cycleStart, cycleEnd: startInMonth(nextYear, nextMonth, anchorDay) };
}
