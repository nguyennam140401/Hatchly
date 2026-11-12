/**
 * Giao diện công khai của module Cổng AI (`ai_gateway`) – 005, contracts/ai-gateway.md.
 *
 * Mọi lời gọi AI và chuyển giọng nói đi qua đây (hiến pháp III): ước tính → giữ chỗ có điều kiện →
 * đánh dấu đang gọi → gọi nhà cung cấp → quyết toán / trả lại. Kết quả và mức dùng cho khách KHÔNG BAO
 * GIỜ có số tiền – chỉ phần trăm trên trần (FR-034). Không thao tác nào nhận `accountId`.
 */

export const AI_TASKS = [
  'post_generation',
  'topic_suggestion',
  'image_labeling',
  'video_labeling',
  'transcription',
  'trend_summary',
] as const;
export type AiTask = (typeof AI_TASKS)[number];

export const MODEL_TIERS = ['default', 'cheap', 'cheap_vision', 'stt'] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

/** Lời nhắc theo thứ tự cố định (tận dụng bộ nhớ đệm lời nhắc của nhà cung cấp). */
export interface AiPrompt {
  system: string;
  businessProfile?: { versionId: string; text: string };
  weeklyTrends?: { weekStart: string; text: string };
  delta: string;
}

export interface AiRequest {
  task: AiTask;
  prompt: AiPrompt;
  /** Số nguyên 1–8 192. */
  maxOutputTokens: number;
  /** Khung hình thu nhỏ – chỉ `image_labeling`/`video_labeling`, ≤ 8. */
  images?: { url: string; bytes: number }[];
  traceId?: string;
}

export interface TranscribeRequest {
  audioUrl: string;
  durationSec: number;
  language: 'vi';
}

/** Kết quả – KHÔNG có số tiền. */
export interface AiResult {
  text: string;
  modelTier: ModelTier;
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number };
  traceId: string;
}

export interface AiStream extends AsyncIterable<{ delta: string }> {
  result: Promise<AiResult>;
  cancel(): void;
}

/** Mức dùng cho màn hình/email của khách – CHỈ phần trăm (FR-034). */
export interface AiUsage {
  /** floor((used + reserved) / cap × 100), 0..100. */
  percent: number;
  state: 'normal' | 'cheap_model' | 'blocked';
  nextCycleStartsAt: Date;
}

export interface AiGatewayPublicApi {
  generate(req: AiRequest, opts?: { signal?: AbortSignal }): Promise<AiResult>;
  generateStream(req: AiRequest): AiStream;
  transcribe(req: TranscribeRequest, opts?: { signal?: AbortSignal }): Promise<AiResult>;
  getUsage(): Promise<AiUsage>;
  /** Việc hệ thống (không thuộc tài khoản) – chỉ gọi được khi ngữ cảnh KHÔNG có accountId (FR-038). */
  readonly system: {
    generate(req: AiRequest & { task: 'trend_summary'; industryId: string }): Promise<AiResult>;
  };
}

/** Token NestJS của AiGatewayPublicApi. */
export const AI_GATEWAY = Symbol('AI_GATEWAY');
