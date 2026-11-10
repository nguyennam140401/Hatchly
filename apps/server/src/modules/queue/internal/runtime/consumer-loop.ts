// Vòng lấy việc của MỘT hàng chờ (research R6, FR-004/005/021): không dùng work() của pg-boss.
//
// Vì sao cần khóa tư vấn: `groupConcurrency` của pg-boss đếm việc `active` theo group_id NGAY TRONG câu
// lệnh lấy việc, nhưng không có khóa giữa các bản Worker – hai bản lấy cùng lúc (READ COMMITTED, SKIP
// LOCKED) cùng thấy "còn chỗ" và vượt giới hạn tenant. Giữ pg_advisory_xact_lock theo hàng chờ quanh câu
// lệnh lấy việc: câu lệnh chạy SAU khi có khóa nên ảnh chụp của nó thấy mọi việc mà bản trước vừa kích
// hoạt (bản trước đã COMMIT rồi mới nhả khóa) → không bao giờ vượt N trên mọi bản (SC-004).
import type { Pool } from 'pg';
import { isConnectionError } from '../../../../core/db/errors';
import type { QueueName } from '../../public-api';
import type { QueueLogger } from '../logger';
import type { BossJob, PgBoss } from '../pgboss/boss-loader';
import { clientDatabase } from '../pgboss/tx-database';
import type { SettingsCache } from './settings';

const MAX_BACKOFF_MS = 30_000;

export interface ConsumerLoopOptions {
  queue: QueueName;
  boss: PgBoss;
  pool: Pool;
  settings: SettingsCache;
  logger: QueueLogger;
  /** Chạy một việc đã lấy; vòng tự đếm số lượt đang chạy. */
  run: (job: BossJob) => Promise<unknown>;
  /** Bọc lượt chạy để bộ điều phối tắt chờ nó (ShutdownCoordinator.trackInFlight). */
  track: <T>(p: Promise<T>) => Promise<T>;
  onFetchSuccess?: () => void;
  onFetchFailure?: () => void;
}

/** Lấy tối đa `batchSize` việc của hàng chờ dưới khóa tư vấn (một giao dịch trên bể điều khiển). */
export async function fetchBatch(
  boss: PgBoss,
  pool: Pool,
  queue: QueueName,
  batchSize: number,
  maxPerTenant: number | null,
): Promise<BossJob[]> {
  const client = await pool.connect();
  let broken: unknown;
  try {
    await client.query('BEGIN');
    if (maxPerTenant !== null) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('queue_fetch:' || $1))", [queue]);
    }
    const jobs = await boss.fetch<unknown>(queue, {
      batchSize,
      includeMetadata: true,
      ...(maxPerTenant !== null ? { groupConcurrency: maxPerTenant } : {}),
      db: clientDatabase(client),
    });
    await client.query('COMMIT');
    return jobs;
  } catch (err) {
    if (isConnectionError(err)) broken = err;
    else await client.query('ROLLBACK').catch((e: unknown) => (broken = e));
    throw err;
  } finally {
    client.release(broken === undefined ? undefined : true);
  }
}

export class ConsumerLoop {
  private running = 0;
  private stopped = false;
  private wake: (() => void) | undefined;
  private loop: Promise<void> | undefined;
  private backoffMs = 0;

  constructor(private readonly options: ConsumerLoopOptions) {}

  get inFlight(): number {
    return this.running;
  }

  start(): void {
    this.loop ??= this.run();
  }

  /** Ngừng lấy việc mới (việc đang chạy vẫn chạy tiếp – bộ điều phối chờ). */
  async stop(): Promise<void> {
    this.stopped = true;
    this.wake?.();
    await this.loop;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.wake = done;
    });
    this.wake = undefined;
  }

  private async run(): Promise<void> {
    const { queue, boss, pool, settings, logger } = this.options;
    while (!this.stopped) {
      const current = settings.get(queue);
      const free = current.concurrencyPerWorker - this.running;
      if (free <= 0) {
        // Chờ một lượt xong (wake) hoặc chu kỳ hỏi – giới hạn mới áp ở lần lấy kế tiếp (FR-006).
        await this.sleep(current.pollIntervalMs);
        continue;
      }
      let jobs: BossJob[];
      try {
        jobs = await fetchBatch(boss, pool, queue, free, current.maxPerTenant);
        this.backoffMs = 0;
        this.options.onFetchSuccess?.();
      } catch (err) {
        this.options.onFetchFailure?.();
        // Mất CSDL: giãn cách 1 → 2 → 4 … ≤ 30 giây, không thoát (R16, FR-019).
        this.backoffMs = Math.min(MAX_BACKOFF_MS, this.backoffMs === 0 ? 1000 : this.backoffMs * 2);
        const code = (err as { code?: unknown } | null)?.code;
        logger.warn({
          event: 'queue.fetch_failed',
          queue,
          code: typeof code === 'string' ? code : 'UNKNOWN',
          retry_in_ms: this.backoffMs,
        });
        await this.sleep(this.backoffMs);
        continue;
      }
      // Việc đã lấy luôn được chạy (đã `active`), kể cả khi vừa bắt đầu tắt – bộ điều phối chờ ≤ 30 giây.
      for (const job of jobs) {
        this.running++;
        void this.options
          .track(this.options.run(job))
          .catch(() => undefined)
          .finally(() => {
            this.running--;
            this.wake?.();
          });
      }
      if (jobs.length === 0) await this.sleep(current.pollIntervalMs);
    }
  }
}
