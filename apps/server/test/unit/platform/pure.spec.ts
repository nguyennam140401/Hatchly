import { describe, expect, it } from 'vitest';
import {
  applyErrorMapping,
  makeClassifier,
  sanitizeRawCode,
} from '../../../src/modules/platform_gateway/internal/adapters/classify';
import {
  contentHashOf,
  normalizeText,
} from '../../../src/modules/platform_gateway/internal/adapters/content-hash';
import { validateMedia } from '../../../src/modules/platform_gateway/internal/adapters/media-rules';
import { FAKE_CHANNELS, FAKE_ERROR_TABLE } from '../../../src/modules/platform_gateway/internal/fake/channels';
import type { ClassifiedError, MediaRules } from '../../../src/modules/platform_gateway';

// 005 T025: hàm thuần của Cổng nền tảng – dấu nội dung (R4), phân loại + ánh xạ đè (R5), quy tắc media.

describe('content-hash', () => {
  it('chuẩn hóa: NFC, URL → <url>, bỏ ký tự vô hình, NBSP → cách, gộp khoảng trắng, không hạ chữ', () => {
    expect(normalizeText('  A b​  c https://x.vn/a?b=1  Đ\n')).toBe('A b c <url> Đ');
    expect(normalizeText('é')).toBe('é');
    expect(normalizeText('ABC')).toBe('ABC');
  });
  it('dấu có tiền tố ch1: và tất định; bước riêng của bộ chuyển đổi', () => {
    expect(contentHashOf('x')).toBe(contentHashOf(' x '));
    expect(contentHashOf('x')).toMatch(/^ch1:[0-9a-f]{64}$/);
    expect(contentHashOf('a #tag', (t) => t.replace(/\s#\w+$/, ''))).toBe(contentHashOf('a'));
  });
});

describe('classify', () => {
  const classify = makeClassifier('facebook_page', FAKE_ERROR_TABLE);
  it('mã trong bảng → loại đúng; transient có retryAfterSec', () => {
    expect(classify('FAKE_RATE_LIMIT')).toMatchObject({ category: 'transient', retryAfterSec: 60 });
    expect(classify('FAKE_TOKEN_EXPIRED')).toMatchObject({ category: 'user_action' });
    expect(classify('FAKE_TOKEN_EXPIRED').retryAfterSec).toBeUndefined();
  });
  it('mã ngoài bảng → unknown + check_on_platform', () => {
    expect(classify('X')).toMatchObject({ category: 'unknown', remedies: [{ action: 'check_on_platform' }] });
  });
  it('sanitizeRawCode: lọc ký tự lạ, cắt 64, rỗng → UNKNOWN', () => {
    expect(sanitizeRawCode('a b<c>/d:e.f-g_h')).toBe('abcd:e.f-g_h');
    expect(sanitizeRawCode('x'.repeat(100))).toHaveLength(64);
    expect(sanitizeRawCode('<>')).toBe('UNKNOWN');
  });
  it('applyErrorMapping: khớp → thay category/messageVi/remedies, giữ rawCode/channelType; không khớp → giữ', () => {
    const err: ClassifiedError = classify('X_CODE');
    const row = {
      channelType: 'facebook_page' as const,
      rawCode: 'X_CODE',
      category: 'user_action' as const,
      messageVi: 'Đã đổi',
      remedies: [{ action: 'edit_text' as const, labelVi: 'Sửa' }] as ClassifiedError['remedies'],
    };
    expect(applyErrorMapping(err, row)).toEqual({ ...err, category: 'user_action', messageVi: 'Đã đổi', remedies: row.remedies });
    expect(applyErrorMapping(err, { ...row, rawCode: 'KHAC' })).toBe(err);
    expect(applyErrorMapping(err, { ...row, channelType: 'instagram' })).toBe(err);
    expect(applyErrorMapping(err)).toBe(err);
  });
});

describe('validateMedia', () => {
  const rules = FAKE_CHANNELS.instagram!.mediaRules;
  const img = { mediaId: 'i', kind: 'image' as const, format: 'jpeg', bytes: 1000, width: 1000, height: 1000 };
  const rule = (items: Parameters<typeof validateMedia>[1], r: MediaRules = rules) =>
    validateMedia(r, items).map((v) => v.rule);
  it('hợp lệ → không vi phạm', () => {
    expect(rule([img])).toEqual([]);
  });
  it('từng quy tắc: format, size, duration, aspect, count, mixed', () => {
    expect(rule([{ ...img, format: 'png' }])).toEqual(['format']);
    expect(rule([{ ...img, bytes: 9e9 }])).toEqual(['size']);
    expect(
      rule([{ mediaId: 'v', kind: 'video', format: 'mp4', bytes: 1, width: 1080, height: 1080, durationSec: 5000 }]),
    ).toEqual(['duration']);
    expect(rule([{ ...img, width: 3000, height: 1000 }])).toEqual(['aspect']);
    expect(rule(Array.from({ length: 11 }, () => img))).toContain('count');
    expect(
      rule(
        [img, { mediaId: 'v', kind: 'video', format: 'mp4', bytes: 1, width: 1, height: 1, durationSec: 1 }],
        FAKE_CHANNELS.zalo_oa!.mediaRules,
      ),
    ).toEqual(['mixed', 'format']);
    const v = validateMedia(rules, [{ ...img, bytes: 9e9 }])[0]!;
    expect(v.messageVi).toMatch(/Tệp quá lớn/);
    expect(v.limit).toBe(rules.image!.maxBytes);
    expect(v.actual).toBe(9e9);
  });
});
