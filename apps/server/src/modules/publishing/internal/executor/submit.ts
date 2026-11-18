// Bước 3 – Gửi (FR-004, research R3). Ba pha tách rời, MỖI pha một giao dịch ngắn đã commit:
//   A. ghi dấu "Đã gửi, chờ phản hồi" (`phase`, `content_hash`, `submitted_at`) bằng UPDATE có điều kiện;
//   B. gọi nền tảng NGOÀI mọi giao dịch (không giữ kết nối CSDL khi chờ mạng);
//   C. ghi kết quả theo loại.
// Worker chết sau A → lần chạy sau thấy `submitted_awaiting_response` và ĐỐI SOÁT, không bao giờ gửi lại.
import { tenantTx } from '../../../../core';
import { retryAfter, type JobHandlerResult } from '../../../queue';
import { publishMetrics } from '../metrics';
import { stampSubmitted, updateInPlace } from '../state-machine';
import { finishStep, startStep } from '../step-log';
import { confirmSuccess } from './confirm';
import { applyFailure, toFailure, type StepFailure } from './outcomes';
import type { PrecheckValue } from './precheck';
import type { PreparedMedia } from './prepare-media';
import type { ExecutorDeps, RunContext } from './types';

/** Lần kiểm tra đầu sau khi nền tảng nhận media (giây). */
const FIRST_AWAIT_DELAY_SEC = 10;

export async function submitStep(
  deps: ExecutorDeps,
  run: RunContext,
  pre: PrecheckValue,
  media: PreparedMedia,
): Promise<JobHandlerResult> {
  const { attempt } = run;
  await startStep(run.step, 'submit');

  // A. Dấu "đã gửi" TRƯỚC khi gọi nền tảng.
  const contentHash = deps.gateway.contentHash(pre.channelType, pre.text);
  const stamp = await tenantTx((db) => stampSubmitted(db, attempt.id, contentHash));
  if (!stamp.ok) {
    // Có Worker khác đã ghi dấu (hoặc lượt đã đổi trạng thái): TUYỆT ĐỐI không gửi.
    publishMetrics.duplicateGuard('conditional_update_lost');
    return undefined;
  }
  run.attempt = stamp.row;

  // B. Gọi nền tảng (ngoài giao dịch).
  const startedAt = Date.now();
  let result;
  try {
    result = await deps.gateway.submit({
      connectionId: attempt.channel_connection_id,
      text: pre.text,
      media: media.items,
      contentHash,
      traceId: attempt.trace_id,
    });
  } catch {
    // Đã ghi dấu nên KHÔNG biết nền tảng nhận chưa → "không xác định", đối soát (không gửi lại).
    const failure: StepFailure = {
      category: 'unknown',
      rawCode: 'SUBMIT_EXCEPTION',
      messageVi: 'Chưa rõ bài đã lên hay chưa. Hệ thống sẽ đối soát trước khi làm gì tiếp.',
      remedies: [{ action: 'check_on_platform', labelVi: 'Kiểm tra trên trang' }],
      needsReason: null,
    };
    return applyFailure(deps, run, 'submit', failure, true);
  }
  publishMetrics.stepDuration('submit', (Date.now() - startedAt) / 1000);
  // Khóa hết/Worker tắt trong lúc chờ: KHÔNG ghi kết quả; trạng thái đã commit cho phép lần sau đối soát an toàn.
  if (run.signal.aborted) return undefined;

  // C. Ghi kết quả.
  switch (result.kind) {
    case 'published':
      await finishStep(run.step, 'submit', 'succeeded');
      return confirmSuccess(run, {
        platformPostId: result.platformPostId,
        permalink: result.permalink,
        by: 'platform',
        logAwaitNotApplicable: true,
      });
    case 'processing': {
      const r = await tenantTx((db) =>
        updateInPlace(
          db,
          attempt.id,
          { status: 'processing', phase: 'submitted_awaiting_response' },
          { phase: 'awaiting_processing', processing_id: result.processingId.slice(0, 500) },
        ),
      );
      if (!r.ok) {
        publishMetrics.duplicateGuard('conditional_update_lost');
        return undefined;
      }
      await finishStep(run.step, 'submit', 'succeeded', { note: 'Nền tảng đã nhận, đang xử lý' });
      await startStep(run.step, 'await_processing');
      return retryAfter(FIRST_AWAIT_DELAY_SEC);
    }
    case 'failed': {
      const failure = toFailure(await deps.errorMapping.map(result.error));
      return applyFailure(deps, run, 'submit', failure, true);
    }
  }
}
