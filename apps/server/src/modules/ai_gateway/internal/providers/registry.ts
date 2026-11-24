import { AnthropicAdapter } from './anthropic';
import { OpenAiAdapter } from './openai';
import { ProviderCallError } from './provider-error';
import type { AiProviderAdapter, OrderedPrompt, ProviderResult, ProviderStream } from './provider';
import { estimateInputTokens } from './token-estimate';

// Dựng bộ chuyển đổi theo `provider` của `model_routes` (015 T049). Thêm nhà cung cấp = thêm tệp bộ chuyển đổi + dòng
// vào `ADAPTER_FACTORIES` + dòng `model_routes`/`model_prices`; không sửa module gọi (FR-023).

export interface ProviderKeys {
  anthropic?: string | undefined;
  openai?: string | undefined;
}

export interface BuildOptions {
  keys: ProviderKeys;
  safetyPercent: number;
  /** Host được tải âm thanh STT (kho tệp S3 + `AI_STT_ALLOWED_HOSTS`); rỗng = từ chối mọi URL âm thanh. */
  sttAllowedHosts?: readonly string[] | undefined;
}

type Factory = (o: BuildOptions) => AiProviderAdapter | undefined;

const ADAPTER_FACTORIES: Record<string, { envName: string; build: Factory }> = {
  anthropic: {
    envName: 'ANTHROPIC_API_KEY',
    build: (o) =>
      o.keys.anthropic === undefined
        ? undefined
        : new AnthropicAdapter({ apiKey: o.keys.anthropic, safetyPercent: o.safetyPercent }),
  },
  openai: {
    envName: 'OPENAI_API_KEY',
    build: (o) =>
      o.keys.openai === undefined
        ? undefined
        : new OpenAiAdapter({
            apiKey: o.keys.openai,
            safetyPercent: o.safetyPercent,
            sttAllowedHosts: o.sttAllowedHosts,
          }),
  },
};

/**
 * Dựng LƯỜI một bộ chuyển đổi cho nhà cung cấp mà admin vừa trỏ tuyến tới sau khi khởi động. Không ném: thiếu khóa/nhà
 * cung cấp lạ → `undefined` (Cổng trả `AI_NOT_CONFIGURED`, kèm cảnh báo `ai.route_missing`).
 */
export function buildAdapterIfKeyed(name: string, o: BuildOptions): AiProviderAdapter | undefined {
  return ADAPTER_FACTORIES[name]?.build(o);
}

/**
 * Dựng bộ chuyển đổi cho đúng các nhà cung cấp của tuyến đã bật. Thiếu khóa/nhà cung cấp lạ → ném lỗi khởi động rõ ràng
 * (chỉ nêu TÊN biến môi trường, không bao giờ in giá trị khóa).
 */
export function buildAdapters(
  enabledProviders: readonly string[],
  o: BuildOptions,
): Map<string, AiProviderAdapter> {
  const out = new Map<string, AiProviderAdapter>();
  const problems: string[] = [];
  for (const name of enabledProviders) {
    const entry = ADAPTER_FACTORIES[name];
    if (entry === undefined) {
      problems.push(`nhà cung cấp "${name}" của tuyến đã bật chưa có bộ chuyển đổi`);
      continue;
    }
    const adapter = entry.build(o);
    if (adapter === undefined) {
      problems.push(`thiếu ${entry.envName} cho tuyến đã bật của nhà cung cấp "${name}"`);
      continue;
    }
    out.set(name, adapter);
  }
  if (problems.length > 0) {
    throw new Error(`AI_GATEWAY_DRIVER=real: ${problems.join('; ')}`);
  }
  return out;
}

/**
 * Bộ ước tính token cục bộ cho `countInputTokens` của Cổng ở driver `real` (không gọi mạng, không cần khóa). Mọi thao tác
 * gọi nhà cung cấp bị từ chối: lời gọi thật luôn đi qua bộ chuyển đổi chọn theo tuyến.
 */
export class LocalTokenCounter implements AiProviderAdapter {
  readonly provider = 'local';
  constructor(private readonly safetyPercent: number) {}

  countInputTokens(_model: string, prompt: OrderedPrompt): Promise<number> {
    return Promise.resolve(estimateInputTokens(prompt.parts.join('\n'), this.safetyPercent));
  }
  complete(): Promise<ProviderResult> {
    return Promise.reject(new ProviderCallError(this.provider, 'unsupported'));
  }
  stream(): ProviderStream {
    throw new ProviderCallError(this.provider, 'unsupported');
  }
  transcribe(): Promise<ProviderResult> {
    return Promise.reject(new ProviderCallError(this.provider, 'unsupported'));
  }
}
