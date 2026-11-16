import { ERROR_CODES } from '@app/shared/core';
import { describe, expect, it } from 'vitest';
import { CHANNELS, channelLabel } from './channels';
import { ERROR_EXPLANATIONS, explain } from './error-explanations';

describe('error-explanations', () => {
  it('mỗi mã trong ERROR_CODES có lời giải thích và ≥ 1 hành động', () => {
    for (const code of Object.keys(ERROR_CODES)) {
      const row = explain(code);
      expect(row, code).toBeDefined();
      expect(row?.message.length).toBeGreaterThan(0);
      expect(row?.actions.length).toBeGreaterThanOrEqual(1);
    }
    expect(Object.keys(ERROR_EXPLANATIONS).sort()).toEqual(Object.keys(ERROR_CODES).sort());
  });
  it('lời giải thích không chứa mã kỹ thuật UPPER_SNAKE_CASE', () => {
    for (const row of Object.values(ERROR_EXPLANATIONS)) {
      expect(row.message).not.toMatch(/[A-Z]{3,}_[A-Z_]+/);
    }
  });
});

describe('channels', () => {
  it('4 kênh theo thứ tự, nhãn bằng chữ', () => {
    expect(CHANNELS.map((c) => c.label)).toEqual(['Facebook', 'Instagram', 'TikTok', 'Zalo']);
    expect(channelLabel('tiktok')).toBe('TikTok');
    expect(channelLabel('khác')).toBe('khác');
  });
});
