// Điểm khởi động đơn vị Worker (ADR-01): `node dist/worker.js` – Kubernetes ghi đè `command`.
// Worker không giữ trạng thái nghiệp vụ trong tiến trình và không ghi tệp cục bộ (FR-002), nên
// chạy được nhiều bản song song (SC-009).
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerAppModule } from './app/worker-app.module';
import { ConfigError, installShutdownSignals, loadConfig, ShutdownCoordinator } from './core';
import { WorkerHealthServer } from './core/health/worker-health-server';

export async function bootstrapWorker(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(env);
  const app = await NestFactory.createApplicationContext(WorkerAppModule.forRoot(config), {
    bufferLogs: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.flushLogs();

  const coordinator = app.get(ShutdownCoordinator);
  const health = new WorkerHealthServer({
    version: config.APP_VERSION,
    getState: () => coordinator.state,
  });
  await health.listen(config.WORKER_HEALTH_PORT);

  installShutdownSignals(app, { logger, unit: 'worker', afterClose: () => health.close() });

  coordinator.markReady();
  // Chưa có hàng chờ nào (WBS 1.3) – Worker vẫn chạy giữ tiến trình.
  logger.log({ msg: 'worker.ready', queues: [], health_port: config.WORKER_HEALTH_PORT });
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
