import type { DynamicModule, Type } from '@nestjs/common';
import { AccountModule } from '../modules/account';
import { AiGatewayModule } from '../modules/ai_gateway';
import { ApprovalModule } from '../modules/approval';
import { ContentModule } from '../modules/content';
import { ContextModule } from '../modules/context';
import { MediaModule } from '../modules/media';
import { NotificationsModule } from '../modules/notifications';
import { PlatformGatewayModule } from '../modules/platform_gateway';
import { PublishingModule } from '../modules/publishing';
import { QueueModule } from '../modules/queue';
import { TrendsModule } from '../modules/trends';
import { getManifest, modulesFor } from './manifest';

// Tầng ghép: nơi DUY NHẤT (cùng api.ts / worker.ts) được nhập index.ts của mọi module (FR-012).
// Thêm module: thêm vào modules.manifest.json, tạo thư mục theo khuôn, thêm một dòng ở đây.

export const MODULE_REGISTRY: Readonly<Record<string, Type>> = {
  account: AccountModule,
  context: ContextModule,
  media: MediaModule,
  trends: TrendsModule,
  content: ContentModule,
  approval: ApprovalModule,
  publishing: PublishingModule,
  platform_gateway: PlatformGatewayModule,
  ai_gateway: AiGatewayModule,
  notifications: NotificationsModule,
  queue: QueueModule,
};

/** Kiểm tra registry khớp tệp kê khai – lệch thì dừng khởi động. */
export function assertRegistryMatchesManifest(): void {
  const declared = getManifest().modules.map((m) => m.name);
  const registered = Object.keys(MODULE_REGISTRY);
  const missing = declared.filter((n) => !registered.includes(n));
  const extra = registered.filter((n) => !declared.includes(n));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `module-registry.ts lệch modules.manifest.json – thiếu: [${missing.join(', ')}], thừa: [${extra.join(', ')}]`,
    );
  }
}

/** Module có cấu hình theo đơn vị (vd account: controller xác thực chỉ ở API). */
type UnitAwareModule = Type & { forUnit?: (unit: 'api' | 'worker') => DynamicModule };

/** Các module NestJS chạy ở một đơn vị, lọc theo `runsIn`. */
export function buildModules(unit: 'api' | 'worker'): (Type | DynamicModule)[] {
  assertRegistryMatchesManifest();
  return modulesFor(unit).map((m) => {
    const mod = MODULE_REGISTRY[m.name] as UnitAwareModule | undefined;
    if (mod === undefined) throw new Error(`Module ${m.name} chưa có trong registry`);
    return typeof mod.forUnit === 'function' ? mod.forUnit(unit) : mod;
  });
}
