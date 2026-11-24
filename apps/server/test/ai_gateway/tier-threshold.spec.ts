import { describe, expect, it } from 'vitest';
import {
  isBudgetBlocked,
  isBudgetExhaustedSettled,
} from '../../src/modules/ai_gateway/internal/budget/budget-store';
import { pickTier } from '../../src/modules/ai_gateway/internal/tier';

// T033 (US2, FR-012) – phần thuần hàm của chọn bậc theo ngưỡng mềm: 1,99 / 2,00 / 2,01 USD và biên blocked.
// Ca qua Cổng AI + kho thật nằm ở tier-threshold.db.spec.ts. Ngưỡng mềm đi kèm ảnh chụp (đã chụp vào dòng ngân sách).

const SOFT = 2_000_000;
const CAP = 4_000_000;
const snap = (used: number, reserved = 0) => ({ used, reserved, softLimit: SOFT });

describe('pickTier – ngưỡng mềm', () => {
  it.each(['post_generation', 'topic_suggestion'] as const)(
    '%s: 1,99 USD → default; 2,00 USD → cheap; 2,01 USD → cheap',
    (task) => {
      expect(pickTier(task, snap(1_990_000))).toBe('default');
      expect(pickTier(task, snap(2_000_000))).toBe('cheap');
      expect(pickTier(task, snap(2_010_000))).toBe('cheap');
    },
  );

  it('tính cả giữ chỗ: used + reserved quyết định', () => {
    expect(pickTier('post_generation', snap(1_000_000, 999_999))).toBe('default');
    expect(pickTier('post_generation', snap(1_000_000, 1_000_000))).toBe('cheap');
  });

  it('ngưỡng lấy từ ảnh chụp, không phải hằng số (softLimit khác 2 USD)', () => {
    const s = { used: 500_000, reserved: 0, softLimit: 500_000 };
    expect(pickTier('post_generation', s)).toBe('cheap');
    expect(pickTier('post_generation', { ...s, softLimit: 500_001 })).toBe('default');
  });

  it('bậc cố định theo loại việc, bất kể ngân sách', () => {
    for (const used of [0, 1_990_000, 3_999_999]) {
      expect(pickTier('image_labeling', snap(used))).toBe('cheap_vision');
      expect(pickTier('video_labeling', snap(used))).toBe('cheap_vision');
      expect(pickTier('trend_summary', snap(used))).toBe('cheap');
    }
  });
});

describe('biên blocked / hết ngân sách đã quyết toán (>=)', () => {
  const MIN = 1_234;
  it('used + reserved + minEstimate == cap → blocked; thiếu 1 → chưa', () => {
    expect(isBudgetBlocked({ used: CAP - MIN, reserved: 0, cap: CAP }, MIN)).toBe(true);
    expect(isBudgetBlocked({ used: CAP - MIN - 1, reserved: 0, cap: CAP }, MIN)).toBe(false);
    expect(
      isBudgetBlocked({ used: 1_000_000, reserved: CAP - 1_000_000 - MIN, cap: CAP }, MIN),
    ).toBe(true);
    expect(isBudgetBlocked({ used: CAP, reserved: 0, cap: CAP }, MIN)).toBe(true);
  });

  it('chỉ theo số đã quyết toán: đúng biên là hết, dưới biên 1 thì chưa', () => {
    expect(isBudgetExhaustedSettled({ used: CAP - MIN, cap: CAP }, MIN)).toBe(true);
    expect(isBudgetExhaustedSettled({ used: CAP - MIN - 1, cap: CAP }, MIN)).toBe(false);
  });
});
