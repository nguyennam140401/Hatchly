import { stagingFakesInUse } from '../config/assert-no-fakes';
import type { AppConfig } from '../config/config.schema';
import { ConfigError } from '../config/config-error';
import { resolveMailConfig } from '../config/mail-config';
import type { DatabaseService } from '../db/database';
import { isConnectionError } from '../db/errors';

// Lựa chọn bản cài đặt của 4 điểm phụ thuộc + email (005, contracts/runtime-config.md mục 2, US6-AS1).
// API và Worker đọc cùng biến môi trường → cùng lựa chọn; mỗi đơn vị ghi một dòng `gateways.selected`.

export interface GatewaySelection {
  platform: 'fake' | 'real' | 'unset';
  ai: 'fake' | 'real' | 'unset';
  notifications: 'fake' | 'unset';
  storage: 'memory' | 's3' | 'unset';
  mail: 'memory' | 'smtp' | 'unset';
  fakeState: 'memory' | 'sandbox' | 'none';
}

/** Đọc lựa chọn từ cấu hình đã kiểm (không có giá trị bí mật nào). */
export function readGatewaySelection(config: AppConfig): GatewaySelection {
  let mail: GatewaySelection['mail'];
  try {
    mail = resolveMailConfig(config, { defaultToMemory: true }).transport;
  } catch {
    mail = 'unset';
  }
  return {
    platform: config.PLATFORM_GATEWAY_DRIVER ?? 'unset',
    ai: config.AI_GATEWAY_DRIVER ?? 'unset',
    notifications: config.NOTIFICATIONS_DRIVER ?? 'unset',
    storage: config.STORAGE_DRIVER ?? 'unset',
    mail,
    fakeState: config.FAKE_STATE_STORE ?? 'none',
  };
}

/** Ghi một dòng nhật ký có cấu trúc `gateways.selected`. */
export function logGatewaySelection(
  logger: { log: (message: unknown) => void },
  selection: GatewaySelection,
): void {
  logger.log({ msg: 'gateways.selected', ...selection });
}

/**
 * 007 (R15): ở `staging` có `STAGING_ALLOW_FAKES=true` mà còn driver `fake` → một dòng cảnh báo có cấu trúc
 * `gateways.fakes_enabled_in_staging` (tên driver, không có bí mật). Không làm gì nếu không áp dụng.
 */
export function logStagingFakes(
  logger: { warn: (message: unknown) => void },
  config: AppConfig,
): void {
  const drivers = stagingFakesInUse(config);
  if (drivers.length > 0) logger.warn({ msg: 'gateways.fakes_enabled_in_staging', drivers });
}

/** Thông điệp khi thiếu schema sandbox (dùng lại trong kiểm thử). */
export const SANDBOX_MISSING_MESSAGE = 'Chưa có schema sandbox – chạy `pnpm db:setup`';

/**
 * `FAKE_STATE_STORE=sandbox` mà CSDL chưa có bảng giả lập → `ConfigError` (tiến trình dừng). CSDL chưa
 * kết nối được lúc khởi động → bỏ qua (như DatabaseModule: không chặn khởi động, `/readyz` báo 503).
 */
export async function assertSandboxSchemaReady(
  config: AppConfig,
  db: DatabaseService,
  logger?: { warn: (message: unknown) => void },
): Promise<void> {
  if (config.FAKE_STATE_STORE !== 'sandbox') return;
  const pool = db.pool('app');
  if (pool === undefined) return;
  let ready: boolean;
  try {
    const client = await pool.connect();
    try {
      const r = await client.query<{ ok: boolean }>(
        "SELECT to_regclass('sandbox.fake_scenarios') IS NOT NULL AS ok",
      );
      ready = r.rows[0]?.ok === true;
    } finally {
      client.release();
    }
  } catch (err) {
    if (isConnectionError(err)) {
      logger?.warn({ msg: 'gateways.sandbox_check_skipped', reason: 'db_unavailable' });
      return;
    }
    throw err;
  }
  if (!ready) {
    throw new ConfigError(
      [{ variable: 'FAKE_STATE_STORE', reason: 'schema sandbox chưa có' }],
      SANDBOX_MISSING_MESSAGE,
    );
  }
}
