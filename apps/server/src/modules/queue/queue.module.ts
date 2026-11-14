import {
  type DynamicModule,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { UnitName } from '@app/shared/core';
import {
  APP_CONFIG,
  APP_UNIT,
  ReadinessRegistry,
  ShutdownCoordinator,
  type AppConfig,
} from '../../core';
import { setQueueUnit } from './internal/handlers';
import { nestQueueLogger, type QueueLogger } from './internal/logger';
import { startProducer, type ProducerHandle } from './internal/producer-boss';
import { queueReadinessCheck } from './internal/readiness';
import { QueueRuntime } from './internal/runtime/queue-runtime';
import { SmokeController } from './internal/smoke/smoke.controller';
import { SmokeTokenGuard } from './internal/smoke/smoke-token.guard';
import { queueServices } from './internal/services';

const MAX_START_BACKOFF_MS = 30_000;

/** Đọc mã lỗi an toàn (không thông điệp – có thể chứa máy chủ/người dùng). */
const codeOf = (err: unknown): string => {
  const e = err as { detail?: unknown; code?: unknown } | null;
  if (typeof e?.detail === 'string') return e.detail;
  return typeof e?.code === 'string' ? e.code : 'UNKNOWN';
};

/**
 * Vòng đời lớp hàng chờ của một tiến trình (research R4, R16):
 * - `worker`: QueueRuntime (bể điều khiển `system`, 6 vòng lấy việc, bộ hẹn giờ) – khởi động nền, CSDL
 *   chưa sẵn sàng thì thử lại giãn cách (≤ 30 giây), /readyz báo 503 tới khi chạy được;
 * - `api`: pg-boss chỉ-tạo-việc (bể `app`, QUEUE_API_POOL_MAX).
 * Tắt: ShutdownCoordinator.onStopping → ngừng lấy việc; sau khi xả việc → đóng pg-boss + bể.
 */
@Injectable()
class QueueLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger: QueueLogger = nestQueueLogger(new Logger('Queue'));
  private runtime: QueueRuntime | undefined;
  private producer: ProducerHandle | undefined;
  private starting: Promise<void> | undefined;
  private shuttingDown = false;
  private started = false;

  constructor(
    @Inject(APP_UNIT) private readonly unit: UnitName,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ShutdownCoordinator) private readonly coordinator: ShutdownCoordinator,
    @Inject(ReadinessRegistry) readiness: ReadinessRegistry,
  ) {
    setQueueUnit(unit === 'worker' ? 'worker' : 'api');
    readiness.register(
      unit === 'worker'
        ? queueReadinessCheck(() => this.runtime)
        : { name: 'queue', check: () => Promise.resolve(this.started) },
    );
    coordinator.onStopping(() => {
      this.shuttingDown = true;
    });
  }

  onApplicationBootstrap(): void {
    // Không chặn khởi động khi CSDL chưa sẵn sàng – /readyz báo 503 tới khi chạy được.
    this.starting = this.startWithRetry();
  }

  private async startOnce(): Promise<void> {
    if (this.unit === 'worker') {
      const systemUrl = this.config.DATABASE_SYSTEM_URL;
      if (systemUrl === undefined) throw new Error('Worker thiếu DATABASE_SYSTEM_URL');
      const runtime = new QueueRuntime({
        systemUrl,
        controlPoolMax: this.config.QUEUE_CONTROL_POOL_MAX,
        statementTimeoutMs: this.config.DATABASE_STATEMENT_TIMEOUT_MS,
        settingsRefreshMs: this.config.QUEUE_SETTINGS_REFRESH_MS,
        enabled: this.config.QUEUE_ENABLED,
        logger: this.logger,
        coordinator: this.coordinator,
        shutdownTimeoutMs: this.config.SHUTDOWN_TIMEOUT_MS,
        services: queueServices({
          appEnv: this.config.APP_ENV,
          schedulerTickMs: this.config.QUEUE_SCHEDULER_TICK_MS,
        }),
      });
      await runtime.start();
      this.runtime = runtime;
    } else {
      this.producer = await startProducer({
        appUrl: this.config.DATABASE_APP_URL,
        poolMax: this.config.QUEUE_API_POOL_MAX,
        logger: this.logger,
      });
    }
    this.started = true;
  }

  private firstAttemptDone: (() => void) | undefined;
  private readonly firstAttempt = new Promise<void>((resolve) => {
    this.firstAttemptDone = resolve;
  });

  private async startWithRetry(): Promise<void> {
    let backoff = 1000;
    while (!this.shuttingDown) {
      try {
        await this.startOnce();
        this.firstAttemptDone?.();
        return;
      } catch (err) {
        this.firstAttemptDone?.();
        this.logger.warn({
          event: 'queue.start_failed',
          code: codeOf(err),
          retry_in_ms: backoff,
        });
        await new Promise((resolve) => setTimeout(resolve, backoff).unref());
        backoff = Math.min(MAX_START_BACKOFF_MS, backoff * 2);
      }
    }
  }

  /** Tên 6 hàng chờ đang chạy (nhật ký worker.ready). */
  get queues(): readonly string[] {
    return this.runtime !== undefined && this.config.QUEUE_ENABLED ? this.runtime.queues : [];
  }

  /**
   * Chờ LẦN THỬ khởi động đầu tiên (thành công hay lỗi) – worker.ts ghi worker.ready với 6 hàng chờ.
   * CSDL chưa sẵn sàng thì không chặn: các lần thử sau chạy nền, /readyz báo 503 tới khi chạy được.
   */
  async whenStarted(timeoutMs: number): Promise<boolean> {
    if (this.starting === undefined) return false;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    await Promise.race([this.firstAttempt, timeout]);
    clearTimeout(timer);
    return this.started;
  }

  // Chạy SAU beforeApplicationShutdown (ShutdownCoordinator đã chờ việc đang chạy).
  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.runtime !== undefined) {
      await this.runtime.close();
      // Việc bị hủy vì tắt quá hạn → thoát mã 1 (R16, SC-008).
      if (this.runtime.abortedOnShutdown > 0) process.exitCode = 1;
    }
    await this.producer?.stop();
  }
}

/**
 * Module Hàng chờ (hạ tầng) (`queue`, WBS 1.3). Giao diện công khai là các hàm module-cấp trong
 * `index.ts` (enqueue, defineJobType, registerJobHandler…) – không phải provider.
 */
@Module({ providers: [QueueLifecycle], exports: [QueueLifecycle] })
export class QueueModule {
  /** API có thêm điểm cuối kiểm tra khói `/ops/smoke` (008 FR-032); Worker chỉ có vòng đời hàng chờ. */
  static forUnit(unit: 'api' | 'worker'): DynamicModule {
    return {
      module: QueueModule,
      providers: unit === 'api' ? [QueueLifecycle, SmokeTokenGuard] : [QueueLifecycle],
      controllers: unit === 'api' ? [SmokeController] : [],
      exports: [QueueLifecycle],
    };
  }
}

export { QueueLifecycle };
