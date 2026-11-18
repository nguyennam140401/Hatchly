import { UploadError, type UploadSession } from './types';

/**
 * Tải nhiều phần (014 R1, FR-004/005/006): cắt tệp thành phần 8 MiB, BỎ QUA phần đã có ở kho (`completedParts`), `PUT`
 * từng phần tới URL ký sẵn (xin theo lô ≤ 20 phần). URL hết hạn/HTTP 403 ⇒ xin lại mà không báo lỗi cho người dùng; lỗi
 * mạng thử lại từng phần 1/3/10 giây; mất mạng ⇒ ném lỗi `retryable` để hàng đợi tạm dừng và tiếp tục khi có mạng
 * (phiên được nhận lại, chỉ tải phần còn thiếu).
 */

export const PART_RETRY_DELAYS_MS: readonly number[] = [1000, 3000, 10_000];
export const PART_URL_BATCH = 20;

export interface PartUrl {
  partNumber: number;
  url: string;
  contentLength: number;
}

/** Kết quả một lần `PUT` một phần: ok · expired (URL hết hạn, xin lại) · retry (lỗi tạm) · fatal (kho từ chối). */
export type PartPutResult = 'ok' | 'expired' | 'retry' | 'fatal';

export interface MultipartDeps {
  /** Xin URL cho các phần (≤ 20) – gọi API qua `lib/api`. */
  getPartUrls: (
    session: UploadSession,
    partNumbers: readonly number[],
    signal: AbortSignal,
  ) => Promise<readonly PartUrl[]>;
  /** `PUT` một phần; báo số byte đã gửi. Mặc định dùng XMLHttpRequest. */
  putPart?: (
    url: string,
    body: Blob,
    onBytes: (loaded: number) => void,
    signal: AbortSignal,
  ) => Promise<PartPutResult>;
  wait?: (ms: number) => Promise<void>;
  isOnline?: () => boolean;
}

/**
 * web-rules-ignore: lib/upload là ngoại lệ có chú thích của quy tắc "chỉ lib/api gọi mạng" (tải thẳng lên kho, không qua API).
 */
export function putPartXhr(
  url: string,
  body: Blob,
  onBytes: (loaded: number) => void,
  signal: AbortSignal,
): Promise<PartPutResult> {
  return new Promise<PartPutResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onBytes(event.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve('ok');
      else if (xhr.status === 403) resolve('expired');
      else if (xhr.status === 408 || xhr.status === 429 || xhr.status >= 500) resolve('retry');
      else resolve('fatal');
    };
    xhr.onerror = () => {
      resolve('retry');
    };
    xhr.onabort = () => {
      reject(new DOMException('Đã hủy', 'AbortError'));
    };
    if (signal.aborted) {
      reject(new DOMException('Đã hủy', 'AbortError'));
      return;
    }
    signal.addEventListener('abort', () => {
      xhr.abort();
    });
    xhr.send(body);
  });
}

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Tải các phần còn thiếu của `file`; báo tiến độ 0–100 theo byte cộng dồn (bắt đầu từ phần đã có). */
export async function uploadMissingParts(
  session: UploadSession,
  file: File,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
  deps: MultipartDeps,
): Promise<void> {
  const partSize = session.partSizeBytes ?? 0;
  const partCount = session.partCount ?? 0;
  if (partSize <= 0 || partCount <= 0) throw new UploadError('Phiên tải không hợp lệ.', 'fatal');
  const put = deps.putPart ?? putPartXhr;
  const wait = deps.wait ?? defaultWait;
  const isOnline = deps.isOnline ?? (() => typeof navigator === 'undefined' || navigator.onLine);

  const have = new Set(session.completedParts ?? []);
  const sizeOf = (n: number): number =>
    n < partCount ? partSize : file.size - partSize * (partCount - 1);
  let doneBytes = 0;
  for (const n of have) if (n >= 1 && n <= partCount) doneBytes += sizeOf(n);
  const report = (inFlight: number) => {
    onProgress(Math.min(100, Math.floor(((doneBytes + inFlight) / file.size) * 100)));
  };
  report(0);

  const missing: number[] = [];
  for (let n = 1; n <= partCount; n += 1) if (!have.has(n)) missing.push(n);

  for (let i = 0; i < missing.length; i += PART_URL_BATCH) {
    const batch = missing.slice(i, i + PART_URL_BATCH);
    let urls = new Map<number, PartUrl>();
    const refresh = async (numbers: readonly number[]) => {
      const fresh = await deps.getPartUrls(session, numbers, signal);
      urls = new Map([...urls, ...fresh.map((p): [number, PartUrl] => [p.partNumber, p])]);
    };
    await refresh(batch);

    for (const n of batch) {
      const blob = file.slice((n - 1) * partSize, (n - 1) * partSize + sizeOf(n));
      let retries = 0;
      for (;;) {
        if (signal.aborted) throw new DOMException('Đã hủy', 'AbortError');
        if (!isOnline()) throw new UploadError('Mất kết nối khi tải lên.', 'retryable');
        const target = urls.get(n);
        if (target === undefined) {
          await refresh([n]);
          continue;
        }
        const result = await put(target.url, blob, report, signal);
        if (result === 'ok') {
          doneBytes += sizeOf(n);
          report(0);
          break;
        }
        if (result === 'expired') {
          // Hết hạn giữa chừng: xin URL mới, KHÔNG báo lỗi và không tốn lượt thử lại.
          await refresh([n]);
          continue;
        }
        if (result === 'fatal') throw new UploadError('Kho tệp từ chối tệp này.', 'fatal');
        const delay = PART_RETRY_DELAYS_MS[retries];
        if (delay === undefined) throw new UploadError('Mất kết nối khi tải lên.', 'retryable');
        retries += 1;
        report(0);
        await wait(delay);
      }
    }
  }
}
