// pnpm db:setup – CHỈ cho dev/test: bootstrap 4 vai trò rồi áp migration (gồm sandbox).
// Môi trường thật: hạ tầng chạy roles.sql và Job `node dist/db/migrate.js` riêng (WBS 1.5).
import { bootstrapFromEnv } from './bootstrap';
import { migrateFromEnv } from './migrate';
import { runScript } from './script-utils';

export async function setupDev(
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const appEnv = env.APP_ENV;
  if (appEnv === 'staging' || appEnv === 'production') {
    throw new Error(`db:setup chỉ dùng cho development/test (APP_ENV=${appEnv})`);
  }
  await bootstrapFromEnv(env);
  await migrateFromEnv(env);
}

if (require.main === module) {
  runScript(() => setupDev());
}
