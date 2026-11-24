import { describe, expect, it, vi } from 'vitest';
import {
  FeatureGate,
  MAX_FEATURE_CACHE_TTL_MS,
  resolveFlag,
  type FeatureReader,
} from '../../src/modules/platform_gateway/internal/features/feature-gate';
import {
  DEFAULT_GATEWAY_SETTINGS,
  GatewaySettings,
  parseGatewaySettings,
} from '../../src/modules/platform_gateway/internal/settings/gateway-settings';

// T013 (010 R5, FR-036…FR-038): công tắc = ghi đè ?? mặc định; đọc lỗi ⇒ TẮT; cache ≤ 60 giây.

describe('resolveFlag – 6 tổ hợp ghi đè × mặc định', () => {
  it.each([
    ['on', true, true],
    ['on', false, true],
    ['off', true, false],
    ['off', false, false],
    ['default', true, true],
    ['default', false, false],
  ] as const)('ghi đè %s, mặc định %s ⇒ %s', (override, def, expected) => {
    expect(resolveFlag(override, def)).toBe(expected);
  });

  it('không có dòng ghi đè (null/undefined) = theo mặc định; dạng boolean cũng đúng', () => {
    expect(resolveFlag(null, true)).toBe(true);
    expect(resolveFlag(undefined, false)).toBe(false);
    expect(resolveFlag(true, false)).toBe(true);
    expect(resolveFlag(false, true)).toBe(false);
  });
});

function reader(over: Partial<FeatureReader> = {}): FeatureReader {
  return {
    readOverride: vi.fn().mockResolvedValue(null),
    readDefault: vi.fn().mockResolvedValue(false),
    ...over,
  };
}

describe('FeatureGate', () => {
  it('mặc định tắt; ghi đè bật cho đúng một tài khoản, tài khoản khác không bị ảnh hưởng', async () => {
    const r = reader({
      readOverride: vi.fn(async (acc: string) => (acc === 'A' ? true : null)),
    });
    const gate = new FeatureGate(r);
    expect(await gate.isEnabled('A', 'channel.tiktok')).toBe(true);
    expect(await gate.isEnabled('B', 'channel.tiktok')).toBe(false);
  });

  it('đổi mặc định sang bật: tài khoản không ghi đè thấy, tài khoản ghi đè off vẫn không', async () => {
    const r = reader({
      readDefault: vi.fn().mockResolvedValue(true),
      readOverride: vi.fn(async (acc: string) => (acc === 'C' ? false : null)),
    });
    const gate = new FeatureGate(r);
    expect(await gate.isEnabled('A', 'channel.tiktok')).toBe(true);
    expect(await gate.isEnabled('C', 'channel.tiktok')).toBe(false);
  });

  it('đọc lỗi ⇒ false, không ném, gọi onReadFailed; TTL lỗi ngắn nên tự phục hồi', async () => {
    let t = 1_000;
    const failed = vi.fn();
    const readOverride = vi
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(true);
    const gate = new FeatureGate(reader({ readOverride }), {
      now: () => t,
      onReadFailed: failed,
      ttlMs: 30_000,
      errorTtlMs: 5_000,
    });
    expect(await gate.isEnabled('A', 'channel.tiktok')).toBe(false);
    expect(failed).toHaveBeenCalledTimes(1);
    // Trong 5 giây dùng kết quả lỗi đã cache (không dồn tải vào CSDL đang lỗi).
    t += 4_000;
    expect(await gate.isEnabled('A', 'channel.tiktok')).toBe(false);
    expect(readOverride).toHaveBeenCalledTimes(1);
    // Sau 5 giây đọc lại và phục hồi.
    t += 2_000;
    expect(await gate.isEnabled('A', 'channel.tiktok')).toBe(true);
  });

  it('cache theo (tài khoản, khóa) và hết hạn đúng TTL; trần TTL là 60 giây', async () => {
    let t = 0;
    const readOverride = vi.fn().mockResolvedValue(null);
    const gate = new FeatureGate(reader({ readOverride }), {
      now: () => t,
      ttlMs: 10 * MAX_FEATURE_CACHE_TTL_MS,
    });
    await gate.isEnabled('A', 'channel.tiktok');
    await gate.isEnabled('A', 'channel.tiktok');
    expect(readOverride).toHaveBeenCalledTimes(1);
    t += MAX_FEATURE_CACHE_TTL_MS + 1; // TTL cấu hình quá lớn vẫn bị chốt ở 60 giây
    await gate.isEnabled('A', 'channel.tiktok');
    expect(readOverride).toHaveBeenCalledTimes(2);
  });

  it('invalidate xóa cache ngay (bản xử lý đổi công tắc có hiệu lực tức thì)', async () => {
    const readOverride = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const gate = new FeatureGate(reader({ readOverride }), { now: () => 0 });
    expect(await gate.isEnabled('A', 'channel.tiktok')).toBe(false);
    gate.invalidate('A', 'channel.tiktok');
    expect(await gate.isEnabled('A', 'channel.tiktok')).toBe(true);
  });
});

describe('GatewaySettings', () => {
  it('khóa thiếu hoặc sai kiểu ⇒ dùng mặc định trong mã', () => {
    expect(parseGatewaySettings({})).toEqual(DEFAULT_GATEWAY_SETTINGS);
    expect(
      parseGatewaySettings({
        'channel.max_per_platform': '5', // sai kiểu (chuỗi)
        'channel.expiry_warn_days': -1, // không hợp lệ
        'channel.tiktok.enabled_default': true,
        'channel.manual_check_cooldown_sec': 30,
      }),
    ).toEqual({
      ...DEFAULT_GATEWAY_SETTINGS,
      tiktokEnabledDefault: true,
      manualCheckCooldownSec: 30,
    });
  });

  it('đọc lỗi ⇒ giữ bản cache cũ, không ném', async () => {
    let t = 0;
    const readAll = vi
      .fn()
      .mockResolvedValueOnce({ 'channel.max_per_platform': 3 })
      .mockRejectedValue(new Error('db down'));
    const s = new GatewaySettings({ readAll }, { now: () => t, ttlMs: 1_000 });
    expect((await s.get()).maxPerPlatform).toBe(3);
    t += 2_000;
    expect((await s.get()).maxPerPlatform).toBe(3);
  });

  it('đọc lỗi ngay lần đầu ⇒ mặc định', async () => {
    const s = new GatewaySettings({ readAll: vi.fn().mockRejectedValue(new Error('x')) });
    expect(await s.get()).toEqual(DEFAULT_GATEWAY_SETTINGS);
  });
});
