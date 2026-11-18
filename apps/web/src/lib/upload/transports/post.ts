import { UploadError, type UploadSession } from './types';

/**
 * Tải cả tệp bằng MỘT yêu cầu POST multipart/form-data tới đường dẫn ký sẵn (POST policy của kho, 014 chế độ `single`):
 * gửi mọi trường của `session.fields` rồi MỚI tới `file` (S3 yêu cầu `file` là trường cuối). Dùng XMLHttpRequest để có
 * tiến độ tải lên.
 * web-rules-ignore: lib/upload là ngoại lệ có chú thích của quy tắc "chỉ lib/api gọi mạng" (tải thẳng lên kho, không qua API).
 */
export function postFormToStorage(
  session: UploadSession,
  file: File,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const form = new FormData();
    for (const [name, value] of Object.entries(session.fields ?? {})) form.append(name, value);
    form.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', session.uploadUrl);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else if (
        xhr.status === 403 ||
        xhr.status === 408 ||
        xhr.status === 429 ||
        xhr.status >= 500
      ) {
        // 403: chính sách ký sẵn hết hạn ⇒ hàng đợi bắt đầu lại và xin đường dẫn mới.
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
    if (signal.aborted) {
      reject(new DOMException('Đã hủy', 'AbortError'));
      return;
    }
    signal.addEventListener('abort', () => {
      xhr.abort();
    });
    xhr.send(form);
  });
}
