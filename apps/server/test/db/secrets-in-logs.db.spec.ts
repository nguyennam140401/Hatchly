// SC-008: không chuỗi nhật ký / thông báo lỗi nào chứa mật khẩu vai trò hay chuỗi kết nối có mật khẩu.
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DatabaseService, setActiveDatabase } from '../../src/core/db/database';
import { tenantTx } from '../../src/core/db/transaction';
import { describeError } from '../../src/db/script-utils';
import { getJson, startNode, waitForHttp } from '../helpers/processes';
import {
  captureLogs,
  createAccount,
  dbUrls,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from './helpers/db';
import { tenantNotes } from './sandbox/schema';

const CONNECTION_WITH_PASSWORD = /postgres(ql)?:\/\/[^@\s]+:[^@\s]+@/;
const PASSWORDS = ['owner', 'app', 'system', 'support'].map((role) =>
  decodeURIComponent(new URL(dbUrls[role as keyof typeof dbUrls]).password),
);
const MARKER = 'S3cr3t_marker_pw';

function assertClean(texts: string[]): void {
  const all = texts.join('\n');
  for (const pw of [...PASSWORDS, MARKER].filter((p) => p.length >= 4)) {
    expect(all, `lộ mật khẩu`).not.toContain(pw);
  }
  expect(all).not.toMatch(CONNECTION_WITH_PASSWORD);
}

describeDb('Bí mật không lọt vào nhật ký và thông báo lỗi', () => {
  let database: TestDatabase;
  const outputs: string[] = [];

  beforeAll(() => {
    database = makeDatabase();
  });
  afterAll(async () => {
    await database.close();
  });

  it('khởi tạo bể + lỗi chính sách: nhật ký và lỗi không có bí mật', async () => {
    const a = await createAccount();
    const b = await createAccount();
    const err = await withAccount(a, () =>
      tenantTx((db) => db.insert(tenantNotes).values({ account_id: b, title: 'x' })),
    ).catch((e: unknown) => e);
    outputs.push(String(err), (err as Error).stack ?? '', describeError(err));
    outputs.push(JSON.stringify(database.logs.entries));
    assertClean(outputs);
  });

  it('cổng đóng và mật khẩu sai: lỗi chỉ có mã', async () => {
    const make = (url: string) => {
      const logs = captureLogs();
      const service = new DatabaseService({
        unit: 'api',
        appEnv: 'test',
        appUrl: url,
        poolMax: 1,
        statementTimeoutMs: 15_000,
        idleInTxTimeoutMs: 30_000,
        logger: logs,
      });
      return { service, logs };
    };
    const wrongPassword = new URL(dbUrls.app);
    wrongPassword.password = MARKER;
    for (const url of [`postgres://app:${MARKER}@127.0.0.1:1/app`, wrongPassword.toString()]) {
      const { service, logs } = make(url);
      setActiveDatabase(service);
      const a = '0190a0b4-6b5e-7c3a-8f4e-1a2b3c4d5e6f';
      const err = await withAccount(a, () => tenantTx(async () => 1)).catch((e: unknown) => e);
      expect((err as { code?: string }).code).toMatch(/^(ECONNREFUSED|28P01)$/);
      outputs.push(
        String(err),
        (err as Error).stack ?? '',
        describeError(err),
        JSON.stringify(logs.entries),
      );
      await service.close();
    }
    setActiveDatabase(database.service);
    assertClean(outputs);
  });

  it('tiến trình con: API với mật khẩu sai, db:check cổng đóng (mã 2) → stdout/stderr sạch', async () => {
    const wrong = new URL(dbUrls.app);
    wrong.password = MARKER;
    const api = startNode(['dist/api.js'], {
      APP_ENV: 'test',
      LOG_LEVEL: 'info',
      API_PORT: '34420',
      DATABASE_APP_URL: wrong.toString(),
    });
    try {
      await api.waitForLog('api.ready');
      await waitForHttp('http://127.0.0.1:34420/healthz');
      const ready = await getJson('http://127.0.0.1:34420/readyz');
      expect(ready.status).toBe(503);
      outputs.push(JSON.stringify(ready.body));
    } finally {
      api.child.kill();
      await api.waitForExit();
    }
    outputs.push(JSON.stringify(api.logs), api.stderr());

    const check = spawnSync(process.execPath, ['--import', 'tsx', 'src/db/check-conventions.ts'], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        SYSTEMROOT: process.env.SYSTEMROOT ?? '',
        DATABASE_OWNER_URL: `postgres://owner:${MARKER}@127.0.0.1:1/app`,
      },
    });
    expect(check.status).toBe(2);
    outputs.push(check.stdout, check.stderr);
    assertClean(outputs);
  });
});
