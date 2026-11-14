import { z } from 'zod';
import { postgresUrl, secret } from '../core/config/config.schema';
import { loadConfigFrom } from '../core/config/load-config';

// Lược đồ biến cho script CSDL (contracts/db-commands.md mục 2). KHÔNG nằm trong AppConfigSchema:
// API/Worker không bao giờ đọc chuỗi kết nối của `owner` hay tài khoản quản trị (research R7).

const AppEnv = z.enum(['development', 'test', 'staging', 'production']);

export const BootstrapConfigSchema = z.object({
  DATABASE_ADMIN_URL: secret(postgresUrl()),
  DATABASE_NAME: z
    .string()
    .regex(/^[a-z_][a-z0-9_]*$/)
    .optional(),
  DB_ROLE_PASSWORD_OWNER: secret(z.string().min(8)),
  DB_ROLE_PASSWORD_APP: secret(z.string().min(8)),
  DB_ROLE_PASSWORD_SYSTEM: secret(z.string().min(8)),
  DB_ROLE_PASSWORD_SUPPORT: secret(z.string().min(8)),
});
export type BootstrapConfig = z.infer<typeof BootstrapConfigSchema>;

export const MigrateConfigSchema = z.object({
  APP_ENV: AppEnv,
  /** 007 (R15): chỉ có nghĩa ở `staging`. */
  STAGING_ALLOW_FAKES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  DATABASE_OWNER_URL: secret(postgresUrl()),
});
export type MigrateConfig = z.infer<typeof MigrateConfigSchema>;

export const CheckConfigSchema = z.object({
  DATABASE_OWNER_URL: secret(postgresUrl()),
});

type Env = Record<string, string | undefined>;

export const loadBootstrapConfig = (env: Env = process.env) =>
  loadConfigFrom(BootstrapConfigSchema, env);
export const loadMigrateConfig = (env: Env = process.env) =>
  loadConfigFrom(MigrateConfigSchema, env);
export const loadCheckConfig = (env: Env = process.env) => loadConfigFrom(CheckConfigSchema, env);
