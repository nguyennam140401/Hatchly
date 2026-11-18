// Hợp đồng web ↔ API của Tiến trình đăng (013, contracts/publishing-http-api.md). Không phụ thuộc gói nào.
import type { AttemptStatus } from '../content/post.js';

/** 5 trạng thái hiển thị cho người dùng thường (FR-027); `retry_wait/unknown/processing` đều là "Đang đăng". */
export type DisplayStatus = 'scheduled' | 'publishing' | 'needs_action' | 'published' | 'cancelled';

export function toDisplayStatus(status: AttemptStatus): DisplayStatus {
  switch (status) {
    case 'scheduled':
      return 'scheduled';
    case 'processing':
    case 'retry_wait':
    case 'unknown':
      return 'publishing';
    case 'needs_user':
    case 'needs_check':
      return 'needs_action';
    case 'succeeded':
      return 'published';
    case 'cancelled':
      return 'cancelled';
  }
}

export const DISPLAY_STATUS_LABELS: Record<DisplayStatus, { labelVi: string; icon: string }> = {
  scheduled: { labelVi: 'Đã lên lịch', icon: 'clock' },
  publishing: { labelVi: 'Đang đăng', icon: 'loader' },
  needs_action: { labelVi: 'Cần bạn xử lý', icon: 'alert' },
  published: { labelVi: 'Đã đăng', icon: 'check' },
  cancelled: { labelVi: 'Đã hủy', icon: 'x' },
};

export const STEP_KEYS = [
  'precheck',
  'prepare_media',
  'submit',
  'await_processing',
  'confirm',
] as const;
export type StepKey = (typeof STEP_KEYS)[number];

export const STEP_LABELS_VI: Record<StepKey, string> = {
  precheck: 'Kiểm tra',
  prepare_media: 'Chuẩn bị ảnh/video',
  submit: 'Gửi lên',
  await_processing: 'Nền tảng xử lý',
  confirm: 'Xác nhận',
};

export type StepState =
  'not_run' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'not_applicable';

export const NEEDS_REASONS = [
  'token_expired',
  'not_professional_account',
  'media_invalid',
  'rate_limited_daily',
  'plan_expired',
  'overdue',
  'retries_exhausted',
  'uncertain_result',
  'reconcile_failed',
  'other',
] as const;
export type NeedsReason = (typeof NEEDS_REASONS)[number];

export type AttemptAction =
  | 'reconnect'
  | 'ask_owner_to_reconnect'
  | 'change_time'
  | 'republish'
  | 'mark_published'
  | 'edit_media'
  | 'contact_support';

export interface StepView {
  stepNo: 1 | 2 | 3 | 4 | 5;
  key: StepKey;
  state: StepState;
  at: string | null;
  note: string | null;
  messageVi: string | null;
  remedies: { action: string; labelVi: string }[];
}

export interface ChannelProgressView {
  attemptId: string;
  channelType: string;
  displayName: string | null;
  status: DisplayStatus;
  needsKind: 'needs_user' | 'needs_check' | null;
  scheduledAt: string;
  permalink: string | null;
  message: string | null;
  remedies: { action: string; labelVi: string }[];
  allowedActions: AttemptAction[];
  version: number;
  steps: StepView[];
}

export interface PublishProgressView {
  postId: string;
  overall: DisplayStatus | null;
  channels: ChannelProgressView[];
}

/** Hành động khắc phục theo vai trò: cộng tác viên không kết nối lại được (FR-025). */
export function remedyActionsForRole(
  actions: readonly AttemptAction[],
  role: 'owner' | 'collaborator',
): AttemptAction[] {
  return actions.map((a) =>
    a === 'reconnect' && role === 'collaborator' ? 'ask_owner_to_reconnect' : a,
  );
}
