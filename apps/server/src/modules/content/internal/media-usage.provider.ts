import { Injectable, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { tenantTx } from '../../../core';
import { registerMediaUsageProvider, type MediaUsageRef } from '../../media';

// Nhà cung cấp "bài nào đang dùng media" cho module Thư viện media (014 T091, R10): `media` không import `content`, nên `content`
// đăng ký MỘT nhà cung cấp lúc khởi động. Chỉ đọc bảng của chính `content` (channel_variants.media là mảng JSON có `mediaId`).
// Quy tắc chặn/xác nhận xóa nằm ở `media`; bài `approved` (đã duyệt/lên lịch) chặn xóa, các trạng thái khác cần xác nhận.

// `type` (không `interface`): db.execute<T> đòi T gán được cho Record<string, unknown>.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type UsageRow = {
  media_id: string;
  post_id: string;
  post_title: string | null;
  post_status: string;
};

@Injectable()
export class MediaUsageRegistrar implements OnModuleInit {
  onModuleInit(): void {
    // Nhiều ứng dụng Nest trong cùng một tiến trình (kiểm thử) dùng chung một nhà cung cấp không giữ trạng thái:
    // đã có nhà cung cấp (của ứng dụng trước) thì giữ nguyên.
    try {
      registerMediaUsageProvider({
        findUsages: (mediaIds) =>
          tenantTx(async (db): Promise<MediaUsageRef[]> => {
            if (mediaIds.length === 0) return [];
            const ids = sql.join(
              mediaIds.map((id) => sql`${id}`),
              sql`, `,
            );
            const result = await db.execute<UsageRow>(sql`
            SELECT DISTINCT e.item ->> 'mediaId' AS media_id, p.id AS post_id, p.internal_name AS post_title, p.status AS post_status
              FROM content.channel_variants cv
              JOIN content.posts p ON p.id = cv.post_id AND p.account_id = cv.account_id
             CROSS JOIN LATERAL jsonb_array_elements(cv.media) AS e(item)
             WHERE p.deleted_at IS NULL AND e.item ->> 'mediaId' IN (${ids})`);
            return result.rows.map((row) => ({
              mediaId: row.media_id,
              postId: row.post_id,
              postTitle: row.post_title ?? '',
              postStatus: row.post_status as MediaUsageRef['postStatus'],
            }));
          }),
      });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('đã được đăng ký')) throw error;
    }
  }
}
