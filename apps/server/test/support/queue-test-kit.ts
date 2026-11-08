// Khuôn kiểm thử dùng lại cho lớp hàng chờ (003 FR-035, contracts/queue-api.md mục 8).
// Module nghiệp vụ dùng: `runJobInline` (chạy bộ xử lý không cần Worker thật), `expectIdempotent`
// (chạy hai lần, so ảnh chụp), `startTestWorkers` (1–2 bản Worker thật trong cùng tiến trình).
import type { MeterProvider } from '@opentelemetry/api';
import { expect, inject } from 'vitest';
import { runWithJobContext } from '../../src/core/context/bind-account';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { upgradePayload } from '../../src/modules/queue/job-types';
import type {
  JobHandlerResult,
  JobTypeDefinition,
  QueueName,
} from '../../src/modules/queue/public-api';
import { getHandler } from '../../src/modules/queue/internal/handlers';
import { silentLogger, type QueueLogEntry, type QueueLogger } from '../../src/modules/queue/internal/logger';
import { startProducer } from '../../src/modules/queue/internal/producer-boss';
import type { WorkerBossOptions } from '../../src/modules/queue/internal/pgboss/boss-loader';
import {
  QueueRuntime,
  type CoordinatorLike,
  type RuntimeService,
} from '../../src/modules/queue/internal/runtime/queue-runtime';

/** Bật bộ tạo việc (như API) trên vai trò `app` của CSDL kiểm thử. Trả hàm dừng. */
export async function startTestProducer(logger: QueueLogger = silentLogger): Promise<() => Promise<void>> {
  const urls = inject('dbUrls');
  const handle = await startProducer({ appUrl: urls.app, poolMax: 2, logger });
  return () => handle.stop();
}

/** Bộ ghi nhật ký gom vào mảng (kèm mức). */
export interface CapturedQueueLogs extends QueueLogger {
  entries: (QueueLogEntry & { level: 'debug' | 'info' | 'warn' | 'error' })[];
  of(event: string): QueueLogEntry[];
}

export function captureQueueLogs(): CapturedQueueLogs {
  const entries: CapturedQueueLogs['entries'] = [];
  return {
    entries,
    of: (event) => entries.filter((e) => e.event === event),
    debug: (e) => entries.push({ level: 'debug', ...e }),
    info: (e) => entries.push({ level: 'info', ...e }),
    warn: (e) => entries.push({ level: 'warn', ...e }),
    error: (e) => entries.push({ level: 'error', ...e }),
  };
}

export interface TestWorkersOptions {
  queues?: readonly QueueName[];
  logger?: QueueLogger;
  settingsRefreshMs?: number;
  heartbeatEveryMs?: number;
  boss?: WorkerBossOptions;
  meterProvider?: MeterProvider;
  services?: (index: number) => RuntimeService[];
  coordinator?: CoordinatorLike;
  shutdownTimeoutMs?: number;
  controlPoolMax?: number;
  random?: () => number;
  enabled?: boolean;
}

export interface TestWorkers {
  runtimes: QueueRuntime[];
  logs: CapturedQueueLogs;
  /** Chờ tới khi không còn việc đến giờ / đang chạy trên các hàng chờ đã chọn. */
  drain(timeoutMs?: number): Promise<void>;
  stop(): Promise<void>;
}

/**
 * `n` bản Worker độc lập trong cùng tiến trình – mỗi bản một bể điều khiển + pg-boss riêng, cùng dùng
 * DatabaseService đang hoạt động (makeDatabase) cho tenantTx/systemTx của bộ xử lý.
 */
