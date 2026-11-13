// test:compat (008, FR-018): bản code này khởi động được và làm việc đúng trên CSDL đã migrate bằng migration
// của bản MỚI hơn. Hợp đồng (quality-gates.md mục 7): không migrate, không chứa khẳng định về cấu trúc
// (số migration, quy ước bảng, danh sách schema) – cấu trúc đổi hợp lệ không được làm các ca này đỏ.
//
// Ghi chú: vòng "tạo việc → xử lý việc" qua hàng chờ sẽ được thêm cùng việc thử `queue.smoke_ping` (T063+);
// hiện tại bộ này kiểm API + Worker khởi động, sẵn sàng, và đọc/ghi qua tenantTx.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { TEST_AUTH_ENV } from '../helpers/auth-env';
import { getJson, startNode, waitForHttp, type RunningProcess } from '../helpers/processes';
import { runWithJobContext } from '../../src/core/context/bind-account';
import { DatabaseService, setActiveDatabase } from '../../src/core/db/database';
import { tenantTx } from '../../src/core/db/transaction';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { sql } from 'drizzle-orm';
import { Client } from 'pg';

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Thiếu ${name}`);
  return value;
};

const API_PORT = 38_100 + Math.floor(Math.random() * 400);
const WORKER_PORT = API_PORT + 500;
const BASE_ENV = {
  APP_ENV: 'test',
  APP_VERSION: 'compat-under-test',
  LOG_LEVEL: 'info',
  ...TEST_AUTH_ENV,
  DATABASE_APP_URL: env('COMPAT_DATABASE_APP_URL'),
  DATABASE_SYSTEM_URL: env('COMPAT_DATABASE_SYSTEM_URL'),
  DATABASE_SUPPORT_URL: env('COMPAT_DATABASE_SUPPORT_URL'),
  DATABASE_OWNER_URL: env('COMPAT_DATABASE_OWNER_URL'),
  DATABASE_POOL_MAX: '10',
};

let api: RunningProcess;
let worker: RunningProcess;
let database: DatabaseService;

beforeAll(async () => {
  api = startNode(['dist/api.js'], { ...BASE_ENV, API_PORT: String(API_PORT) });
  worker = startNode(['dist/worker.js'], {
    ...BASE_ENV,
    API_PORT: String(API_PORT + 1000),
    WORKER_HEALTH_PORT: String(WORKER_PORT),
    DATABASE_POOL_MAX: '20',
  });
  await Promise.all([
    api.waitForLog('api.ready', 60_000),
    worker.waitForLog('worker.ready', 60_000),
  ]);
  await Promise.all([
    waitForHttp(`http://127.0.0.1:${API_PORT}/healthz`),
    waitForHttp(`http://127.0.0.1:${WORKER_PORT}/healthz`),
  ]);
  database = new DatabaseService({
    unit: 'worker',
    appEnv: 'test',
    appUrl: env('COMPAT_DATABASE_APP_URL'),
    systemUrl: env('COMPAT_DATABASE_SYSTEM_URL'),
    supportUrl: env('COMPAT_DATABASE_SUPPORT_URL'),
    poolMax: 5,
    statementTimeoutMs: 15_000,
    idleInTxTimeoutMs: 30_000,
    logger: { warn: () => undefined, error: () => undefined },
  });
  setActiveDatabase(database);
});

afterAll(async () => {
  await database.close();
  for (const proc of [api, worker]) proc.child.kill('SIGTERM');
});

it('API: /healthz đạt và trả đúng bản đang chạy', async () => {
  const res = await getJson(`http://127.0.0.1:${API_PORT}/healthz`);
  expect(res.status).toBe(200);
  expect((res.body as { version: string }).version).toBe('compat-under-test');
});

it('API: /readyz đạt (CSDL + hàng chờ sẵn sàng trên cấu trúc mới)', async () => {
  const res = await getJson(`http://127.0.0.1:${API_PORT}/readyz`);
  expect(res.body).toBeTruthy();
  expect(res.status).toBe(200);
});

it('Worker: cổng sức khỏe /healthz và /readyz đạt', async () => {
  expect((await getJson(`http://127.0.0.1:${WORKER_PORT}/healthz`)).status).toBe(200);
  expect((await getJson(`http://127.0.0.1:${WORKER_PORT}/readyz`)).status).toBe(200);
});

it('đọc/ghi qua tenantTx: tạo tài khoản, ghi hồ sơ, chỉ thấy dữ liệu của chính mình', async () => {
  const owner = new Client({ connectionString: env('COMPAT_DATABASE_OWNER_URL') });
  await owner.connect();
  const [a, b] = [uuidV7(), uuidV7()];
  try {
    for (const id of [a, b]) {
      await owner.query(`INSERT INTO account.accounts (id, status) VALUES ($1, 'active')`, [id]);
    }
    for (const id of [a, b]) {
      await runWithJobContext({ traceId: uuidV7(), accountId: id }, () =>
        tenantTx(async (db) => {
          await db.execute(
            sql`INSERT INTO context.business_profiles (id, account_id) VALUES (${uuidV7()}, ${id})`,
          );
        }),
      );
    }
    const seen = await runWithJobContext({ traceId: uuidV7(), accountId: a }, () =>
      tenantTx(async (db) => {
        const r = await db.execute<{ account_id: string }>(
          sql`SELECT account_id FROM context.business_profiles`,
        );
        return r.rows.map((row) => row.account_id);
      }),
    );
    expect(seen).toEqual([a]);
  } finally {
    await owner.query(`DELETE FROM account.accounts WHERE id = ANY($1)`, [[a, b]]);
    await owner.end();
  }
});
