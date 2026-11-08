import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import type { TestProject } from 'vitest/node';
import { runBootstrap } from '../../src/db/bootstrap';
import { runMigrations } from '../../src/db/migrate';

// Tạo CSDL tạm app_test_<8 ký tự> cho mỗi lần chạy `pnpm test:db` (research R16): bootstrap vai trò
// (GIỮ mật khẩu vai trò đã có – vai trò là đối tượng cấp cụm, dùng chung với CSDL dev) + migrate
// (gồm sandbox). Chạy xong thì xóa. Không có TEST_DATABASE_ADMIN_URL → bỏ qua có thông báo.

export interface DbTestUrls {
  admin: string;
  owner: string;
  app: string;
  system: string;
  support: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    dbAvailable: boolean;
    dbName: string;
    dbUrls: DbTestUrls;
  }
}

function roleUrl(adminUrl: string, user: string, password: string, database: string): string {
  const url = new URL(adminUrl);
  url.username = encodeURIComponent(user);
  url.password = encodeURIComponent(password);
  url.pathname = `/${database}`;
  return url.toString();
}

export default async function setup(
  project: TestProject,
): Promise<(() => Promise<void>) | undefined> {
  // Mật khẩu vai trò: biến môi trường, rồi apps/server/.env, rồi giá trị dev của .env.example.
  const envFile = resolve(process.cwd(), '.env');
  if (existsSync(envFile)) {
    const before = { ...process.env };
    process.loadEnvFile(envFile);
    // Biến đặt sẵn trong shell được ưu tiên hơn .env.
    Object.assign(process.env, before);
  }
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (adminUrl === undefined || adminUrl === '') {
    console.log('Bỏ qua kiểm thử CSDL: chưa đặt TEST_DATABASE_ADMIN_URL');
    project.provide('dbAvailable', false);
    project.provide('dbName', '');
    project.provide('dbUrls', { admin: '', owner: '', app: '', system: '', support: '' });
    return undefined;
  }

  const passwords = {
    owner: process.env.DB_ROLE_PASSWORD_OWNER ?? 'owner_dev_only',
    app: process.env.DB_ROLE_PASSWORD_APP ?? 'app_dev_only',
    system: process.env.DB_ROLE_PASSWORD_SYSTEM ?? 'system_dev_only',
    support: process.env.DB_ROLE_PASSWORD_SUPPORT ?? 'support_dev_only',
  };
  const dbName = `app_test_${randomBytes(4).toString('hex')}`;
  const quiet = () => undefined;

  await runBootstrap({
    adminUrl,
    database: dbName,
    passwords,
    keepExistingPasswords: true,
    log: quiet,
  });
  const urls: DbTestUrls = {
    admin: roleUrl(
      adminUrl,
      new URL(adminUrl).username,
      decodeURIComponent(new URL(adminUrl).password),
      dbName,
    ),
    owner: roleUrl(adminUrl, 'owner', passwords.owner, dbName),
    app: roleUrl(adminUrl, 'app', passwords.app, dbName),
    system: roleUrl(adminUrl, 'system', passwords.system, dbName),
    support: roleUrl(adminUrl, 'support', passwords.support, dbName),
  };
  await runMigrations({ ownerUrl: urls.owner, appEnv: 'test', log: quiet });
  console.log(`CSDL kiểm thử: ${dbName}`);

  project.provide('dbAvailable', true);
  project.provide('dbName', dbName);
  project.provide('dbUrls', urls);

  return async () => {
    const client = new Client({ connectionString: adminUrl });
    await client.connect();
    try {
      await client.query(`DROP DATABASE IF EXISTS ${client.escapeIdentifier(dbName)} WITH (FORCE)`);
    } finally {
      await client.end();
    }
  };
}
