// Đối soát (FR-019/020, research R5). Chạy khi lượt ở trạng thái `unknown` (hoặc `processing` đã ghi dấu đã gửi
// mà Worker cũ chết): hỏi nền tảng "bài có nội dung này đã lên chưa" – KHÔNG BAO GIỜ gửi lại trước khi biết.
//  - thấy bài            → `succeeded` (xác nhận nhờ đối soát), 1 bài duy nhất;
//  - không thấy sau 10'  → thử lại ĐÚNG MỘT LẦN (cờ `reconcile_retry_used`), lần sau vẫn mơ hồ → "Cần kiểm tra";
//  - kênh không đối soát → "Cần kiểm tra" ngay để người dùng chọn "Đã đăng" hoặc "Đăng lại".
import { sql } from 'drizzle-orm';
import { tenantTx } from '../../../../core';
import type { ChannelType } from '../../../platform_gateway';
import { retryAfter, type JobHandlerResult } from '../../../queue';
import { publishAttempts } from '../db/schema';
import { publishMetrics } from '../metrics';
import { nextReconcileAction, reconcileExpired } from '../retry-policy';
import { transition } from '../state-machine';
import { finishStep } from '../step-log';
import { confirmSuccess } from './confirm';
import { toNeedsCheck } from './outcomes';
import type { ExecutorDeps, RunContext } from './types';

const UNCERTAIN_REMEDIES = [
  {
    action: 'check_on_platform',
    labelVi: 'Kiểm tra trên trang rồi chọn "Đã đăng" hoặc "Đăng lại"',
  },
];

export async function reconcileStep(
  deps: ExecutorDeps,
  run: RunContext,
): Promise<JobHandlerResult> {
  let attempt = run.attempt;
  // Lượt `processing` đã ghi dấu mà Worker chết: chuyển `unknown` rồi đối soát.
  if (attempt.status === 'processing') {
    const r = await tenantTx((db) => transition(db, attempt.id, 'processing', 'unknown'));
    if (!r.ok) {
      publishMetrics.duplicateGuard('conditional_update_lost');
      return undefined;
    }
    publishMetrics.transition(attempt.channel_type, 'processing', 'unknown');
    attempt = r.row;
    run.attempt = attempt;
  }

  const channelType = attempt.channel_type as ChannelType;

  const needsCheck = async (
    reason: 'uncertain_result' | 'reconcile_failed',
    rawCode: string,
    result: 'unsupported' | 'not_found',
  ): Promise<JobHandlerResult> => {
    publishMetrics.reconcile(attempt.channel_type, result);
    await finishStep(run.step, 'confirm', 'failed', {
      errorCategory: 'unknown',
      rawCode,
      messageVi:
        'Chưa rõ bài đã lên kênh hay chưa. Hãy kiểm tra trên trang rồi chọn "Đã đăng" hoặc "Đăng lại" để tránh đăng trùng.',
      remedies: UNCERTAIN_REMEDIES,
    });
    return toNeedsCheck(deps, run, reason);
  };

  const { submitted_at: submittedAt, content_hash: contentHash } = attempt;
  if (
    !deps.gateway.capabilities(channelType).reconcile ||
    submittedAt === null ||
    contentHash === null
  ) {
    return needsCheck('uncertain_result', 'RECONCILE_UNSUPPORTED', 'unsupported');
  }
  const now = deps.now();

  const wait = nextReconcileAction(submittedAt, null, now, deps.settings);
  if (wait.kind === 'wait') return retryAfter(Math.max(1, wait.delaySec));

  let result;
  try {
    result = await deps.gateway.reconcile({
      connectionId: attempt.channel_connection_id,
      contentHash,
      from: new Date(submittedAt.getTime() - deps.settings.reconcileLookbackSec * 1000),
      to: now,
    });
  } catch {
    // Chưa hỏi được nền tảng: hỏi lại sau, không đổi trạng thái.
    return retryAfter(deps.settings.reconcilePollSec);
  }
  if (run.signal.aborted) return undefined;

  switch (result.kind) {
    case 'found':
      publishMetrics.reconcile(attempt.channel_type, 'found');
      return confirmSuccess(run, {
        platformPostId: result.platformPostId,
        permalink: result.permalink,
        by: 'reconciliation',
        note: 'Xác nhận nhờ đối soát',
      });
    case 'unsupported':
      return needsCheck('uncertain_result', 'RECONCILE_UNSUPPORTED', 'unsupported');
    case 'not_found': {
      publishMetrics.reconcile(attempt.channel_type, 'not_found');
      if (!reconcileExpired(submittedAt, now, deps.settings)) {
        return retryAfter(deps.settings.reconcilePollSec);
      }
      if (attempt.reconcile_retry_used) {
        return needsCheck('reconcile_failed', 'RECONCILE_NOT_FOUND', 'not_found');
      }
      // Thử lại ĐÚNG MỘT LẦN: cờ đặt bằng cập nhật có điều kiện để hai Worker không cùng "thử lại một lần".
      const r = await tenantTx((db) =>
        transition(
          db,
          attempt.id,
          'unknown',
          'retry_wait',
          {
            reconcile_retry_used: true,
            phase: 'none',
            content_hash: null,
            submitted_at: null,
            processing_id: null,
          },
          { extra: sql`${publishAttempts.reconcile_retry_used} = false` },
        ),
      );
      if (!r.ok) {
        publishMetrics.duplicateGuard('conditional_update_lost');
        return undefined;
      }
      publishMetrics.transition(attempt.channel_type, 'unknown', 'retry_wait');
      await finishStep(run.step, 'confirm', 'failed', {
        errorCategory: 'unknown',
        rawCode: 'RECONCILE_NOT_FOUND',
        messageVi: 'Chưa thấy bài trên kênh sau 10 phút. Hệ thống sẽ thử đăng lại một lần.',
        remedies: [{ action: 'retry_later', labelVi: 'Chờ hệ thống thử lại' }],
      });
      return retryAfter(1);
    }
  }
}
