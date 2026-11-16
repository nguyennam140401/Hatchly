// T024 (012 US1) – quy tắc kiểm tra theo kênh: hàm thuần, thông điệp tiếng Việt, luôn có cách khắc phục.
import { describe, expect, it } from 'vitest';
import type { ChannelRule } from '../../../src/modules/content';
import {
  channelInactiveRule,
  effectiveText,
  emptyRule,
  hashtagsRule,
  mediaRequiredRule,
  textLength,
  textLengthRule,
} from '../../../src/modules/content/internal/validation/rules';
import { contentFingerprint } from '../../../src/modules/content/internal/posts.repository';

const instagram: ChannelRule = {
  channelType: 'instagram',
  maxTextLength: 2200,
  maxHashtags: 30,
  mediaRequired: true,
  maxPostsPer24h: 25,
};
const facebook: ChannelRule = {
  channelType: 'facebook_page',
  maxTextLength: 63206,
  maxHashtags: null,
  mediaRequired: false,
  maxPostsPer24h: null,
};

describe('quy tắc kiểm tra theo kênh', () => {
  it('đếm ký tự Unicode: emoji và tiếng Việt có dấu tính một ký tự, không cắt âm thầm', () => {
    expect(textLength('Xin chào 😀')).toBe(10);
    expect(textLength('a\nb')).toBe(3);
    expect(textLengthRule('😀'.repeat(2200), instagram)).toEqual([]);
    const over = textLengthRule('😀'.repeat(2201), instagram);
    expect(over).toHaveLength(1);
    expect(over[0]?.rule).toBe('text_length');
    expect(over[0]?.messageVi).toContain('rút gọn');
  });

  it('vượt giới hạn chữ kèm cách khắc phục; Facebook rộng hơn', () => {
    const long = 'a'.repeat(3000);
    expect(textLengthRule(long, instagram)[0]?.remedies.length).toBeGreaterThanOrEqual(1);
    expect(textLengthRule(long, facebook)).toEqual([]);
  });

  it('hashtag: vượt tối đa báo, không giới hạn thì bỏ qua', () => {
    const tags = Array.from({ length: 31 }, (_, i) => `t${i}`);
    expect(hashtagsRule(tags, instagram)[0]?.rule).toBe('hashtags');
    expect(hashtagsRule(tags.slice(0, 30), instagram)).toEqual([]);
    expect(hashtagsRule(tags, facebook)).toEqual([]);
  });

  it('media bắt buộc: thiếu thì báo, có thì thôi; kênh không bắt buộc không báo', () => {
    expect(mediaRequiredRule(0, instagram)[0]?.rule).toBe('media_required');
    expect(mediaRequiredRule(1, instagram)).toEqual([]);
    expect(mediaRequiredRule(0, facebook)).toEqual([]);
  });

  it('kênh không hoạt động: ngắt / hết hạn / không tìm thấy đều có "Kết nối lại" và "Bỏ kênh này khỏi bài"', () => {
    for (const status of ['disconnected', 'expired', 'unknown'] as const) {
      const [issue] = channelInactiveRule(status);
      expect(issue?.rule).toBe('channel_inactive');
      expect(issue?.remedies.map((r) => r.action)).toEqual(['reconnect', 'remove_channel']);
    }
    expect(channelInactiveRule('active')).toEqual([]);
    expect(channelInactiveRule('expiring')).toEqual([]);
  });

  it('bài rỗng: chỉ khoảng trắng và không media → báo; có media thì thôi', () => {
    expect(emptyRule('   \n ', 0)[0]?.rule).toBe('empty');
    expect(emptyRule('   ', 1)).toEqual([]);
    expect(emptyRule('x', 0)).toEqual([]);
  });

  it('nội dung hiệu lực: bản riêng khi đã tùy chỉnh, không thì nội dung chung', () => {
    expect(effectiveText({ customized: true, text: 'riêng' }, 'chung')).toBe('riêng');
    expect(effectiveText({ customized: false, text: 'bỏ qua' }, 'chung')).toBe('chung');
  });
});

describe('dấu vân tay nội dung (phát hiện "sửa nội dung" của bài đã duyệt – FR-019)', () => {
  const variant = (
    over: Partial<Parameters<typeof contentFingerprint>[0]['variants'][number]> = {},
  ) => ({
    connectionId: 'c1',
    customized: false,
    text: '',
    hashtags: [] as string[],
    media: [] as { mediaId: string; kind: 'image' | 'video' }[],
    ...over,
  });
  const base = { sharedText: 'Xin chào', variants: [variant()] };

  it('giống nhau → cùng dấu vân tay, kể cả đổi thứ tự kênh', () => {
    const a = {
      sharedText: 'x',
      variants: [variant({ connectionId: 'a' }), variant({ connectionId: 'b' })],
    };
    const b = {
      sharedText: 'x',
      variants: [variant({ connectionId: 'b' }), variant({ connectionId: 'a' })],
    };
    expect(contentFingerprint(a)).toBe(contentFingerprint(b));
  });

  it.each([
    ['chữ chung', { ...base, sharedText: 'Xin chào!' }],
    ['hashtag', { ...base, variants: [variant({ hashtags: ['moi'] })] }],
    ['media', { ...base, variants: [variant({ media: [{ mediaId: 'm', kind: 'image' }] })] }],
    ['thêm kênh', { ...base, variants: [variant(), variant({ connectionId: 'c2' })] }],
    ['bớt kênh', { ...base, variants: [] }],
    [
      'chữ riêng khi đã tùy chỉnh',
      { ...base, variants: [variant({ customized: true, text: 'riêng' })] },
    ],
  ])('đổi %s → dấu vân tay khác', (_name, changed) => {
    expect(contentFingerprint(changed)).not.toBe(contentFingerprint(base));
  });

  it('chữ riêng bị bỏ qua khi kênh chưa tùy chỉnh (không phải "sửa nội dung")', () => {
    const noisy = { ...base, variants: [variant({ customized: false, text: 'rác' })] };
    expect(contentFingerprint(noisy)).toBe(contentFingerprint(base));
  });
});
