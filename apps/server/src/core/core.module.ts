import { type DynamicModule, Global, Logger, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { UnitName } from '@app/shared/core';
import { APP_CONFIG, type AppConfig } from './config/config.schema';
import { ErrorFilter } from './errors/error.filter';
import { ReadinessRegistry } from './health/readiness';
import { ShutdownCoordinator } from './lifecycle/shutdown-coordinator';
import { LoggingModule } from './logging/logging.module';

/** Token cho tên đơn vị đang chạy (`api` | `worker`). */
export const APP_UNIT = Symbol('APP_UNIT');

/**
 * Lõi dùng chung phía máy chủ: cấu hình, nhật ký, bộ lọc lỗi, vòng đời, sẵn sàng.
 * KHÔNG được nhập bất kỳ thứ gì từ `modules/**` (quy tắc `core-no-modules`).
 * Ngữ cảnh yêu cầu (`requestContextMiddleware`) được gắn ở `configureApiApp`.
 */
@Global()
@Module({})
export class CoreModule {
  static forRoot(unit: UnitName, config: AppConfig): DynamicModule {
    return {
      module: CoreModule,
      imports: [LoggingModule.forRoot(unit, config)],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: APP_UNIT, useValue: unit },
        { provide: APP_FILTER, useClass: ErrorFilter },
        ReadinessRegistry,
        {
          provide: ShutdownCoordinator,
          useFactory: () =>
            new ShutdownCoordinator({
              timeoutMs: config.SHUTDOWN_TIMEOUT_MS,
              exit: (code) => process.exit(code),
              logger: new Logger('Lifecycle'),
            }),
        },
      ],
      exports: [APP_CONFIG, APP_UNIT, ReadinessRegistry, ShutdownCoordinator, LoggingModule],
    };
  }
}
