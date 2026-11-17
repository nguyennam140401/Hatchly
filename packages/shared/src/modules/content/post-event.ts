// Lịch sử bài (012, contracts/http-api.md mục 3): chỉ thêm, KHÔNG chứa nội dung bài.
import { z } from 'zod';

export const POST_EVENT_TYPES = [
  'created',
  'submitted',
  'withdrawn',
  'approved',
  'returned',
  'unscheduled',
  'rescheduled',
  'edited_after_approval',
  'channels_changed',
] as const;
export type PostEventType = (typeof POST_EVENT_TYPES)[number];

/** Khuôn `data` theo loại sự kiện – chỉ mã, phiên bản, giờ và ghi chú trả lại (lời của chủ). */
export const PostEventData = z.strictObject({
  fromVersion: z.int().optional(),
  toVersion: z.int().optional(),
  note: z.string().max(500).optional(),
  fromAt: z.string().nullish(),
  toAt: z.string().nullish(),
  submissionId: z.uuid().optional(),
});
export type PostEventData = z.infer<typeof PostEventData>;

export interface PostEvent {
  type: PostEventType;
  actorUserId: string;
  actorDisplayName: string;
  at: string;
  data: PostEventData;
}

export interface PostHistoryResponse {
  events: PostEvent[];
}
