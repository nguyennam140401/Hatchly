// Bước 5 – Xác nhận (FR-015): lưu mã bài + đường dẫn, chuyển `succeeded`, kết thúc lượt (`phase = finished`).
// Dùng chung cho ba nguồn xác nhận: nền tảng trả đã đăng (`platform`), đối soát thấy bài (`reconciliation`).
import { tenantTx } from '../../../../core';
import type { JobHandlerResult } from '../../../queue';
import { publishMetrics } from '../metrics';
import { transition } from '../state-machine';
import { finishStep, startStep } from '../step-log';
import type { RunContext } from './types';

export interface ConfirmProof {
  platformPostId: string;
  permalink: string;
  by: 'platform' | 'reconciliation';
  /** Nền tảng đồng bộ (Facebook): bước 4 không áp dụng – ghi để đủ 5 bước (SC-005). */
  logAwaitNotApplicable?: boolean;
  note?: string;
}

export async function confirmSuccess(
  run: RunContext,
  proof: ConfirmProof,
): Promise<JobHandlerResult> {
  const { attempt } = run;
  if (proof.logAwaitNotApplicable === true) {
    await startStep(run.step, 'await_processing');
    await finishStep(run.step, 'await_processing', 'not_applicable', {
      note: 'Nền tảng xử lý ngay khi nhận bài',
    });
  }
  await startStep(run.step, 'confirm');
  const r = await tenantTx((db) =>
    transition(db, attempt.id, ['processing', 'unknown'], 'succeeded', {
      phase: 'finished',
      platform_post_id: proof.platformPostId.slice(0, 500),
      permalink: proof.permalink.slice(0, 2048),
      confirmed_by: proof.by,
      processing_id: null,
      needs_reason: null,
    }),
  );
  if (!r.ok) {
    publishMetrics.duplicateGuard('conditional_update_lost');
    return undefined;
  }
  publishMetrics.transition(attempt.channel_type, attempt.status, 'succeeded');
  publishMetrics.lag(attempt.channel_type, (Date.now() - attempt.scheduled_at.getTime()) / 1000);
  await finishStep(run.step, 'confirm', 'succeeded', {
    ...(proof.note !== undefined ? { note: proof.note } : {}),
  });
  return undefined;
}
