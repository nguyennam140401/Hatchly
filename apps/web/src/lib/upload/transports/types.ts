// Giao diện vận chuyển tải tệp: tải THẲNG lên kho bằng đường dẫn ký sẵn, KHÔNG qua API (hiến pháp V, ADR-07a).
// API chỉ cấp đường dẫn (`start`) và nhận xác nhận hoàn tất (`complete`).

export interface UploadSession {
  /** Đường dẫn ký sẵn: bí mật tạm thời – KHÔNG lưu vào bộ lưu cục bộ, không ghi nhật ký. */
  uploadUrl: string;
  headers?: Record<string, string>;
  /** Tham chiếu để báo hoàn tất với API. */
  completionRef: string;
}

/** Lỗi tải có phân loại để hàng đợi quyết định thử lại hay dừng. */
export class UploadError extends Error {
  constructor(
    message: string,
    readonly kind: 'retryable' | 'storage_full' | 'fatal',
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

export interface UploadTransport {
  /** Xin đường dẫn ký sẵn từ API. */
  start(file: File, signal: AbortSignal): Promise<UploadSession>;
  /** Tải nội dung tệp thẳng lên kho; báo tiến độ 0–100. */
  putPart(
    session: UploadSession,
    file: File,
    onProgress: (percent: number) => void,
    signal: AbortSignal,
  ): Promise<void>;
  /** Báo API đã tải xong. */
  complete(session: UploadSession, file: File, signal: AbortSignal): Promise<void>;
}
