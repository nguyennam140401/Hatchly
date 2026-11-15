// Môi trường cho kiểm thử trình duyệt (006 T064, nhóm g) – CHỈ dùng bởi `e2e/` (Playwright webServer).
// 1. Tạo CSDL tạm app_e2e_<ngẫu nhiên> từ TEST_DATABASE_ADMIN_URL: bootstrap vai trò + migrate.
// 2. Chạy API (APP_ENV=test, thư trong bộ nhớ) trên CSDL đó.
// 3. Mồi chủ tài khoản + cộng tác viên đã xác minh với mật khẩu ngẫu nhiên.
// 4. Ghi trạng thái (tên CSDL, tài khoản mẫu) ra tệp JSON cho kiểm thử và globalTeardown (xóa CSDL).
// Cách dùng: tsx src/ops/e2e-env.ts <đường-dẫn-tệp-trạng-thái>
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { bootstrapApi } from '../api';
import { runBootstrap } from '../db/bootstrap';
import { runMigrations } from '../db/migrate';
import { ACCOUNT_PUBLIC_API, type AccountPublicApi } from '../modules/account';

function roleUrl(adminUrl: string, user: string, password: string, database: string): string {
  const url = new URL(adminUrl);
  url.username = encodeURIComponent(user);
  url.password = encodeURIComponent(password);
  url.pathname = `/${database}`;
  return url.toString();
}

async function main(): Promise<void> {
  const statePath = process.argv[2];
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (statePath === undefined || adminUrl === undefined || adminUrl === '') {
    throw new Error('Cần TEST_DATABASE_ADMIN_URL và đường dẫn tệp trạng thái');
  }
  // Kiểm thử chỉ đọc tệp do lần chạy NÀY ghi.
  mkdirSync(dirname(statePath), { recursive: true });
  rmSync(statePath, { force: true });
  const passwords = {
    owner: process.env.DB_ROLE_PASSWORD_OWNER ?? 'owner_dev_only',
    app: process.env.DB_ROLE_PASSWORD_APP ?? 'app_dev_only',
    system: process.env.DB_ROLE_PASSWORD_SYSTEM ?? 'system_dev_only',
    support: process.env.DB_ROLE_PASSWORD_SUPPORT ?? 'support_dev_only',
  };
  const dbName = `app_e2e_${randomBytes(4).toString('hex')}`;
  const quiet = () => undefined;
  await runBootstrap({
    adminUrl,
    database: dbName,
    passwords,
    keepExistingPasswords: true,
    log: quiet,
  });
  await runMigrations({
    ownerUrl: roleUrl(adminUrl, 'owner', passwords.owner, dbName),
    appEnv: 'test',
    log: quiet,
  });

  const webBaseUrl = process.env.E2E_WEB_BASE_URL ?? 'http://localhost:5180';
  const { app } = await bootstrapApi({
    ...process.env,
    APP_ENV: 'test',
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
    API_PORT: process.env.E2E_API_PORT ?? '3100',
    DATABASE_APP_URL: roleUrl(adminUrl, 'app', passwords.app, dbName),
    DATABASE_SUPPORT_URL: roleUrl(adminUrl, 'support', passwords.support, dbName),
    WEB_BASE_URL: webBaseUrl,
    WEB_ORIGINS: webBaseUrl,
    CORS_ORIGINS: webBaseUrl,
    AUTH_THROTTLE_SECRET: `e2e_only_${randomBytes(24).toString('hex')}`,
    TERMS_VERSION: '2026-11',
    MAIL_TRANSPORT: 'memory',
    ARGON2_MEMORY_KIB: '64',
    ARGON2_TIME_COST: '1',
    OAUTH_DRIVER: 'fake',
  });

  const accounts = app.get<AccountPublicApi>(ACCOUNT_PUBLIC_API);
  const password = `E2e-${randomBytes(9).toString('base64url')}`;
  const ownerEmail = `owner.${randomBytes(4).toString('hex')}@example.test`;
  const collaboratorEmail = `ctv.${randomBytes(4).toString('hex')}@example.test`;
  const owner = await accounts.createVerifiedOwner({
    displayName: 'Chị Lan',
    email: ownerEmail,
    password,
  });
  await accounts.addMember({
    accountId: owner.accountId,
    displayName: 'Cộng tác viên Minh',
    email: collaboratorEmail,
    password,
    emailVerified: true,
    addedByUserId: owner.userId,
  });

  writeFileSync(
    statePath,
    JSON.stringify(
      {
        dbName,
        owner: { email: ownerEmail, password },
        collaborator: { email: collaboratorEmail, password },
      },
      null,
      2,
    ),
  );
  console.log('e2e-env.ready');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
