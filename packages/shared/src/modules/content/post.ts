// Khuôn dùng chung web ↔ API cho bài viết (012, contracts/http-api.md). Giới hạn KHỚP CHECK của CSDL
// (data-model.md mục 1) – lược đồ là lớp chặn thứ nhất, CHECK là lớp thứ hai.
import { z } from 'zod';
import { viIssue } from '../../core/vi-error-messages.js';

export const POST_STATUSES = ['draft', 'pending_review', 'approved', 'cancelled'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const CHANNEL_TYPES = ['facebook_page', 'instagram', 'zalo_oa', 'test_channel'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const POST_LIMITS = {
  internalNameMax: 80,
  textMax: 63_206,
  hashtagsMax: 30,
  hashtagMax: 100,
  mediaMax: 20,
  variantsMax: 10,
  returnNoteMax: 500,
  titleMax: 60,
} as const;

const isoUtc = z.iso.datetime();

/** Hashtag: bỏ khoảng trắng hai đầu và dấu `#` đầu; không chứa khoảng trắng bên trong. */
export const Hashtag = z
  .string()
  .transform((v) => v.trim().replace(/^#+/, ''))
  .pipe(
    z
      .string()
      .min(1)
      .max(POST_LIMITS.hashtagMax)
      .regex(/^\S+$/, 'Hashtag không được chứa khoảng trắng.'),
  );

export const MediaRef = z.strictObject({
  mediaId: z.uuid(),
  kind: z.enum(['image', 'video']),
});
export type MediaRef = z.infer<typeof MediaRef>;

/** Nội dung riêng của một kênh. `customized=false` → hiển thị nội dung chung, `text` bị bỏ. */
export const VariantInput = z.strictObject({
  connectionId: z.uuid(),
  customized: z.boolean(),
  text: z.string().max(POST_LIMITS.textMax).default(''),
  hashtags: z.array(Hashtag).max(POST_LIMITS.hashtagsMax).default([]),
  media: z.array(MediaRef).max(POST_LIMITS.mediaMax).default([]),
});
export type VariantInput = z.infer<typeof VariantInput>;

const postFields = {
  internalName: z.string().trim().max(POST_LIMITS.internalNameMax).nullish(),
  sharedText: z.string().max(POST_LIMITS.textMax),
  scheduledAt: isoUtc.nullish(),
  variants: z.array(VariantInput).max(POST_LIMITS.variantsMax),
};

/** Bài cần ≥ 1 kênh hoặc có chữ (không lưu bài hoàn toàn rỗng). Kênh trùng bị chặn. */
function checkBody(
  v: { sharedText: string; variants: { connectionId: string }[] },
  ctx: z.RefinementCtx,
): void {
  if (v.variants.length === 0 && v.sharedText.trim() === '') {
    ctx.addIssue(viIssue('Hãy chọn ít nhất một kênh hoặc nhập nội dung bài.', ['sharedText']));
  }
  const seen = new Set<string>();
  v.variants.forEach((variant, i) => {
    if (seen.has(variant.connectionId)) {
      ctx.addIssue(viIssue('Mỗi kênh chỉ được chọn một lần.', ['variants', i, 'connectionId']));
    }
    seen.add(variant.connectionId);
  });
}

export const CreatePostRequest = z.strictObject(postFields).superRefine(checkBody);
export type CreatePostRequest = z.infer<typeof CreatePostRequest>;

export const UpdatePostRequest = z
  .strictObject({ expectedVersion: z.int().min(1), ...postFields })
  .superRefine(checkBody);
export type UpdatePostRequest = z.infer<typeof UpdatePostRequest>;

export const PostIdParam = z.strictObject({ id: z.uuid() });
export type PostIdParam = z.infer<typeof PostIdParam>;

export const DeletePostQuery = z.strictObject({ expectedVersion: z.coerce.number().int().min(1) });
export type DeletePostQuery = z.infer<typeof DeletePostQuery>;

// ---------------------------------------------------------------------------------------------
// Kết quả kiểm tra theo kênh (không lưu – tính khi đọc/duyệt)

export const VALIDATION_RULES = [
  'text_length',
  'hashtags',
  'media_required',
  'media_rule',
  'channel_inactive',
  'empty',
] as const;
export type ValidationRule = (typeof VALIDATION_RULES)[number];

export const REMEDY_ACTIONS = [
  'edit_text',
  'edit_media',
  'edit_hashtags',
  'reconnect',
  'remove_channel',
  'choose_other_time',
  'use_suggested_time',
  'view_progress',
  'open_post',
] as const;
export type RemedyAction = (typeof REMEDY_ACTIONS)[number];

export const Remedy = z.strictObject({ action: z.enum(REMEDY_ACTIONS), labelVi: z.string() });
export type Remedy = z.infer<typeof Remedy>;

export const ValidationIssue = z.strictObject({
  rule: z.enum(VALIDATION_RULES),
  messageVi: z.string(),
  remedies: z.array(Remedy).min(1),
});
export type ValidationIssue = z.infer<typeof ValidationIssue>;

// ---------------------------------------------------------------------------------------------
// Bài hiển thị

export const CHANNEL_STATUSES = [
  'active',
  'expiring',
  'expired',
  'disconnected',
  'unknown',
] as const;
export type ChannelStatusValue = (typeof CHANNEL_STATUSES)[number];

export interface PostVariant {
  id: string;
  connectionId: string;
  channelType: ChannelType;
  channelDisplayName: string | null;
  channelStatus: ChannelStatusValue;
  customized: boolean;
  text: string;
  hashtags: string[];
  media: MediaRef[];
  version: number;
  issues: ValidationIssue[];
}

export interface PostLabels {
  returned: { note: string; byUserId: string | null; at: string | null } | null;
  editedAfterApproval: boolean;
  timePassed: boolean;
}

export interface Post {
  id: string;
  status: PostStatus;
  source: 'manual' | 'ai';
  internalName: string | null;
  /** Tên nội bộ hoặc 60 ký tự đầu của nội dung. */
  title: string;
  sharedText: string;
  scheduledAt: string | null;
  version: number;
  labels: PostLabels;
  createdBy: string;
  submittedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  variants: PostVariant[];
}

export interface PostSummary {
  id: string;
  status: PostStatus;
  title: string;
  scheduledAt: string | null;
  version: number;
  labels: PostLabels;
  channelTypes: ChannelType[];
  updatedAt: string;
}

/** Trạng thái đăng của một mục lịch đăng (đọc từ `publishing`). */
export const ATTEMPT_STATUSES = [
  'scheduled',
  'processing',
  'retry_wait',
  'needs_user',
  'unknown',
  'needs_check',
  'succeeded',
  'cancelled',
] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export interface PostAttemptState {
  connectionId: string;
  channelType: ChannelType;
  status: AttemptStatus;
  scheduledAt: string;
}

export interface PostDetailResponse {
  post: Post;
  validation: { connectionId: string; issues: ValidationIssue[] }[];
  attempts: PostAttemptState[];
}

export const PostListQuery = z.strictObject({
  status: z.enum(POST_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type PostListQuery = z.infer<typeof PostListQuery>;

export interface PostListResponse {
  items: PostSummary[];
  nextCursor: string | null;
}

export const ChannelRule = z.strictObject({
  channelType: z.enum(CHANNEL_TYPES),
  maxTextLength: z.int().min(1),
  maxHashtags: z.int().min(0).nullable(),
  mediaRequired: z.boolean(),
  maxPostsPer24h: z.int().min(1).nullable(),
});
export type ChannelRule = z.infer<typeof ChannelRule>;

export interface ChannelRulesResponse {
  rules: ChannelRule[];
}

/** Tiêu đề thẻ bài: tên nội bộ hoặc 60 ký tự đầu của nội dung (cắt theo ký tự Unicode, không cắt đôi emoji). */
export function postTitle(internalName: string | null, sharedText: string): string {
  const name = internalName?.trim();
  if (name !== undefined && name !== '') return name;
  const flat = sharedText.replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length <= POST_LIMITS.titleMax
    ? flat
    : `${chars.slice(0, POST_LIMITS.titleMax - 1).join('')}…`;
}
