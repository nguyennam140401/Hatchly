// T041 (012 US2) – giờ gợi ý khi duyệt: ≥ now + 5 phút, nằm trong "giờ vàng" UTC+7, các giờ KHÁC NHAU, tránh
// giờ đã có bài, đúng ngày sát nửa đêm UTC+7.
import { describe, expect, it } from 'vitest';
import {
  parseSuggestHours,
  suggestTimes,
} from '../../../src/modules/approval/internal/suggest-times';

const HOURS = '09:00,12:00,19:00';
const vn = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3_600_000); // hiển thị UTC+7 qua UTC getters
const vnHM = (d: Date) => {
  const x = vn(d.toISOString());
  return `${String(x.getUTCHours()).padStart(2, '0')}:${String(x.getUTCMinutes()).padStart(2, '0')}`;
};

describe('suggestTimes', () => {
  it('phân tích cấu hình giờ vàng, bỏ giá trị trùng và sắp tăng dần', () => {
    expect(parseSuggestHours('19:00, 09:00,09:00')).toEqual([9 * 60, 19 * 60]);
    expect(parseSuggestHours('')).toEqual([]);
  });

  it('mọi giờ ≥ now + 5 phút, thuộc giờ vàng UTC+7, đều khác nhau', () => {
    const now = new Date('2026-11-16T05:00:00Z'); // 12:00 UTC+7
    const times = suggestTimes({ count: 10, now, minLeadMinutes: 5, hours: HOURS });
    expect(times).toHaveLength(10);
    expect(new Set(times.map((t) => t.getTime())).size).toBe(10);
    for (const t of times) {
      expect(t.getTime()).toBeGreaterThanOrEqual(now.getTime() + 5 * 60_000);
      expect(['09:00', '12:00', '19:00']).toContain(vnHM(t));
    }
    // 12:00 UTC+7 đúng lúc now → khung 12:00 hôm nay đã quá (< now+5') nên khung đầu là 19:00.
    expect(vnHM(times[0]!)).toBe('19:00');
  });

  it('sát nửa đêm UTC+7 cho đúng ngày kế tiếp', () => {
    const now = new Date('2026-11-16T16:55:00Z'); // 23:55 UTC+7 ngày 16
    const [first] = suggestTimes({ count: 1, now, minLeadMinutes: 5, hours: HOURS });
    expect(first?.toISOString()).toBe('2026-11-17T02:00:00.000Z'); // 09:00 UTC+7 ngày 17
  });

  it('tôn trọng mốc `after` và tránh giờ đã có bài', () => {
    const now = new Date('2026-11-16T00:00:00Z');
    const taken = [new Date('2026-11-16T02:00:00Z')]; // 09:00 UTC+7 đã có bài
    const times = suggestTimes({ count: 2, now, minLeadMinutes: 5, hours: HOURS, taken });
    expect(times.map(vnHM)).toEqual(['12:00', '19:00']);
    const after = new Date('2026-11-20T00:00:00Z');
    const later = suggestTimes({ count: 1, now, after, minLeadMinutes: 5, hours: HOURS });
    expect(later[0]?.getTime()).toBeGreaterThan(after.getTime());
  });

  it('cấu hình rỗng → không gợi ý; yêu cầu 100 giờ vẫn ra đủ và khác nhau', () => {
    expect(suggestTimes({ count: 3, now: new Date(), minLeadMinutes: 5, hours: '' })).toEqual([]);
    const many = suggestTimes({ count: 100, now: new Date(), minLeadMinutes: 5, hours: HOURS });
    expect(many).toHaveLength(100);
    expect(new Set(many.map((t) => t.getTime())).size).toBe(100);
  });
});
