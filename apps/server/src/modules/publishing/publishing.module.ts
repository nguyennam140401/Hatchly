import { type DynamicModule, Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../core';
import { CONTENT_PUBLIC_API, type ContentPublicApi } from '../content';
import { PLATFORM_GATEWAY, type PlatformGatewayPublicApi } from '../platform_gateway';
import { registerJobHandler } from '../queue';
import { createRunAttemptHandler } from './internal/executor.stub';
import { PublishingService } from './internal/publishing.service';
import { runAttemptJob } from './jobs';
import { PUBLISHING_PUBLIC_API } from './public-api';

/** Đăng ký bộ xử lý việc – CHỈ ở Worker, trước khi QueueRuntime bắt đầu lấy việc. */
let handlerRegistered = false;

@Injectable()
class PublishingWorkerHandlers implements OnModuleInit {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CONTENT_PUBLIC_API) private readonly content: ContentPublicApi,
    @Inject(PLATFORM_GATEWAY) private readonly gateway: PlatformGatewayPublicApi,
  ) {}

  onModuleInit(): void {
    if (handlerRegistered) return;
    registerJobHandler(
      runAttemptJob,
      createRunAttemptHandler({
        mode: this.config.PUBLISH_EXECUTOR,
        content: this.content,
        gateway: this.gateway,
      }),
    );
    handlerRegistered = true;
  }
}

/**
 * Module Đăng bài (`publishing`).
 * Chỉ export provider thuộc giao diện công khai (`PUBLISHING_PUBLIC_API`); mọi thứ khác nằm trong `internal/`.
 * 012: mục lịch đăng + bộ thực thi tạm; 013 thay phần thực thi 5 bước.
 */
@Module({})
export class PublishingModule {
  static forUnit(unit: 'api' | 'worker'): DynamicModule {
    return {
      module: PublishingModule,
      global: true,
      providers: [
        PublishingService,
        { provide: PUBLISHING_PUBLIC_API, useExisting: PublishingService },
        ...(unit === 'worker' ? [PublishingWorkerHandlers] : []),
      ],
      exports: [PUBLISHING_PUBLIC_API],
    };
  }
}
