import { type DynamicModule, Module } from '@nestjs/common';
import { PostsController } from './internal/posts.controller';
import { ContentService } from './internal/content.service';
import { MEDIA_PUBLIC_API, type MediaPublicApi } from '../media';
import { createMediaDescriber } from './internal/media-describer';
import { MediaUsageRegistrar } from './internal/media-usage.provider';
import { CONTENT_PUBLIC_API, MEDIA_DESCRIBER } from './public-api';

/**
 * Module Nội dung (`content`).
 * Chỉ export provider thuộc giao diện công khai (`CONTENT_PUBLIC_API`); mọi thứ khác nằm trong `internal/`.
 * `global` để `approval`/`publishing` tiêm (ranh giới do tệp kê khai + check:boundaries kiểm).
 * Controller chỉ ở API. Cổng mô tả media (`MEDIA_DESCRIBER`) nối tới `MEDIA_PUBLIC_API` của module Thư viện media (014 T091).
 */
@Module({})
export class ContentModule {
  static forUnit(unit: 'api' | 'worker'): DynamicModule {
    return {
      module: ContentModule,
      global: true,
      controllers: unit === 'api' ? [PostsController] : [],
      providers: [
        ContentService,
        MediaUsageRegistrar,
        { provide: CONTENT_PUBLIC_API, useExisting: ContentService },
        {
          provide: MEDIA_DESCRIBER,
          useFactory: (media: MediaPublicApi) => createMediaDescriber(media),
          inject: [MEDIA_PUBLIC_API],
        },
      ],
      exports: [CONTENT_PUBLIC_API],
    };
  }
}
