// Danh mục thông báo ĐÓNG (005, contracts/notifications.md mục 1, data-model.md mục 3, UI/UX mục 8).
// Dùng chung bởi `notifications` (phát + xử lý) và `account` (phát qua hàng chờ, không phụ thuộc module).
// Chỉ phụ thuộc `zod`. Khóa chống trùng (`dedupeKey`) do máy chủ dựng – KHÔNG xuất ở đây.
import { z } from 'zod';

export const NOTIFICATION_TYPES = [
  'post_pending_review',
  'post_returned',
  'approved_post_rescheduled',
  'batch_generation_done',
  'publish_needs_action',
  'channel_token_expiring',
  'ai_usage_80',
  'ai_usage_100',
  'plan_expiring',
  'data_deletion_scheduled',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Tên loại việc của hàng chờ `notify` (khai báo thật ở modules/notifications/jobs.ts). */
export const NOTIFY_DELIVER_JOB = 'notifications.deliver';

const id = z.uuid();
const day = z.iso.date();

/** Tham số hiển thị – giới hạn chặt, không nội dung bài, không số tiền. */
export const NotificationParams = z.strictObject({
  postTitle: z.string().max(60).optional(),
  channelDisplayName: z.string().max(120).optional(),
  percent: z.union([z.literal(80), z.literal(100)]).optional(),
});

export const NOTIFICATION_ACTION_KINDS = [
  'open_post',
  'open_attempt',
  'reconnect_channel',
  'open_usage',
  'open_plan',
] as const;
export type NotificationActionKind = (typeof NOTIFICATION_ACTION_KINDS)[number];

export const NotificationAction = z.strictObject({
  kind: z.enum(NOTIFICATION_ACTION_KINDS),
  targetId: z.uuid().optional(),
});
export type NotificationAction = z.infer<typeof NotificationAction>;

const base = {
  params: NotificationParams.optional(),
  actions: z.array(NotificationAction).max(5).optional(),
};

/** `refs` của từng loại – mọi trường dùng trong khóa chống trùng PHẢI có ở đây. */
export const NOTIFICATION_REFS = {
  post_pending_review: z.strictObject({
    submissionId: id,
    postIds: z.array(id).min(1).max(50),
    authorUserId: id,
  }),
  post_returned: z.strictObject({ postId: id, postVersion: z.int().min(1), authorUserId: id }),
  approved_post_rescheduled: z.strictObject({
    postId: id,
    postVersion: z.int().min(1),
    byUserId: id,
  }),
  batch_generation_done: z.strictObject({ planId: id, batchId: id, requestedByUserId: id }),
  publish_needs_action: z.strictObject({
    attemptId: id,
    postId: id,
    authorUserId: id,
    state: z.enum(['needs_user', 'needs_check']),
    // 013: hai trường TÙY CHỌN (sự kiện cũ vẫn hợp lệ).
    channelType: z.enum(['facebook_page', 'instagram', 'zalo_oa', 'test_channel']).optional(),
    reason: z
      .enum([
        'token_expired',
        'not_professional_account',
        'media_invalid',
        'rate_limited_daily',
        'plan_expired',
        'overdue',
        'retries_exhausted',
        'uncertain_result',
        'other',
      ])
      .optional(),
  }),
  channel_token_expiring: z.strictObject({ connectionId: id, expiresOn: day }),
  ai_usage_80: z.strictObject({ cycleStart: day }),
  ai_usage_100: z.strictObject({ cycleStart: day }),
  plan_expiring: z.strictObject({ subscriptionId: id, expiresOn: day }),
  data_deletion_scheduled: z.strictObject({ deleteOn: day }),
} as const satisfies Record<NotificationType, z.ZodObject>;

const branch = <T extends NotificationType>(type: T) =>
  z.strictObject({ type: z.literal(type), refs: NOTIFICATION_REFS[type], ...base });

export const NotificationEventSchema = z.discriminatedUnion('type', [
  branch('post_pending_review'),
  branch('post_returned'),
  branch('approved_post_rescheduled'),
  branch('batch_generation_done'),
  branch('publish_needs_action'),
  branch('channel_token_expiring'),
  branch('ai_usage_80'),
  branch('ai_usage_100'),
  branch('plan_expiring'),
  branch('data_deletion_scheduled'),
]);
export type NotificationEvent = z.infer<typeof NotificationEventSchema>;
export type RefsOf<T extends NotificationType> = z.infer<(typeof NOTIFICATION_REFS)[T]>;

export type NotificationRecipient = 'owner' | 'post_author' | 'actor_target';
export type NotificationChannel = 'in_app' | 'email';
export type EmailBatch = 'batch_10m' | 'immediate';

export interface NotificationRule {
  recipients: NotificationRecipient[];
  channels: NotificationChannel[];
  /** Chỉ khi có kênh email. `batch_10m` chỉ ở "Bài cần xử lý / cần kiểm tra". */
  emailBatch: EmailBatch | null;
  /** ≥ 1 hành động khắc phục (FR-044). */
  defaultActions: [NotificationActionKind, ...NotificationActionKind[]];
}

/** Người nhận + kênh + gộp email theo loại (khớp UI/UX mục 8 – đổi bảng = đổi kiểm thử, phải review). */
export const NOTIFICATION_RULES: Record<NotificationType, NotificationRule> = {
  post_pending_review: {
    recipients: ['owner'],
    channels: ['in_app', 'email'],
    emailBatch: 'immediate',
    defaultActions: ['open_post'],
  },
  post_returned: {
    recipients: ['post_author'],
    channels: ['in_app'],
    emailBatch: null,
    defaultActions: ['open_post'],
  },
  approved_post_rescheduled: {
    recipients: ['owner'],
    channels: ['in_app'],
    emailBatch: null,
    defaultActions: ['open_post'],
  },
  batch_generation_done: {
    recipients: ['actor_target'],
    channels: ['in_app'],
    emailBatch: null,
    defaultActions: ['open_plan'],
  },
  publish_needs_action: {
    recipients: ['owner', 'post_author'],
    channels: ['in_app', 'email'],
    emailBatch: 'batch_10m',
    defaultActions: ['open_attempt'],
  },
  channel_token_expiring: {
    recipients: ['owner'],
    channels: ['in_app', 'email'],
    emailBatch: 'immediate',
    defaultActions: ['reconnect_channel'],
  },
  ai_usage_80: {
    recipients: ['owner'],
    channels: ['in_app', 'email'],
    emailBatch: 'immediate',
    defaultActions: ['open_usage'],
  },
  ai_usage_100: {
    recipients: ['owner'],
    channels: ['in_app', 'email'],
    emailBatch: 'immediate',
    defaultActions: ['open_usage'],
  },
  plan_expiring: {
    recipients: ['owner'],
    channels: ['in_app', 'email'],
    emailBatch: 'immediate',
    defaultActions: ['open_plan'],
  },
  data_deletion_scheduled: {
    recipients: ['owner'],
    channels: ['in_app', 'email'],
    emailBatch: 'immediate',
    defaultActions: ['open_plan'],
  },
};
