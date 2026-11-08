import { type DynamicModule, Module } from '@nestjs/common';
import { type AppConfig, CoreModule } from '../core';
import { DiagnosticsController } from '../core/diagnostics/diagnostics.controller';
import { HealthController } from '../core/health/health.controller';
import { buildModules } from './module-registry';

/** Mô-đun gốc của đơn vị API. */
@Module({})
export class ApiAppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: ApiAppModule,
      imports: [CoreModule.forRoot('api', config), ...buildModules('api')],
      controllers: [
        HealthController,
        // Điểm chẩn đoán không bao giờ có ở production (R17).
        ...(config.APP_ENV === 'production' ? [] : [DiagnosticsController]),
      ],
    };
  }
}
