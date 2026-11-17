import { DEFAULT_RULES, validateFile, type UploadRules } from './validate';
import { UploadError, type UploadSession, type UploadTransport } from './transports/types';

// Hàng đợi tải tệp (FR-021, 014 FR-007): tối đa 3 tệp đồng thời; lỗi một tệp không dừng tệp khác; thử lại giãn cách
// 1 s, 3 s, 10 s; hủy/thử lại từng tệp; mất mạng ⇒ "Tạm dừng – đang chờ mạng" rồi tự tiếp tục khi có mạng.
// KHÔNG lưu tên tệp, đường dẫn ký sẵn, mã phiên tải vào bộ lưu cục bộ (chỉ giữ trong RAM của hàng đợi).

export const MAX_CONCURRENT_UPLOADS = 3;
export const RETRY_DELAYS_MS: readonly number[] = [1000, 3000, 10_000];

export type UploadStatus =
  | 'queued'
  | 'uploading'
  /** 014: mất mạng giữa chừng – tự tiếp tục khi có mạng, không cần bấm. */
  | 'waiting_network'
  /** 014: đã tải xong, máy chủ đang xử lý (chuẩn hóa, ảnh thu nhỏ). */
  | 'processing'
  | 'done'
  /** 014: tệp trùng nội dung với tệp đã có trong thư viện. */
  | 'duplicate'
  | 'error'
  | 'canceled';

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  /** 0–100. */
  progress: number;
  status: UploadStatus;
  error?: string | undefined;
  /**
   * `invalid`: không qua kiểm tra (không thử lại được); `storage_full`: kho đầy; `plan_expired`: gói hết hạn;
   * `failed`: lỗi tải.
   */
  errorKind?: 'invalid' | 'storage_full' | 'plan_expired' | 'failed' | undefined;
  /** Lần thử hiện tại (0 = lần đầu). */
  attempt: number;
  /** 014: mã media (khi máy chủ đã nhận) và kết quả cuối ở trạng thái `done`. */
  mediaId?: string | undefined;
  mediaStatus?: 'ready' | 'unprocessable' | undefined;
  /** 014: tệp đã có – hiện "Xem tệp đã có". */
  duplicateOf?: { mediaId: string; displayName: string } | undefined;
  /** 014: thông báo không phải lỗi (vd "Lần tải trước đã hết hạn, đang tải lại từ đầu"). */
  notice?: string | undefined;
}

export interface UploadQueue {
  getItems: () => readonly UploadItem[];
  subscribe: (listener: () => void) => () => void;
  add: (files: readonly File[]) => void;
  cancel: (id: string) => void;
  retry: (id: string) => void;
  /** 014: gỡ một dòng đã kết thúc khỏi hàng (đóng thông báo "đã có", tệp bị từ chối…). */
  dismiss: (id: string) => void;
}

export interface UploadQueueOptions {
  transport: UploadTransport;
  rules?: UploadRules;
  /** Chờ giữa các lần thử lại (kiểm thử truyền hàm giả để không chờ thật). */
  wait?: (ms: number) => Promise<void>;
  /** Đang có mạng không (mặc định `navigator.onLine`). */
  isOnline?: () => boolean;
  /** Chờ tới khi có mạng trở lại (mặc định nghe sự kiện `online`); hủy qua `signal`. */
  waitOnline?: (signal: AbortSignal) => Promise<void>;
  /** Gọi khi một tệp kết thúc thành công/trùng (để làm mới lưới thư viện). */
  onSettled?: (item: UploadItem) => void;
}

interface Internal {
  item: UploadItem;
  file: File | null;
  controller: AbortController | null;
  session: UploadSession | null;
}

const defaultIsOnline = (): boolean => typeof navigator === 'undefined' || navigator.onLine;

const defaultWaitOnline = (signal: AbortSignal): Promise<void> =>
  new Promise<void>((resolve) => {
    const done = () => {
      window.removeEventListener('online', done);
      signal.removeEventListener('abort', done);
      resolve();
    };
    window.addEventListener('online', done);
    signal.addEventListener('abort', done);
  });

