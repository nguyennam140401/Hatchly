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

let registered = false;

@Injectable()
export class MediaUsageRegistrar implements OnModuleInit {
  onModuleInit(): void {
    // Nhiều ứng dụng Nest trong cùng một tiến trình (kiểm thử) dùng chung một nhà cung cấp không giữ trạng thái.
    if (registered) return;
    registered = true;
    registerMediaUsageProvider({
      findUsages: (mediaIds) =>
        tenantTx(async (db): Promise<MediaUsageRef[]> => {
          if (mediaIds.length === 0) return [];
          const result = await db.execute<UsageRow>(sql`
            SELECT DISTINCT ids.media_id, p.id AS post_id, p.internal_name AS post_title, p.status AS post_status
              FROM unnest(${[...mediaIds]}::text[]) AS ids(media_id)
              JOIN content.channel_variants cv ON cv.media @> jsonb_build_array(jsonb_build_object('mediaId', ids.media_id))
              JOIN content.posts p ON p.id = cv.post_id AND p.account_id = cv.account_id
             WHERE p.deleted_at IS NULL`);
          return result.rows.map((row) => ({
            mediaId: row.media_id,
            postId: row.post_id,
            postTitle: row.post_title ?? '',
            postStatus: row.post_status as MediaUsageRef['postStatus'],
          }));
        }),
    });
  }
}
