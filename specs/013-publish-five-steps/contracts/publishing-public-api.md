# Hợp đồng: giao diện công khai của module Đăng bài (`PublishingPublicApi`)

Người dùng: `approval` / 012 (tạo, hủy, đổi giờ, đọc trạng thái), `notifications` (không gọi, chỉ nhận sự kiện), bộ xóa tài
khoản của `account`. Mọi thao tác chạy trong ngữ cảnh tài khoản của yêu cầu — **không có tham số `accountId`**. Kết quả nghiệp vụ
là hợp đóng có `kind`; chỉ lỗi lập trình/hạ tầng mới ném (cùng kiểu 005).

## 1. Thao tác cho `approval` / 012

Tất cả nhận `tx: Db` (giao dịch nghiệp vụ hiện tại của bên gọi) để duyệt + tạo lượt đăng + tạo việc nằm trong **một** giao dịch
(Hiến pháp II).

```ts
export interface PublishingPublicApi {
  /** Tạo lượt đăng cho mỗi kênh của bài và đặt việc hẹn giờ trong cùng giao dịch. Idempotent theo (post, connection). */
  schedule(tx: Db, req: ScheduleRequest): Promise<ScheduleResult>;
  /** Hủy các lượt đang `scheduled` của bài (kèm hủy việc). Lượt đã rời `scheduled` không bị đụng. */
  cancel(tx: Db, req: { postId: string; reason: 'unapproved' | 'content_edited' | 'unscheduled'; byUserId: string }): Promise<CancelResult>;
  /** Đổi giờ mọi lượt của bài; chỉ thành công khi TẤT CẢ còn `scheduled`. */
  reschedule(tx: Db, req: { postId: string; newScheduledAt: Date; byUserId: string }): Promise<RescheduleResult>;
  /** Đọc trạng thái hiển thị (đã gộp 8 trạng thái nội bộ → 5 trạng thái hiển thị) của một hoặc nhiều bài. */
  getStatuses(postIds: string[]): Promise<PostPublishStatus[]>;
  /** Hủy mọi lượt chưa kết thúc khi tài khoản bị xóa/kênh ngắt (FR-033). */
  cancelAllForConnection(tx: Db, connectionId: string): Promise<{ cancelled: number }>;
}
export const PUBLISHING = Symbol('PUBLISHING');
```

```ts
export interface ScheduleRequest {
  postId: string;
  scheduledAt: Date;                         // UTC; đã kiểm tối thiểu 5 phút ở 012
  channels: { variantId: string; variantVersion: number; connectionId: string }[]; // 1..4
  byUserId: string;
}
export type ScheduleResult =
  | { kind: 'scheduled'; attempts: { attemptId: string; connectionId: string }[] }   // gồm cả lượt đã có (idempotent)
  | { kind: 'rejected'; reason: 'connection_unavailable' | 'plan_inactive' | 'already_started'; connectionIds?: string[] };

export type CancelResult = { kind: 'cancelled'; count: number } | { kind: 'nothing_to_cancel' } | { kind: 'already_started'; startedConnectionIds: string[] };
export type RescheduleResult = { kind: 'rescheduled'; count: number } | { kind: 'rejected'; reason: 'already_processing' | 'no_attempts' | 'quota_exceeded_at_new_time' };

export type DisplayStatus = 'scheduled' | 'publishing' | 'published' | 'needs_action' | 'cancelled';
export interface PostPublishStatus {
  postId: string;
  overall: DisplayStatus;                    // "xấu nhất" của các kênh (FR-027)
  channels: { connectionId: string; channelType: ChannelType; status: DisplayStatus; attemptId: string; permalink: string | null }[];
}
```

Quy tắc:

- `schedule` kiểm kênh còn kết nối và gói còn hiệu lực **nhẹ** (đầy đủ ở bước 1 khi chạy); tạo lượt `scheduled` + `enqueue(executeAttempt,
  { attemptId }, { dedupeKey: 'publish:'+id, runAfter: scheduledAt })`. Vi phạm chỉ mục duy nhất ⇒ trả lượt hiện có (không lỗi).
