// Công tắc tính năng theo khách hàng (010 FR-036…FR-038, R5, contracts/feature-flags.md).
// Giá trị hiệu lực = ghi đè của tài khoản ?? mặc định hệ thống. Đọc lỗi ⇒ TẮT (không bao giờ bật nhầm tính năng
// chưa được duyệt) và đếm `channel_feature_read_failed_total` để cảnh báo (T064). Cache trong tiến trình ≤ 60 giây
// CHỈ cho công tắc/cấu hình – mã quyền và trạng thái quyền KHÔNG cache (Hiến pháp).
import type { FeatureFlagKey, FeatureValue } from '../db/schema';

/** Nguồn dữ liệu của công tắc (hiện thực thật đọc `feature_overrides` + `gateway_settings` qua giao dịch). */
export interface FeatureReader {
  /** Ghi đè của tài khoản: `true|false`, `null` = không có dòng ghi đè (theo mặc định). */
  readOverride(accountId: string, flag: FeatureFlagKey): Promise<boolean | null>;
  /** Mặc định toàn hệ thống của khóa (`channel.tiktok.enabled_default`). */
  readDefault(flag: FeatureFlagKey): Promise<boolean>;
}

/**
 * Hàm THUẦN: ghi đè (`on|off|default` hoặc `true|false|null`) ⇒ giá trị hiệu lực. "theo mặc định" = không có ghi
 * đè nên dùng mặc định hệ thống.
 */
export function resolveFlag(
  override: FeatureValue | boolean | null | undefined,
  defaultEnabled: boolean,
): boolean {
  if (override === 'on' || override === true) return true;
  if (override === 'off' || override === false) return false;
  return defaultEnabled;
}

export interface FeatureGateOptions {
  /** TTL cache giá trị đọc được; ≤ 60 giây (mặc định 30). */
  ttlMs?: number;
  /** TTL cache khi đọc lỗi (ngắn để tự phục hồi nhanh; mặc định 5 giây). */
  errorTtlMs?: number;
  now?: () => number;
  /** Gọi mỗi lần đọc lỗi (chỉ số + nhật ký). KHÔNG truyền giá trị bí mật. */
  onReadFailed?: (flag: FeatureFlagKey, err: unknown) => void;
}

export const MAX_FEATURE_CACHE_TTL_MS = 60_000;

interface CacheEntry {
  value: boolean;
  expiresAt: number;
}

export class FeatureGate {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly errorTtlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly reader: FeatureReader,
    private readonly opts: FeatureGateOptions = {},
  ) {
    // Chốt trần 60 giây để cấu hình sai không làm công tắc trễ hơn cam kết "hiệu lực ≤ 1 phút" (FR-036).
    this.ttlMs = Math.min(opts.ttlMs ?? 30_000, MAX_FEATURE_CACHE_TTL_MS);
    this.errorTtlMs = Math.min(opts.errorTtlMs ?? 5_000, this.ttlMs);
    this.now = opts.now ?? Date.now;
  }

  /** Giá trị hiệu lực của công tắc cho một tài khoản. Không bao giờ ném: lỗi đọc ⇒ `false`. */
  async isEnabled(accountId: string, flag: FeatureFlagKey): Promise<boolean> {
    const key = `${accountId}:${flag}`;
    const hit = this.cache.get(key);
    const t = this.now();
    if (hit !== undefined && hit.expiresAt > t) return hit.value;
    try {
      const [override, defaultEnabled] = await Promise.all([
        this.reader.readOverride(accountId, flag),
        this.reader.readDefault(flag),
      ]);
      const value = resolveFlag(override, defaultEnabled);
      this.cache.set(key, { value, expiresAt: t + this.ttlMs });
      return value;
    } catch (err) {
      this.opts.onReadFailed?.(flag, err);
      this.cache.set(key, { value: false, expiresAt: t + this.errorTtlMs });
      return false;
    }
  }

  /** Xóa cache ngay (bản xử lý yêu cầu đổi công tắc gọi để có hiệu lực tức thì ở tiến trình này). */
  invalidate(accountId?: string, flag?: FeatureFlagKey): void {
    if (accountId === undefined) {
      this.cache.clear();
      return;
    }
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(`${accountId}:`) && (flag === undefined || key.endsWith(`:${flag}`))) {
        this.cache.delete(key);
      }
    }
  }
}
