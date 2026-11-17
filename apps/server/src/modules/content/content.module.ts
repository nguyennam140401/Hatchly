import { type DynamicModule, Module } from '@nestjs/common';
import { PostsController } from './internal/posts.controller';
import { ContentService } from './internal/content.service';
import { CONTENT_PUBLIC_API } from './public-api';

/**
 * Module Nội dung (`content`).
 * Chỉ export provider thuộc giao diện công khai (`CONTENT_PUBLIC_API`); mọi thứ khác nằm trong `internal/`.
 * `global` để `approval`/`publishing` tiêm (ranh giới do tệp kê khai + check:boundaries kiểm).
 * Controller chỉ ở API. Cổng mô tả media (`MEDIA_DESCRIBER`) là TÙY CHỌN: chưa có thì kênh bắt buộc media
 * báo "chưa thể lên lịch" (FR-007) tới khi module Thư viện media cung cấp.
 */
@Module({})
export class ContentModule {
  static forUnit(unit: 'api' | 'worker'): DynamicModule {
    return {
      module: ContentModule,
      global: true,
      controllers: unit === 'api' ? [PostsController] : [],
      providers: [ContentService, { provide: CONTENT_PUBLIC_API, useExisting: ContentService }],
      exports: [CONTENT_PUBLIC_API],
    };
  }
}
