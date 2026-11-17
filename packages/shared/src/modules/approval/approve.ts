// Khuôn dùng chung cho gửi duyệt, duyệt, trả lại, đổi giờ (012, contracts/http-api.md mục 2–3).
import { z } from 'zod';
import { POST_LIMITS, Remedy } from '../content/post.js';

export const BULK_LIMITS = { submit: 50, approve: 100, suggest: 100 } as const;

const isoUtc = z.iso.datetime();
const version = z.int().min(1);

export const ApproveRequest = z.strictObject({ expectedVersion: version, scheduledAt: isoUtc });
export type ApproveRequest = z.infer<typeof ApproveRequest>;

export const ApproveItem = z.strictObject({
  postId: z.uuid(),
  expectedVersion: version,
  scheduledAt: isoUtc.optional(),
});
export type ApproveItem = z.infer<typeof ApproveItem>;

/** Số phần tử tối đa KHÔNG kiểm ở lược đồ: vượt giới hạn cấu hình → `BULK_LIMIT_EXCEEDED` (422) từ dịch vụ. */
export const SubmitRequest = z.strictObject({ items: z.array(ApproveItem).min(1).max(500) });
export type SubmitRequest = z.infer<typeof SubmitRequest>;

export const ApproveBatchRequest = z.strictObject({ items: z.array(ApproveItem).min(1).max(500) });
export type ApproveBatchRequest = z.infer<typeof ApproveBatchRequest>;

export const VersionOnlyRequest = z.strictObject({ expectedVersion: version });
export type VersionOnlyRequest = z.infer<typeof VersionOnlyRequest>;

/**
 * Ghi chú trả lại: lược đồ chỉ chặn chuỗi quá dài; ghi chú rỗng hoặc > 500 ký tự do dịch vụ trả
 * `RETURN_NOTE_REQUIRED` (422) kèm hành động "Nhập ghi chú" (contracts/http-api.md mục 4).
 */
export const ReturnNote = z.string().max(10_000);

/** Ghi chú hợp lệ (đã cắt khoảng trắng) hoặc `null`. */
export function normalizeReturnNote(note: string): string | null {
  const t = note.trim();
  return t.length >= 1 && t.length <= POST_LIMITS.returnNoteMax ? t : null;
}

export const ReturnRequest = z.strictObject({ expectedVersion: version, note: ReturnNote });
export type ReturnRequest = z.infer<typeof ReturnRequest>;

export const ReturnBatchRequest = z.strictObject({
  items: z
    .array(z.strictObject({ postId: z.uuid(), expectedVersion: version }))
    .min(1)
    .max(500),
  note: ReturnNote,
});
export type ReturnBatchRequest = z.infer<typeof ReturnBatchRequest>;

export const RescheduleRequest = z.strictObject({ expectedVersion: version, scheduledAt: isoUtc });
export type RescheduleRequest = z.infer<typeof RescheduleRequest>;

export const SuggestTimesRequest = z.strictObject({
  count: z.int().min(1).max(BULK_LIMITS.suggest),
  after: isoUtc.optional(),
});
export type SuggestTimesRequest = z.infer<typeof SuggestTimesRequest>;

export interface SuggestTimesResponse {
  times: string[];
}

/** Một kênh vướng khi duyệt/lên lịch – gộp mọi kênh vào MỘT phản hồi để hiện đủ cùng lúc. */
export const ChannelIssue = z.strictObject({
  connectionId: z.uuid(),
  code: z.enum([
    'CHANNEL_INACTIVE',
    'CHANNEL_QUOTA_EXCEEDED',
    'POST_CONTENT_INVALID',
    'CHANNEL_ALREADY_PUBLISHING',
  ]),
  messageVi: z.string(),
  remedies: z.array(Remedy).min(1),
});
export type ChannelIssue = z.infer<typeof ChannelIssue>;

export interface BulkResultItem {
  postId: string;
  status: 'ok' | 'failed';
  error?: {
    code: string;
    message: string;
    extra?: Record<string, unknown>;
  };
}

export interface BulkResult {
  /** Số bài thành công (duyệt / gửi duyệt / trả lại). */
  succeeded: number;
  failed: number;
  results: BulkResultItem[];
}

export interface PendingItem {
  postId: string;
  title: string;
  excerpt: string;
  channelTypes: string[];
  authorUserId: string;
  authorDisplayName: string;
  scheduledAt: string | null;
  version: number;
  timePassed: boolean;
  returned: boolean;
  editedAfterApproval: boolean;
  submittedAt: string | null;
}

export const PendingQuery = z.strictObject({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type PendingQuery = z.infer<typeof PendingQuery>;

export interface PendingListResponse {
  items: PendingItem[];
  nextCursor: string | null;
}

export interface PendingCountResponse {
  count: number;
}
