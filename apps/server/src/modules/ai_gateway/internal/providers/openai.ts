import OpenAI, { toFile } from 'openai';
import {
  createProviderStream,
  instrumented,
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

// Bộ chuyển đổi OpenAI (015 T047, contracts/provider-adapter.md). SDK chỉ nhập ở thư mục này.
//
// - Lời nhắc: tiền tố cố định (hệ thống + hồ sơ + xu hướng) là các tin nhắn `system` đứng TRƯỚC; phần thay đổi (+ ảnh) là tin
//   nhắn `user` đứng SAU → tiền tố ổn định để OpenAI tự dùng bộ đệm tiền tố. Không giữ trạng thái giữa các lời gọi.
// - `inputTokens` = prompt_tokens (ĐÃ gồm phần đệm); `cachedInputTokens` = prompt_tokens_details.cached_tokens.
// - FR-025: thân yêu cầu có `store: false` (mặc định; `noTrain: false` mới bỏ cờ này).
// - FR-036: mã theo dõi đi qua tiêu đề `x-trace-id`, không nằm trong lời nhắc.
// - Không thử lại bên trong (`maxRetries: 0`); lỗi chuẩn hóa thành `ProviderCallError` (không lộ khóa/lời nhắc).
// - STT: tải `audioUrl` bằng GET rồi gửi tới `/audio/transcriptions`. Bên gọi chỉ cấp đoạn 5 phút đầu (T052).

export interface OpenAiAdapterOptions {
  /** Khóa API dạng chuỗi thường (giải bọc bí mật ở nơi nối module). */
  apiKey: string;
  baseURL?: string | undefined;
  safetyPercent?: number | undefined;
  /** Host được phép tải âm thanh (kho tệp S3 + `AI_STT_ALLOWED_HOSTS`). Rỗng = từ chối mọi URL âm thanh. */
  sttAllowedHosts?: readonly string[] | undefined;
  /** Trần số byte tải về cho một tệp âm thanh (mặc định 25 MB = giới hạn tệp của OpenAI). */
  sttMaxBytes?: number | undefined;
}

const STT_DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'mp4',
  'm4a',
  'wav',
  'webm',
  'ogg',
  'oga',
  'flac',
  'mpeg',
  'mpga',
]);
const CONTENT_TYPE_EXT: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'video/mp4': 'mp4',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
};

/** Đuôi tệp cho OpenAI: ưu tiên đuôi của đường dẫn URL, sau đó `content-type`, mặc định `mp3`. */
function audioExtension(audioUrl: string, contentType: string): string {
  try {
    const last = new URL(audioUrl).pathname.split('/').pop() ?? '';
    const ext = last.includes('.') ? last.split('.').pop()?.toLowerCase() : undefined;
    if (ext !== undefined && AUDIO_EXTENSIONS.has(ext)) return ext;
  } catch {
    /* URL đã được kiểm trước đó */
  }
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return CONTENT_TYPE_EXT[mime] ?? 'mp3';
}

