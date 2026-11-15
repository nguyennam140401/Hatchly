import { type DynamicModule, Module } from '@nestjs/common';
import { type AppConfig, CoreModule } from '../core';
import { AuthModule, type AccessScanMode } from '../core/auth/auth.module';
import { resolveAuthConfig } from '../core/config/auth-config';
import { DatabaseModule } from '../core/db/database.module';
import { StorageModule } from '../core/storage';
import { DiagnosticsController } from '../core/diagnostics/diagnostics.controller';
import { HealthController } from '../core/health/health.controller';
import type { LogDestination } from '../core/logging/logging.module';
import { DevFakesController } from '../dev/fakes.controller';
import { FakeAuthorizeController } from '../modules/account';
import { FakeOauthController } from '../modules/platform_gateway';
import { buildModules } from './module-registry';

export interface ApiAppOptions {
  /** Kiểm tra khai báo truy cập khi khởi động (mặc định theo APP_ENV). Kiểm thử cố ý có handler thiếu khai báo dùng `log`. */
  accessScan?: AccessScanMode | undefined;
  /** Nơi ghi nhật ký (kiểm thử bắt nhật ký); mặc định stdout. */
  logDestination?: LogDestination | undefined;
}

/** Route chỉ-dev (quản trị giả lập, trang ủy quyền giả) chỉ có ở development/test (005, R12). */
export function shouldRegisterDevRoutes(appEnv: AppConfig['APP_ENV']): boolean {
  return appEnv === 'development' || appEnv === 'test';
}

/** Mô-đun gốc của đơn vị API. Thiếu biến xác thực bắt buộc → ConfigError, API không khởi động. */
@Module({})
export class ApiAppModule {
  static forRoot(config: AppConfig, options: ApiAppOptions = {}): DynamicModule {
    const authConfig = resolveAuthConfig(config);
    return {
      module: ApiAppModule,
      imports: [
        CoreModule.forRoot('api', config, { logDestination: options.logDestination }),
        DatabaseModule.forRoot('api', config),
        // Kho tệp (005) – chọn bản cài đặt theo STORAGE_DRIVER.
        StorageModule,
        AuthModule.forRoot(authConfig, { accessScan: options.accessScan }),
        ...buildModules('api'),
      ],
      controllers: [
        HealthController,
        // Điểm chẩn đoán không bao giờ có ở production (R17).
        ...(config.APP_ENV === 'production' ? [] : [DiagnosticsController]),
        // 005: quản trị bản giả lập + trang ủy quyền giả – không có route ở staging/production (→ 404).
        ...(shouldRegisterDevRoutes(config.APP_ENV)
          ? [DevFakesController, FakeOauthController]
          : []),
        // 009: trang đăng nhập Google/Facebook giả lập – chỉ khi OAUTH_DRIVER=fake (staging/production
        // từ chối khởi động với giá trị này nên route không bao giờ có ở đó → 404).
        // Hai lớp chặn: giá trị cấu hình VÀ môi trường – không dựa riêng vào bước kiểm tra cấu hình.
        ...(config.OAUTH_DRIVER === 'fake' && shouldRegisterDevRoutes(config.APP_ENV)
          ? [FakeAuthorizeController]
          : []),
      ],
    };
  }
}
