import { UploadError, type UploadSession, type UploadTransport } from './types';

export interface SingleTransportOptions {
  /** Xin đường dẫn ký sẵn (gọi API qua `lib/api` ở tính năng sở hữu). */
  start: (file: File, signal: AbortSignal) => Promise<UploadSession>;
  /** Báo API đã tải xong. */
  complete: (session: UploadSession, file: File, signal: AbortSignal) => Promise<void>;
}

/**
 * Tải cả tệp bằng MỘT yêu cầu PUT tới đường dẫn ký sẵn. Dùng XMLHttpRequest để có tiến độ tải lên.
 * web-rules-ignore: lib/upload là ngoại lệ có chú thích của quy tắc "chỉ lib/api gọi mạng" (tải thẳng lên kho, không qua API).
 */
export function createSingleTransport(options: SingleTransportOptions): UploadTransport {
  return {
    start: options.start,
    complete: options.complete,
    putPart: (session, file, onProgress, signal) =>
      new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', session.uploadUrl);
        for (const [name, value] of Object.entries(session.headers ?? {}))
          xhr.setRequestHeader(name, value);
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            onProgress(100);
            resolve();
          } else if (xhr.status === 409 || xhr.status === 507) {
            reject(new UploadError('Kho tệp đã đầy.', 'storage_full'));
          } else if (xhr.status >= 500 || xhr.status === 408 || xhr.status === 429) {
            reject(new UploadError('Kho tệp tạm thời chưa nhận được.', 'retryable'));
          } else {
            reject(new UploadError('Kho tệp từ chối tệp này.', 'fatal'));
          }
        };
        xhr.onerror = () => {
          reject(new UploadError('Mất kết nối khi tải lên.', 'retryable'));
        };
        xhr.onabort = () => {
          reject(new DOMException('Đã hủy', 'AbortError'));
        };
        signal.addEventListener('abort', () => {
          xhr.abort();
        });
        xhr.send(file);
      }),
  };
}
