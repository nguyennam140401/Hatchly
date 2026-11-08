import { type DynamicModule, Module } from '@nestjs/common';
import { type AppConfig, CoreModule } from '../core';
import { DatabaseModule } from '../core/db/database.module';
import { buildModules } from './module-registry';

/** Mô-đun gốc của đơn vị Worker – không có controller, không có router HTTP (FR-004). */
@Module({})
export class WorkerAppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: WorkerAppModule,
      imports: [
        CoreModule.forRoot('worker', config),
        DatabaseModule.forRoot('worker', config),
        ...buildModules('worker'),
      ],
    };
  }
}
