// Bộ lưu cục bộ DANH SÁCH TRẮNG: chỉ cờ giao diện, không bao giờ dữ liệu tài khoản (FR-021, SC-008).
export const SAFE_STORAGE_KEYS = [
  'ui.sidebar.collapsed',
  'ui.posts.view',
  'ui.calendar.view',
  'ui.onboarding.dismissed',
] as const;
export type SafeStorageKey = (typeof SAFE_STORAGE_KEYS)[number];

const PREFIX = 'app:';
const MAX_VALUE_LENGTH = 64;

function assertKey(key: string): asserts key is SafeStorageKey {
  if (!(SAFE_STORAGE_KEYS as readonly string[]).includes(key)) {
    throw new Error(`safe-storage: khóa "${key}" không nằm trong danh sách trắng`);
  }
}

export const safeStorage = {
  get(key: SafeStorageKey): string | null {
    assertKey(key);
    try {
      return window.localStorage.getItem(PREFIX + key);
    } catch {
      return null;
    }
  },
  set(key: SafeStorageKey, value: string): void {
    assertKey(key);
    if (value.length > MAX_VALUE_LENGTH) {
      throw new Error('safe-storage: chỉ lưu cờ/chuỗi ngắn');
    }
    try {
      window.localStorage.setItem(PREFIX + key, value);
    } catch {
      // Bộ lưu bị chặn hoặc đầy: bỏ qua – giao diện vẫn chạy.
    }
  },
  remove(key: SafeStorageKey): void {
    assertKey(key);
    try {
      window.localStorage.removeItem(PREFIX + key);
    } catch {
      // bỏ qua
    }
  },
  /** Xóa mọi khóa của ứng dụng (đăng xuất/đổi tài khoản). */
  clear(): void {
    try {
      for (const key of SAFE_STORAGE_KEYS) window.localStorage.removeItem(PREFIX + key);
    } catch {
      // bỏ qua
    }
  },
};
