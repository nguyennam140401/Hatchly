// Bộ xử lý việc định kỳ nội bộ (data-model mục 8, FR-029, R8, R14). Đăng ký MỘT lần mỗi tiến trình; mỗi
// lượt dùng một bản QueueRuntime đang chạy (bể điều khiển + pg-boss) của tiến trình.
import { sql } from 'drizzle-orm';
import { systemTx } from '../../../core/db/transaction';
import {
  cleanupJob,
  deadJobRetriesJob,
  DEAD_JOB_RETENTION_DAYS,
  partitionsJob,
  sweepFailedJob,
} from '../jobs';
import { listPartitionedLogs } from '../schedules';
import { processDeadJobRetries } from './dead-jobs';
import { getHandler, registerJobHandler } from './handlers';
import { sweepFailed } from './runtime/bury';
import { anyRuntime, type QueueRuntime, type RuntimeService } from './runtime/queue-runtime';

const SQL_NAME = /^[a-z_]+\.[a-z_]+$/;

/** `queue.cleanup`: việc hỏng và khung lịch quá 90 ngày. */
export async function runCleanup(): Promise<{ deadJobs: number; slots: number }> {
  return systemTx(async (db) => {
    const dead = await db.execute<{ n: number }>(
      sql`SELECT infra.cleanup_dead_jobs(${DEAD_JOB_RETENTION_DAYS}) AS n`,
    );
    const slots = await db.execute(
      sql`DELETE FROM infra.schedule_slots WHERE slot_at < now() - make_interval(days => ${DEAD_JOB_RETENTION_DAYS})`,
    );
    return { deadJobs: Number(dead.rows[0]?.n ?? 0), slots: slots.rowCount ?? 0 };
  });
}

/** `queue.partitions`: tạo trước / bỏ phân vùng mọi bảng nhật ký đã đăng ký (idempotent). */
export async function runPartitions(): Promise<{ table: string; dropped: number }[]> {
  const out: { table: string; dropped: number }[] = [];
  for (const log of listPartitionedLogs()) {
    if (!SQL_NAME.test(log.ensureFunction)) continue;
    await systemTx(async (db) => {
      await db.execute(sql`SELECT ${sql.raw(log.ensureFunction)}(${log.monthsAhead})`);
      let dropped = 0;
      if (log.dropFunction !== undefined && log.retentionMonths !== undefined && SQL_NAME.test(log.dropFunction)) {
        const r = await db.execute<{ n: number }>(
          sql`SELECT ${sql.raw(log.dropFunction)}(${log.retentionMonths}) AS n`,
        );
        dropped = Number(r.rows[0]?.n ?? 0);
      }
      out.push({ table: log.table, dropped });
    });
  }
  return out;
}

function requireRuntime(): QueueRuntime {
  const runtime = anyRuntime();
  if (runtime === undefined) throw new Error('Không có QueueRuntime đang chạy');
  return runtime;
}

/** Đăng ký bộ xử lý 4 việc nội bộ (một lần mỗi tiến trình). */
export function registerInternalHandlers(): void {
  if (getHandler(cleanupJob.name) !== undefined) return;
  registerJobHandler(cleanupJob, async () => {
    const r = await runCleanup();
    requireRuntime().logger.info({ event: 'queue.cleanup_done', dead_jobs: r.deadJobs, slots: r.slots });
  });
  registerJobHandler(partitionsJob, async () => {
    const r = await runPartitions();
    requireRuntime().logger.info({ event: 'queue.partitions_done', tables: r });
  });
  registerJobHandler(sweepFailedJob, async () => {
    const runtime = requireRuntime();
    const r = await sweepFailed({
      boss: runtime.boss,
      pool: runtime.pool,
      logger: runtime.logger,
      metrics: runtime.metrics,
    });
    if (r.buried + r.renotified > 0) {
      runtime.logger.info({ event: 'queue.sweep_failed_done', buried: r.buried, renotified: r.renotified });
    }
  });
  registerJobHandler(deadJobRetriesJob, async () => {
    const runtime = requireRuntime();
    const r = await processDeadJobRetries(runtime);
    if (r.retried + r.rejected > 0) {
      runtime.logger.info({ event: 'queue.dead_job_retries_done', retried: r.retried, rejected: r.rejected });
    }
  });
}

/** Dịch vụ của Worker: đăng ký bộ xử lý nội bộ + chạy `queue.partitions` một lần khi khởi động. */
export class InternalJobsService implements RuntimeService {
  start(runtime: QueueRuntime): void {
    registerInternalHandlers();
    void runPartitions().catch((err: unknown) => {
      const code = (err as { code?: unknown } | null)?.code;
      runtime.logger.warn({
        event: 'queue.partitions_failed',
        code: typeof code === 'string' ? code : 'UNKNOWN',
      });
    });
  }

  stop(): void {
    // Không có nhịp riêng – việc chạy qua hàng chờ `scheduled`.
  }
}
