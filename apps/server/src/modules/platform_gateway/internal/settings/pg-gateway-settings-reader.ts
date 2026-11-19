import { tenantTx } from '../../../../core/db';
import { gatewaySettings } from '../db/schema';
import type { GatewaySettingsReader } from './gateway-settings';

/** Đọc toàn bộ `gateway_settings` (bảng nhỏ, dùng chung, `app` chỉ SELECT). */
export class PgGatewaySettingsReader implements GatewaySettingsReader {
  async readAll(): Promise<Record<string, unknown>> {
    const rows = await tenantTx((db) =>
      db.select({ key: gatewaySettings.key, value: gatewaySettings.value }).from(gatewaySettings),
    );
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
}