/** Đọc thân phản hồi theo dòng, từ chối ngay khi vượt trần byte (không nạp cả tệp lớn vào bộ nhớ). */
async function readLimited(res: Response, max: number, provider: string): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    throw new ProviderCallError(provider, 'bad_request');
  }
  if (res.body === null) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = (await reader.read()) as {
        done: boolean;
        value: Uint8Array;
      };
      if (done) break;
      total += value.byteLength;
      if (total > max) throw new ProviderCallError(provider, 'bad_request');
      chunks.push(value);
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    throw err;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export class OpenAiAdapter implements AiProviderAdapter {
  readonly provider = 'openai';
  private readonly client: OpenAI;
  private readonly safetyPercent: number;
  private readonly allowedHosts: string[];
  private readonly sttMaxBytes: number;
  /** Chỉ có khi dựng với `baseURL` (kiểm thử với máy chủ giả). */
  private readonly testHost: string | undefined;

  constructor(opts: OpenAiAdapterOptions) {
    this.allowedHosts = (opts.sttAllowedHosts ?? []).map((h) => h.toLowerCase());
    this.sttMaxBytes = opts.sttMaxBytes ?? STT_DEFAULT_MAX_BYTES;
    this.testHost =
      opts.baseURL !== undefined ? new URL(opts.baseURL).hostname.toLowerCase() : undefined;
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      ...(opts.baseURL !== undefined ? { baseURL: opts.baseURL } : {}),
      maxRetries: 0,
    });
    this.safetyPercent = opts.safetyPercent ?? 20;
  }

  countInputTokens(_model: string, prompt: OrderedPrompt): Promise<number> {
    return Promise.resolve(estimateInputTokens(prompt.parts.join('\n'), this.safetyPercent));
  }

  private messages(p: OrderedPrompt): OpenAI.Chat.ChatCompletionMessageParam[] {
    const prefix = p.parts.slice(0, -1);
    const delta = p.parts.at(-1) ?? '';
    const system = prefix.map((content): OpenAI.Chat.ChatCompletionMessageParam => ({
      role: 'system',
      content,
    }));
    const user: OpenAI.Chat.ChatCompletionContentPart[] = [
      ...p.images.map((im): OpenAI.Chat.ChatCompletionContentPart => ({
        type: 'image_url',
        image_url: { url: im.url },
      })),
      { type: 'text', text: delta },
    ];
    return [...system, { role: 'user', content: user }];
  }

  private static usageOf(u: OpenAI.CompletionUsage | null | undefined): {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
  } {
    return {
      inputTokens: u?.prompt_tokens ?? 0,
      outputTokens: u?.completion_tokens ?? 0,
      cachedInputTokens: u?.prompt_tokens_details?.cached_tokens ?? 0,
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
      const res = await this.client.chat.completions.create(
        {
          model,
          messages: this.messages(p),
          max_completion_tokens: maxOut,
          ...(opts?.noTrain === false ? {} : { store: false }),
        },
        { signal, headers: traceHeaders(opts?.traceId) },
      );
      return {
        text: res.choices[0]?.message.content ?? '',
        ...OpenAiAdapter.usageOf(res.usage),
        modelId: res.model,
      };
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
        const chunks = await this.client.chat.completions.create(
          {
            model,
            messages: this.messages(p),
            max_completion_tokens: maxOut,
            stream: true,
            stream_options: { include_usage: true },
            ...(opts?.noTrain === false ? {} : { store: false }),
          },
          { signal, headers: traceHeaders(opts?.traceId) },
        );
        let text = '';
        let modelId = model;
        let usage: OpenAI.CompletionUsage | null | undefined;
        try {
          for await (const c of chunks) {
            modelId = c.model;
            if (c.usage !== undefined && c.usage !== null) usage = c.usage;
            const delta = c.choices[0]?.delta.content;
            if (typeof delta === 'string' && delta !== '') {
              text += delta;
              emit(delta);
            }
          }
        } catch (err) {
          throw normalizeProviderError(this.provider, err, signal);
        }
        // SDK kết thúc luồng IM LẶNG khi bị hủy → coi là lỗi để Cổng quyết toán phần đã nhận/trả giữ chỗ.
        if (signal.aborted) throw new ProviderCallError(this.provider, 'aborted');
        return { text, ...OpenAiAdapter.usageOf(usage), modelId };
      }),
    );
  }

  /**
   * Chỉ tải URL do kho tệp nội bộ cấp (SSRF): https, host nằm trong danh sách cho phép. Danh sách rỗng → từ chối mọi URL.
   * Ngoại lệ DUY NHẤT: khi dựng với `baseURL` (máy chủ giả của kiểm thử; cấu hình thật không bao giờ truyền) thì cho
   * phép host của `baseURL` kể cả http.
   */
  private assertAudioUrlAllowed(audioUrl: string): void {
    let u: URL;
    try {
      u = new URL(audioUrl);
    } catch {
      throw new ProviderCallError(this.provider, 'bad_request');
    }
    const host = u.hostname.toLowerCase();
    const testHost = this.testHost;
    if (testHost !== undefined && host === testHost && /^https?:$/.test(u.protocol)) return;
    if (u.protocol !== 'https:' || u.username !== '' || u.password !== '') {
      throw new ProviderCallError(this.provider, 'bad_request');
    }
    const ok = this.allowedHosts.some((h) => host === h || host.endsWith(`.${h}`));
    if (!ok) throw new ProviderCallError(this.provider, 'bad_request');
  }

  transcribe(
    model: string,
    audioUrl: string,
    signal: AbortSignal,
    opts?: ProviderCallOptions,
  ): Promise<ProviderResult> {
    return instrumented(this.provider, signal, async () => {
      this.assertAudioUrlAllowed(audioUrl);
      // Không theo chuyển hướng (tránh nhảy sang host ngoài danh sách); lỗi không chứa URL ký sẵn (ProviderCallError chỉ
      // có nhà cung cấp + loại + mã HTTP).
      const audio = await fetch(audioUrl, { signal, redirect: 'error' });
      if (!audio.ok) throw new ProviderCallError(this.provider, 'bad_request', audio.status);
      const bytes = await readLimited(audio, this.sttMaxBytes, this.provider);
      const contentType = audio.headers.get('content-type') ?? '';
      // Điểm cuối `/audio/transcriptions` nhận biết định dạng theo ĐUÔI tên tệp → bắt buộc có đuôi đúng.
      const ext = audioExtension(audioUrl, contentType);
      const file = await toFile(bytes, `audio.${ext}`, {
        type: contentType !== '' ? contentType : `audio/${ext}`,
      });
      const verbose = model.startsWith('whisper');
      const res = await this.client.audio.transcriptions.create(
        {
          file,
          model,
          language: 'vi',
          response_format: verbose ? 'verbose_json' : 'json',
        },
        { signal, headers: traceHeaders(opts?.traceId) },
      );
      const duration = (res as { duration?: unknown }).duration;
      return {
        text: res.text,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        modelId: model,
        ...(typeof duration === 'number' && Number.isFinite(duration)
          ? // Thời lượng thực nhà cung cấp báo (tệp được gửi nguyên, không cắt 5 phút) – Cổng AI tính tiền theo đó.
            { audioSeconds: Math.max(0, Math.ceil(duration)) }
          : {}),
      };
    });
  }
}
