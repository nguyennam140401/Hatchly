// Khóa thời gian của ngân sách AI (005, R7). Mọi mốc tính theo UTC+7 (giờ Việt Nam), lưu dạng ngày.

const VN_OFFSET_MS = 7 * 3_600_000;

function vnDate(at: Date): Date {
  return new Date(at.getTime() + VN_OFFSET_MS);
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Chu kỳ mặc định của bản giả lập: ngày 1 tháng hiện tại (UTC+7). Chu kỳ thật theo ngày kích hoạt – WBS 4.4. */
export function defaultCycleStart(at: Date = new Date()): string {
  const d = vnDate(at);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** Ngân sách hệ thống theo tuần: thứ Hai 00:00 UTC+7. */
export function weekStart(at: Date = new Date()): string {
  const d = vnDate(at);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = thứ Hai
  d.setUTCDate(d.getUTCDate() - dow);
  return fmt(d);
}

/**
 * Bắt đầu chu kỳ kế tiếp: cùng ngày của tháng sau, tháng không có ngày đó → ngày cuối tháng (hiến pháp);
 * trả về thời điểm 00:00 UTC+7 dưới dạng Date (UTC).
 */
export function nextCycleStartsAt(cycleStart: string): Date {
  const [y, m, day] = cycleStart.split('-').map(Number) as [number, number, number];
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const next = new Date(Date.UTC(y, m, Math.min(day, lastDay)));
  return new Date(next.getTime() - VN_OFFSET_MS);
}
