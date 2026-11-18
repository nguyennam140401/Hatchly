import type { MediaPublicApi } from '../../media';
import type { MediaDescriber } from '../public-api';

// Cầu nối cổng mô tả media của `content` (012) tới giao diện công khai của `media` (014 T091). Media đã xóa / không có /
// chưa xử lý xong KHÔNG có mô tả ⇒ bị bỏ qua (việc chặn đính media xấu do `assertAttachable` ở bước đính, không ở đây).
export function createMediaDescriber(media: Pick<MediaPublicApi, 'describe'>): MediaDescriber {
  return {
    async describe(mediaIds) {
      const results = await media.describe(mediaIds);
      return results.flatMap((r) => {
        if (r.kind !== 'ok' || r.media.status !== 'ready') return [];
        const m = r.media;
        const sub = m.contentType.toLowerCase().split('/')[1] ?? '';
        return [
          {
            mediaId: m.mediaId,
            kind: m.kind,
            format: sub === 'quicktime' ? 'mov' : sub,
            bytes: m.kind === 'image' ? (m.normalizedBytes ?? m.originalBytes) : m.originalBytes,
            width: m.width ?? 0,
            height: m.height ?? 0,
            ...(m.durationMs !== null ? { durationSec: Math.round(m.durationMs / 1000) } : {}),
          },
        ];
      });
    },
  };
}
