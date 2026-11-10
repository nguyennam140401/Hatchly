// contracts/db-commands.md mục 4, research R7: /readyz có kiểm tra `database`; chạy nhầm vai trò
// `owner` → tiến trình ghi db.role_invalid và thoát mã 1, không in mật khẩu.
import { TEST_AUTH_ENV } from '../helpers/auth-env';
import { beforeAll, expect, it } from 'vitest';
import { getJson, startNode, waitForHttp } from '../helpers/processes';
import { dbUrls, describeDb } from './helpers/db';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const PORT = 34_410;

describeDb('/readyz với CSDL thật', () => {
  beforeAll(() => {
    if (!existsSync('dist/api.js')) execSync('pnpm run build', { stdio: 'inherit' });
  });

  it('DATABASE_APP_URL đúng vai trò app → 200, checks có database: pass', async () => {
    const proc = startNode(['dist/api.js'], {
      ...TEST_AUTH_ENV,
      APP_ENV: 'test',
      LOG_LEVEL: 'info',
      API_PORT: String(PORT),
      DATABASE_APP_URL: dbUrls.app,
    });
    try {
      await proc.waitForLog('api.ready');
      await waitForHttp(`http://127.0.0.1:${PORT}/healthz`);
      const res = await getJson(`http://127.0.0.1:${PORT}/readyz`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ready', checks: [{ name: 'database', status: 'pass' }] });
    } finally {
      proc.child.kill();
      await proc.waitForExit();
    }
  });

  it('DATABASE_APP_URL dùng vai trò owner → db.role_invalid, thoát mã 1, không lộ mật khẩu', async () => {
    const ownerPassword = decodeURIComponent(new URL(dbUrls.owner).password);
    const proc = startNode(['dist/api.js'], {
      ...TEST_AUTH_ENV,
      APP_ENV: 'test',
      LOG_LEVEL: 'info',
      API_PORT: String(PORT + 1),
      DATABASE_APP_URL: dbUrls.owner,
    });
    const { code } = await proc.waitForExit(20_000);
    expect(code).toBe(1);
    const fatal = proc.logs.find((l) => l.msg === 'db.role_invalid');
    expect(fatal).toMatchObject({ role: 'owner' });
    expect(JSON.stringify(proc.logs)).not.toContain(ownerPassword);
  });
});
