// Dựng / hủy CSDL tạm cho `pnpm db:compat` (008, FR-018, R12): tạo CSDL mới, bootstrap vai trò, áp TOÀN BỘ
// migration của bản đang chạy lệnh này (HEAD) bằng vai trò owner, in các URL vai trò dạng JSON.
//   tsx src/db/prepare-compat-db.ts create   (cần TEST_DATABASE_ADMIN_URL)  → in {"name","owner","app","system","support"}
//   tsx src/db/prepare-compat-db.ts drop <tên>
// Mật khẩu vai trò lấy như `test:db` (DB_ROLE_PASSWORD_* hoặc giá trị dev) vì vai trò là đối tượng cấp cụm.
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { runBootstrap } from './bootstrap';
import { runMigrations } from './migrate';
import { runScript, withDatabase } from './script-utils';

function roleUrl(adminUrl: string, user: string, password: string, database: string): string {
  const url = new URL(adminUrl);
  url.username = encodeURIComponent(user);
  url.password = encodeURIComponent(password);
  url.pathname = `/${database}`;
  return url.toString();
}

async function create(adminUrl: string): Promise<void> {
  const passwords = {
    owner: process.env.DB_ROLE_PASSWORD_OWNER ?? 'owner_dev_only',
    app: process.env.DB_ROLE_PASSWORD_APP ?? 'app_dev_only',
    system: process.env.DB_ROLE_PASSWORD_SYSTEM ?? 'system_dev_only',
    support: process.env.DB_ROLE_PASSWORD_SUPPORT ?? 'support_dev_only',
  };
  const name = `app_compat_${randomBytes(4).toString('hex')}`;
  const quiet = () => undefined;
  await runBootstrap({
    adminUrl,
    database: name,
    passwords,
    keepExistingPasswords: true,
    log: quiet,
  });
  const urls = {
    name,
    owner: roleUrl(adminUrl, 'owner', passwords.owner, name),
    app: roleUrl(adminUrl, 'app', passwords.app, name),
    system: roleUrl(adminUrl, 'system', passwords.system, name),
    support: roleUrl(adminUrl, 'support', passwords.support, name),
  };
  await runMigrations({ ownerUrl: urls.owner, appEnv: 'test', log: quiet });
  process.stdout.write(`${JSON.stringify(urls)}\n`);
}

if (require.main === module) {
  runScript(async () => {
    const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
    if (!adminUrl) throw new Error('Thiếu TEST_DATABASE_ADMIN_URL');
    const [command, target] = process.argv.slice(2);
    if (command === 'create') await create(adminUrl);
    else if (command === 'drop' && target && /^app_compat_[0-9a-f]+$/.test(target)) {
      const client = new Client({ connectionString: withDatabase(adminUrl, 'postgres') });
      await client.connect();
      try {
        await client.query(
          `DROP DATABASE IF EXISTS ${client.escapeIdentifier(target)} WITH (FORCE)`,
        );
      } finally {
        await client.end();
      }
    } else throw new Error('Dùng: create | drop <app_compat_…>');
  });
}