export function createUploadQueue(options: UploadQueueOptions): UploadQueue {
  const rules = options.rules ?? DEFAULT_RULES;
  const wait =
    options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const isOnline = options.isOnline ?? defaultIsOnline;
  const waitOnline = options.waitOnline ?? defaultWaitOnline;
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

  /** Hủy lần tải ở máy chủ (trả giữ chỗ); lỗi mạng ở đây không quan trọng – phiên tự hết hạn sau 24 giờ. */
  const cancelRemote = (entry: Internal) => {
    const session = entry.session;
    if (session === null || options.transport.cancel === undefined) return;
    void options.transport.cancel(session).catch(() => undefined);
  };

  const runOne = async (entry: Internal): Promise<void> => {
    const file = entry.file;
    if (file === null) return;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      const controller = new AbortController();
      entry.controller = controller;
      patch(entry, {
        status: 'uploading',
        attempt,
        error: undefined,
        errorKind: undefined,
        progress: 0,
      });
      try {
        const session = await options.transport.start(file, controller.signal);
        entry.session = session;
        patch(entry, {
          mediaId: session.mediaId,
          notice: session.previousExpired
            ? 'Lần tải trước đã hết hạn, đang tải lại từ đầu.'
            : undefined,
        });
        await options.transport.putPart(
          session,
          file,
          (percent) => {
            patch(entry, { progress: percent });
          },
          controller.signal,
        );
        const outcome = await options.transport.complete(session, file, controller.signal, {
          onProcessing: () => {
            patch(entry, { status: 'processing', progress: 100 });
          },
        });
        const result = outcome ?? undefined;
        if (result?.kind === 'duplicate') {
          patch(entry, { status: 'duplicate', progress: 100, duplicateOf: result.duplicateOf });
        } else {
          patch(entry, {
            status: 'done',
            progress: 100,
            ...(result !== undefined ? { mediaId: result.mediaId, mediaStatus: result.kind } : {}),
          });
        }
        options.onSettled?.(entry.item);
        return;
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          patch(entry, { status: 'canceled' });
          return;
        }
        if (error instanceof UploadError && error.kind === 'storage_full') {
          patch(entry, { status: 'error', error: error.message, errorKind: 'storage_full' });
          return;
        }
        if (error instanceof UploadError && error.kind === 'plan_expired') {
          patch(entry, { status: 'error', error: error.message, errorKind: 'plan_expired' });
          return;
        }
        if (error instanceof UploadError && error.kind === 'fatal') {
          patch(entry, { status: 'error', error: error.message, errorKind: 'failed' });
          return;
        }
        if (!isOnline()) {
          // Mất mạng: tạm dừng, KHÔNG tốn lượt thử lại; có mạng thì tiếp tục (phiên được nhận lại, chỉ tải phần thiếu).
          patch(entry, { status: 'waiting_network' });
          await waitOnline(controller.signal);
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- có thể bị hủy trong lúc chờ
          if (controller.signal.aborted) {
            patch(entry, { status: 'canceled' });
            return;
          }
          attempt -= 1;
          continue;
        }
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined) {
          patch(entry, {
            status: 'error',
            error: 'Tệp bị lỗi khi tải. Hãy thử lại.',
            errorKind: 'failed',
          });
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

  const ACTIVE: readonly UploadStatus[] = ['uploading', 'waiting_network', 'processing'];

  const pump = () => {
    const active = entries.filter((e) => ACTIVE.includes(e.item.status)).length;
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
          entries.push({ item: base, file, controller: null, session: null });
        } else {
          // Lỗi báo theo từng tệp; các tệp hợp lệ khác vẫn tải bình thường.
          entries.push({
            item: { ...base, status: 'error', error: check.message, errorKind: 'invalid' },
            file: null,
            controller: null,
            session: null,
          });
        }
      }
      emit();
      pump();
    },
    cancel: (id) => {
      const entry = entries.find((e) => e.item.id === id);
      if (entry === undefined) return;
      if (entry.controller !== null) {
        entry.controller.abort();
        cancelRemote(entry);
      } else if (entry.item.status === 'queued') patch(entry, { status: 'canceled' });
    },
    retry: (id) => {
      const entry = entries.find((e) => e.item.id === id);
      if (entry?.file == null) return;
      if (entry.item.status !== 'error' && entry.item.status !== 'canceled') return;
      entry.controller = null;
      entry.session = null;
      patch(entry, {
        status: 'queued',
        progress: 0,
        attempt: 0,
        error: undefined,
        errorKind: undefined,
        notice: undefined,
      });
      pump();
    },
    dismiss: (id) => {
      const index = entries.findIndex((e) => e.item.id === id);
      const entry = entries[index];
      if (
        entry === undefined ||
        ACTIVE.includes(entry.item.status) ||
        entry.item.status === 'queued'
      ) {
        return;
      }
      entries.splice(index, 1);
      emit();
    },
  };
}