export async function startTestWorkers(
  n: 1 | 2,
  opts: TestWorkersOptions = {},
): Promise<TestWorkers> {
  const urls = inject('dbUrls');
  const logs = captureQueueLogs();
  const logger: QueueLogger = opts.logger ?? logs;
  const runtimes: QueueRuntime[] = [];
  for (let i = 0; i < n; i++) {
    const runtime = new QueueRuntime({
      systemUrl: urls.system,
      controlPoolMax: opts.controlPoolMax ?? 6,
      settingsRefreshMs: opts.settingsRefreshMs ?? 60_000,
      enabled: opts.enabled ?? true,
      logger,
      ...(opts.queues !== undefined ? { queues: opts.queues } : {}),
      ...(opts.heartbeatEveryMs !== undefined ? { heartbeatEveryMs: opts.heartbeatEveryMs } : {}),
      boss: opts.boss ?? { superviseIntervalSeconds: 2, monitorIntervalSeconds: 2 },
      ...(opts.meterProvider !== undefined ? { meterProvider: opts.meterProvider } : {}),
      ...(opts.services !== undefined ? { services: opts.services(i) } : {}),
      ...(opts.coordinator !== undefined ? { coordinator: opts.coordinator } : {}),
      ...(opts.shutdownTimeoutMs !== undefined ? { shutdownTimeoutMs: opts.shutdownTimeoutMs } : {}),
      ...(opts.random !== undefined ? { random: opts.random } : {}),
    });
    await runtime.start();
    runtimes.push(runtime);
  }
  const queues = opts.queues;
  return {
    runtimes,
    logs,
    drain: async (timeoutMs = 60_000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const pool = runtimes[0]!.pool;
        const r = await pool.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM pgboss.job_common
            WHERE ($1::text[] IS NULL OR name = ANY($1))
              AND (state = 'active' OR (state IN ('created', 'retry') AND start_after <= now()))`,
          [queues ?? null],
        );
        if (Number(r.rows[0]?.n ?? 0) === 0 && runtimes.every((rt) => rt.running === 0)) return;
        if (Date.now() > deadline) throw new Error('drain: hết thời gian chờ hàng chờ rỗng');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
    stop: async () => {
      await Promise.all(runtimes.map((r) => r.stop()));
    },
  };
}

/** Bộ hủy giả cho runJobInline. */
const neverAborted = () => new AbortController().signal;

/**
 * Chạy bộ xử lý đã đăng ký của `def` NGAY trong tiến trình kiểm thử, đúng ngữ cảnh như Worker thật
 * (runWithJobContext với tài khoản của việc), không cần hàng chờ. Trả kết quả của bộ xử lý.
 */
export async function runJobInline<P>(
  def: JobTypeDefinition<P>,
  payload: P,
  opts: { accountId?: string; attempt?: number; signal?: AbortSignal } = {},
): Promise<JobHandlerResult> {
  const registered = getHandler(def.name);
  if (registered === undefined) throw new Error(`Chưa đăng ký bộ xử lý cho ${def.name}`);
  const value = upgradePayload(def, payload, def.version);
  const traceId = uuidV7();
  return runWithJobContext({ traceId, accountId: opts.accountId }, () =>
    registered.handler(value, {
      jobId: uuidV7(),
      type: def.name,
      queue: def.queue,
      attempt: opts.attempt ?? 1,
      maxRetries: def.retry?.maxRetries ?? 0,
      accountId: opts.accountId ?? null,
      traceId,
      signal: opts.signal ?? neverAborted(),
    }),
  );
}

/**
 * Kiểm "chạy lại hai lần cho cùng kết quả" (hiến pháp V): chạy bộ xử lý 2 lần trên cùng dữ liệu, so
 * `snapshot()` sau lần 1 và sau lần 2 (bằng nhau sâu).
 */
export async function expectIdempotent<P>(
  def: JobTypeDefinition<P>,
  payload: P,
  opts: { accountId?: string; snapshot: () => Promise<unknown> },
): Promise<void> {
  await runJobInline(def, payload, { ...(opts.accountId !== undefined ? { accountId: opts.accountId } : {}), attempt: 1 });
  const first = await opts.snapshot();
  await runJobInline(def, payload, { ...(opts.accountId !== undefined ? { accountId: opts.accountId } : {}), attempt: 2 });
  const second = await opts.snapshot();
  expect(second).toEqual(first);
}
