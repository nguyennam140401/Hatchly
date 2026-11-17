// Khuôn yêu cầu HTTP của Tiến trình đăng (013, contracts/publishing-http-api.md). Dùng chung web ↔ API.
import { z } from 'zod';

export const AttemptIdParam = z.strictObject({ attemptId: z.uuid() });
export type AttemptIdParam = z.infer<typeof AttemptIdParam>;

export const PostProgressParam = z.strictObject({ postId: z.uuid() });
export type PostProgressParam = z.infer<typeof PostProgressParam>;

/** Khóa lạc quan: `version` của lượt đăng lúc người dùng xem; lệch → 409 PUBLISH_VERSION_CONFLICT. */
export const RepublishRequest = z.strictObject({ version: z.int().min(1) });
export type RepublishRequest = z.infer<typeof RepublishRequest>;

/** `permalink` tùy chọn: PHẢI là đường dẫn https (người dùng dán sau khi tự kiểm tra trên trang). */
export const MarkPublishedRequest = z.strictObject({
  version: z.int().min(1),
  permalink: z
    .url({ protocol: /^https$/ })
    .max(2048)
    .optional(),
});
export type MarkPublishedRequest = z.infer<typeof MarkPublishedRequest>;

export interface RepublishResponse {
  attemptId: string;
  status: 'scheduled';
  /** Đăng lại từ "Cần kiểm tra": bài trước có thể đã lên → có nguy cơ đăng trùng. */
  warning?: 'possible_duplicate';
}

export interface MarkPublishedResponse {
  attemptId: string;
  status: 'published';
  permalink: string | null;
}
