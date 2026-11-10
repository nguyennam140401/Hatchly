// Bộ chạy hàng chờ của MỘT bản Worker (research R5–R10, R16; FR-003/004/006/017/018/019):
// bể điều khiển (vai trò `system`) + pg-boss giám sát + 6 vòng lấy việc + thông số động + kiểm tra sẵn
// sàng. Hai bản Worker = hai QueueRuntime độc lập (bể + pg-boss riêng), phối hợp hoàn toàn qua CSDL.
import type { MeterProvider } from '@opentelemetry/api';
import type { Pool } from 'pg';
import { QUEUE_NAMES, type QueueName } from '../../public-api';
import type { QueueLogger } from '../logger';
import { QueueMetrics } from '../observability';
import {
  assertSchemaVersion,
  createQueuePool,
  createWorkerBoss,
  EXPECTED_SCHEMA_VERSION,
  readSchemaVersion,
  type PgBoss,
  type WorkerBossOptions,
} from '../pgboss/boss-loader';
import { clearProducer, setProducer } from '../producer';
import { ConsumerLoop } from './consumer-loop';
import { runJob, type AbortReason } from './job-runner';
import { SETTINGS_SQL, SettingsCache, type QueueSettings, type SettingsChange } from './settings';

/** Việc xong/hủy giữ 30 ngày (FR-029) – trùng ensureQueues. */
const DELETE_AFTER_SECONDS = 2_592_000;
/** Lần lấy việc/heartbeat thành công gần nhất phải trong khoảng này để "sẵn sàng" (FR-019). */
const READY_WINDOW_MS = 30_000;
const HEALTH_TICK_MS = 10_000;
const METRICS_TICK_MS = 30_000;

/** Giao diện tối thiểu của ShutdownCoordinator mà bộ chạy cần. */
export interface CoordinatorLike {
  onStopping(listener: () => void | Promise<void>): void;
  trackInFlight<T>(promise: Promise<T>): Promise<T>;
}

/** Thành phần chạy theo nhịp, dừng cùng bộ chạy (bộ hẹn giờ – US5). */
export interface RuntimeService {
  start(runtime: QueueRuntime): void | Promise<void>;
  stop(): void | Promise<void>;
}

export interface QueueRuntimeOptions {
  systemUrl: string;
  controlPoolMax: number;
  statementTimeoutMs?: number;
  settingsRefreshMs: number;
  /** false: không chạy vòng lấy việc (QUEUE_ENABLED=false). */
  enabled: boolean;
  logger: QueueLogger;
  coordinator?: CoordinatorLike;
  /** Thời gian bộ điều phối chờ việc đang chạy khi tắt (SHUTDOWN_TIMEOUT_MS). */
  shutdownTimeoutMs?: number;
  /** Chỉ chạy một số hàng chờ (kiểm thử); mặc định cả 6. */
  queues?: readonly QueueName[];
  meterProvider?: MeterProvider;
  boss?: WorkerBossOptions;
  heartbeatEveryMs?: number;
  /** Dùng thể hiện này để tạo việc trong tiến trình (mặc định true). */
  producer?: boolean;
  services?: RuntimeService[];
  random?: () => number;
}

/** Các bản đang chạy trong tiến trình (việc nội bộ dùng bể/pg-boss của một bản bất kỳ). */
const liveRuntimes = new Set<QueueRuntime>();

export function anyRuntime(): QueueRuntime | undefined {
  return liveRuntimes.values().next().value;
}

export function queueOptionsOf(s: QueueSettings) {
  return {
    expireInSeconds: s.lockSeconds,
    heartbeatSeconds: s.heartbeatSeconds,
    retryLimit: s.maxRetries,
    retryDelay: s.retryDelaysSeconds[0] ?? 60,
    retryBackoff: false,
    deleteAfterSeconds: DELETE_AFTER_SECONDS,
  };
}

const QUEUE_OPTION_FIELDS: (keyof QueueSettings)[] = [
  'lockSeconds',
  'heartbeatSeconds',
  'maxRetries',
  'retryDelaysSeconds',
];

export class QueueRuntime {
  readonly metrics: QueueMetrics;
  private poolRef: Pool | undefined;
  private bossRef: PgBoss | undefined;
  private settingsRef: SettingsCache | undefined;
  private loops: ConsumerLoop[] = [];
  private readonly aborters = new Set<(reason: AbortReason) => void>();
  private readonly inFlight = new Set<Promise<unknown>>();
  private timers: NodeJS.Timeout[] = [];
  private lastSuccessAt = 0;
  private versionOk = false;
  private started = false;
  private stopping = false;
  private closed = false;

  constructor(readonly options: QueueRuntimeOptions) {
    this.metrics = new QueueMetrics(options.meterProvider);
  }

  get logger(): QueueLogger {
    return this.options.logger;
  }

