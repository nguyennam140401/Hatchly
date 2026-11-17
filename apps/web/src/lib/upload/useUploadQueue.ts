import { useMemo, useSyncExternalStore } from 'react';
import {
  createUploadQueue,
  type UploadItem,
  type UploadQueue,
  type UploadQueueOptions,
} from './queue';

/** Hàng đợi tải tệp cho một màn hình; tự theo dõi trạng thái bằng `useSyncExternalStore`. */
export function useUploadQueue(options: UploadQueueOptions): {
  queue: UploadQueue;
  items: readonly UploadItem[];
} {
  const { transport, rules, wait, isOnline, waitOnline, onSettled } = options;
  const queue = useMemo(
    () =>
      createUploadQueue({
        transport,
        ...(rules !== undefined ? { rules } : {}),
        ...(wait !== undefined ? { wait } : {}),
        ...(isOnline !== undefined ? { isOnline } : {}),
        ...(waitOnline !== undefined ? { waitOnline } : {}),
        ...(onSettled !== undefined ? { onSettled } : {}),
      }),
    [transport, rules, wait, isOnline, waitOnline, onSettled],
  );
  const items = useSyncExternalStore(queue.subscribe, queue.getItems, queue.getItems);
  return { queue, items };
}