- `reschedule`: một `UPDATE publish_attempts SET scheduled_at = :t WHERE post_id = :p AND status = 'scheduled'` rồi so số dòng
  với số lượt của bài; thiếu ⇒ hoàn tác và `already_processing`. Cùng giao dịch gọi `rescheduleJob` cho từng việc.
- `cancel`: hủy việc + `status → cancelled` bằng UPDATE có điều kiện.
- `getStatuses` ≤ 200 bài/lần; không trả `content_hash`, mã lỗi gốc, mã quyền.

## 2. Sự kiện phát ra (qua `NotificationsPublicApi.emit`)

Trong **cùng giao dịch** chuyển sang `needs_user` / `needs_check`:

```ts
emit(tx, { type: 'publish_needs_action', refs: { attemptId, postId, authorUserId, state, channelType?, reason? } })
```

Khuôn `refs` mở rộng hai trường **tùy chọn** (xem `packages/shared/src/modules/notifications/events.ts`); sự kiện cũ vẫn hợp lệ.
Không phát khi `transient` (FR-018). Không có tên bài, nội dung, số tiền AI trong sự kiện.

## 3. Phụ thuộc mà Đăng bài gọi

| Module | Giao diện đã có | Thao tác dùng | Khoảng trống cần thêm |
|---|---|---|---|
| `platform_gateway` | `PlatformGatewayPublicApi` (005) | `checkAccount`, `mediaRules`, `submit`, `checkStatus`, `reconcile`, `classifyError`, `capabilities`, `contentHash`, `getConnection` | không |
| `notifications` | `emit(tx, event)` | `publish_needs_action` | thêm 2 trường tùy chọn ở `refs` + mẫu nội dung |
| `queue` | `defineJobType`, `enqueue`, `registerJobHandler`, `retryAfter`, `cancelJob`, `rescheduleJob` | như `queue.md` | không |
| `content` | khung rỗng | `getVariantForPublish` (mục 4) | **thêm** |
| `media` | khung rỗng | `getPublishableMedia` (mục 4) | **thêm** |
| `account` | có | `getPublishingEligibility` | **thêm** |

## 4. Khoảng trống hợp đồng (do module sở hữu hiện thực; 013 chỉ định nghĩa kiểu + bản giả cho kiểm thử)

```ts
// content/public-api.ts
getVariantForPublish(postId: string, variantId: string): Promise<
  | { kind: 'ok'; postStatus: 'approved'; variantVersion: number; text: string; mediaIds: string[] }
  | { kind: 'not_publishable'; reason: 'not_approved' | 'deleted' | 'version_changed' }
>;

// media/public-api.ts
getPublishableMedia(mediaIds: string[], opts: { ttlSec: number /* ≤ 86400 */ }): Promise<
  { kind: 'ok'; items: { mediaId: string; kind: 'image'|'video'; format: string; bytes: number; width: number; height: number; durationSec?: number; publicUrl: string; urlExpiresAt: Date }[] }
  | { kind: 'failed'; mediaId: string; reason: 'not_found' | 'not_ready' | 'conversion_failed' }
>;

// account/public-api.ts
getPublishingEligibility(): Promise<{ planActive: boolean; deletionRequested: boolean }>;
```

`getPublishableMedia` phải cấp đường dẫn ký sẵn **đúng tiền tố `tenants/{accountId}/`** và hạn ≤ 24 giờ (Hiến pháp I).

## 5. Kiểm thử hợp đồng bắt buộc

1. `schedule` hai lần cùng (post, connection) → cùng `attemptId`, đúng một dòng, đúng một việc.
2. `reschedule` khi một lượt đã `processing` → `already_processing`, **không** lượt nào đổi giờ.
3. `cancel` khi một lượt đã `processing` → lượt đó không bị hủy; `already_started`.
4. Giao dịch của bên gọi hoàn tác → không còn lượt, không còn việc, không có sự kiện thông báo.
5. Tài khoản B gọi với `postId` của A → `rejected`/`nothing_to_cancel` (RLS), không lộ tồn tại.
