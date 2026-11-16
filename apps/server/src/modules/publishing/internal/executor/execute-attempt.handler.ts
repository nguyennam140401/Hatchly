// Bộ xử lý `publishing.run_attempt` – thay bộ thực thi tạm của 012 bằng 5 bước đăng thật (013).
// IDEMPOTENT bằng cách ĐỌC TRẠNG THÁI TRƯỚC rồi rẽ nhánh theo `(status, phase)` (research R2, contracts/jobs-and-schedules mục 2):
//   scheduled / retry_wait           → chiếm lượt (`→ processing`, chỉ MỘT Worker thắng) rồi chạy bước 1 → 3 (→ 4 → 5)
//   processing + phase none          → Worker cũ chết trước khi ghi dấu: chạy lại từ bước 1 (chưa gửi gì)
//   *  + submitted_awaiting_response → ĐỐI SOÁT, tuyệt đối KHÔNG gửi lại
//   processing + awaiting_processing → bước 4 → 5
//   unknown                          → đối soát
//   succeeded / cancelled / needs_*  → thoát, không tác dụng phụ
import { sql } from 'drizzle-orm';
import { tenantTx } from '../../../../core';
import type { JobContext, JobHandler } from '../../../queue';
import { retryAfter } from '../../../queue';
import { loadAttempt } from '../attempts.repository';
import { publishMetrics } from '../metrics';
import { transition } from '../state-machine';
import { awaitProcessing } from './await-processing';
import { toNeedsCheck, toNeedsUser, userFailure } from './outcomes';
import { precheck } from './precheck';
import { prepareMedia } from './prepare-media';
import { reconcileStep } from './reconcile';
import { submitStep } from './submit';
import type { ExecutorDeps, RunContext } from './types';

/** Hoãn việc khi chưa bật bộ thực thi (giây) – việc không mất, lượt vẫn `scheduled`. */
export const NO_EXECUTOR_DELAY_SECONDS = 900;

const TERMINAL_OR_WAITING = new Set(['succeeded', 'cancelled', 'needs_user', 'needs_check']);

/** Hàm riêng để TypeScript không "nhớ" `aborted = false` giữa các bước (cờ đổi bất cứ lúc nào). */
function isAborted(run: RunContext): boolean {
  return run.signal.aborted;
}

async function forward(deps: ExecutorDeps, run: RunContext) {
  const pre = await precheck(deps, run);
  if (pre.kind === 'stop') return pre.result;
  if (isAborted(run)) return undefined;
  const media = await prepareMedia(deps, run, pre.value);
  if (media.kind === 'stop') return media.result;
  if (isAborted(run)) return undefined;
  return submitStep(deps, run, pre.value, media.value);
}

export function createExecuteAttemptHandler(deps: ExecutorDeps): JobHandler<{ attemptId: string }> {
  return async ({ attemptId }, jobCtx: JobContext) => {
    const attempt = await tenantTx((db) => loadAttempt(db, attemptId));
    if (attempt === null) return;
    if (TERMINAL_OR_WAITING.has(attempt.status) || attempt.phase === 'finished') return;
    if (deps.mode === 'none') return retryAfter(NO_EXECUTOR_DELAY_SECONDS);

    const run: RunContext = {
      attempt,
      step: { attemptId, runNo: attempt.run_no, traceId: attempt.trace_id },
      signal: jobCtx.signal,
      startedFromScheduled: false,
    };

    if (attempt.status === 'scheduled' || attempt.status === 'retry_wait') {
      // Chiếm lượt: chỉ MỘT Worker đổi được sang `processing`; Worker còn lại thoát, không gọi nền tảng.
      const claimed = await tenantTx((db) =>
        transition(db, attemptId, attempt.status as 'scheduled' | 'retry_wait', 'processing', {
          run_no: sql`run_no + 1`,
        }),
      );
      if (!claimed.ok) {
        publishMetrics.duplicateGuard('conditional_update_lost');
        return;
      }
      publishMetrics.transition(attempt.channel_type, attempt.status, 'processing');
      run.attempt = claimed.row;
      run.step = { attemptId, runNo: claimed.row.run_no, traceId: claimed.row.trace_id };
      run.startedFromScheduled = attempt.status === 'scheduled';
      return forward(deps, run);
    }

    if (attempt.status === 'unknown') return reconcileStep(deps, run);

    // status = 'processing'
    switch (attempt.phase) {
      case 'none':
        return forward(deps, run);
      case 'submitted_awaiting_response':
        publishMetrics.duplicateGuard('phase_resume');
        return reconcileStep(deps, run);
      case 'awaiting_processing':
        return awaitProcessing(deps, run);
    }
  };
}

/**
 * Việc `publish` hết số lần thử và bị chôn (Worker chết nhiều lần…): KHÔNG gửi lại. Đã từng ghi dấu "đã gửi" →
 * "Cần kiểm tra" (người dùng quyết); chưa gửi gì → "Cần người dùng" để họ bấm "Đăng lại".
 */
export function createFinalFailureHandler(deps: ExecutorDeps) {
  return async (payload: { attemptId: string }): Promise<void> => {
    let attempt = await tenantTx((db) => loadAttempt(db, payload.attemptId));
    if (attempt === null || TERMINAL_OR_WAITING.has(attempt.status)) return;
    const run: RunContext = {
      attempt,
      step: { attemptId: attempt.id, runNo: attempt.run_no, traceId: attempt.trace_id },
      signal: new AbortController().signal,
      startedFromScheduled: false,
    };
    const stamped = attempt.phase !== 'none' || attempt.status === 'unknown';
    if (stamped) {
      if (attempt.status === 'processing') {
        await tenantTx((db) => transition(db, payload.attemptId, 'processing', 'unknown'));
      }
      attempt = await tenantTx((db) => loadAttempt(db, payload.attemptId));
      if (attempt === null) return;
      run.attempt = attempt;
      await toNeedsCheck(deps, run, 'uncertain_result');
      return;
    }
    if (attempt.status !== 'processing') {
      const c = await tenantTx((db) =>
        transition(
          db,
          payload.attemptId,
          attempt.status as 'scheduled' | 'retry_wait',
          'processing',
        ),
      );
      if (!c.ok) return;
      run.attempt = c.row;
    }
    await toNeedsUser(
      deps,
      run,
      userFailure(
        'other',
        'Hệ thống chưa đăng được bài này sau nhiều lần thử. Hãy bấm "Đăng lại" hoặc liên hệ hỗ trợ.',
        [{ action: 'contact_support', labelVi: 'Liên hệ hỗ trợ' }],
        'RETRIES_EXHAUSTED',
      ),
      'other',
    );
  };
}
