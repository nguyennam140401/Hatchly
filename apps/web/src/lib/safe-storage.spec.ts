import { beforeEach, describe, expect, it } from 'vitest';
import { safeStorage, type SafeStorageKey } from './safe-storage';

describe('safeStorage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('ghi/đọc/xóa khóa trong danh sách trắng', () => {
    safeStorage.set('ui.sidebar.collapsed', '1');
    expect(safeStorage.get('ui.sidebar.collapsed')).toBe('1');
    safeStorage.remove('ui.sidebar.collapsed');
    expect(safeStorage.get('ui.sidebar.collapsed')).toBeNull();
  });
  it('khóa ngoài danh sách → ném lỗi', () => {
    expect(() => {
      safeStorage.set('user.email' as SafeStorageKey, 'x');
    }).toThrow();
    expect(() => safeStorage.get('token' as SafeStorageKey)).toThrow();
  });
  it('từ chối giá trị dài (không phải cờ)', () => {
    expect(() => {
      safeStorage.set('ui.posts.view', 'x'.repeat(200));
    }).toThrow();
  });
  it('clear() xóa mọi khóa của ứng dụng', () => {
    safeStorage.set('ui.posts.view', 'list');
    safeStorage.set('ui.calendar.view', 'month');
    safeStorage.clear();
    expect(safeStorage.get('ui.posts.view')).toBeNull();
    expect(safeStorage.get('ui.calendar.view')).toBeNull();
  });
});
