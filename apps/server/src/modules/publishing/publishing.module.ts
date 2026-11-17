import { type DynamicModule, Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../core';
import { ACCOUNT_PUBLIC_API, type AccountPublicApi } from '../account';
import { CONTENT_PUBLIC_API, type ContentPublicApi } from '../content';
import { MEDIA_PUBLIC_API, type MediaPublicApi } from '../media';
import { NOTIFICATIONS, type NotificationsPublicApi } from '../notifications';
import { PLATFORM_GATEWAY, type PlatformGatewayPublicApi } from '../platform_gateway';
import { registerJobHandler } from '../queue';
import {
  createExecuteAttemptHandler,
  createFinalFailureHandler,
} from './internal/executor/execute-attempt.handler';
import { AttemptActionsService } from './internal/attempt-actions.service';
import { AttemptsController } from './internal/attempts.controller';
import { ErrorMappingService } from './internal/error-mapping.service';
import { ProgressQuery } from './internal/progress.query';
import { PublishingService } from './internal/publishing.service';
import { DEFAULT_PUBLISH_SETTINGS } from './internal/retry-policy';
import { runSweepOverdue } from './internal/overdue.sweeper';
import { definePublishingSchedules, runAttemptJob, sweepOverdueJob } from './jobs';
import { PUBLISHING_PUBLIC_API } from './public-api';

/** Đăng ký bộ xử lý việc – CHỈ ở Worker, trước khi QueueRuntime bắt đầu lấy việc. */
let handlerRegistered = false;

@Injectable()
class PublishingWorkerHandlers implements OnModuleInit {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CONTENT_PUBLIC_API) private readonly content: ContentPublicApi,
    @Inject(PLATFORM_GATEWAY) private readonly gateway: PlatformGatewayPublicApi,
    @Inject(MEDIA_PUBLIC_API) private readonly media: MediaPublicApi,
    @Inject(ACCOUNT_PUBLIC_API) private readonly account: AccountPublicApi,
    @Inject(NOTIFICATIONS) private readonly notifications: NotificationsPublicApi,
    private readonly errorMapping: ErrorMappingService,
  ) {}

  onModuleInit(): void {
    if (handlerRegistered) return;
    const deps = {
      mode: this.config.PUBLISH_EXECUTOR,
      content: this.content,
      gateway: this.gateway,
      media: this.media,
      account: this.account,
      notifications: this.notifications,
      errorMapping: this.errorMapping,
      settings: DEFAULT_PUBLISH_SETTINGS,
      now: () => new Date(),
    };
    registerJobHandler(runAttemptJob, createExecuteAttemptHandler(deps), {
      onFinalFailure: createFinalFailureHandler(deps),
    });
    registerJobHandler(sweepOverdueJob, async () => {
      await runSweepOverdue();
    });
    definePublishingSchedules();
    handlerRegistered = true;
  }
}

/**
 * Module Đăng bài (`publishing`).
 * Chỉ export provider thuộc giao diện công khai (`PUBLISHING_PUBLIC_API`); mọi thứ khác nằm trong `internal/`.
 * 012: mục lịch đăng; 013: bộ thực thi 5 bước, đối soát, thử lại, tiến trình đăng.
 */
@Module({})
export class PublishingModule {
  static forUnit(unit: 'api' | 'worker'): DynamicModule {
    return {
      module: PublishingModule,
      global: true,
      controllers: unit === 'api' ? [AttemptsController] : [],
      providers: [
        ErrorMappingService,
        AttemptActionsService,
        ProgressQuery,
        PublishingService,
        { provide: PUBLISHING_PUBLIC_API, useExisting: PublishingService },
        ...(unit === 'worker' ? [PublishingWorkerHandlers] : []),
      ],
      exports: [PUBLISHING_PUBLIC_API],
    };
  }
}
