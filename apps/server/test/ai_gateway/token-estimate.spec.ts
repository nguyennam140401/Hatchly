import { describe, expect, it } from 'vitest';
import { estimateInputTokens } from '../../src/modules/ai_gateway/internal/providers/token-estimate';

// T016a (015, R-09, FR-003, FR-009): bộ ước tính token cục bộ – chặn trên, không gọi mạng, số nguyên.
// Công thức: ceil(utf8Bytes / 3) × (100 + safetyPercent) / 100, làm tròn LÊN (ước tính là chi phí tối đa).
// Chữ ký giả định: estimateInputTokens(text: string, safetyPercent: number): number.

const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');
/** Tham chiếu: tính bằng số nguyên để so khớp chính xác, không dùng số thực. */
const expected = (s: string, percent: number): number =>
  Math.ceil((Math.ceil(bytes(s) / 3) * (100 + percent)) / 100);

describe('estimateInputTokens', () => {
  it('chuỗi rỗng → 0', () => {
    expect(estimateInputTokens('', 20)).toBe(0);
    expect(estimateInputTokens('', 0)).toBe(0);
  });

  it('tiếng Anh ASCII: ceil(bytes/3) khi hệ số an toàn 0%', () => {
    expect(estimateInputTokens('abc', 0)).toBe(1);
    expect(estimateInputTokens('abcd', 0)).toBe(2);
    expect(estimateInputTokens('a'.repeat(300), 0)).toBe(100);
    expect(estimateInputTokens('a'.repeat(301), 0)).toBe(101);
  });

  it('tiếng Việt có dấu tính theo byte UTF-8, không theo số ký tự', () => {
    const text = 'Bánh mì thịt nướng đặc biệt, giá ưu đãi hôm nay!';
    expect(bytes(text)).toBeGreaterThan(Array.from(text).length); // có dấu → nhiều byte hơn ký tự
    expect(estimateInputTokens(text, 0)).toBe(Math.ceil(bytes(text) / 3));
    expect(estimateInputTokens(text, 20)).toBe(expected(text, 20));
  });

  it('chữ có dấu cho ước tính không thấp hơn chữ không dấu cùng số ký tự', () => {
    const accented = 'ếếếếếếếếếếếếếếếếếếếế'; // 3 byte mỗi ký tự
    const plain = 'e'.repeat(Array.from(accented).length);
    expect(estimateInputTokens(accented, 20)).toBeGreaterThan(estimateInputTokens(plain, 20));
  });

  it('emoji và ký tự ngoài BMP (4 byte) được tính theo byte', () => {
    const text = '🎉🎉🎉';
    expect(bytes(text)).toBe(12);
    expect(estimateInputTokens(text, 0)).toBe(4);
  });

  it('hệ số an toàn nhân lên và làm tròn LÊN (chặn trên)', () => {
    // 10 byte → ceil(10/3)=4 token cơ sở; +20% → 4.8 → 5.
    expect(estimateInputTokens('a'.repeat(10), 20)).toBe(5);
    // +100% → gấp đôi.
    expect(estimateInputTokens('a'.repeat(30), 100)).toBe(20);
    // +1% trên 4 token cơ sở → 4.04 → 5 (không bao giờ làm tròn xuống).
    expect(estimateInputTokens('a'.repeat(10), 1)).toBe(5);
  });

  it('luôn ≥ ceil(bytes/3) và không giảm khi hệ số an toàn tăng', () => {
    const text = 'Xin chào các bạn, hôm nay quán có món mới rất đặc biệt.';
    const base = Math.ceil(bytes(text) / 3);
    let prev = 0;
    for (const percent of [0, 5, 20, 50, 100, 500]) {
      const value = estimateInputTokens(text, percent);
      expect(value).toBeGreaterThanOrEqual(base);
      expect(value).toBeGreaterThanOrEqual(prev);
      prev = value;
    }
  });

  it('kết quả luôn là số nguyên không âm, kể cả hệ số lẻ khó chia', () => {
    for (const len of [1, 2, 7, 13, 101, 999]) {
      for (const percent of [0, 7, 20, 33]) {
        const value = estimateInputTokens('ạ'.repeat(len), percent);
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBe(expected('ạ'.repeat(len), percent));
      }
    }
  });

  it('văn bản dài vẫn là số nguyên an toàn, tỷ lệ thuận với độ dài (không tràn)', () => {
    const text = 'đ'.repeat(1_000_000); // 2 MB UTF-8
    const value = estimateInputTokens(text, 20);
    expect(Number.isSafeInteger(value)).toBe(true);
    expect(value).toBe(expected(text, 20));
  });

  it('thuần hàm: cùng đầu vào cho cùng kết quả', () => {
    const text = 'Khuyến mãi cuối tuần';
    expect(estimateInputTokens(text, 20)).toBe(estimateInputTokens(text, 20));
  });
});
