// Giờ gợi ý khi duyệt (012 FR-011, US3): `count` giờ KHÁC NHAU, ≥ now + `minLeadMinutes`, nằm trong "giờ
// vàng" cấu hình (giờ UTC+7, ví dụ 09:00,12:00,19:00), tránh trùng giờ đã có. Hàm thuần – dễ kiểm thử.

const VN_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

export interface SuggestInput {
  count: number;
  /** Giờ hiện tại (đưa vào để kiểm thử). */
  now: Date;
  /** Chỉ gợi ý sau mốc này (mặc định = now). */
  after?: Date | undefined;
  minLeadMinutes: number;
  /** "HH:MM,HH:MM" – giờ UTC+7. */
  hours: string;
  /** Giờ đã có bài (so theo phút) – tránh trùng. */
  taken?: readonly Date[];
}

/** Phân tích "09:00,12:00" → số phút trong ngày UTC+7, tăng dần, không trùng. */
export function parseSuggestHours(hours: string): number[] {
  const minutes = hours
    .split(',')
    .map((h) => h.trim())
    .filter((h) => h !== '')
    .map((h) => {
      const [hh, mm] = h.split(':');
      return Number(hh) * 60 + Number(mm);
    })
    .filter((m) => Number.isInteger(m) && m >= 0 && m < 1440);
  return [...new Set(minutes)].sort((a, b) => a - b);
}

export function suggestTimes(input: SuggestInput): Date[] {
  const slots = parseSuggestHours(input.hours);
  if (slots.length === 0) return [];
  const floorMs =
    Math.max(input.now.getTime(), input.after?.getTime() ?? 0) + input.minLeadMinutes * MINUTE_MS;
  const taken = new Set((input.taken ?? []).map((d) => Math.floor(d.getTime() / MINUTE_MS)));

  // Ngày (UTC+7) chứa mốc sớm nhất, tính theo 00:00 UTC+7 = (ngày UTC+7 × 86400000) − 7h.
  const vnDayStart = Math.floor((floorMs + VN_OFFSET_MS) / DAY_MS) * DAY_MS - VN_OFFSET_MS;
  const out: Date[] = [];
  // Mỗi ngày có ≥ 1 khung; giới hạn vòng lặp để không treo khi cấu hình lạ.
  const maxDays = Math.ceil(input.count / slots.length) + 60;
  for (let day = 0; day < maxDays && out.length < input.count; day++) {
    for (const minutes of slots) {
      const at = vnDayStart + day * DAY_MS + minutes * MINUTE_MS;
      if (at < floorMs) continue;
      if (taken.has(Math.floor(at / MINUTE_MS))) continue;
      out.push(new Date(at));
      if (out.length >= input.count) break;
    }
  }
  return out;
}
