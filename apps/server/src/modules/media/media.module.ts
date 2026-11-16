import { Global, Module } from '@nestjs/common';
import { MEDIA_PUBLIC_API, type MediaPublicApi } from './public-api';

/**
 * Bản giữ chỗ cho tới khi Thư viện media có kho tệp thật (WBS 3.x): không có media → ok rỗng; có mã media →
 * `unavailable` (chưa có thư viện nên không cấp được đường dẫn ký sẵn). KHÔNG bịa đường dẫn: 013 sẽ báo người
 * dùng chọn ảnh khác thay vì đăng nhầm.
 */
const placeholderApi: MediaPublicApi = {
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
 */
@Global()
@Module({
  providers: [{ provide: MEDIA_PUBLIC_API, useValue: placeholderApi }],
  exports: [MEDIA_PUBLIC_API],
})
export class MediaModule {}
