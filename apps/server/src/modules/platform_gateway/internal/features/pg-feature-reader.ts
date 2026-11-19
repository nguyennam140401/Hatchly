import { eq } from 'drizzle-orm';
import { currentAccountId, tenantTx } from '../../../../core/db';
import { featureOverrides, gatewaySettings, type FeatureFlagKey } from '../db/schema';
import type { FeatureReader } from './feature-gate';

// Bộ đọc công tắc từ CSDL (010 R5): ghi đè theo tài khoản (`feature_overrides`, RLS) + mặc định hệ thống
// (`gateway_settings`, bảng dùng chung `app` chỉ ĐỌC). Chạy trong tài khoản của ngữ cảnh (API hay Worker); hỏi tài khoản
// khác với ngữ cảnh ⇒ ném (FeatureGate đổi thành "tắt") – không bao giờ đọc chéo tenant.

/** `flag_key` → khóa mặc định trong `gateway_settings`. */
const DEFAULT_KEY: Record<FeatureFlagKey, string> = {
  'channel.tiktok': 'channel.tiktok.enabled_default',
};

export class PgFeatureReader implements FeatureReader {
  async readOverride(accountId: string, flag: FeatureFlagKey): Promise<boolean | null> {
    if (currentAccountId() !== accountId) throw new Error('feature.account_context_mismatch');
    const [row] = await tenantTx((db) =>
      db
        .select({ value: featureOverrides.value })
        .from(featureOverrides)
        .where(eq(featureOverrides.flag_key, flag))
        .limit(1),
    );
    return row?.value ?? null;
  }

  async readDefault(flag: FeatureFlagKey): Promise<boolean> {
    const [row] = await tenantTx((db) =>
      db
        .select({ value: gatewaySettings.value })
        .from(gatewaySettings)
        .where(eq(gatewaySettings.key, DEFAULT_KEY[flag]))
        .limit(1),
    );
    // Thiếu dòng/sai kiểu ⇒ TẮT (không bao giờ bật nhầm).
    return row?.value === true;
  }
}
