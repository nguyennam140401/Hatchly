// Việc hỏng cho màn hình hỗ trợ WBS 4.7 (contracts/queue-api.md mục 6, research R14, FR-023…025):
// tra cứu qua khung nhìn + kiểm toán; yêu cầu chạy lại qua hàm SECURITY DEFINER (ghi kiểm toán cùng
// lời gọi); Worker thực hiện yêu cầu bằng việc định kỳ `queue.dead_job_retries`.
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { AppError, getExecutionContext, uuidV7, type SupportActor } from '../../../core';
import { auditLog } from '../../../core/db/audit-log.log-table';
import { supportCommand, supportSearch, supportViewAccount } from '../../../core/db/support';
import { ERROR_CODES } from '@app/shared/core';
import { getJobType, upgradePayload } from '../job-types';
import type {
  DeadJobCause,
  DeadJobDetail,
  DeadJobFilter,
  DeadJobRetryRequestResult,
  DeadJobRetryStatus,
  DeadJobSummary,
  QueueName,
} from '../public-api';
import { deadJobs } from './db/schema';
import { enqueueRetried } from './producer';
import { inJobTx } from './runtime/bury';
import type { QueueRuntime } from './runtime/queue-runtime';

const MAX_LIMIT = 100;
const MIN_REASON = 5;

type SearchRow = {
  id: string;
  account_id: string | null;
  queue: QueueName;
  job_type: string;
  cause: DeadJobCause;
  attempts: number;
  failed_at: Date;
  retry_status: DeadJobRetryStatus;
  retried_at: Date | null;
};

const toSummary = (r: SearchRow): DeadJobSummary => ({
  id: r.id,
  accountId: r.account_id,
  queue: r.queue,
  jobType: r.job_type,
  cause: r.cause,
  attempts: r.attempts,
  failedAt: new Date(r.failed_at),
  retryStatus: r.retry_status,
  retriedAt: r.retried_at === null ? null : new Date(r.retried_at),
});

const SEARCH_COLUMNS = sql.raw(
  'id::text AS id, account_id::text AS account_id, queue, job_type, cause, attempts, failed_at, retry_status, retried_at',
);

/** Tra cứu việc hỏng xuyên tài khoản – KHÔNG trả dữ liệu việc / lỗi; kiểm toán loại bộ lọc. */
export async function searchDeadJobs(
  actor: SupportActor,
  filter: DeadJobFilter,
): Promise<DeadJobSummary[]> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), MAX_LIMIT);
  const conditions: SQL[] = [sql`true`];
  if (filter.queue !== undefined) conditions.push(sql`queue = ${filter.queue}`);
  if (filter.jobType !== undefined) conditions.push(sql`job_type = ${filter.jobType}`);
  if (filter.accountId !== undefined) conditions.push(sql`account_id = ${filter.accountId}::uuid`);
  if (filter.failedFrom !== undefined) conditions.push(sql`failed_at >= ${filter.failedFrom}`);
  if (filter.failedTo !== undefined) conditions.push(sql`failed_at < ${filter.failedTo}`);
  if (filter.retryStatus !== undefined) conditions.push(sql`retry_status = ${filter.retryStatus}`);
  if (filter.after !== undefined) conditions.push(sql`id > ${filter.after}::uuid`);
  return supportSearch(actor, 'dead_job_filter', async (db) => {
    const r = await db.execute<SearchRow>(
      sql`SELECT ${SEARCH_COLUMNS} FROM infra.support_dead_jobs_search
           WHERE ${sql.join(conditions, sql` AND `)} ORDER BY id LIMIT ${limit}`,
    );
    return r.rows.map(toSummary);
  });
}

function requireReason(reason: string): void {
  if (reason.trim().length < MIN_REASON) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_FAILED,
      httpStatus: 400,
      message: `Vui lòng nhập lý do xem dữ liệu (ít nhất ${MIN_REASON} ký tự).`,
      actions: [{ kind: 'fix_input', label: 'Nhập lý do' }],
    });
  }
}

/**
 * Chi tiết một việc hỏng. `accountId` (nhân viên chọn tài khoản) → khung nhìn chi tiết qua
 * supportViewAccount (kiểm toán + lý do); `null` (việc hệ thống) → khung nhìn tra cứu.
 */
