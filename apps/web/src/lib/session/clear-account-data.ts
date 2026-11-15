import type { QueryClient } from '@tanstack/react-query';
import { safeStorage } from '../safe-storage';
import { broadcastSessionEvent } from './tab-sync';

// Dọn MỌI dữ liệu gắn với tài khoản khi đăng xuất / hết phiên kết thúc / đổi tài khoản (FR-027, SC-008).
// Các kho trong RAM (bản nháp biểu mẫu, trạng thái tạm) tự đăng ký hàm dọn để tránh phụ thuộc vòng.

type Cleaner = () => void;
const cleaners = new Set<Cleaner>();

/** Đăng ký hàm dọn dữ liệu tài khoản; trả hàm hủy đăng ký. */
export function registerAccountDataCleaner(cleaner: Cleaner): () => void {
  cleaners.add(cleaner);
  return () => cleaners.delete(cleaner);
}

export function clearAllAccountData(client?: QueryClient): void {
  client?.clear();
  for (const cleaner of cleaners) cleaner();
  safeStorage.clear();
  try {
    window.sessionStorage.clear();
  } catch {
    // bỏ qua nếu bị chặn
  }
}

/** Đăng xuất/hết phiên có chủ đích: dọn dữ liệu tài khoản ở tab này và báo các tab khác dọn theo + về /login. */
export function endLocalSession(): void {
  clearAllAccountData();
  broadcastSessionEvent('logout');
}
