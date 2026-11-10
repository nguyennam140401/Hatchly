// Tiến trình con "một bản Worker" cho kiểm thử chết giữa chừng / tắt có kiểm soát (003 T032, T033).
// Chạy: node --import tsx test/queue/helpers/worker-child.ts – cấu hình qua biến môi trường, báo sự kiện
// cho tiến trình cha qua IPC. Lệnh {cmd:'stop'} mô phỏng SIGTERM (Windows không bắt được SIGTERM).
import { z } from 'zod';
import { DatabaseService, setActiveDatabase } from '../../../src/core/db/database';
import { ShutdownCoordinator } from '../../../src/core/lifecycle/shutdown-coordinator';
import { defineJobType, registerJobHandler } from '../../../src/modules/queue';
import type { QueueLogger } from '../../../src/modules/queue/internal/logger';
import { QueueRuntime } from '../../../src/modules/queue/internal/runtime/queue-runtime';
import { childJobPayload, CHILD_JOB } from './child-jobs';

const send = (msg: Record<string, unknown>) => {
  process.send?.(msg);
};

const logger: QueueLogger = {
  debug: () => undefined,
  info: (e) => {
    send({ event: 'log', entry: e });
  },
  warn: (e) => {
    send({ event: 'log', entry: e });
  },
  error: (e) => {
    send({ event: 'log', entry: e });
  },
};

const longJob = defineJobType({ ...CHILD_JOB, payload: childJobPayload(z) });

registerJobHandler(longJob, async ({ durationMs }, ctx) => {
  send({ event: 'started', jobId: ctx.jobId, attempt: ctx.attempt });
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, durationMs);
    ctx.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      send({
        event: 'aborted',
        jobId: ctx.jobId,
        reason: (ctx.signal.reason as Error).message,
      });
      resolve();
    });
  });
  send({ event: 'handler_done', jobId: ctx.jobId });
});

async function main(): Promise<void> {
  const env = process.env;
  const timeoutMs = Number(env.SHUTDOWN_TIMEOUT_MS ?? 30_000);
  const database = new DatabaseService({
    unit: 'worker',
    appEnv: 'test',
    appUrl: env.DATABASE_APP_URL!,
    systemUrl: env.DATABASE_SYSTEM_URL!,
    poolMax: 5,
    statementTimeoutMs: 15_000,
    idleInTxTimeoutMs: 30_000,
    logger: { warn: () => undefined, error: () => undefined },
  });
  setActiveDatabase(database);
  const coordinator = new ShutdownCoordinator({
    timeoutMs,
    exit: (code) => {
      send({ event: 'exit', code });
      process.exit(code);
    },
    logger: { log: () => undefined, warn: () => undefined },
  });
  const runtime = new QueueRuntime({
    systemUrl: env.DATABASE_SYSTEM_URL!,
    controlPoolMax: 4,
    settingsRefreshMs: 60_000,
    enabled: true,
    logger,
    coordinator,
    shutdownTimeoutMs: timeoutMs,
    queues: [CHILD_JOB.queue],
    boss: { superviseIntervalSeconds: 2, monitorIntervalSeconds: 2 },
  });
  await runtime.start();
  coordinator.markReady();
  send({ event: 'ready' });

  process.on('message', (msg: { cmd?: string }) => {
    if (msg.cmd !== 'stop') return;
    void (async () => {
      send({ event: 'stopping' });
      await coordinator.beforeApplicationShutdown('SIGTERM');
      await runtime.close();
      await database.close();
      const code = runtime.abortedOnShutdown > 0 ? 1 : 0;
      send({ event: 'exit', code });
      process.exit(code);
    })();
  });
}

main().catch((err: unknown) => {
  send({ event: 'error', message: err instanceof Error ? err.message : String(err) });
  process.exit(2);
});
