// Điểm khởi động đơn vị Worker (ADR-01): `node dist/worker.js` – Kubernetes ghi đè `command`.
// Worker không giữ trạng thái nghiệp vụ trong tiến trình và không ghi tệp cục bộ (FR-002), nên
// chạy được nhiều bản song song (SC-009).
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerAppModule } from './app/worker-app.module';
import {
  ConfigError,
  installShutdownSignals,
  loadConfig,
  ReadinessRegistry,
  ShutdownCoordinator,
} from './core';
import { DatabaseService } from './core/db/database';
import {
  assertSandboxSchemaReady,
  logGatewaySelection,
  logStagingFakes,
  readGatewaySelection,
} from './core/gateways/selection';
import { assertWorkerDatabaseConfig } from './core/config/load-config';
import { WorkerHealthServer } from './core/health/worker-health-server';
import { QueueLifecycle } from './modules/queue';

/** Chờ hàng chờ khởi động lần đầu trước khi ghi worker.ready (CSDL chưa sẵn sàng → vẫn chạy tiếp). */
const QUEUE_START_WAIT_MS = 15_000;

export async function bootstrapWorker(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(env);
  // Worker cần thêm bể system cho việc dùng chung (002, R15) và bể điều khiển hàng chờ (003).
  assertWorkerDatabaseConfig(config);
  const app = await NestFactory.createApplicationContext(WorkerAppModule.forRoot(config), {
    bufferLogs: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.flushLogs();
  // 005 (US6-AS1): cùng lựa chọn bản cài đặt ở API và Worker; thiếu schema sandbox → dừng.
  logGatewaySelection(logger, readGatewaySelection(config));
  logStagingFakes(logger, config);
  await assertSandboxSchemaReady(config, app.get(DatabaseService), logger);

  const coordinator = app.get(ShutdownCoordinator);
  const health = new WorkerHealthServer({
    version: config.APP_VERSION,
    getState: () => coordinator.state,
    // GET /readyz: database + queue (003 FR-019, contracts/queue-commands.md mục 3).
    readiness: app.get(ReadinessRegistry),
  });
  await health.listen(config.WORKER_HEALTH_PORT);

  installShutdownSignals(app, { logger, unit: 'worker', afterClose: () => health.close() });

  const queue = app.get(QueueLifecycle);
  await queue.whenStarted(QUEUE_START_WAIT_MS);
  coordinator.markReady();
  logger.log({ msg: 'worker.ready', queues: queue.queues, health_port: config.WORKER_HEALTH_PORT });
  return { app, coordinator, health };
}

async function main(): Promise<void> {
  try {
    await bootstrapWorker();
  } catch (err) {
    // Lỗi cấu hình: chỉ in tên biến + lý do, không in giá trị (FR-006).
    console.error(err instanceof ConfigError ? err.message : err);
    process.exit(1);
  }
}

if (require.main === module) void main();
