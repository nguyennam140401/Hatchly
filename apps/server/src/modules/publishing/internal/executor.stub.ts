// Bộ thực thi TẠM của `publishing.run_attempt` (012 research R10). 013 thay thân hàm này bằng 5 bước đăng
// thật; GIỮ NGUYÊN tên loại việc, payload `{ attemptId }` và `dedupeKey = publish:{attemptId}`.
//
// - `PUBLISH_EXECUTOR=none` (mặc định, kể cả production): KHÔNG đổi trạng thái, hoãn việc 15 phút – việc
//   không mất, mục vẫn `scheduled`, không bao giờ đăng nhầm khi chưa có luồng đăng thật.
// - `PUBLISH_EXECUTOR=fake` (dev/test/thử nghiệm): `scheduled → processing → succeeded | needs_user` qua
//   bộ chuyển đổi giả lập của 005, mỗi bước là cập nhật có điều kiện theo trạng thái hiện tại.
// Chạy lại an toàn: mục không còn `scheduled` (đã hủy, đã đăng…) → bỏ qua, không tác dụng phụ.
import type { JobHandler } from '../../queue';
import { retryAfter } from '../../queue';
import { tenantTx } from '../../../core';
import type { ContentPublicApi } from '../../content';
import type { PlatformGatewayPublicApi } from '../../platform_gateway';
import { loadAttempt, transitionAttempt } from './attempts.repository';

/** Hoãn việc khi chưa có bộ thực thi thật (giây). */
export const NO_EXECUTOR_DELAY_SECONDS = 900;

export interface ExecutorDeps {
  mode: 'none' | 'fake';
  content: ContentPublicApi;
  gateway: PlatformGatewayPublicApi;
}

export function createRunAttemptHandler(deps: ExecutorDeps): JobHandler<{ attemptId: string }> {
  return async ({ attemptId }) => {
    const attempt = await tenantTx((db) => loadAttempt(db, attemptId));
    // Không có / đã hủy / đã rời `scheduled` → bỏ qua (chạy lại hai lần cho cùng kết quả).
    if (attempt?.status !== 'scheduled') return;

    if (deps.mode === 'none') return retryAfter(NO_EXECUTOR_DELAY_SECONDS);

    // Chiếm lượt: chỉ MỘT Worker đổi được `scheduled → processing`.
    const claimed = await tenantTx((db) =>
      transitionAttempt(db, attemptId, 'scheduled', 'processing'),
    );
    if (!claimed) return;

    const post = await deps.content.getPost(attempt.post_id);
    const variant = post?.variants.find((v) => v.connectionId === attempt.channel_connection_id);
    if (post === null || variant === undefined) {
      await tenantTx((db) => transitionAttempt(db, attemptId, 'processing', 'needs_user'));
      return;
    }
    const text = variant.customized ? variant.text : post.sharedText;
    const result = await deps.gateway.submit({
      connectionId: attempt.channel_connection_id,
      text,
      media: variant.media.map((m) => ({
        url: `https://fake.invalid/${m.mediaId}`,
        kind: m.kind,
        mediaId: m.mediaId,
      })),
      contentHash: deps.gateway.contentHash(attempt.channel_type as never, text),
    });
    const next = result.kind === 'published' ? 'succeeded' : 'needs_user';
    await tenantTx((db) => transitionAttempt(db, attemptId, 'processing', next));
  };
}
