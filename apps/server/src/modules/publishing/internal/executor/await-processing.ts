// Bước 4 – Chờ nền tảng xử lý (FR-015). Chỉ nền tảng bất đồng bộ (Instagram) có bước này: Facebook ghi
// `not_applicable` ở bước xác nhận. Kiểm tra định kỳ bằng `retryAfter` (không giữ Worker), có trần thời gian;
// quá trần → "không xác định" → đối soát (KHÔNG gửi lại – nền tảng đã nhận bài).
import { retryAfter, type JobHandlerResult } from '../../../queue';
import { finishStep } from '../step-log';
import { confirmSuccess } from './confirm';
import { applyFailure, toFailure, toUnknown, type StepFailure } from './outcomes';
import type { ExecutorDeps, RunContext } from './types';

/** Giãn cách kiểm tra theo thời gian đã chờ: dày lúc đầu, thưa dần (giữ số lần thử trong hạn của hàng chờ). */
export function awaitPollDelaySec(elapsedSec: number): number {
  if (elapsedSec < 60) return 15;
  if (elapsedSec < 300) return 45;
  return 90;
}

export async function awaitProcessing(
  deps: ExecutorDeps,
  run: RunContext,
): Promise<JobHandlerResult> {
  const { attempt } = run;
  if (attempt.processing_id === null || attempt.submitted_at === null) {
    // Thiếu mã xử lý: không biết kiểm tra gì → không xác định, đối soát.
    return toUnknown(deps, run, null);
  }
  const elapsedSec = (deps.now().getTime() - attempt.submitted_at.getTime()) / 1000;

  let hasVideo = false;
  try {
    const post = await deps.content.getPost(attempt.post_id);
    hasVideo =
      post?.variants
        .find((v) => v.connectionId === attempt.channel_connection_id)
        ?.media.some((m) => m.kind === 'video') ?? false;
  } catch {
    // Không đọc được bài → dùng trần dài (video) cho an toàn.
    hasVideo = true;
  }
  const maxSec = hasVideo
    ? deps.settings.awaitProcessingMaxSec.video
    : deps.settings.awaitProcessingMaxSec.image;
  if (elapsedSec > maxSec) {
    const failure: StepFailure = {
      category: 'unknown',
      rawCode: 'AWAIT_TIMEOUT',
      messageVi: 'Nền tảng xử lý quá lâu. Hệ thống sẽ đối soát để biết bài đã lên hay chưa.',
      remedies: [{ action: 'check_on_platform', labelVi: 'Kiểm tra trên trang' }],
      needsReason: null,
    };
    await finishStep(run.step, 'await_processing', 'failed', {
      errorCategory: 'unknown',
      rawCode: failure.rawCode ?? 'AWAIT_TIMEOUT',
      messageVi: failure.messageVi,
      remedies: failure.remedies,
    });
    return toUnknown(deps, run, failure);
  }

  let status;
  try {
    status = await deps.gateway.checkStatus(attempt.channel_connection_id, attempt.processing_id);
  } catch {
    // Chưa hỏi được nền tảng → hỏi lại sau, KHÔNG đổi trạng thái.
    return retryAfter(30);
  }
  if (run.signal.aborted) return undefined;

  switch (status.kind) {
    case 'processing':
      return retryAfter(awaitPollDelaySec(elapsedSec));
    case 'done':
      await finishStep(run.step, 'await_processing', 'succeeded');
      return confirmSuccess(run, {
        platformPostId: status.platformPostId,
        permalink: status.permalink,
        by: 'platform',
      });
    case 'failed': {
      const mapped = toFailure(await deps.errorMapping.map(status.error));
      // Nền tảng đã nhận bài nên lỗi tạm thời/lạ KHÔNG được thử lại bằng cách gửi: chuyển thành "không xác định".
      const failure: StepFailure =
        mapped.category === 'user_action' ? mapped : { ...mapped, category: 'unknown' };
      return applyFailure(deps, run, 'await_processing', failure, true);
    }
  }
}
