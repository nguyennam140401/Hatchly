// Giao diện công khai của lõi máy chủ – module nghiệp vụ chỉ nhập từ đây.
export { APP_CONFIG, AppConfigSchema, secret, type AppConfig } from './config/config.schema';
export { ConfigError, loadConfig, loadConfigFrom, type ConfigIssue } from './config/load-config';
export {
  getRequestContext,
  requestContextMiddleware,
  resolveTraceId,
  TRACE_ID_HEADER,
  type ApiRequestContext,
} from './context/request-context';
export { AppError, type AppErrorOptions } from './errors/app-error';
export { ErrorFilter } from './errors/error.filter';
export { ReadinessRegistry, type ReadinessCheck } from './health/readiness';
export { uuidV7 } from './ids/uuid-v7';
export {
  ShutdownCoordinator,
  type LifecycleState,
  type ShutdownCoordinatorOptions,
} from './lifecycle/shutdown-coordinator';
export { installShutdownSignals } from './lifecycle/shutdown-signals';
export { CoreModule, APP_UNIT } from './core.module';
export { ValidBody, ValidParam, ValidQuery } from './validation/decorators';
export { ZodValidationPipe } from './validation/zod-validation.pipe';
