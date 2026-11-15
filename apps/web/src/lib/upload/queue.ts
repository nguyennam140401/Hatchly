import { DEFAULT_RULES, validateFile, type UploadRules } from './validate';
import { UploadError, type UploadTransport } from './transports/types';

// Hàng đợi tải tệp (FR-021): tối đa 3 tệp đồng thời; lỗi một tệp không dừng tệp khác; thử lại giãn cách 1 s, 3 s, 10 s;
// hủy/thử lại từng tệp. KHÔNG lưu tên tệp hay đường dẫn ký sẵn vào bộ lưu cục bộ (chỉ giữ trong RAM của hàng đợi).

export const MAX_CONCURRENT_UPLOADS = 3;
export const RETRY_DELAYS_MS: readonly number[] = [1000, 3000, 10_000];

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error' | 'canceled';

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  /** 0–100. */
  progress: number;
  status: UploadStatus;
  error?: string | undefined;
  /** `invalid`: không qua kiểm tra (không thử lại được); `storage_full`: kho đầy; `failed`: lỗi tải. */
  errorKind?: 'invalid' | 'storage_full' | 'failed' | undefined;
  /** Lần thử hiện tại (0 = lần đầu). */
  attempt: number;
}

export interface UploadQueue {
  getItems: () => readonly UploadItem[];
  subscribe: (listener: () => void) => () => void;
  add: (files: readonly File[]) => void;
  cancel: (id: string) => void;
  retry: (id: string) => void;
}

export interface UploadQueueOptions {
  transport: UploadTransport;
  rules?: UploadRules;
  /** Chờ giữa các lần thử lại (kiểm thử truyền hàm giả để không chờ thật). */
  wait?: (ms: number) => Promise<void>;
}

interface Internal {
  item: UploadItem;
  file: File | null;
  controller: AbortController | null;
}

export function createUploadQueue(options: UploadQueueOptions): UploadQueue {
  const rules = options.rules ?? DEFAULT_RULES;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const entries: Internal[] = [];
  const listeners = new Set<() => void>();
  let snapshot: readonly UploadItem[] = [];
  let counter = 0;

  const emit = () => {
    snapshot = entries.map((e) => e.item);
    for (const listener of listeners) listener();
  };
  const patch = (entry: Internal, change: Partial<UploadItem>) => {
    entry.item = { ...entry.item, ...change };
    emit();
  };

  const runOne = async (entry: Internal): Promise<void> => {
    const file = entry.file;
    if (file === null) return;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      const controller = new AbortController();
      entry.controller = controller;
      patch(entry, { status: 'uploading', attempt, error: undefined, errorKind: undefined, progress: 0 });
      try {
        const session = await options.transport.start(file, controller.signal);
        await options.transport.putPart(
          session,
          file,
          (percent) => {
            patch(entry, { progress: percent });
          },
          controller.signal,
        );
        await options.transport.complete(session, file, controller.signal);
        patch(entry, { status: 'done', progress: 100 });
        return;
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
          patch(entry, { status: 'canceled' });
          return;
        }
        if (error instanceof UploadError && error.kind === 'storage_full') {
          patch(entry, { status: 'error', error: error.message, errorKind: 'storage_full' });
          return;
        }
        if (error instanceof UploadError && error.kind === 'fatal') {
          patch(entry, { status: 'error', error: error.message, errorKind: 'failed' });
          return;
        }
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined) {
          patch(entry, { status: 'error', error: 'Không tải lên được. Hãy thử lại.', errorKind: 'failed' });
          return;
        }
        await wait(delay);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- có thể bị hủy trong lúc chờ
        if (controller.signal.aborted) {
          patch(entry, { status: 'canceled' });
          return;
        }
      }
    }
  };

  const pump = () => {
    const active = entries.filter((e) => e.item.status === 'uploading').length;
    let free = MAX_CONCURRENT_UPLOADS - active;
    for (const entry of entries) {
      if (free <= 0) break;
      if (entry.item.status !== 'queued' || entry.controller !== null) continue;
      free -= 1;
      // Đánh dấu bắt đầu NGAY để vòng `pump` kế tiếp không chạy trùng.
      entry.controller = new AbortController();
      patch(entry, { status: 'uploading' });
      void runOne(entry).finally(() => {
        entry.controller = null;
        pump();
      });
    }
  };

  return {
    getItems: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    add: (files) => {
      for (const file of files) {
        counter += 1;
        const base: UploadItem = {
          id: `f${String(counter)}`,
          name: file.name,
          size: file.size,
          progress: 0,
          status: 'queued',
          attempt: 0,
        };
        const check = validateFile(file, rules);
        if (check.ok) {
          entries.push({ item: base, file, controller: null });
        } else {
          // Lỗi báo theo từng tệp; các tệp hợp lệ khác vẫn tải bình thường.
          entries.push({
            item: { ...base, status: 'error', error: check.message, errorKind: 'invalid' },
            file: null,
            controller: null,
          });
        }
      }
      emit();
      pump();
    },
    cancel: (id) => {
      const entry = entries.find((e) => e.item.id === id);
      if (entry === undefined) return;
      if (entry.controller !== null) entry.controller.abort();
      else if (entry.item.status === 'queued') patch(entry, { status: 'canceled' });
    },
    retry: (id) => {
      const entry = entries.find((e) => e.item.id === id);
      if (entry?.file == null) return;
      if (entry.item.status !== 'error' && entry.item.status !== 'canceled') return;
      entry.controller = null;
      patch(entry, { status: 'queued', progress: 0, attempt: 0, error: undefined, errorKind: undefined });
      pump();
    },
  };
}
