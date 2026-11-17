import {
  type DynamicModule,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnModuleInit,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../core';
import { OBJECT_STORAGE, type ObjectStorage } from '../../core/storage';
import { registerJobHandler } from '../queue';
import {
  cleanupMedia,
  defineMediaSchedules,
  processMedia,
  purgeMediaFiles,
  sweepMedia,
} from './jobs';
import { createCleanupHandler } from './internal/cleanup.handler';
import { createProcessMediaHandler } from './internal/process.handler';
import { createPurgeFilesHandler } from './internal/purge.handler';
import { runMediaSweep } from './internal/sweep';
import { QuotaStore } from './internal/quota.store';
import { LibraryController } from './internal/library.controller';
import { LibraryService } from './internal/library.service';
import { UploadController } from './internal/upload.controller';
import { UploadService } from './internal/upload.service';
import { defaultUploadGate, UPLOAD_GATE } from './internal/upload-gate';
import { MediaPublicApiImpl } from './internal/public-api.impl';
import { MEDIA_PUBLIC_API } from './public-api';

/** Đăng ký bộ xử lý việc của module – CHỈ ở Worker, trước khi QueueRuntime bắt đầu lấy việc. */
let handlersRegistered = false;

@Injectable()
class MediaWorkerHandlers implements OnModuleInit {
  private readonly logger = new Logger('media');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage | null,
  ) {}

  onModuleInit(): void {
    if (handlersRegistered) return;
    handlersRegistered = true;
    const storage = this.storage;
    if (storage === null) {
      this.logger.warn({ msg: 'media.worker.no_storage' });
      return;
    }
    const quota = new QuotaStore(this.config.MEDIA_QUOTA_BYTES);
    const log = {
      info: (entry: Record<string, unknown>) => {
        this.logger.log(entry);
      },
      warn: (entry: Record<string, unknown>) => {
        this.logger.warn(entry);
      },
    };
    const process = createProcessMediaHandler({ storage, quota, log });
    registerJobHandler(processMedia, process.handler, { onFinalFailure: process.onFinalFailure });
    registerJobHandler(purgeMediaFiles, createPurgeFilesHandler({ storage, log }));
    const cleanup = createCleanupHandler({ storage, quota, log });
    registerJobHandler(cleanupMedia, async (payload) => {
      await cleanup(payload);
    });
    registerJobHandler(sweepMedia, async () => {
      await runMediaSweep();
    });
    defineMediaSchedules();
  }
}

/**
 * Module Thư viện media (`media`).
 * Chỉ export provider thuộc giao diện công khai; mọi thứ khác nằm trong `internal/`.
 * `global`: module có `media` trong `allowedDeps` (kiểm bằng check:boundaries) tiêm `MEDIA_PUBLIC_API`.
 * - API: controller tải lên / thư viện (thêm ở các câu chuyện US1…US6).
 * - Worker: bộ xử lý việc `media.process`, `media.purge_files`, `media.cleanup`, `media.sweep`.
 */
@Module({})
export class MediaModule {
  static forUnit(unit: 'api' | 'worker'): DynamicModule {
    return {
      module: MediaModule,
      global: true,
      controllers: unit === 'api' ? [UploadController, LibraryController] : [],
      providers: [
        MediaPublicApiImpl,
        { provide: MEDIA_PUBLIC_API, useExisting: MediaPublicApiImpl },
        { provide: UPLOAD_GATE, useValue: defaultUploadGate },
        ...(unit === 'api' ? [UploadService, LibraryService] : [MediaWorkerHandlers]),
      ],
      exports: [MEDIA_PUBLIC_API],
    };
  }
}
