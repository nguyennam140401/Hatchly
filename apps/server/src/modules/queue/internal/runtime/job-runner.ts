// Chạy MỘT lượt việc (research R5, R7, FR-014/015/016): giải phong bì, đặt lại ngữ cảnh tenant, gia hạn
// khóa (heartbeat), hủy khi sắp hết khóa / mất khóa / tắt quá hạn, ánh xạ kết quả của bộ xử lý.
// Kết quả chỉ ghi khi lượt còn giữ khóa (`JobAttempt` – lượt cũ chạy chậm không ghi đè lượt mới).
import type { Pool } from 'pg';
import { runWithJobContext } from '../../../../core/context/bind-account';
import { getJobType, upgradePayload } from '../../job-types';
import type { DeadJobCause, JobContext, JobHandlerResult, QueueName } from '../../public-api';
import { isNoRetry, isRetryAfter, PermanentJobError } from '../../results';
import { getHandler } from '../handlers';
import type { QueueLogger } from '../logger';
import type { FinishOutcome, QueueMetrics } from '../observability';
import type { BossJob, PgBoss } from '../pgboss/boss-loader';
import { clientDatabase } from '../pgboss/tx-database';
import { payloadRef, redactError } from '../redact';
import { buryJob, readEnvelope } from './bury';
import { retryDelaySeconds } from './retry-policy';
import type { SettingsCache } from './settings';

/** Nhịp gia hạn khóa (R5: mỗi 10 giây, heartbeat của hàng chờ 30 giây). */
export const DEFAULT_HEARTBEAT_EVERY_MS = 10_000;
/** Hủy bộ xử lý khi còn ngần này tới trần cứng "thời gian khóa". */
const LOCK_DEADLINE_MARGIN_MS = 5_000;

export type AbortReason = 'lock_lost' | 'lock_deadline' | 'shutdown' | 'purged';

export interface RunnerDeps {
  boss: PgBoss;
  /** Bể điều khiển (vai trò `system`). */
  pool: Pool;
  settings: SettingsCache;
  logger: QueueLogger;
  metrics: QueueMetrics;
  heartbeatEveryMs?: number;
  /** Lần gọi CSDL của bể điều khiển thành công (kiểm tra sẵn sàng). */
  onControlSuccess?: () => void;
  /** Đăng ký bộ hủy để tắt quá hạn hủy được mọi lượt đang chạy. */
  track?: (abort: (reason: AbortReason) => void) => () => void;
  random?: () => number;
}

class AbortedError extends Error {
  constructor(readonly reason: AbortReason) {
    super(`Lượt chạy bị hủy: ${reason}`);
    this.name = 'AbortedError';
  }
}

/** Lỗi tạm thời do lớp hàng chờ phát hiện (không phải lỗi của bộ xử lý). */
class TransientQueueError extends Error {
  constructor(
    readonly code: 'NO_HANDLER' | 'PAYLOAD_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'TransientQueueError';
  }
}

export interface RunOutcome {
  outcome: FinishOutcome;
  retryInSeconds?: number;
  cause?: DeadJobCause;
}

