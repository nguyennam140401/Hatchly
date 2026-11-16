import { useSyncExternalStore } from 'react';

// Trạng thái kết nối của ứng dụng: "mất mạng" khi trình duyệt báo offline hoặc lời gọi API gần nhất lỗi mạng.
// Dùng cho `OfflineBanner` ("Dữ liệu có thể chưa mới"); dữ liệu đã tải vẫn xem được (FR-011).

let apiReachable = true;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Gọi bởi `client.ts`: lời gọi nhận được phản hồi → online; lỗi mạng → offline. */
export function setApiReachable(reachable: boolean): void {
  if (apiReachable === reachable) return;
  apiReachable = reachable;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

function snapshot(): boolean {
  return apiReachable && navigator.onLine;
}

/** `true` khi có mạng và API trả lời được. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
