import { describe, expect, it } from 'vitest';
import { cycleBounds, weekStart } from '../../src/modules/ai_gateway/internal/budget/cycle';

// T020 (015, FR-014, Hiến chương "Quy ước dữ liệu"): chu kỳ AI theo mốc tài khoản, lặp hằng tháng; tháng không có
// ngày đó → ngày cuối tháng. Thuần hàm, không CSDL. Mọi ngày tính theo UTC+7: `at` là thời điểm UTC; 00:00 UTC+7 =
// 17:00 UTC của ngày hôm trước.

/** Thời điểm giữa trưa UTC+7 của ngày `ymd` (không lệch ngày dù chuyển múi giờ). */
const noon = (ymd: string) => new Date(`${ymd}T12:00:00+07:00`);

describe('cycleBounds – mốc 29/30/31 và tháng ngắn', () => {
  it('mốc 31: Jan 31 → Feb 28 (không nhuận) → Mar 31 → Apr 30', () => {
    expect(cycleBounds('2026-01-31', noon('2026-01-31'))).toEqual({
      cycleStart: '2026-01-31',
      cycleEnd: '2026-02-28',
    });
    expect(cycleBounds('2026-01-31', noon('2026-02-28'))).toEqual({
      cycleStart: '2026-02-28',
      cycleEnd: '2026-03-31',
    });
    expect(cycleBounds('2026-01-31', noon('2026-03-30'))).toEqual({
      cycleStart: '2026-02-28',
      cycleEnd: '2026-03-31',
    });
    expect(cycleBounds('2026-01-31', noon('2026-03-31'))).toEqual({
      cycleStart: '2026-03-31',
      cycleEnd: '2026-04-30',
    });
    expect(cycleBounds('2026-01-31', noon('2026-04-30'))).toEqual({
      cycleStart: '2026-04-30',
      cycleEnd: '2026-05-31',
    });
  });

  it('mốc 30: tháng 2 → cuối tháng 2; các tháng 31 ngày vẫn ngày 30', () => {
    expect(cycleBounds('2026-01-30', noon('2026-02-15'))).toEqual({
      cycleStart: '2026-01-30',
      cycleEnd: '2026-02-28',
    });
    expect(cycleBounds('2026-01-30', noon('2026-03-10'))).toEqual({
      cycleStart: '2026-02-28',
      cycleEnd: '2026-03-30',
    });
    expect(cycleBounds('2026-01-30', noon('2026-07-30'))).toEqual({
      cycleStart: '2026-07-30',
      cycleEnd: '2026-08-30',
    });
  });

  it('mốc 29: tháng 2 không nhuận → 28', () => {
    expect(cycleBounds('2025-01-29', noon('2026-02-10'))).toEqual({
      cycleStart: '2026-01-29',
      cycleEnd: '2026-02-28',
    });
    expect(cycleBounds('2025-01-29', noon('2026-02-28'))).toEqual({
      cycleStart: '2026-02-28',
      cycleEnd: '2026-03-29',
    });
  });

  it('mốc 1 và ngày giữa tháng: không bị kẹp', () => {
    expect(cycleBounds('2026-03-01', noon('2026-03-01'))).toEqual({
      cycleStart: '2026-03-01',
      cycleEnd: '2026-04-01',
    });
    expect(cycleBounds('2026-03-15', noon('2026-12-14'))).toEqual({
      cycleStart: '2026-11-15',
      cycleEnd: '2026-12-15',
    });
  });
});

describe('cycleBounds – năm nhuận', () => {
  it('mốc 29/02/2024 (năm nhuận): 2024-02-29 → 2024-03-29; năm 2025 tháng 2 là 28', () => {
    expect(cycleBounds('2024-02-29', noon('2024-02-29'))).toEqual({
      cycleStart: '2024-02-29',
      cycleEnd: '2024-03-29',
    });
    expect(cycleBounds('2024-02-29', noon('2025-02-27'))).toEqual({
      cycleStart: '2025-01-29',
      cycleEnd: '2025-02-28',
    });
    expect(cycleBounds('2024-02-29', noon('2025-02-28'))).toEqual({
      cycleStart: '2025-02-28',
      cycleEnd: '2025-03-29',
    });
  });

  it('mốc 31, tháng 2 năm nhuận → 29', () => {
    expect(cycleBounds('2023-12-31', noon('2024-02-10'))).toEqual({
      cycleStart: '2024-01-31',
      cycleEnd: '2024-02-29',
    });
    expect(cycleBounds('2023-12-31', noon('2024-02-29'))).toEqual({
      cycleStart: '2024-02-29',
      cycleEnd: '2024-03-31',
    });
  });
});

