// Lược đồ Zod của thư viện media (014 contracts/media-http-api.md) – dùng chung máy chủ (`@ValidBody`,
// `@ValidQuery`, `@ValidParam`) và web (`safeParse` phản hồi). Mọi thân yêu cầu là `z.strictObject`:
// KHÔNG trường nào nhận mã tài khoản (nguyên tắc I – mã tài khoản chỉ lấy từ phiên).
import { z } from 'zod';
import { Id, UtcDateTime } from '../../core/primitives.js';
import { MEDIA_LIMITS } from './limits.js';

export const MEDIA_KINDS = ['image', 'video'] as const;
export const MediaKindSchema = z.enum(MEDIA_KINDS);

/** `uploading` không bao giờ xuất hiện trong lưới thư viện. */
export const MEDIA_STATUSES = ['processing', 'ready', 'unprocessable'] as const;
export const MediaStatusSchema = z.enum(MEDIA_STATUSES);
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const UPLOAD_STATES = [
  'open',
  'completing',
  'completed',
  'cancelled',
  'expired',
  'failed',
  'duplicate',
] as const;
export const UploadStateSchema = z.enum(UPLOAD_STATES);
export type UploadState = (typeof UPLOAD_STATES)[number];

// ---------- Yêu cầu ----------

export const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

export const StartUploadBody = z.strictObject({
  fileName: z.string().min(1).max(255),
  sizeBytes: z.int().positive(),
  // Chuỗi (không z.enum): loại không nhận trả `MEDIA_TYPE_UNSUPPORTED` kèm cách khắc phục, không phải lỗi khuôn chung.
  contentType: z.string().min(1).max(100),
  fingerprint: z.string().regex(FINGERPRINT_PATTERN),
});
export type StartUploadBody = z.infer<typeof StartUploadBody>;

export const PartUrlsBody = z.strictObject({
  partNumbers: z.array(z.int().min(1)).min(1).max(20),
});
export type PartUrlsBody = z.infer<typeof PartUrlsBody>;

export const ListQuery = z.strictObject({
  kind: MediaKindSchema.optional(),
  from: UtcDateTime.optional(),
  to: UtcDateTime.optional(),
  q: z.string().max(100).optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(40),
});
export type ListQuery = z.infer<typeof ListQuery>;

export const MediaIdParam = z.strictObject({ mediaId: Id });
export type MediaIdParam = z.infer<typeof MediaIdParam>;
export const UploadIdParam = z.strictObject({ uploadId: Id });
export type UploadIdParam = z.infer<typeof UploadIdParam>;

