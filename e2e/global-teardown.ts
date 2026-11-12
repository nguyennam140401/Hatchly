import { existsSync, readFileSync, rmSync } from 'node:fs';
import pg from 'pg';
import { STATE_FILE, type E2eState } from './state';

// Xóa CSDL tạm của lần chạy (WITH FORCE – API có thể vẫn còn kết nối khi Playwright dừng webServer).
export default async function globalTeardown(): Promise<void> {
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (adminUrl === undefined || adminUrl === '' || !existsSync(STATE_FILE)) return;
  const { dbName } = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as E2eState;
  if (!/^app_e2e_[0-9a-f]{8}$/.test(dbName)) return;
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${client.escapeIdentifier(dbName)} WITH (FORCE)`);
  } finally {
    await client.end();
  }
  rmSync(STATE_FILE, { force: true });
}