describe('cycleBounds – biên năm và múi giờ UTC+7', () => {
  it('qua năm: mốc 31/12 → 31/01 năm sau; mốc 15 đầu năm lùi về tháng 12 năm trước', () => {
    expect(cycleBounds('2025-12-31', noon('2026-01-05'))).toEqual({
      cycleStart: '2025-12-31',
      cycleEnd: '2026-01-31',
    });
    expect(cycleBounds('2025-06-15', noon('2026-01-05'))).toEqual({
      cycleStart: '2025-12-15',
      cycleEnd: '2026-01-15',
    });
  });

  it('ranh giới nửa đêm UTC+7: 16:59 UTC vẫn là hôm trước, 17:00 UTC là ngày mới', () => {
    // 2026-02-27 16:59:59 UTC = 2026-02-27 23:59:59 UTC+7 → còn chu kỳ bắt đầu 31/01 (kết thúc 28/02).
    expect(cycleBounds('2026-01-31', new Date('2026-02-27T16:59:59Z'))).toEqual({
      cycleStart: '2026-01-31',
      cycleEnd: '2026-02-28',
    });
    // 2026-02-27 17:00:00 UTC = 2026-02-28 00:00 UTC+7 → chu kỳ mới 28/02 → 31/03.
    expect(cycleBounds('2026-01-31', new Date('2026-02-27T17:00:00Z'))).toEqual({
      cycleStart: '2026-02-28',
      cycleEnd: '2026-03-31',
    });
  });

  it('bất biến: cycleStart ≤ hôm nay < cycleEnd, mọi ngày trong 3 năm, mọi mốc 1–31', () => {
    const pad = (n: number) => String(n).padStart(2, '0');
    for (let anchorDay = 1; anchorDay <= 31; anchorDay += 1) {
      // Chọn tháng có đủ ngày làm mốc hợp lệ (Jan 2024 có 31 ngày).
      const anchor = `2024-01-${pad(anchorDay)}`;
      let prevEnd: string | null = null;
      for (let d = 0; d < 3 * 366; d += 1) {
        const at = new Date(Date.UTC(2024, 0, 1, 12) + d * 86_400_000);
        const today = new Date(at.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
        const { cycleStart, cycleEnd } = cycleBounds(anchor, at);
        expect(cycleStart <= today).toBe(true);
        expect(today < cycleEnd).toBe(true);
        expect(cycleEnd > cycleStart).toBe(true);
        // Độ dài chu kỳ hợp lý.
        const len = (Date.parse(cycleEnd) - Date.parse(cycleStart)) / 86_400_000;
        expect(len).toBeGreaterThanOrEqual(28);
        expect(len).toBeLessThanOrEqual(31);
        // Liên tục: chu kỳ kế bắt đầu đúng tại cycleEnd của chu kỳ trước (không hở, không chồng).
        if (prevEnd !== null && cycleStart !== prevEnd) {
          const [ps] = [cycleBounds(anchor, new Date(Date.parse(`${prevEnd}T12:00:00+07:00`)))];
          expect(ps.cycleStart).toBe(prevEnd);
        }
        prevEnd = cycleEnd;
      }
    }
  });

  it('mốc không hợp lệ → ném lỗi (không đoán)', () => {
    expect(() => cycleBounds('2026-02-30', noon('2026-03-01'))).toThrow();
    expect(() => cycleBounds('hôm-qua', noon('2026-03-01'))).toThrow();
  });
});

describe('weekStart – tuần của ngân sách hệ thống', () => {
  it('thứ Hai 00:00 UTC+7', () => {
    // 2026-11-24 là thứ Ba → thứ Hai 2026-11-23.
    expect(weekStart(noon('2026-11-24'))).toBe('2026-11-23');
    expect(weekStart(noon('2026-11-23'))).toBe('2026-11-23');
    expect(weekStart(noon('2026-11-29'))).toBe('2026-11-23');
    // Chủ nhật 23:30 UTC+7 vẫn thuộc tuần cũ; 00:00 thứ Hai (17:00 UTC Chủ nhật) sang tuần mới.
    expect(weekStart(new Date('2026-11-29T16:30:00Z'))).toBe('2026-11-23');
    expect(weekStart(new Date('2026-11-29T17:00:00Z'))).toBe('2026-11-30');
  });
});