  get pool(): Pool {
    if (this.poolRef === undefined) throw new Error('QueueRuntime chưa khởi động');
    return this.poolRef;
  }

  get boss(): PgBoss {
    if (this.bossRef === undefined) throw new Error('QueueRuntime chưa khởi động');
    return this.bossRef;
  }

  get settings(): SettingsCache {
    if (this.settingsRef === undefined) throw new Error('QueueRuntime chưa khởi động');
    return this.settingsRef;
  }

  get queues(): readonly QueueName[] {
    return this.options.queues ?? QUEUE_NAMES;
  }

  /** Số lượt đang chạy trên bản này. */
  get running(): number {
    return this.inFlight.size;
  }

  markControlSuccess = (): void => {
    this.lastSuccessAt = Date.now();
  };

  /** Bọc một tác vụ để tắt có kiểm soát chờ nó (bộ điều phối của tiến trình hoặc tập nội bộ). */
  track = <T>(promise: Promise<T>): Promise<T> => {
    const tracked = this.options.coordinator?.trackInFlight(promise) ?? promise;
    const settled = tracked.finally(() => this.inFlight.delete(settled));
    settled.catch(() => undefined);
    this.inFlight.add(settled);
    return tracked;
  };

  async start(): Promise<void> {
    const { logger } = this.options;
    const pool = createQueuePool({
      url: this.options.systemUrl,
      max: this.options.controlPoolMax,
      applicationName: 'worker-queue',
      ...(this.options.statementTimeoutMs !== undefined
        ? { statementTimeoutMs: this.options.statementTimeoutMs }
        : {}),
      onError: (code) => {
        logger.warn({ event: 'queue.pool_error', pool: 'control', code });
      },
    });
    this.poolRef = pool;
    try {
      try {
        await assertSchemaVersion(pool);
      } catch (err) {
        if ((err as { detail?: unknown }).detail === 'QUEUE_SCHEMA_VERSION_MISMATCH') {
          logger.error({
            event: 'queue.schema_version_mismatch',
            expected: EXPECTED_SCHEMA_VERSION,
            actual: await readSchemaVersion(pool).catch(() => null),
          });
        }
        throw err;
      }
      this.versionOk = true;
      const boss = await createWorkerBoss(pool, this.options.boss);
      boss.on('error', (err: unknown) => {
        const code = (err as { code?: unknown } | null)?.code;
        logger.warn({
          event: 'queue.boss_error',
          code: typeof code === 'string' ? code : 'UNKNOWN',
        });
      });
      await boss.start();
      this.bossRef = boss;

      const settings = new SettingsCache({
        load: async () => (await pool.query<Record<string, unknown>>(SETTINGS_SQL)).rows,
        refreshMs: this.options.settingsRefreshMs,
        logger,
        onInvalid: (queue) => {
          this.metrics.settingsInvalid(queue);
        },
      });
      await settings.refresh();
      this.settingsRef = settings;
      await this.syncQueueOptions();
      settings.onChange((changes) => this.applySettings(changes));
      settings.start();
      if (this.options.producer !== false) setProducer(boss);
      liveRuntimes.add(this);
      this.markControlSuccess();

      if (this.options.enabled) {
        for (const queue of this.queues) {
          const loop = new ConsumerLoop({
            queue,
            boss,
            pool,
            settings,
            logger,
            track: this.track,
            run: (job) =>
              runJob(
                {
                  boss,
                  pool,
                  settings,
                  logger,
                  metrics: this.metrics,
                  onControlSuccess: this.markControlSuccess,
                  track: (abort) => {
                    this.aborters.add(abort);
                    return () => this.aborters.delete(abort);
                  },
                  ...(this.options.heartbeatEveryMs !== undefined
                    ? { heartbeatEveryMs: this.options.heartbeatEveryMs }
                    : {}),
                  ...(this.options.random !== undefined ? { random: this.options.random } : {}),
                },
                queue,
                job,
              ),
            onFetchSuccess: this.markControlSuccess,
          });
          loop.start();
          this.loops.push(loop);
        }
      }
      for (const service of this.options.services ?? []) await service.start(this);

      this.timers.push(setInterval(() => void this.healthTick(), HEALTH_TICK_MS));
      this.timers.push(setInterval(() => void this.refreshMetrics(), METRICS_TICK_MS));
      for (const t of this.timers) t.unref();
      await this.refreshMetrics();
      this.options.coordinator?.onStopping(() => this.beginShutdown());
      this.started = true;
      logger.info({
        event: 'queue.started',
        queues: this.options.enabled ? [...this.queues] : [],
        version: EXPECTED_SCHEMA_VERSION,
      });
    } catch (err) {
      await this.close().catch(() => undefined);
      throw err;
    }
  }

