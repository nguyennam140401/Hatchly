import { type DynamicModule, Module } from '@nestjs/common';
import { defaultUploadGate, UPLOAD_GATE } from './internal/upload-gate';
import { MEDIA_PUBLIC_API, type MediaPublicApi } from './public-api';

/**
 * Bản giữ chỗ cho tới khi `public-api.impl.ts` (US5) được nối: không có media → ok rỗng; có mã media → `unavailable`.
 * KHÔNG bịa đường dẫn: 013 báo người dùng chọn ảnh khác thay vì đăng nhầm.
 */
const placeholderApi: MediaPublicApi = {
  describe: (mediaIds) => Promise.resolve(mediaIds.map(() => ({ kind: 'not_found' as const }))),
  assertAttachable: (mediaIds) =>
    Promise.resolve(mediaIds.map((mediaId) => ({ kind: 'not_found' as const, mediaId }))),
  getPreviewUrls: (mediaIds) =>
    Promise.resolve(mediaIds.map((mediaId) => ({ mediaId, thumbUrl: null, expiresAt: null }))),
  issuePublicUrl: () => Promise.resolve({ kind: 'not_found' }),
  getPublishableMedia: (mediaIds) =>
    Promise.resolve(
      mediaIds.length === 0
        ? { kind: 'ok', items: [] }
        : { kind: 'unavailable', mediaIds: [...mediaIds] },
    ),
};

/**
 * Module Thư viện media (`media`).
 * Chỉ export provider thuộc giao diện công khai; mọi thứ khác nằm trong `internal/`.
 * `global`: module có `media` trong `allowedDeps` (kiểm bằng check:boundaries) tiêm `MEDIA_PUBLIC_API`.
 * - API: controller tải lên / thư viện (thêm ở các câu chuyện US1…US6).
 * - Worker: bộ xử lý việc `media.process`, `media.purge_files`, `media.cleanup`, `media.sweep`.
 */
@Module({})
export class MediaModule {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dùng khi nối controller (API) và bộ xử lý việc (Worker)
  static forUnit(unit: 'api' | 'worker'): DynamicModule {
    return {
      module: MediaModule,
      global: true,
      providers: [
        { provide: MEDIA_PUBLIC_API, useValue: placeholderApi },
        { provide: UPLOAD_GATE, useValue: defaultUploadGate },
      ],
      exports: [MEDIA_PUBLIC_API],
    };
  }
}
