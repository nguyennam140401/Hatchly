// Kết thúc lượt đăng: thành công, hủy, thử lại, "cần người dùng", "không xác định", "cần kiểm tra".
// Mọi chuyển đi qua `transition()` (cập nhật có điều kiện); thông báo `publish_needs_action` được phát TRONG CÙNG
// giao dịch chuyển sang `needs_*` (Hiến pháp II/IV) và KHÔNG phát khi lỗi tạm thời (FR-018).
import { sql } from 'drizzle-orm';
import type { StepKey } from '@app/shared/publishing';
import { tenantTx } from '../../../../core';
import { retryAfter, type JobHandlerResult } from '../../../queue';
import type { ChannelType, ClassifiedError } from '../../../platform_gateway';
import type { MappedError } from '../error-mapping.service';
import { publishMetrics } from '../metrics';
import { nextReconcileAction, nextTransientDelay } from '../retry-policy';
import { transition, type TransitionPatch } from '../state-machine';
import { finishStep, sanitizeRawCode, skipRemaining, type StepRemedy } from '../step-log';
import type { ExecutorDeps, RunContext } from './types';

export type NeedsReasonCode =
  | 'token_expired'
  | 'not_professional_account'
  | 'media_invalid'
  | 'rate_limited_daily'
  | 'plan_expired'
  | 'overdue'
  | 'retries_exhausted'
  | 'uncertain_result'
  | 'reconcile_failed'
  | 'other';

/** Kết quả lỗi đã chuẩn hóa của MỘT bước (từ nền tảng hoặc do chính hệ thống phát hiện). */
export interface StepFailure {
  category: ClassifiedError['category'];
  rawCode?: string;
  messageVi: string;
  remedies: StepRemedy[];
  needsReason: NeedsReasonCode | null;
  retryAfterSec?: number;
}

const REASONS = new Set<string>([
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
]);

export function toFailure(mapped: MappedError): StepFailure {
  const { error, needsReason } = mapped;
  return {
    category: error.category,
    rawCode: error.rawCode,
    messageVi: error.messageVi,
    remedies: error.remedies.map((r) => ({ action: r.action, labelVi: r.labelVi })),
    needsReason:
      needsReason !== null && REASONS.has(needsReason) ? (needsReason as NeedsReasonCode) : null,
    ...(error.retryAfterSec !== undefined ? { retryAfterSec: error.retryAfterSec } : {}),
  };
}

/** Lỗi do HỆ THỐNG phát hiện (gói hết hạn, quá giờ hẹn, thiếu media…): luôn cần người dùng, kèm cách sửa. */
export function userFailure(
  needsReason: NeedsReasonCode,
  messageVi: string,
  remedies: StepRemedy[],
  rawCode?: string,
): StepFailure {
  return {
    category: 'user_action',
    messageVi,
    remedies,
    needsReason,
    ...(rawCode !== undefined ? { rawCode } : {}),
  };
}

interface NotifyInfo {
  authorUserId: string;
  postTitle: string | undefined;
  channelDisplayName: string | undefined;
}

/** Đọc người nhận + tên hiển thị TRƯỚC giao dịch chuyển trạng thái (không gọi nền tảng, chỉ module nội bộ). */
async function notifyInfo(deps: ExecutorDeps, run: RunContext): Promise<NotifyInfo> {
  const { attempt } = run;
  let authorUserId: string | undefined;
  let postTitle: string | undefined;
  try {
    const post = await deps.content.getPost(attempt.post_id);
    if (post !== null) {
      authorUserId = post.createdBy;
      const raw = post.internalName ?? post.sharedText;
      postTitle = raw.trim() === '' ? undefined : raw.trim().slice(0, 60);
    }
  } catch {
    // Không đọc được bài → vẫn thông báo cho chủ tài khoản bên dưới.
  }
  let channelDisplayName: string | undefined;
  try {
    const c = await deps.gateway.getConnection(attempt.channel_connection_id);
    channelDisplayName = c?.displayName;
  } catch {
    // Không có tên kênh → mẫu thông báo dùng "kênh".
  }
  if (authorUserId === undefined) {
    const members = await deps.account.listActiveMembers();
    authorUserId = members.find((m) => m.role === 'owner')?.userId ?? members[0]?.userId;
  }
  if (authorUserId === undefined) throw new Error('Không xác định được người nhận thông báo');
  return { authorUserId, postTitle, channelDisplayName };
}

function failureColumns(failure: StepFailure): TransitionPatch {
  return {
    last_error_category: failure.category,
    last_raw_code: sanitizeRawCode(failure.rawCode),
  };
}

const CLEAR_STAMP: TransitionPatch = {
  phase: 'none',
  content_hash: null,
  submitted_at: null,
  processing_id: null,
};

/** `processing → needs_user` + thông báo (cùng giao dịch). Trả `undefined` kể cả khi mất cuộc đua (đã có người xử lý). */
export async function toNeedsUser(
  deps: ExecutorDeps,
  run: RunContext,
  failure: StepFailure,
  reason: NeedsReasonCode,
): Promise<JobHandlerResult> {
  const info = await notifyInfo(deps, run);
  const { attempt } = run;
  await tenantTx(async (db) => {
    const r = await transition(db, attempt.id, 'processing', 'needs_user', {
      ...CLEAR_STAMP,
      ...failureColumns(failure),
      needs_reason: reason,
    });
    if (!r.ok) {
      publishMetrics.duplicateGuard('conditional_update_lost');
      return;
    }
    publishMetrics.transition(attempt.channel_type, 'processing', 'needs_user');
    await deps.notifications.emit(db, {
      type: 'publish_needs_action',
      refs: {
        attemptId: attempt.id,
        postId: attempt.post_id,
        authorUserId: info.authorUserId,
        state: 'needs_user',
        channelType: attempt.channel_type as ChannelType,
        reason: reason === 'reconcile_failed' ? 'other' : reason,
      },
      params: {
        ...(info.postTitle !== undefined ? { postTitle: info.postTitle } : {}),
        ...(info.channelDisplayName !== undefined
          ? { channelDisplayName: info.channelDisplayName }
          : {}),
      },
    });
  });
  return undefined;
}

