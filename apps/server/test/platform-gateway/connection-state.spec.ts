import { describe, expect, it } from 'vitest';
import {
  daysLeft,
  deriveState,
  isUsableState,
  toLegacyStatus,
  type DerivedState,
  type StateInput,
} from '../../src/modules/platform_gateway/internal/connections/connection-state';

// T012 (010 data-model.md "Trạng thái hiển thị", R3, R4): bảng ưu tiên của `deriveState` và bất biến
// "dùng được ⇔ state ∈ {active, expiring} ⇔ status công khai ∈ {active, expiring}".

const NOW = new Date('2026-11-18T05:00:00.000Z');
const DAY = 86_400_000;
const WARN = 7;

const page = (over: Partial<StateInput> = {}): StateInput => ({
  channelType: 'facebook_page',
  status: 'active',
  tokenExpiresAt: new Date(NOW.getTime() + 30 * DAY),
  reasonCode: null,
  sourceConnectionId: null,
  ...over,
});
const ig = (over: Partial<StateInput> = {}): StateInput =>
  page({ channelType: 'instagram', sourceConnectionId: 'src-1', ...over });
const ctx = (over: Partial<Parameters<typeof deriveState>[1]> = {}) => ({
  now: NOW,
  warnDays: WARN,
  featureEnabled: true,
  ...over,
});

describe('deriveState – bảng ưu tiên', () => {
  it('đã ngắt luôn là disconnected (trên mọi điều kiện khác)', () => {
    expect(deriveState(page({ status: 'disconnected' }), ctx())).toEqual({
      state: 'disconnected',
      reasonCode: null,
    });
    expect(
      deriveState(
        page({ channelType: 'tiktok', status: 'disconnected' }),
        ctx({ featureEnabled: false }),
      ).state,
    ).toBe('disconnected');
  });

  it('TikTok khi công tắc tắt ⇒ suspended/FEATURE_OFF, kể cả khi quyền hết hạn', () => {
    const tiktok = page({ channelType: 'tiktok', tokenExpiresAt: new Date(NOW.getTime() - DAY) });
    expect(deriveState(tiktok, ctx({ featureEnabled: false }))).toEqual({
      state: 'suspended',
      reasonCode: 'FEATURE_OFF',
    });
    // Công tắc bật lại ⇒ tự về đúng trạng thái thật (không có trạng thái "phụ" lưu trong CSDL).
    expect(deriveState(tiktok, ctx({ featureEnabled: true })).state).toBe('needs_reconnect');
  });

  it('công tắc chỉ ảnh hưởng TikTok', () => {
    expect(deriveState(page(), ctx({ featureEnabled: false })).state).toBe('active');
    expect(deriveState(ig(), ctx({ featureEnabled: false, source: page() })).state).toBe('active');
  });

  it('Instagram: Page nguồn mất/hỏng ⇒ needs_reconnect/SOURCE_PAGE_LOST', () => {
    const lost: (StateInput | null | undefined)[] = [
      null,
      undefined,
      page({ status: 'disconnected' }),
      page({ status: 'needs_reconnect', reasonCode: 'TOKEN_REVOKED' }),
      page({ status: 'ineligible' }),
      page({ tokenExpiresAt: new Date(NOW.getTime() - 1) }),
    ];
    for (const source of lost) {
      expect(deriveState(ig(), ctx({ source }))).toEqual({
        state: 'needs_reconnect',
        reasonCode: 'SOURCE_PAGE_LOST',
      });
    }
  });

  it('Instagram: Page nguồn active hoặc sắp hết hạn ⇒ Instagram theo trạng thái của chính nó', () => {
    expect(deriveState(ig(), ctx({ source: page() })).state).toBe('active');
    const expiringSource = page({ tokenExpiresAt: new Date(NOW.getTime() + 2 * DAY) });
    expect(deriveState(ig(), ctx({ source: expiringSource })).state).toBe('active');
  });

  it('Instagram không có Page nguồn (độc lập) không bị coi là mất nguồn', () => {
    expect(deriveState(ig({ sourceConnectionId: null }), ctx()).state).toBe('active');
  });

  it('Page phục hồi ⇒ Instagram tự đúng, không cấp quyền lại (FR-042)', () => {
    const broken = page({ status: 'needs_reconnect' });
    expect(deriveState(ig(), ctx({ source: broken })).state).toBe('needs_reconnect');
    expect(deriveState(ig(), ctx({ source: page() })).state).toBe('active');
  });

  it('needs_reconnect/ineligible lưu mang lý do đã lưu', () => {
    expect(
      deriveState(page({ status: 'needs_reconnect', reasonCode: 'TOKEN_REVOKED' }), ctx()),
    ).toEqual({
      state: 'needs_reconnect',
      reasonCode: 'TOKEN_REVOKED',
    });
    expect(
      deriveState(page({ status: 'ineligible', reasonCode: 'NOT_PROFESSIONAL' }), ctx()),
    ).toEqual({
      state: 'ineligible',
      reasonCode: 'NOT_PROFESSIONAL',
    });
  });

  it('hạn: quá hạn ⇒ needs_reconnect/TOKEN_EXPIRED; < warnDays ⇒ expiring; còn lại active', () => {
    expect(deriveState(page({ tokenExpiresAt: new Date(NOW.getTime()) }), ctx())).toEqual({
      state: 'needs_reconnect',
      reasonCode: 'TOKEN_EXPIRED',
    });
    expect(deriveState(page({ tokenExpiresAt: new Date(NOW.getTime() - DAY) }), ctx()).state).toBe(
      'needs_reconnect',
    );
    expect(deriveState(page({ tokenExpiresAt: new Date(NOW.getTime() + 6 * DAY) }), ctx())).toEqual(
      { state: 'expiring', reasonCode: 'TOKEN_EXPIRING' },
    );
    // Đúng ngưỡng warnDays không còn "sắp hết hạn" (< chứ không phải ≤).
    expect(
      deriveState(page({ tokenExpiresAt: new Date(NOW.getTime() + 7 * DAY) }), ctx()).state,
    ).toBe('active');
  });

  it('không có mốc hạn (Meta không hết hạn cố định) ⇒ không bao giờ expiring/hết hạn', () => {
    expect(deriveState(page({ tokenExpiresAt: null }), ctx()).state).toBe('active');
  });
});

