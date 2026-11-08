// pnpm db:bootstrap – tạo/cập nhật 4 vai trò CSDL và quyền cấp CSDL (research R6). Idempotent.
// Chạy bằng DATABASE_ADMIN_URL (quản trị cụm). Không bao giờ in mật khẩu hay chuỗi kết nối.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { loadBootstrapConfig } from './script-config';
import { DRIZZLE_DIR, databaseOf, runScript, withDatabase } from './script-utils';

export interface BootstrapOptions {
  adminUrl: string;
  /** CSDL đích; mặc định lấy từ `adminUrl`. */
  database?: string | undefined;
  passwords: { owner: string; app: string; system: string; support: string };
  /** Vai trò đã có thì giữ mật khẩu cũ (kiểm thử – vai trò là đối tượng cấp cụm, dùng chung). */
  keepExistingPasswords?: boolean;
  log?: (line: string) => void;
}

/** Tạo CSDL nếu chưa có rồi chạy `drizzle/bootstrap/roles.sql` trên CSDL đó. */
export async function runBootstrap(options: BootstrapOptions): Promise<void> {
  const log =
    options.log ??
    ((line: string) => {
      console.log(line);
    });
  const database = options.database ?? databaseOf(options.adminUrl);
  if (database === '') throw new Error('Không xác định được tên CSDL (đặt DATABASE_NAME)');

  // 1. Tạo CSDL đích nếu chưa có – kết nối vào CSDL bảo trì `postgres`.
  const maintenance = new Client({ connectionString: withDatabase(options.adminUrl, 'postgres') });
  await maintenance.connect();
  try {
    const found = await maintenance.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      database,
    ]);
    if (found.rowCount === 0) {
      await maintenance.query(`CREATE DATABASE ${maintenance.escapeIdentifier(database)}`);
      log(`Đã tạo CSDL ${database}`);
    }
  } finally {
    await maintenance.end();
  }

  // 2. Vai trò + quyền. Mật khẩu đi qua tham số ràng buộc → biến phiên → format('%L') phía máy chủ.
  const client = new Client({ connectionString: withDatabase(options.adminUrl, database) });
  await client.connect();
  try {
    for (const [role, password] of Object.entries(options.passwords)) {
      await client.query('SELECT set_config($1, $2, false)', [
        `bootstrap.password_${role}`,
        password,
      ]);
    }
    await client.query("SELECT set_config('bootstrap.keep_existing_passwords', $1, false)", [
      options.keepExistingPasswords === true ? 'on' : 'off',
    ]);
    await client.query(readFileSync(join(DRIZZLE_DIR, 'bootstrap', 'roles.sql'), 'utf8'));
  } finally {
    await client.end();
  }
  log('Đã khởi tạo 4 vai trò');
}

export function bootstrapFromEnv(
  env: Record<string, string | undefined> = process.env,
  keepExistingPasswords = false,
): Promise<void> {
  const config = loadBootstrapConfig(env);
  return runBootstrap({
    adminUrl: config.DATABASE_ADMIN_URL,
    database: config.DATABASE_NAME,
    passwords: {
      owner: config.DB_ROLE_PASSWORD_OWNER,
      app: config.DB_ROLE_PASSWORD_APP,
      system: config.DB_ROLE_PASSWORD_SYSTEM,
      support: config.DB_ROLE_PASSWORD_SUPPORT,
    },
    keepExistingPasswords,
  });
}

if (require.main === module) {
  runScript(() =>
    bootstrapFromEnv(process.env, process.argv.includes('--keep-existing-passwords')),
  );
}