  /** Khi khởi động: đưa thuộc tính hàng chờ pg-boss về đúng infra.queue_settings (đổi khi Worker tắt). */
  private async syncQueueOptions(): Promise<void> {
    for (const queue of QUEUE_NAMES) {
      const s = this.settings.get(queue);
      const current = await this.boss.getQueue(queue);
      if (current === null) continue;
      const wanted = queueOptionsOf(s);
      if (
        current.expireInSeconds !== wanted.expireInSeconds ||
        (current.heartbeatSeconds ?? null) !== wanted.heartbeatSeconds ||
        current.retryLimit !== wanted.retryLimit ||
        current.retryDelay !== wanted.retryDelay
      ) {
        await this.boss.updateQueue(queue, wanted);
      }
    }
  }

  /** Thông số đổi: lock/heartbeat/thử lại → updateQueue (idempotent); đồng thời → lần lấy kế tiếp. */
  private async applySettings(changes: SettingsChange[]): Promise<void> {
    for (const change of changes) {
      if (change.fields.some((f) => QUEUE_OPTION_FIELDS.includes(f))) {
        try {
          await this.boss.updateQueue(change.queue, queueOptionsOf(change.next));
        } catch (err) {
          const code = (err as { code?: unknown } | null)?.code;
          this.logger.warn({
            event: 'queue.settings_apply_failed',
            queue: change.queue,
            code: typeof code === 'string' ? code : 'UNKNOWN',
          });
          continue;
        }
      }
      this.logger.info({
        event: 'queue.settings_applied',
        queue: change.queue,
        fields: change.fields,
      });
    }
  }

  private async healthTick(): Promise<void> {
    if (this.poolRef === undefined || this.closed) return;
    try {
      const version = await readSchemaVersion(this.poolRef);
      const ok = version === EXPECTED_SCHEMA_VERSION;
      if (!ok && this.versionOk) {
        this.logger.error({
          event: 'queue.schema_version_mismatch',
          expected: EXPECTED_SCHEMA_VERSION,
          actual: version,
        });
      }
      this.versionOk = ok;
      this.markControlSuccess();
    } catch {
      // Mất CSDL: lastSuccessAt không tiến → /readyz báo 503 sau READY_WINDOW_MS.
    }
  }

  private async refreshMetrics(): Promise<void> {
    if (this.poolRef === undefined || this.bossRef === undefined || this.closed) return;
    try {
      await this.metrics.refresh(this.poolRef, this.bossRef);
    } catch {
      // Chỉ số lỗi không ảnh hưởng xử lý việc.
    }
  }

  /** Đọc lại thông số ngay (kiểm thử, công cụ quản trị). */
  async refreshSettings(): Promise<SettingsChange[]> {
    return this.settings.refresh();
  }

  /** Cập nhật chỉ số ngay (kiểm thử). */
  async refreshMetricsNow(): Promise<void> {
    await this.metrics.refresh(this.pool, this.boss);
  }

  /** Kiểm tra sẵn sàng `queue` (R16): phiên bản đúng, CSDL trả lời < 30 giây, không đang tắt. */
  isReady(): boolean {
    return (
      this.started &&
      !this.stopping &&
      this.versionOk &&
      Date.now() - this.lastSuccessAt < READY_WINDOW_MS
    );
  }

  /** Ngừng lấy việc mới, dừng dịch vụ nhịp; đặt hẹn hủy lượt đang chạy khi sắp hết hạn chờ (R16). */
  async beginShutdown(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    const timeout = this.options.shutdownTimeoutMs;
    if (timeout !== undefined) {
      const timer = setTimeout(
        () => {
          this.abortAll('shutdown');
        },
        Math.max(0, timeout - 2000),
      );
      timer.unref();
      this.timers.push(timer);
    }
    await Promise.all(this.loops.map((l) => l.stop()));
    for (const service of this.options.services ?? []) await service.stop();
    this.settingsRef?.stop();
  }

  /** Số lượt bị hủy vì tắt quá hạn – tiến trình nên thoát mã 1 (R16, SC-008). */
  abortedOnShutdown = 0;

  abortAll(reason: AbortReason): void {
    if (reason === 'shutdown') this.abortedOnShutdown += this.aborters.size;
    for (const abort of this.aborters) abort(reason);
  }

  /** Chờ mọi lượt đang chạy xong (kiểm thử / không có bộ điều phối). */
  async drainInFlight(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  /** Đóng pg-boss và bể điều khiển (sau khi đã xả việc). */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    liveRuntimes.delete(this);
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.settingsRef?.stop();
    if (this.bossRef !== undefined) {
      clearProducer(this.bossRef);
      await this.bossRef.stop({ graceful: false, close: false }).catch(() => undefined);
    }
    await this.poolRef?.end().catch(() => undefined);
  }

  /** Tắt đầy đủ: ngừng lấy, chờ việc đang chạy, đóng. */
  async stop(): Promise<void> {
    await this.beginShutdown();
    await this.drainInFlight();
    await this.close();
  }
}
