// Điểm khởi động đơn vị API (ADR-01): `node dist/api.js` – lệnh mặc định của ảnh container.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { ApiAppModule } from './app/api-app.module';
import { configureApiApp } from './app/configure-api-app';
import { DatabaseService } from './core/db/database';
import {
  assertSandboxSchemaReady,
  logGatewaySelection,
  logStagingFakes,
  readGatewaySelection,
} from './core/gateways/selection';
import { ConfigError, installShutdownSignals, loadConfig, ShutdownCoordinator } from './core';

export async function bootstrapApi(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(env);
  const app = await NestFactory.create(ApiAppModule.forRoot(config), { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.flushLogs();
  // 005 (US6-AS1): cùng lựa chọn bản cài đặt ở API và Worker; thiếu schema sandbox → dừng.
  logGatewaySelection(logger, readGatewaySelection(config));
  logStagingFakes(logger, config);
  await assertSandboxSchemaReady(config, app.get(DatabaseService), logger);

  configureApiApp(app, config);
  const coordinator = app.get(ShutdownCoordinator);
  installShutdownSignals(app, { logger, unit: 'api' });

  await app.listen(config.API_PORT);
  coordinator.markReady();
  logger.log({ msg: 'api.ready', port: config.API_PORT });
  return { app, coordinator };
}

async function main(): Promise<void> {
  try {
    await bootstrapApi();
  } catch (err) {
    // Lỗi cấu hình: chỉ in tên biến + lý do, không in giá trị (FR-006).
    console.error(err instanceof ConfigError ? err.message : err);
    process.exit(1);
  }
}

if (require.main === module) void main();
