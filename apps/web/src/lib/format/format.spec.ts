import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatRelative,
  formatTime,
  fromLocalInput,
  toLocalInput,
} from './datetime';
import { formatBytes, formatCount, formatPercent } from './number';

describe('datetime (UTC → UTC+7)', () => {
  it('nửa đêm UTC → 07:00 cùng ngày', () => {
    expect(formatTime('2026-03-10T00:00:00Z')).toBe('07:00');
    expect(formatDate('2026-03-10T00:00:00Z')).toBe('10/03/2026');
  });
  it('17:00 UTC sang ngày kế tiếp theo giờ Việt Nam', () => {
    expect(formatDateTime('2026-01-31T17:00:00Z')).toBe('00:00 01/02/2026');
  });
  it('ngày cuối tháng', () => {
    expect(formatDate('2026-02-28T10:00:00Z')).toBe('28/02/2026');
  });
  it('datetime-local ↔ ISO UTC khứ hồi', () => {
    const iso = '2026-05-05T03:30:00.000Z';
    expect(toLocalInput(iso)).toBe('2026-05-05T10:30');
    expect(fromLocalInput('2026-05-05T10:30')).toBe(iso);
  });
  it('thời gian tương đối', () => {
    const now = new Date('2026-05-05T10:00:00Z');
    expect(formatRelative('2026-05-05T09:55:00Z', now)).toBe('5 phút trước');
    expect(formatRelative('2026-05-05T08:00:00Z', now)).toBe('2 giờ trước');
    expect(formatRelative('2026-05-02T10:00:00Z', now)).toBe('3 ngày trước');
    expect(formatRelative('2026-05-05T10:00:10Z', now)).toBe('Vừa xong');
  });
});

describe('number', () => {
  it('đếm, %, byte', () => {
    expect(formatCount(1234)).toBe('1.234');
    expect(formatPercent(79.6)).toBe('80%');
    expect(formatPercent(140)).toBe('100%');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5 GB');
    expect(formatBytes(1536 * 1024)).toBe('1,5 MB');
  });
});
