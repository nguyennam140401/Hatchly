// Giao diện nhà cung cấp AI (005, contracts/ai-gateway.md mục 3). SDK thật (chốt sau POC-1/POC-4) chỉ được
// nhập trong thư mục này; kiểu dữ liệu của SDK KHÔNG ra khỏi `internal/providers/` (FR-008).

/** Lời nhắc đã ghép theo thứ tự cố định: hệ thống → hồ sơ → xu hướng tuần → phần thay đổi. */
export interface OrderedPrompt {
  task: string;
  parts: string[];
  images: { url: string; bytes: number }[];
}

export interface ProviderResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  modelId: string;
}

export interface ProviderStream extends AsyncIterable<{ delta: string }> {
  /** Kết quả khi luồng kết thúc (token thực). Hủy → ném. */
  final: Promise<ProviderResult>;
}

export interface AiProviderAdapter {
  readonly provider: string;
  countInputTokens(model: string, prompt: OrderedPrompt): Promise<number>;
  complete(model: string, p: OrderedPrompt, maxOut: number, signal: AbortSignal): Promise<ProviderResult>;
  stream(model: string, p: OrderedPrompt, maxOut: number, signal: AbortSignal): ProviderStream;
  transcribe(model: string, audioUrl: string, signal: AbortSignal): Promise<ProviderResult>;
}