export async function getDeadJob(
  actor: SupportActor,
  accountId: string | null,
  deadJobId: string,
  reason: string,
): Promise<DeadJobDetail | null> {
  requireReason(reason);
  if (accountId === null) {
    const rows = await supportSearch(actor, 'dead_job_id', async (db) => {
      const r = await db.execute<SearchRow>(
        sql`SELECT ${SEARCH_COLUMNS} FROM infra.support_dead_jobs_search
             WHERE id = ${deadJobId}::uuid AND account_id IS NULL`,
      );
      return r.rows;
    });
    const row = rows[0];
    if (row === undefined) return null;
    return {
      ...toSummary(row),
      originalJobId: '',
      payloadVersion: 0,
      payload: null,
      dedupeKey: null,
      lastError: null,
      jobCreatedAt: null,
      traceId: null,
      genericRetryAllowed: null,
      retryRequestedBy: null,
      retryRequestedAt: null,
      newJobId: null,
    };
  }
  return supportViewAccount(actor, accountId, reason, async (db) => {
    const r = await db.execute<
      SearchRow & {
        original_job_id: string;
        payload_version: number;
        payload: Record<string, unknown>;
        dedupe_key: string;
        last_error: { name: string; code?: string; message: string };
        job_created_at: Date;
        trace_id: string;
        generic_retry_allowed: boolean;
        retry_requested_by: string | null;
        retry_requested_at: Date | null;
        new_job_id: string | null;
      }
    >(
      sql`SELECT ${SEARCH_COLUMNS}, original_job_id::text AS original_job_id, payload_version, payload,
                 dedupe_key, last_error, job_created_at, trace_id, generic_retry_allowed,
                 retry_requested_by, retry_requested_at, new_job_id::text AS new_job_id
            FROM infra.support_dead_jobs_detail WHERE id = ${deadJobId}::uuid`,
    );
    const row = r.rows[0];
    if (row === undefined) return null;
    return {
      ...toSummary(row),
      originalJobId: row.original_job_id,
      payloadVersion: row.payload_version,
      payload: row.payload,
      dedupeKey: row.dedupe_key,
      lastError: row.last_error,
      jobCreatedAt: new Date(row.job_created_at),
      traceId: row.trace_id,
      genericRetryAllowed: row.generic_retry_allowed,
      retryRequestedBy: row.retry_requested_by,
      retryRequestedAt: row.retry_requested_at === null ? null : new Date(row.retry_requested_at),
      newJobId: row.new_job_id,
    };
  });
}

/**
 * Yêu cầu chạy lại MỘT việc hỏng (một thao tác của nhân viên – SC-009). Loại việc `publish` bị từ chối
 * (`rejected_not_allowed`) – hướng dẫn cho WBS 4.7: dùng "Đăng lại" trong màn hình lượt đăng (Q1).
 */
export async function requestDeadJobRetry(
  actor: SupportActor,
  deadJobId: string,
  reason: string,
): Promise<DeadJobRetryRequestResult> {
  requireReason(reason);
  return supportCommand(async (db) => {
    const r = await db.execute<{ result: DeadJobRetryRequestResult }>(
      sql`SELECT infra.request_dead_job_retry(${deadJobId}::uuid, ${actor.staffId}, ${reason.trim()},
                 ${uuidV7()}::uuid, ${getExecutionContext()?.traceId ?? null}) AS result`,
    );
    return r.rows[0]!.result;
  });
}

const RETRY_ACTOR = 'queue.dead_job_retries';

/**
 * Worker thực hiện các yêu cầu chạy lại (việc định kỳ `queue.dead_job_retries`): tạo việc mới cùng loại /
 * dữ liệu / khóa chống trùng, lượt thử đặt lại, `traceId` mới nối với mã cũ qua `retriedFrom`.
 */
export async function processDeadJobRetries(
  runtime: QueueRuntime,
): Promise<{ retried: number; rejected: number }> {
  const claimed = await runtime.pool.query<{ id: string; account_id: string | null }>(
    'SELECT id::text, account_id::text FROM infra.claim_dead_job_retries(20)',
  );
  let retried = 0;
  let rejected = 0;
  for (const row of claimed.rows) {
    const newTrace = uuidV7();
    const outcome = await inJobTx(row.account_id, newTrace, async (db) => {
      const locked = await db
        .select()
        .from(deadJobs)
        .where(and(eq(deadJobs.id, row.id), eq(deadJobs.retry_status, 'requested')))
        .for('update');
      const dead = locked[0];
      if (dead === undefined) return 'skip' as const;
      const def = getJobType(dead.job_type);
      // Loại việc không khai báo trong tiến trình này → để bản khác / lần sau.
      if (def === undefined) return 'skip' as const;
      const payload = upgradePayload(def, dead.payload, dead.payload_version);
      const result = await enqueueRetried(def, payload, {
        dedupeKey: dead.dedupe_key,
        traceId: newTrace,
        retriedFrom: { deadJobId: dead.id, traceId: dead.trace_id },
      });
      if (result.status === 'created') {
        await db
          .update(deadJobs)
          .set({ retry_status: 'retried', retried_at: sql`now()`, new_job_id: result.jobId })
          .where(eq(deadJobs.id, dead.id));
        await db.insert(auditLog).values({
          account_id: dead.account_id,
          actor_type: 'system',
          actor_id: RETRY_ACTOR,
          action: 'dead_job.retried',
          trace_id: newTrace,
          metadata: { dead_job_id: dead.id, new_job_id: result.jobId },
        });
        return 'retried' as const;
      }
      await db
        .update(deadJobs)
        .set({ retry_status: 'rejected_already_active' })
        .where(eq(deadJobs.id, dead.id));
      await db.insert(auditLog).values({
        account_id: dead.account_id,
        actor_type: 'system',
        actor_id: RETRY_ACTOR,
        action: 'dead_job.retry_rejected',
        trace_id: newTrace,
        metadata: { dead_job_id: dead.id, why: 'already_active', active_job_id: result.jobId },
      });
      return 'rejected' as const;
    });
    if (outcome === 'retried') retried++;
    if (outcome === 'rejected') rejected++;
  }
  return { retried, rejected };
}
