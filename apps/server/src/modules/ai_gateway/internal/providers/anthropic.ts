import Anthropic from '@anthropic-ai/sdk';
import {
  instrumented,
  createProviderStream,
  normalizeProviderError,
  ProviderCallError,
  traceHeaders,
} from './provider-error';
import type {
  AiProviderAdapter,
  OrderedPrompt,
  ProviderCallOptions,
  ProviderResult,
  ProviderStream,
} from './provider';
import { estimateInputTokens } from './token-estimate';

// Bộ chuyển đổi Anthropic (015 T046, contracts/provider-adapter.md). SDK chỉ nhập ở thư mục này.
//
// - Lời nhắc: `parts = [hệ thống, hồ sơ?, xu hướng?, ..., phần thay đổi]`. Mọi phần TRƯỚC phần cuối là tiền tố cố định →
//   `system` (nhiều khối, `cache_control` ở khối CUỐI của tiền tố) để dùng prompt cache; phần thay đổi (+ ảnh khung hình)
//   nằm ở tin nhắn người dùng, SAU dấu cache. Bộ chuyển đổi không giữ trạng thái giữa các lời gọi → không trộn hồ sơ
//   nhiều tài khoản vào cùng tiền tố (mỗi lời gọi chỉ chứa hồ sơ của chính nó).
// - `inputTokens` = input_tokens + cache_read_input_tokens + cache_creation_input_tokens (TỔNG, gồm phần đệm).
// - Không thử lại bên trong (`maxRetries: 0`); mọi lỗi chuẩn hóa thành `ProviderCallError` (không lộ khóa/lời nhắc).
// - Mã theo dõi (FR-036) đi qua tiêu đề `x-trace-id`, không nằm trong lời nhắc.
// - Cờ không-huấn-luyện (FR-025): API Anthropic KHÔNG có cờ yêu cầu tương ứng (dữ liệu API thương mại mặc định không dùng để
//   huấn luyện, theo điều khoản thương mại). Cam kết nằm ở HỢP ĐỒNG với nhà cung cấp (hiến chương VII; ghi trong
//   apps/server/docs/ai-gateway-providers.md), nên `noTrain` ở đây KHÔNG thêm tiêu đề/trường giả nào.

export interface AnthropicAdapterOptions {
  /** Khóa API dạng chuỗi thường (giải bọc bí mật ở nơi nối module). */
  apiKey: string;
  /** Trỏ vào máy chủ giả khi kiểm thử; thường bỏ trống. */
  baseURL?: string | undefined;
  /** Biên an toàn cộng vào ước tính token vào (%), mặc định 20. */
  safetyPercent?: number | undefined;
}

interface SystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export class AnthropicAdapter implements AiProviderAdapter {
  readonly provider = 'anthropic';
  private readonly client: Anthropic;
  private readonly safetyPercent: number;

  constructor(opts: AnthropicAdapterOptions) {
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      ...(opts.baseURL !== undefined ? { baseURL: opts.baseURL } : {}),
      maxRetries: 0,
      // SDK 1.7 gửi khóa qua `Authorization: Bearer`; API Anthropic chuẩn dùng `x-api-key` → gửi cả hai (cùng một khóa).
      defaultHeaders: { 'x-api-key': opts.apiKey },
    });
    this.safetyPercent = opts.safetyPercent ?? 20;
  }

  countInputTokens(_model: string, prompt: OrderedPrompt): Promise<number> {
    return Promise.resolve(estimateInputTokens(prompt.parts.join('\n'), this.safetyPercent));
  }

  private body(model: string, p: OrderedPrompt, maxOut: number) {
    const prefix = p.parts.slice(0, -1);
    const delta = p.parts.at(-1) ?? '';
    const system: SystemBlock[] = prefix.map((text, i) =>
      i === prefix.length - 1
        ? { type: 'text', text, cache_control: { type: 'ephemeral' } }
        : { type: 'text', text },
    );
    const content: Anthropic.ContentBlockParam[] = [
      ...p.images.map((im): Anthropic.ContentBlockParam => ({
        type: 'image',
        source: { type: 'url', url: im.url },
      })),
      { type: 'text', text: delta },
    ];
    return {
      model,
      max_tokens: maxOut,
      ...(system.length > 0 ? { system } : {}),
      messages: [{ role: 'user' as const, content }],
    };
  }

  private static usageOf(u: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  }): {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    cacheWriteInputTokens?: number;
  } {
    const read = u.cache_read_input_tokens ?? 0;
    const created = u.cache_creation_input_tokens ?? 0;
    return {
      inputTokens: (u.input_tokens ?? 0) + read + created,
      outputTokens: u.output_tokens ?? 0,
      cachedInputTokens: read,
      // Ghi bộ đệm đắt hơn giá nhập thường (≈ 1,25×): báo riêng để quyết toán nhân hệ số (estimate.ts).
      ...(created > 0 ? { cacheWriteInputTokens: created } : {}),
    };
  }

  complete(
    model: string,
    p: OrderedPrompt,
    maxOut: number,
    signal: AbortSignal,
    opts?: ProviderCallOptions,
  ): Promise<ProviderResult> {
    return instrumented(this.provider, signal, async () => {
      const res = await this.client.messages.create(this.body(model, p, maxOut), {
        signal,
        headers: traceHeaders(opts?.traceId),
      });
      const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      return { text, ...AnthropicAdapter.usageOf(res.usage), modelId: res.model };
    });
  }

  stream(
    model: string,
    p: OrderedPrompt,
    maxOut: number,
    signal: AbortSignal,
    opts?: ProviderCallOptions,
  ): ProviderStream {
    return createProviderStream((emit) =>
      instrumented(this.provider, signal, async () => {
        const events = await this.client.messages.create(
          { ...this.body(model, p, maxOut), stream: true },
          { signal, headers: traceHeaders(opts?.traceId) },
        );
        let text = '';
        let modelId = model;
        let sawStart = false;
        const usage = {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        };
        try {
          for await (const ev of events) {
            if (ev.type === 'message_start') {
              sawStart = true;
              modelId = ev.message.model;
              usage.input_tokens = ev.message.usage.input_tokens;
              usage.cache_read_input_tokens = ev.message.usage.cache_read_input_tokens ?? 0;
              usage.cache_creation_input_tokens = ev.message.usage.cache_creation_input_tokens ?? 0;
              usage.output_tokens = ev.message.usage.output_tokens;
            } else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
              text += ev.delta.text;
              emit(ev.delta.text);
            } else if (ev.type === 'message_delta') {
              usage.output_tokens = ev.usage.output_tokens;
            }
          }
        } catch (err) {
          const e = normalizeProviderError(this.provider, err, signal);
          // Phần đầu vào đã biết từ `message_start` → đính kèm để Cổng quyết toán sát thực tế khi luồng đứt.
          if (sawStart) e.partialUsage = AnthropicAdapter.usageOf(usage);
          throw e;
        }
        // SDK kết thúc luồng IM LẶNG khi bị hủy → coi là lỗi để Cổng quyết toán phần đã nhận/trả giữ chỗ.
        if (signal.aborted) {
          const e = new ProviderCallError(this.provider, 'aborted');
          if (sawStart) e.partialUsage = AnthropicAdapter.usageOf(usage);
          throw e;
        }
        return { text, ...AnthropicAdapter.usageOf(usage), modelId };
      }),
    );
  }

  transcribe(): Promise<ProviderResult> {
    // Anthropic không có chuyển giọng nói: tuyến STT phải trỏ tới nhà cung cấp khác (OpenAI).
    return Promise.reject(new ProviderCallError(this.provider, 'unsupported'));
  }
}
