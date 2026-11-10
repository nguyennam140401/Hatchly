import { type DynamicModule, Module } from '@nestjs/common';
import { type AppConfig, CoreModule } from '../core';
import { AuthModule, type AccessScanMode } from '../core/auth/auth.module';
import { resolveAuthConfig } from '../core/config/auth-config';
import { DatabaseModule } from '../core/db/database.module';
import { DiagnosticsController } from '../core/diagnostics/diagnostics.controller';
import { HealthController } from '../core/health/health.controller';
import type { LogDestination } from '../core/logging/logging.module';
import { buildModules } from './module-registry';

export interface ApiAppOptions {
  /** Kiểm tra khai báo truy cập khi khởi động (mặc định theo APP_ENV). Kiểm thử cố ý có handler thiếu khai báo dùng `log`. */
  accessScan?: AccessScanMode | undefined;
  /** Nơi ghi nhật ký (kiểm thử bắt nhật ký); mặc định stdout. */
  logDestination?: LogDestination | undefined;
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
        AuthModule.forRoot(authConfig, { accessScan: options.accessScan }),
        ...buildModules('api'),
      ],
      controllers: [
        HealthController,
        // Điểm chẩn đoán không bao giờ có ở production (R17).
        ...(config.APP_ENV === 'production' ? [] : [DiagnosticsController]),
      ],
    };
  }
}