export const DeleteQuery = z.strictObject({
  confirm: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
export type DeleteQuery = z.infer<typeof DeleteQuery>;

// ---------- Phản hồi ----------

/** Phần trăm đã dùng = floor((đã dùng + giữ chỗ) / trần × 100). */
export function quotaPercent(used: number, reserved: number, limit: number): number {
  if (limit <= 0) return 100;
  return Math.floor(((used + reserved) * 100) / limit);
}

export type QuotaState = 'ok' | 'near_full' | 'full';

export function quotaState(used: number, reserved: number, limit: number): QuotaState {
  if (used + reserved >= limit) return 'full';
  return quotaPercent(used, reserved, limit) >= MEDIA_LIMITS.nearFullPercent ? 'near_full' : 'ok';
}

export const Quota = z.strictObject({
  usedBytes: z.int().nonnegative(),
  reservedBytes: z.int().nonnegative(),
  limitBytes: z.int().positive(),
  percent: z.int().min(0).max(100),
  state: z.enum(['ok', 'near_full', 'full']),
});
export type Quota = z.infer<typeof Quota>;

/** Dựng `Quota` từ ba con số của `media.storage_quotas`. */
export function buildQuota(used: number, reserved: number, limit: number): Quota {
  return {
    usedBytes: used,
    reservedBytes: reserved,
    limitBytes: limit,
    percent: Math.min(100, quotaPercent(used, reserved, limit)),
    state: quotaState(used, reserved, limit),
  };
}

export const MediaFailure = z.strictObject({
  code: z.string(),
  title: z.string(),
  action: z.string(),
});

export const MediaItem = z.strictObject({
  id: Id,
  kind: MediaKindSchema,
  displayName: z.string(),
  status: MediaStatusSchema,
  originalBytes: z.int().nonnegative(),
  width: z.int().positive().nullable(),
  height: z.int().positive().nullable(),
  durationMs: z.int().nonnegative().nullable(),
  createdAt: UtcDateTime,
  /** `displayName` null khi người tải đã rời tài khoản – web hiện "Thành viên đã rời". */
  uploadedBy: z.strictObject({ userId: Id.nullable(), displayName: z.string().nullable() }),
  thumbUrl: z.string().nullable(),
  failure: MediaFailure.nullable(),
  canDelete: z.boolean(),
});
export type MediaItem = z.infer<typeof MediaItem>;

export const MediaDetail = MediaItem.extend({
  previewUrl: z.string().nullable(),
  mimeType: z.string().nullable(),
});
export type MediaDetail = z.infer<typeof MediaDetail>;

export const ListResponse = z.strictObject({
  items: z.array(MediaItem),
  nextCursor: z.string().nullable(),
  quota: Quota,
});
export type ListResponse = z.infer<typeof ListResponse>;

const PostUpload = z.strictObject({
  url: z.string(),
  fields: z.record(z.string(), z.string()),
  expiresAt: UtcDateTime,
});

const UploadStartBase = {
  uploadId: Id,
  mediaId: Id,
  resumed: z.boolean(),
  expiresAt: UtcDateTime,
  previousExpired: z.boolean().optional(),
};

export const StartUploadResponse = z.discriminatedUnion('mode', [
  z.strictObject({ ...UploadStartBase, mode: z.literal('single'), post: PostUpload }),
  z.strictObject({
    ...UploadStartBase,
    mode: z.literal('multipart'),
    partSizeBytes: z.int().positive(),
    partCount: z.int().positive(),
    completedParts: z.array(z.int().positive()),
  }),
]);
export type StartUploadResponse = z.infer<typeof StartUploadResponse>;

export const PartUrlsResponse = z.strictObject({
  parts: z.array(
    z.strictObject({
      partNumber: z.int().positive(),
      url: z.string(),
      contentLength: z.int().positive(),
      expiresAt: UtcDateTime,
    }),
  ),
});
export type PartUrlsResponse = z.infer<typeof PartUrlsResponse>;

export const CompleteUploadResponse = z.strictObject({
  uploadId: Id,
  mediaId: Id,
  state: z.literal('completed'),
});
export type CompleteUploadResponse = z.infer<typeof CompleteUploadResponse>;

export const UploadStatusResponse = z.strictObject({
  uploadId: Id,
  state: UploadStateSchema,
  mediaId: Id.nullable(),
  mediaStatus: z.enum(['uploading', ...MEDIA_STATUSES]).nullable(),
  duplicateOf: z.strictObject({ mediaId: Id, displayName: z.string() }).nullable(),
  failureCode: z.string().nullable(),
  completedParts: z.array(z.int().positive()).optional(),
  expiresAt: UtcDateTime,
});
export type UploadStatusResponse = z.infer<typeof UploadStatusResponse>;

/** Trạng thái bài đang dùng media (do nhà cung cấp "bài dùng media" của 012/013 trả). */
export const MEDIA_USAGE_STATUSES = [
  'draft',
  'pending_review',
  'approved',
  'scheduled',
  'published',
  'failed',
  'cancelled',
] as const;
export type MediaUsageStatus = (typeof MEDIA_USAGE_STATUSES)[number];
/** Bài ở các trạng thái này chặn xóa media (không có đường xác nhận). */
export const MEDIA_USAGE_BLOCKING_STATUSES = ['approved', 'scheduled'] as const;

export const MediaUsage = z.strictObject({
  postId: Id,
  postTitle: z.string(),
  postStatus: z.enum(MEDIA_USAGE_STATUSES),
});
export type MediaUsage = z.infer<typeof MediaUsage>;

export const UsagesResponse = z.strictObject({
  usages: z.array(MediaUsage),
  blocking: z.boolean(),
});
export type UsagesResponse = z.infer<typeof UsagesResponse>;
