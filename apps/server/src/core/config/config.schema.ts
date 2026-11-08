import { z } from 'zod';

// Lược đồ biến môi trường (data-model.md mục 3, R6). Kiểm tra một lần khi khởi động.

/** Sổ đánh dấu biến bí mật: giá trị không bao giờ được ghi nhật ký hay đưa vào thông điệp lỗi. */
export const secretRegistry = z.registry<{ secret: true }>();

/** Đánh dấu một biến là bí mật (vd mật khẩu CSDL – WBS 1.2 thêm). */
export function secret<T extends z.ZodType>(schema: T): T {
  secretRegistry.add(schema, { secret: true });
  return schema;
}

const port = (fallback: number) => z.coerce.number().int().min(1).max(65535).default(fallback);

/** Chuỗi kết nối PostgreSQL (`postgres://` hoặc `postgresql://`, có máy chủ). */
export const postgresUrl = () =>
  z.string().refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'postgres:' || url.protocol === 'postgresql:') && url.hostname !== ''
      );
    } catch {
      return false;
    }
  });

export const AppConfigSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']),
  APP_VERSION: z.string().min(1).default('0.0.0-dev'),
  API_PORT: port(3000),
  WORKER_HEALTH_PORT: port(3001),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(30000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((raw) =>
      raw
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    )
    .pipe(z.array(z.url())),

  // ----- CSDL (002, contracts/db-commands.md mục 2) – mọi URL là bí mật -----
  /** Vai trò `app` – API và Worker, chịu RLS. */
  DATABASE_APP_URL: secret(postgresUrl()),
  /** Vai trò `system` – chỉ Worker (bắt buộc ở Worker, xem `assertWorkerDatabaseConfig`). */
  DATABASE_SYSTEM_URL: secret(postgresUrl().optional()),
  /** Vai trò `support` – chỉ API, tùy chọn. */
  DATABASE_SUPPORT_URL: secret(postgresUrl().optional()),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15000),
  DATABASE_IDLE_IN_TX_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

/** Token NestJS để tiêm cấu hình đã kiểm tra. */
export const APP_CONFIG = Symbol('APP_CONFIG');
