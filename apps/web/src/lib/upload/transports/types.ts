// Giao diện vận chuyển tải tệp: tải THẲNG lên kho bằng đường dẫn ký sẵn, KHÔNG qua API (hiến pháp V, ADR-07a).
// API chỉ cấp đường dẫn (`start`) và nhận xác nhận hoàn tất (`complete`).

export interface UploadSession {
  /** Đường dẫn ký sẵn: bí mật tạm thời – KHÔNG lưu vào bộ lưu cục bộ, không ghi nhật ký. */
  uploadUrl: string;
  headers?: Record<string, string>;
  /** Tham chiếu để báo hoàn tất với API. */
  completionRef: string;
  /** 014: chế độ tải – một lần (POST ký sẵn) hoặc nhiều phần (PUT từng phần). Thiếu = PUT một lần (011). */
  mode?: 'single' | 'multipart';
  /** 014: trường của POST ký sẵn (chế độ `single`). Bí mật tạm thời như `uploadUrl`. */
  fields?: Record<string, string>;
  /** 014: mã phiên tải và mã media (chỉ để hỏi trạng thái / hủy; không lưu cục bộ). */
  uploadId?: string;
  mediaId?: string;
  /** 014: tải nhiều phần – cỡ phần, số phần và các phần đã có ở kho (bỏ qua khi tải). */
  partSizeBytes?: number;
  partCount?: number;
  completedParts?: readonly number[];
  /** 014: nhận lại phiên dở / phiên cũ đã hết hạn (hiện thông báo cho người dùng). */
  resumed?: boolean;
  previousExpired?: boolean;
}

/** Lỗi tải có phân loại để hàng đợi quyết định thử lại hay dừng. */
export class UploadError extends Error {
  constructor(
    message: string,
    readonly kind: 'retryable' | 'storage_full' | 'plan_expired' | 'fatal',
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

/** Kết quả cuối của một tệp sau khi máy chủ xử lý xong (014). */
export type UploadOutcome =
  | { kind: 'ready' | 'unprocessable'; mediaId: string }
  | { kind: 'duplicate'; duplicateOf: { mediaId: string; displayName: string } };

/** Điểm móc để `complete` báo tiến trình trung gian cho hàng đợi. */
export interface CompleteHooks {
  /** Đã tải xong, máy chủ đang xử lý. */
  onProcessing?: () => void;
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
  /** Báo API đã tải xong; 014: chờ tới khi máy chủ xử lý xong và trả kết quả cuối. */
  complete(
    session: UploadSession,
    file: File,
    signal: AbortSignal,
    hooks?: CompleteHooks,
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- bản 011 chỉ báo xong, không trả kết quả
  ): Promise<UploadOutcome | void>;
  /** 014: hủy lần tải (trả giữ chỗ dung lượng). Không bắt buộc. */
  cancel?(session: UploadSession): Promise<void>;
}
