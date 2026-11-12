import { type DynamicModule, Injectable, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { registerJobHandler } from '../queue';
import { profileChanged } from './jobs';
import { createProfileChangedHandler } from './internal/profile-changed.handler';
import { ProfileController } from './internal/profile.controller';
import { ProfileService } from './internal/profile.service';
import { contextPublicApi } from './internal/public-api.impl';
import { CONTEXT_PUBLIC_API } from './public-api';

/** Đăng ký bộ xử lý việc của module – CHỈ ở Worker, trước khi QueueRuntime bắt đầu lấy việc. */
let handlersRegistered = false;

@Injectable()
class ContextWorkerHandlers implements OnModuleInit {
  private readonly logger = new Logger('context');

  onModuleInit(): void {
    if (handlersRegistered) return;
    registerJobHandler(
      profileChanged,
      createProfileChangedHandler({
        context: contextPublicApi,
        log: {
          info: (entry) => {
            this.logger.log(entry);
          },
        },
      }),
    );
    handlersRegistered = true;
  }
}

/**
 * Module Ngữ cảnh kinh doanh (`context`).
 * Chỉ export provider thuộc giao diện công khai (`CONTEXT_PUBLIC_API`); mọi thứ khác nằm trong `internal/`.
 * - API: controller hồ sơ kinh doanh + dịch vụ (cần `ACCOUNT_PUBLIC_API` – module account global ở API).
 * - Worker: bộ xử lý việc `context.profile_changed`.
 */
@Module({})
export class ContextModule {
  static forUnit(unit: 'api' | 'worker'): DynamicModule {
    const publicApi = { provide: CONTEXT_PUBLIC_API, useValue: contextPublicApi };
    if (unit === 'worker') {
      return {
        module: ContextModule,
        providers: [publicApi, ContextWorkerHandlers],
        exports: [CONTEXT_PUBLIC_API],
      };
    }
    return {
      module: ContextModule,
      controllers: [ProfileController],
      providers: [publicApi, ProfileService],
      exports: [CONTEXT_PUBLIC_API],
    };
  }
}
