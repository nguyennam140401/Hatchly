// Chôn việc vào infra.dead_jobs (research R8, FR-016): MỘT chỗ cho mọi đường (hết lượt, lỗi vĩnh viễn,
// không có bộ xử lý, dữ liệu sai, hết khóa do Worker chết). Idempotent theo `original_job_id`.
import { and, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { uuidV7 } from '../../../../core';
import { runWithJobContext } from '../../../../core/context/bind-account';
import { currentTxHandle, systemTx } from '../../../../core/db/transaction';
import { getJobType, upgradePayload } from '../../job-types';
import { QUEUE_NAMES, type DeadJobCause, type QueueName } from '../../public-api';
import { deadJobs } from '../db/schema';
import { getHandler } from '../handlers';
import type { QueueLogger } from '../logger';
import type { QueueMetrics } from '../observability';
import type { PgBoss } from '../pgboss/boss-loader';
import { clientDatabase } from '../pgboss/tx-database';
import { JOB_TABLE, type JobEnvelope } from '../producer';
import { redactError } from '../redact';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FINAL_FAILURE_ATTEMPTS = 5;

export interface BuryDeps {
  boss: PgBoss;
  pool: Pool;
  logger: QueueLogger;
  metrics: QueueMetrics;
}

export interface BuryInput {
  queue: QueueName;
  jobId: string;
  /** Lượt đang giữ (việc `active`) – xóa có rào theo lượt; null cho việc đã `failed` (quét). */
  attempt: { id: string; retryCount: number } | null;
  data: unknown;
  dedupeKey: string;
  attempts: number;
  jobCreatedAt: Date;
  cause: DeadJobCause;
  error: unknown;
}

/** Phần phong bì đọc được an toàn từ dữ liệu việc (có thể sai khuôn). */
export function readEnvelope(data: unknown): {
  type: string;
  v: number;
  accountId: string | null;
  traceId: string;
  payload: Record<string, unknown>;
  retriedFrom: JobEnvelope['retriedFrom'];
} {
  const d = (typeof data === 'object' && data !== null ? data : {}) as Partial<JobEnvelope>;
  return {
    type: typeof d.type === 'string' ? d.type.slice(0, 200) : 'unknown.unknown',
    v: typeof d.v === 'number' && Number.isInteger(d.v) ? d.v : 0,
    accountId: typeof d.accountId === 'string' && UUID.test(d.accountId) ? d.accountId : null,
    traceId: typeof d.traceId === 'string' && d.traceId !== '' ? d.traceId.slice(0, 64) : uuidV7(),
    payload:
      typeof d.payload === 'object' && d.payload !== null && !Array.isArray(d.payload)
        ? d.payload
        : {},
    retriedFrom: d.retriedFrom,
  };
}

/** Chạy `fn` trong giao dịch `system` của ngữ cảnh việc (tenant của việc, hoặc không tenant). */
export function inJobTx<T>(
  accountId: string | null,
  traceId: string,
  fn: Parameters<typeof systemTx<T>>[0],
): Promise<T> {
  return runWithJobContext({ traceId, accountId: accountId ?? undefined }, () =>
    systemTx(fn, { tenant: accountId === null ? 'none' : 'from-context' }),
  );
}

export interface BuryResult {
  deadJobId: string | null;
  created: boolean;
  /** Lượt không còn giữ việc – không chôn. */
  lost?: boolean;
}

class LostAttemptError extends Error {
  constructor() {
    super('Lượt chạy đã mất khóa việc');
    this.name = 'LostAttemptError';
  }
}

/** Chèn dòng việc hỏng + xóa việc pg-boss trong MỘT giao dịch, rồi gọi onFinalFailure (R8). */
export async function buryJob(deps: BuryDeps, input: BuryInput): Promise<BuryResult> {
  const env = readEnvelope(input.data);
  const def = getJobType(env.type);
  const lastError = redactError(input.error);
  let result: BuryResult;
  try {
    result = await inJobTx(env.accountId, env.traceId, async (db) => {
      const inserted = await db
        .insert(deadJobs)
        .values({
          id: uuidV7(),
          account_id: env.accountId,
          original_job_id: input.jobId,
          queue: input.queue,
          job_type: env.type,
          payload_version: env.v,
          payload: env.payload,
          dedupe_key: input.dedupeKey,
          cause: input.cause,
          last_error: lastError,
          attempts: input.attempts,
          job_created_at: input.jobCreatedAt,
          trace_id: env.traceId,
          generic_retry_allowed: def?.allowGenericRetry ?? input.queue !== 'publish',
        })
        .onConflictDoNothing({ target: deadJobs.original_job_id })
        .returning({ id: deadJobs.id });
      const tx = currentTxHandle();
      if (tx !== undefined) {
        const deleted = (await deps.boss.deleteJob(input.queue, input.attempt ?? input.jobId, {
          db: clientDatabase(tx.db.$client),
        })) as { affected?: number };
        // Lượt đã mất khóa (bản khác đang chạy lại việc) → hoàn tác, KHÔNG chôn (R5).
        if (input.attempt !== null && deleted.affected === 0) throw new LostAttemptError();
      }
      if (inserted[0] !== undefined) return { deadJobId: inserted[0].id, created: true };
      const existing = await db
        .select({ id: deadJobs.id })
        .from(deadJobs)
        .where(eq(deadJobs.original_job_id, input.jobId));
      return { deadJobId: existing[0]?.id ?? null, created: false };
    });
  } catch (err) {
    if (err instanceof LostAttemptError) return { deadJobId: null, created: false, lost: true };
    // Tài khoản đã bị xóa (TENANT_NOT_FOUND) → không còn ai để chôn cho: xóa việc, ghi nhật ký.
    if ((err as { code?: unknown }).code === 'TENANT_NOT_FOUND') {
      await deps.pool.query(`DELETE FROM ${JOB_TABLE} WHERE name = $1 AND id = $2::uuid`, [
        input.queue,
        input.jobId,
      ]);
      deps.logger.warn({
        event: 'queue.job_dropped_account_gone',
        queue: input.queue,
        job_type: env.type,
        job_id: input.jobId,
      });
      return { deadJobId: null, created: false };
    }
    throw err;
  }
  if (result.created && result.deadJobId !== null) {
    deps.metrics.deadJobCreated(input.queue, env.type, input.cause);
    await notifyFinalFailure(deps, {
      deadJobId: result.deadJobId,
      accountId: env.accountId,
      traceId: env.traceId,
      jobType: env.type,
      payload: env.payload,
      payloadVersion: env.v,
      cause: input.cause,
      attempts: input.attempts,
      lastErrorCode: lastError.code,
    });
  }
  return result;
}

interface FinalFailureTarget {
  deadJobId: string;
  accountId: string | null;
  traceId: string;
  jobType: string;
  payload: unknown;
  payloadVersion: number;
  cause: DeadJobCause;
  attempts: number;
  lastErrorCode: string | undefined;
}

/** Gọi onFinalFailure của loại việc TRONG ngữ cảnh của việc; ghi kết quả vào dòng việc hỏng. */
async function notifyFinalFailure(deps: BuryDeps, target: FinalFailureTarget): Promise<void> {
  const registered = getHandler(target.jobType);
  const callback = registered?.onFinalFailure;
  const mark = (ok: boolean) =>
    inJobTx(target.accountId, target.traceId, async (db) => {
      const row = await db
        .select({ attempts: deadJobs.final_failure_attempts })
        .from(deadJobs)
        .where(eq(deadJobs.id, target.deadJobId));
      await db
        .update(deadJobs)
        .set(
          ok
            ? { final_failure_notified: true }
            : { final_failure_attempts: (row[0]?.attempts ?? 0) + 1 },
        )
        .where(eq(deadJobs.id, target.deadJobId));
    });
  if (callback === undefined) {
    // Không có gì để gọi (loại việc không đăng ký onFinalFailure, hoặc không có bộ xử lý ở bản này):
    // chỉ đánh dấu khi đã biết chắc loại việc không có callback.
    if (registered !== undefined) await mark(true);
    return;
  }
  let payload: unknown = target.payload;
  try {
    payload = upgradePayload(registered!.def, target.payload, target.payloadVersion);
  } catch {
    // Dữ liệu sai khuôn: vẫn báo cho module với dữ liệu thô (chỉ mã tham chiếu).
  }
  try {
    await runWithJobContext(
      { traceId: target.traceId, accountId: target.accountId ?? undefined },
      () =>
        callback(payload, {
          deadJobId: target.deadJobId,
          cause: target.cause,
          attempts: target.attempts,
          ...(target.lastErrorCode !== undefined ? { lastErrorCode: target.lastErrorCode } : {}),
        }),
    );
    await mark(true);
  } catch (err) {
    const redacted = redactError(err);
    deps.logger.warn({
      event: 'queue.final_failure_callback_failed',
      trace_id: target.traceId,
      account_id: target.accountId,
      job_type: target.jobType,
      dead_job_id: target.deadJobId,
      error_code: redacted.code ?? null,
      error_message: redacted.message,
    });
    await mark(false);
  }
}

const EXPIRED_MESSAGES = new Set(['job timed out', 'job heartbeat timeout']);

/**
 * Việc định kỳ `queue.sweep_failed` (R8): chôn việc pg-boss đã `failed` (hết lượt do Worker chết /
 * mất heartbeat – monitor của thư viện chuyển, không qua bộ chạy) và gọi lại onFinalFailure chưa thành
 * công (≤ 5 lần). Trả số việc đã chôn.
 */
export async function sweepFailed(deps: BuryDeps): Promise<{ buried: number; renotified: number }> {
  const failed = await deps.pool.query<{
    id: string;
    name: QueueName;
    data: unknown;
    singleton_key: string | null;
    retry_count: number;
    created_on: Date;
    output: { value?: { message?: unknown }; message?: unknown } | null;
  }>(
    `SELECT id::text, name, data, singleton_key, retry_count, created_on, output
       FROM ${JOB_TABLE}
      WHERE name = ANY($1) AND state = 'failed'
      ORDER BY completed_on NULLS FIRST LIMIT 100`,
    [[...QUEUE_NAMES]],
  );
  let buried = 0;
  for (const job of failed.rows) {
    const message = job.output?.value?.message ?? job.output?.message;
    const text = typeof message === 'string' ? message : 'job failed';
    await buryJob(deps, {
      queue: job.name,
      jobId: job.id,
      attempt: null,
      data: job.data,
      dedupeKey: job.singleton_key ?? `${readEnvelope(job.data).type}:${job.id}`,
      attempts: job.retry_count + 1,
      jobCreatedAt: job.created_on,
      cause: EXPIRED_MESSAGES.has(text) ? 'EXPIRED' : 'RETRIES_EXHAUSTED',
      error: Object.assign(new Error(text), {
        code: EXPIRED_MESSAGES.has(text) ? 'JOB_EXPIRED' : 'JOB_FAILED',
      }),
    });
    buried++;
  }

  const pending = await deps.pool.query<{ id: string; account_id: string | null }>(
    'SELECT id::text, account_id::text FROM infra.pending_final_failures(50)',
  );
  let renotified = 0;
  for (const row of pending.rows) {
    const loaded = await inJobTx(row.account_id, uuidV7(), (db) =>
      db
        .select()
        .from(deadJobs)
        .where(and(eq(deadJobs.id, row.id), eq(deadJobs.final_failure_notified, false))),
    ).catch(() => []);
    const dead = loaded[0];
    if (dead === undefined || dead.final_failure_attempts >= MAX_FINAL_FAILURE_ATTEMPTS) continue;
    // Bản Worker này không có bộ xử lý của loại việc → để bản khác (hoặc lần quét sau) gọi.
    if (getHandler(dead.job_type) === undefined) continue;
    await notifyFinalFailure(deps, {
      deadJobId: dead.id,
      accountId: dead.account_id,
      traceId: dead.trace_id,
      jobType: dead.job_type,
      payload: dead.payload,
      payloadVersion: dead.payload_version,
      cause: dead.cause,
      attempts: dead.attempts,
      lastErrorCode: (dead.last_error as { code?: string }).code,
    });
    renotified++;
  }
  return { buried, renotified };
}
