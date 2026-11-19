// Cấu hình dùng chung của cổng (010 data-model.md mục 6). Đọc từ `platform_gateway.gateway_settings`, cache trong
// tiến trình ≤ 60 giây. Mọi giá trị có mặc định trong mã để cổng vẫn chạy khi bảng chưa nạp/đọc lỗi.

export interface GatewaySettingsValues {
  /** `channel.tiktok.enabled_default` – mặc định TẮT. */
  tiktokEnabledDefault: boolean;
  /** `channel.max_per_platform` – số kết nối tối đa mỗi nền tảng (FR-007). */
  maxPerPlatform: number;
  /** `channel.expiry_warn_days` – số ngày báo trước hết hạn (FR-020). */
  expiryWarnDays: number;
  /** `channel.manual_check_cooldown_sec` – giãn cách "Kiểm tra lại" (FR-011). */
  manualCheckCooldownSec: number;
  /** `channel.selection_ttl_sec` – hạn phiên kết nối/chọn Page (FR-004). */
  selectionTtlSec: number;
  /** `channel.check_batch_limit` – số kết nối tối đa mỗi lần quét hằng ngày. */
  checkBatchLimit: number;
}

export const DEFAULT_GATEWAY_SETTINGS: GatewaySettingsValues = {
  tiktokEnabledDefault: false,
  maxPerPlatform: 5,
  expiryWarnDays: 7,
  manualCheckCooldownSec: 20,
  selectionTtlSec: 600,
  checkBatchLimit: 500,
};

/** Nguồn dữ liệu: bản đồ `key → value` thô của bảng (hiện thực thật đọc qua giao dịch hệ thống). */
export interface GatewaySettingsReader {
  readAll(): Promise<Record<string, unknown>>;
}

const posInt = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : fallback;

/** Chuyển bản đồ thô thành giá trị có kiểu; khóa thiếu/sai kiểu ⇒ dùng mặc định (không ném). */
export function parseGatewaySettings(raw: Record<string, unknown>): GatewaySettingsValues {
  const d = DEFAULT_GATEWAY_SETTINGS;
  return {
    tiktokEnabledDefault:
      typeof raw['channel.tiktok.enabled_default'] === 'boolean'
        ? raw['channel.tiktok.enabled_default']
        : d.tiktokEnabledDefault,
    maxPerPlatform: posInt(raw['channel.max_per_platform'], d.maxPerPlatform),
    expiryWarnDays: posInt(raw['channel.expiry_warn_days'], d.expiryWarnDays),
    manualCheckCooldownSec: posInt(
      raw['channel.manual_check_cooldown_sec'],
      d.manualCheckCooldownSec,
    ),
    selectionTtlSec: posInt(raw['channel.selection_ttl_sec'], d.selectionTtlSec),
    checkBatchLimit: posInt(raw['channel.check_batch_limit'], d.checkBatchLimit),
  };
}

export class GatewaySettings {
  private cached: { values: GatewaySettingsValues; expiresAt: number } | undefined;

  constructor(
    private readonly reader: GatewaySettingsReader,
    private readonly opts: { ttlMs?: number; now?: () => number } = {},
  ) {}

  /** Cấu hình hiện hành. Đọc lỗi ⇒ giữ bản cache cũ nếu có, không thì mặc định (không bao giờ ném). */
  async get(): Promise<GatewaySettingsValues> {
    const now = (this.opts.now ?? Date.now)();
    if (this.cached !== undefined && this.cached.expiresAt > now) return this.cached.values;
    const ttl = Math.min(this.opts.ttlMs ?? 30_000, 60_000);
    try {
      const values = parseGatewaySettings(await this.reader.readAll());
      this.cached = { values, expiresAt: now + ttl };
      return values;
    } catch {
      const fallback = this.cached?.values ?? DEFAULT_GATEWAY_SETTINGS;
      // Thử lại sớm (5 giây) thay vì chờ hết TTL đầy đủ.
      this.cached = { values: fallback, expiresAt: now + Math.min(5_000, ttl) };
      return fallback;
    }
  }

  invalidate(): void {
    this.cached = undefined;
  }
}
