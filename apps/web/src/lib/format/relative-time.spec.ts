import { describe, expect, it } from 'vitest';
import { formatDateTime, formatRelative } from './datetime';

const NOW = new Date('2026-11-16T05:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('formatRelative', () => {
  it('dưới 1 phút → "Vừa xong"', () => {
    expect(formatRelative(ago(30_000), NOW)).toBe('Vừa xong');
  });
  it('phút / giờ / ngày trước', () => {
    expect(formatRelative(ago(5 * 60_000), NOW)).toBe('5 phút trước');
    expect(formatRelative(ago(2 * 3_600_000), NOW)).toBe('2 giờ trước');
    expect(formatRelative(ago(3 * 86_400_000), NOW)).toBe('3 ngày trước');
  });
  it('tương lai → "nữa"', () => {
    expect(formatRelative(new Date(NOW.getTime() + 10 * 60_000).toISOString(), NOW)).toBe(
      '10 phút nữa',
    );
  });
  it('từ 7 ngày trở đi → ngày tuyệt đối theo UTC+7', () => {
    expect(formatRelative('2026-11-01T18:30:00Z', NOW)).toBe('02/11/2026');
  });
});

describe('định dạng thống nhất UTC+7', () => {
  it('23:30 UTC sang ngày hôm sau ở UTC+7', () => {
    expect(formatDateTime('2026-11-15T23:30:00Z')).toBe('06:30 16/11/2026');
  });
});