describe('toLegacyStatus và bất biến "dùng được" (R3)', () => {
  const all: DerivedState[] = [
    'active',
    'expiring',
    'needs_reconnect',
    'ineligible',
    'suspended',
    'disconnected',
  ];

  it('ánh xạ đúng bảng', () => {
    expect(all.map((s) => [s, toLegacyStatus(s)])).toEqual([
      ['active', 'active'],
      ['expiring', 'expiring'],
      ['needs_reconnect', 'expired'],
      ['ineligible', 'expired'],
      ['suspended', 'disconnected'],
      ['disconnected', 'disconnected'],
    ]);
  });

  it('status công khai ∈ {active, expiring} ⇔ state ∈ {active, expiring} ⇔ dùng được để đăng', () => {
    for (const state of all) {
      const publicUsable = ['active', 'expiring'].includes(toLegacyStatus(state));
      expect(publicUsable).toBe(state === 'active' || state === 'expiring');
      expect(isUsableState(state)).toBe(publicUsable);
    }
  });
});

describe('daysLeft – đếm ngày theo lịch UTC+7', () => {
  it('cùng ngày lịch Việt Nam = 0; qua nửa đêm UTC+7 = 1', () => {
    // 2026-11-18 05:00Z = 12:00 UTC+7; 16:59Z cùng ngày = 23:59 UTC+7.
    expect(daysLeft(new Date('2026-11-18T16:59:00Z'), NOW)).toBe(0);
    // 17:00Z = 00:00 ngày 19 UTC+7.
    expect(daysLeft(new Date('2026-11-18T17:00:00Z'), NOW)).toBe(1);
    expect(daysLeft(new Date('2026-11-23T05:00:00Z'), NOW)).toBe(5);
  });

  it('đã qua cho giá trị âm', () => {
    expect(daysLeft(new Date('2026-11-17T05:00:00Z'), NOW)).toBe(-1);
  });
});