/** Ghi lỗi/hủy/thử lại trong MỘT giao dịch trên bể điều khiển: fail + đặt giờ thử lại (R7). */
async function failWithDelay(
  deps: RunnerDeps,
  queue: QueueName,
  job: BossJob,
  seconds: number,
  output: object,
): Promise<boolean> {
  const client = await deps.pool.connect();
  try {
    await client.query('BEGIN');
    const db = clientDatabase(client);
    const failed = (await deps.boss.fail(
      queue,
      { id: job.id, retryCount: job.retryCount },
      output,
      {
        db,
      },
    )) as { affected?: number };
    if (failed.affected === 0) {
      await client.query('ROLLBACK');
      return false;
    }
    await deps.boss.update(queue, undefined, { id: job.id, startAfter: seconds, db });
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Chạy một việc đã lấy (`active`, lượt `job.retryCount`). Không bao giờ ném. */
export async function runJob(
  deps: RunnerDeps,
  queue: QueueName,
  job: BossJob,
): Promise<RunOutcome> {
  const started = Date.now();
  const env = readEnvelope(job.data, job.groupId ?? null);
  const settings = deps.settings.get(queue);
  const def = getJobType(env.type);
  const registered = getHandler(env.type);
  const typeMax = def?.retry?.maxRetries ?? Number.POSITIVE_INFINITY;
  const maxRetries = Math.min(settings.maxRetries, typeMax, job.retryLimit);
  const attempt = job.retryCount + 1;
  const waitMs = Math.max(0, started - new Date(job.startAfter).getTime());

  const controller = new AbortController();
  let abortReason: AbortReason | undefined;
  const abort = (reason: AbortReason) => {
    if (abortReason !== undefined) return;
    abortReason = reason;
    controller.abort(new AbortedError(reason));
  };
  const untrack = deps.track?.(abort) ?? (() => undefined);

  // Gia hạn khóa: touch() có rào theo lượt; 0 dòng → việc đã bị trả lại/xóa → hủy.
  const heartbeat = setInterval(() => {
    deps.boss
      .touch(queue, { id: job.id, retryCount: job.retryCount })
      .then((r) => {
        deps.onControlSuccess?.();
        if ((r as { affected?: number }).affected === 0) abort('lock_lost');
      })
      .catch(() => undefined);
  }, deps.heartbeatEveryMs ?? DEFAULT_HEARTBEAT_EVERY_MS);
  // Trần cứng: thời gian khóa của việc tính từ lúc lấy.
  const lockMs = (job.expireInSeconds || settings.lockSeconds) * 1000;
  const deadline = setTimeout(
    () => {
      abort('lock_deadline');
    },
    Math.max(1000, lockMs - LOCK_DEADLINE_MARGIN_MS),
  );

  let handlerResult: JobHandlerResult = undefined;
  let handlerError: unknown;
  try {
    handlerResult = await runWithJobContext(
      { traceId: env.traceId, accountId: env.accountId ?? undefined },
      async () => {
        // Mã tài khoản trong dữ liệu lệch group_id (đã qua RLS) → không chạy bộ xử lý (hiến pháp I).
        if (env.accountMismatch) {
          throw new PermanentJobError(
            'ACCOUNT_MISMATCH',
            'Mã tài khoản trong dữ liệu việc không khớp group_id',
          );
        }
        if (registered === undefined || def === undefined) {
          throw new TransientQueueError(
            'NO_HANDLER',
            `Không có bộ xử lý cho loại việc ${env.type}`,
          );
        }
        let payload: unknown;
        try {
          payload = upgradePayload(def, env.payload, env.v);
        } catch {
          throw new TransientQueueError('PAYLOAD_INVALID', `Dữ liệu việc ${env.type} sai khuôn`);
        }
        const ctx: JobContext = {
          jobId: job.id,
          type: env.type,
          queue,
          attempt,
          maxRetries,
          accountId: env.accountId,
          traceId: env.traceId,
          signal: controller.signal,
        };
        // Bộ xử lý tự mở tenantTx/systemTx khi cần – lớp hàng chờ KHÔNG bọc giao dịch dài.
        return registered.handler(payload, ctx);
      },
    );
  } catch (err) {
    handlerError = err;
  } finally {
    clearInterval(heartbeat);
    clearTimeout(deadline);
    untrack();
  }

  const finish = (result: RunOutcome, error?: unknown): RunOutcome => {
    const seconds = (Date.now() - started) / 1000;
    deps.metrics.jobFinished(queue, env.type, result.outcome, seconds);
    const redacted = error === undefined ? undefined : redactError(error);
    const entry = {
      event: 'queue.job_finished',
      trace_id: env.traceId,
      account_id: env.accountId,
      queue,
      job_type: env.type,
      job_id: job.id,
      attempt,
      max_retries: maxRetries,
      duration_ms: Math.round(seconds * 1000),
      wait_ms: waitMs,
      outcome: result.outcome,
      ...(result.retryInSeconds !== undefined ? { retry_in_s: result.retryInSeconds } : {}),
      ...(result.cause !== undefined ? { cause: result.cause } : {}),
      ...(redacted !== undefined
        ? { error_code: redacted.code ?? redacted.name, error_message: redacted.message }
        : {}),
      payload_ref: payloadRef(env.payload),
    };
    if (result.outcome === 'completed') deps.logger.info(entry);
    else deps.logger.warn(entry);
    return result;
  };

  // Lượt đã bị hủy: KHÔNG ghi kết quả – việc được trả lại sau heartbeat hoặc đã bị xóa (R5, FR-037).
  if (abortReason !== undefined) {
    deps.logger.warn({
      event: 'queue.job_aborted',
      trace_id: env.traceId,
      account_id: env.accountId,
      queue,
      job_type: env.type,
      job_id: job.id,
      attempt,
      reason: abortReason,
    });
    return finish({ outcome: 'aborted' });
  }

  const attemptRef = { id: job.id, retryCount: job.retryCount };
  const dedupeKey = job.singletonKey ?? `${env.type}:${job.id}`;
  const bury = async (cause: DeadJobCause, error: unknown): Promise<RunOutcome> => {
    const buried = await buryJob(deps, {
      queue,
      jobId: job.id,
      attempt: attemptRef,
      data: job.data,
      groupId: job.groupId ?? null,
      dedupeKey,
      attempts: attempt,
      jobCreatedAt: new Date(job.createdOn),
      cause,
      error,
    });
    if (buried.lost === true) return finish({ outcome: 'aborted' });
    return finish({ outcome: 'dead', cause }, error);
  };
  const retryOrBury = async (
    seconds: number,
    error: unknown,
    exhaustedCause: DeadJobCause,
  ): Promise<RunOutcome> => {
    if (job.retryCount >= maxRetries) return bury(exhaustedCause, error);
    const redacted = error === undefined ? null : redactError(error);
    const ok = await failWithDelay(deps, queue, job, seconds, {
      outcome: 'retry',
      ...(redacted !== null ? { error: redacted } : {}),
    });
    if (!ok) return finish({ outcome: 'aborted' });
    return finish({ outcome: 'retry', retryInSeconds: seconds }, error);
  };

  try {
    if (handlerError === undefined) {
      if (isRetryAfter(handlerResult)) {
        return await retryOrBury(handlerResult.seconds, undefined, 'RETRIES_EXHAUSTED');
      }
      const output = isNoRetry(handlerResult)
        ? { outcome: 'no_retry', reason: handlerResult.reason }
        : { outcome: 'completed' };
      await deps.boss.complete(queue, attemptRef, output);
      deps.onControlSuccess?.();
      return finish({ outcome: isNoRetry(handlerResult) ? 'no_retry' : 'completed' });
    }
    if (handlerError instanceof PermanentJobError)
      return await bury('PERMANENT_ERROR', handlerError);
    const exhausted: DeadJobCause =
      handlerError instanceof TransientQueueError ? handlerError.code : 'RETRIES_EXHAUSTED';
    const delays = def?.retry?.delaysSeconds ?? settings.retryDelaysSeconds;
    const seconds = retryDelaySeconds(settings.retryMode, delays, job.retryCount, deps.random);
    return await retryOrBury(seconds, handlerError, exhausted);
  } catch (err) {
    // Không ghi được kết quả (mất CSDL…): việc vẫn `active` → monitor trả lại sau heartbeat.
    const redacted = redactError(err);
    deps.logger.error({
      event: 'queue.result_write_failed',
      trace_id: env.traceId,
      account_id: env.accountId,
      queue,
      job_type: env.type,
      job_id: job.id,
      error_code: redacted.code ?? redacted.name,
    });
    return finish({ outcome: 'aborted' }, err);
  }
}