/** `unknown → needs_check` + thông báo: người dùng chọn "Đã đăng" hoặc "Đăng lại" (FR-020). */
export async function toNeedsCheck(
  deps: ExecutorDeps,
  run: RunContext,
  reason: 'uncertain_result' | 'reconcile_failed',
): Promise<JobHandlerResult> {
  const info = await notifyInfo(deps, run);
  const { attempt } = run;
  await tenantTx(async (db) => {
    const r = await transition(db, attempt.id, 'unknown', 'needs_check', { needs_reason: reason });
    if (!r.ok) {
      publishMetrics.duplicateGuard('conditional_update_lost');
      return;
    }
    publishMetrics.transition(attempt.channel_type, 'unknown', 'needs_check');
    await deps.notifications.emit(db, {
      type: 'publish_needs_action',
      refs: {
        attemptId: attempt.id,
        postId: attempt.post_id,
        authorUserId: info.authorUserId,
        state: 'needs_check',
        channelType: attempt.channel_type as ChannelType,
        reason: 'uncertain_result',
      },
      params: {
        ...(info.postTitle !== undefined ? { postTitle: info.postTitle } : {}),
        ...(info.channelDisplayName !== undefined
          ? { channelDisplayName: info.channelDisplayName }
          : {}),
      },
    });
  });
  return undefined;
}

/** `processing → unknown` (giữ dấu đã gửi): bước kế tiếp là đối soát, KHÔNG gửi lại. */
export async function toUnknown(
  deps: ExecutorDeps,
  run: RunContext,
  failure: StepFailure | null,
): Promise<JobHandlerResult> {
  const { attempt } = run;
  const r = await tenantTx((db) =>
    transition(db, attempt.id, 'processing', 'unknown', failure ? failureColumns(failure) : {}),
  );
  if (!r.ok) {
    publishMetrics.duplicateGuard('conditional_update_lost');
    return undefined;
  }
  publishMetrics.transition(attempt.channel_type, 'processing', 'unknown');
  const submittedAt = r.row.submitted_at ?? deps.now();
  const next = nextReconcileAction(submittedAt, null, deps.now(), deps.settings);
  return retryAfter(next.kind === 'wait' ? Math.max(1, next.delaySec) : 1);
}

/** Lỗi tạm thời ("chắc chắn chưa nhận"): thử lại có giãn cách, tối đa 5 lần / 30 phút (R4). */
export async function toRetryWait(
  deps: ExecutorDeps,
  run: RunContext,
  failure: StepFailure,
): Promise<JobHandlerResult> {
  const { attempt } = run;
  const decision = nextTransientDelay(
    attempt.transient_attempts,
    attempt.transient_window_started_at,
    deps.now(),
    failure.retryAfterSec,
    deps.settings,
  );
  if (decision.kind === 'exhausted') {
    return toNeedsUser(deps, run, failure, 'retries_exhausted');
  }
  const r = await tenantTx((db) =>
    transition(db, attempt.id, 'processing', 'retry_wait', {
      ...CLEAR_STAMP,
      ...failureColumns(failure),
      transient_attempts: sql`${attempt.transient_attempts} + 1`,
      transient_window_started_at: attempt.transient_window_started_at ?? sql`now()`,
    }),
  );
  if (!r.ok) {
    publishMetrics.duplicateGuard('conditional_update_lost');
    return undefined;
  }
  publishMetrics.transition(attempt.channel_type, 'processing', 'retry_wait');
  return retryAfter(Math.max(1, Math.ceil(decision.delaySec)));
}

/** Hủy (bài đã hủy/đổi nội dung, tài khoản đang xóa…): KHÔNG đăng nội dung cũ. */
export async function toCancelled(run: RunContext): Promise<JobHandlerResult> {
  const { attempt } = run;
  const r = await tenantTx((db) =>
    transition(db, attempt.id, 'processing', 'cancelled', { ...CLEAR_STAMP, phase: 'finished' }),
  );
  if (r.ok) publishMetrics.transition(attempt.channel_type, 'processing', 'cancelled');
  return undefined;
}

/**
 * Áp một lỗi của bước `key` lên lượt đăng: ghi bước lỗi (kèm cách khắc phục) + các bước sau "chưa chạy", rồi chuyển
 * trạng thái theo loại lỗi. `submitted` = lượt đã ghi dấu "Đã gửi" (lỗi `unknown` khi đó phải đối soát; trước khi gửi
 * thì chưa có gì để đối soát nên coi như tạm thời – an toàn vì chưa có bài nào lên).
 */
export async function applyFailure(
  deps: ExecutorDeps,
  run: RunContext,
  key: StepKey,
  failure: StepFailure,
  submitted: boolean,
): Promise<JobHandlerResult> {
  await finishStep(run.step, key, 'failed', {
    errorCategory: failure.category,
    ...(failure.rawCode !== undefined ? { rawCode: failure.rawCode } : {}),
    messageVi: failure.messageVi,
    remedies: failure.remedies,
  });
  await skipRemaining(run.step, key);
  switch (failure.category) {
    case 'transient':
      return toRetryWait(deps, run, failure);
    case 'user_action':
      return toNeedsUser(deps, run, failure, failure.needsReason ?? 'other');
    case 'unknown':
      return submitted ? toUnknown(deps, run, failure) : toRetryWait(deps, run, failure);
  }
}
