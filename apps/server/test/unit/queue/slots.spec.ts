// 003 T054 – tính khung lịch (R9, FR-026) và lịch giãn cách thử lại (R7).
import { describe, expect, it } from 'vitest';
import { retryDelaySeconds } from '../../../src/modules/queue/internal/runtime/retry-policy';
import {
  assertCron,
  currentSlot,
  defaultTz,
} from '../../../src/modules/queue/internal/scheduler/slots';

describe('currentSlot', () => {
  it('thứ Hai 05:00 Asia/Ho_Chi_Minh → slot_at = 22:00 UTC Chủ nhật, slot = …T05:00+07:00', () => {
    // 2026-11-09 là thứ Hai. Giờ CSDL: 05:00:30 giờ VN = 2026-11-08T22:00:30Z.
    const r = currentSlot('0 5 * * 1', 'Asia/Ho_Chi_Minh', new Date('2026-11-08T22:00:30Z'));
    expect(r.slotAt.toISOString()).toBe('2026-11-08T22:00:00.000Z');
    expect(r.slotAt.getUTCDay()).toBe(0); // Chủ nhật (UTC)
    expect(r.slot).toBe('2026-11-09T05:00+07:00');
  });

  it('đúng thời điểm đầu khung thuộc khung đó; trước 1 giây thuộc khung trước', () => {
    const at = new Date('2026-11-08T22:00:00Z');
    expect(currentSlot('0 5 * * 1', 'Asia/Ho_Chi_Minh', at).slot).toBe('2026-11-09T05:00+07:00');
    expect(currentSlot('0 5 * * 1', 'Asia/Ho_Chi_Minh', new Date(at.getTime() - 1000)).slot).toBe(
      '2026-11-02T05:00+07:00',
    );
  });

  it('"0 0 1 * *": tháng 30/31 ngày và tháng 2 → luôn đầu tháng (giờ VN)', () => {
    const tz = 'Asia/Ho_Chi_Minh';
    expect(currentSlot('0 0 1 * *', tz, new Date('2026-03-31T10:00:00Z')).slot).toBe(
      '2026-03-01T00:00+07:00',
    );
    expect(currentSlot('0 0 1 * *', tz, new Date('2026-04-30T10:00:00Z')).slot).toBe(
      '2026-04-01T00:00+07:00',
    );
    const feb = currentSlot('0 0 1 * *', tz, new Date('2026-02-28T16:59:59Z'));
    expect(feb.slot).toBe('2026-02-01T00:00+07:00');
    expect(currentSlot('0 0 1 * *', tz, new Date('2026-02-28T17:00:00Z')).slot).toBe(
      '2026-03-01T00:00+07:00',
    );
  });

  it('lịch phút/giờ mặc định UTC; lịch ngày/tuần/tháng mặc định Asia/Ho_Chi_Minh', () => {
    expect(defaultTz('* * * * *')).toBe('UTC');
    expect(defaultTz('*/5 * * * *')).toBe('UTC');
    expect(defaultTz('0 * * * *')).toBe('UTC');
    expect(defaultTz('30 3 * * *')).toBe('Asia/Ho_Chi_Minh');
    expect(defaultTz('0 4 1 * *')).toBe('Asia/Ho_Chi_Minh');
    expect(defaultTz('*/2 * * * * *')).toBe('UTC');
    expect(currentSlot('*/15 * * * *', 'UTC', new Date('2026-11-08T22:07:00Z')).slot).toBe(
      '2026-11-08T22:00+00:00',
    );
  });

  it('cron 6 trường (giây) chỉ khi APP_ENV=test; có giây trong slot', () => {
    expect(() => {
      assertCron('*/2 * * * * *', 'production');
    }).toThrow(/APP_ENV=test/);
    expect(() => {
      assertCron('*/2 * * * * *', 'development');
    }).toThrow(/APP_ENV=test/);
    expect(() => {
      assertCron('*/2 * * * * *', 'test');
    }).not.toThrow();
    expect(() => {
      assertCron('* * *', 'test');
    }).toThrow(/5 trường/);
    expect(() => {
      assertCron('99 * * * *', 'test');
    }).toThrow();
    expect(currentSlot('*/2 * * * * *', 'UTC', new Date('2026-11-08T22:00:03.500Z')).slot).toBe(
      '2026-11-08T22:00:02+00:00',
    );
  });
});

describe('retryDelaySeconds', () => {
  it('lần thử lại thứ k dùng phần tử k; quá mảng dùng phần tử cuối (không ngẫu nhiên khi random = 0.5)', () => {
    const mid = () => 0.5;
    expect(retryDelaySeconds('schedule', [60, 300, 900], 0, mid)).toBe(60);
    expect(retryDelaySeconds('schedule', [60, 300, 900], 1, mid)).toBe(300);
    expect(retryDelaySeconds('schedule', [60, 300, 900], 2, mid)).toBe(900);
    expect(retryDelaySeconds('schedule', [60, 300, 900], 7, mid)).toBe(900);
  });

  it('ngẫu nhiên ≤ 20%: biên dưới 0.8×, biên trên 1.2×; luôn trong khoảng với nguồn ngẫu nhiên thật', () => {
    expect(retryDelaySeconds('schedule', [100], 0, () => 0)).toBe(80);
    expect(retryDelaySeconds('schedule', [100], 0, () => 0.999999)).toBe(120);
    for (let i = 0; i < 1000; i++) {
      const d = retryDelaySeconds('schedule', [300], 0);
      expect(d).toBeGreaterThanOrEqual(240);
      expect(d).toBeLessThanOrEqual(360);
    }
  });

  it("'handler' (publish): luôn phần tử đầu, không ngẫu nhiên; không bao giờ < 1 giây", () => {
    expect(retryDelaySeconds('handler', [60, 999], 3, () => 0)).toBe(60);
    expect(retryDelaySeconds('schedule', [1], 0, () => 0)).toBe(1);
  });
});
