// Giao diện nhà cung cấp AI (005, contracts/ai-gateway.md mục 3; 015 contracts/provider-adapter.md). SDK thật chỉ được
// nhập trong thư mục này; kiểu dữ liệu của SDK KHÔNG ra khỏi `internal/providers/` (FR-008).

/** Lời nhắc đã ghép theo thứ tự cố định: hệ thống → hồ sơ → xu hướng tuần → phần thay đổi. */
export interface OrderedPrompt {
  task: string;
  parts: string[];
  images: { url: string; bytes: number }[];
}

export interface ProviderResult {
  text: string;
  /** TỔNG token đầu vào, gồm cả phần đọc từ bộ đệm (công thức giá trừ `cachedInputTokens` ra khỏi phần tính giá thường). */
  inputTokens: number;
  outputTokens: number;
  /** Phần đọc từ bộ đệm (giá đọc-bộ-đệm). */
  cachedInputTokens: number;
  /**
   * Phần GHI bộ đệm (Anthropic `cache_creation_input_tokens`), nằm TRONG `inputTokens`; tính giá ≈ 1,25× giá nhập
   * (xem `CACHE_WRITE_MULTIPLIER_PERCENT`). Vắng = 0.
   */
  cacheWriteInputTokens?: number;
  modelId: string;
  /** Chỉ STT: số giây âm thanh nhà cung cấp báo đã xử lý (thời lượng THỰC, không kẹp; Cổng quyết toán theo số này,
   * > 300 s → `over_estimate`; bên gọi phải cắt 5 phút đầu trước khi gửi – FR-021). */
  audioSeconds?: number;
}

/** Mức dùng đã biết khi luồng đứt giữa chừng (đính kèm `ProviderCallError.partialUsage`). */
export interface PartialUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens?: number;
}

export interface ProviderStream extends AsyncIterable<{ delta: string }> {
  /** Kết quả khi luồng kết thúc (token thực). Hủy → ném. */
  final: Promise<ProviderResult>;
}

/**
 * Tham số theo lời gọi (015 T045b).
 * - `traceId` (FR-036, hiến chương VIII): truyền xuống nhà cung cấp qua TIÊU ĐỀ yêu cầu, KHÔNG nằm trong lời nhắc.
 * - `noTrain` (FR-025, hiến chương VII): không dùng/không lưu dữ liệu để huấn luyện; MẶC ĐỊNH BẬT khi không nêu.
 */
export interface ProviderCallOptions {
  traceId?: string | undefined;
  noTrain?: boolean | undefined;
}

export interface AiProviderAdapter {
  readonly provider: string;
  /** Ước tính CỤC BỘ (chặn trên), không gọi mạng. */
  countInputTokens(model: string, prompt: OrderedPrompt): Promise<number>;
  complete(
    model: string,
    p: OrderedPrompt,
    maxOut: number,
    signal: AbortSignal,
    opts?: ProviderCallOptions,
  ): Promise<ProviderResult>;
  stream(
    model: string,
    p: OrderedPrompt,
    maxOut: number,
    signal: AbortSignal,
    opts?: ProviderCallOptions,
  ): ProviderStream;
  transcribe(
    model: string,
    audioUrl: string,
    signal: AbortSignal,
    opts?: ProviderCallOptions,
  ): Promise<ProviderResult>;
}
