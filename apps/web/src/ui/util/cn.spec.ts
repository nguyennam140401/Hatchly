import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('giữ cỡ chữ riêng khi đi cùng màu chữ', () => {
    expect(cn('text-body text-ink')).toBe('text-body text-ink');
    expect(cn('text-label text-brand', 'text-caption')).toContain('text-caption');
  });
  it('lớp sau thắng khi xung đột thật', () => {
    expect(cn('px-3', 'px-4')).toBe('px-4');
    expect(cn('text-ink', 'text-brand')).toBe('text-brand');
    expect(cn('text-body', 'text-caption')).toBe('text-caption');
  });
  it('khoảng cách/bo góc riêng không bị xóa nhầm', () => {
    expect(cn('min-h-touch', 'h-topbar')).toBe('min-h-touch h-topbar');
    expect(cn('rounded-md', 'rounded-pill')).toBe('rounded-pill');
  });
});
