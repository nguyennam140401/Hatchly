import { Client, Pool } from 'pg';
import { describe, inject } from 'vitest';
import { runWithJobContext } from '../../../src/core/context/bind-account';
import { DatabaseService, setActiveDatabase, type AppEnv } from '../../../src/core/db/database';
import type { DbLogger } from '../../../src/core/db/pools';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';

// Tiện ích kiểm thử CSDL. Dữ liệu mồi tạo bằng vai trò `owner` (chủ bảng – không bị RLS vì không
// FORCE); mã cần kiểm thử chạy bằng `app`/`system`/`support` qua DatabaseService thật.

export const dbAvailable = inject('dbAvailable');
export const dbUrls = inject('dbUrls');
export const dbName = inject('dbName');

/** `describe` khi có CSDL kiểm thử, ngược lại `describe.skip`. */
export function describeDb(name: string, fn: () => void): void {
  (dbAvailable ? describe : describe.skip)(name, fn);
}

/** Kết nối `owner` mới (người gọi phải `end()`). */
export async function ownerClient(): Promise<Client> {
  const client = new Client({ connectionString: dbUrls.owner, options: '-c TimeZone=UTC' });
  await client.connect();
  return client;
}

/** Chạy `fn` với một kết nối `owner` rồi đóng. */
export async function asOwner<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await ownerClient();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Tạo một tài khoản (bằng `owner` – `app` không có quyền INSERT trên accounts). */
export async function createAccount(status = 'active'): Promise<string> {
  const id = uuidV7();
  await asOwner((c) =>
    c.query('INSERT INTO account.accounts (id, status) VALUES ($1, $2)', [id, status]),
  );
  return id;
}

/** Mồi `n` dòng `sandbox.tenant_notes` cho một tài khoản (bằng `owner`). Trả các id. */
export async function seedNotes(
  accountId: string,
  n: number,
  title = 'ghi chú',
): Promise<string[]> {
  const ids: string[] = [];
  await asOwner(async (c) => {
    for (let i = 0; i < n; i++) {
      const id = uuidV7();
      ids.push(id);
      await c.query(
        'INSERT INTO sandbox.tenant_notes (id, account_id, title, secret_note) VALUES ($1, $2, $3, $4)',
        [id, accountId, `${title} ${i + 1}`, `bí mật ${i + 1}`],
      );
    }
  });
  return ids;
}

/** Số dòng của từng tài khoản trong một bảng (đếm bằng `owner`). */
export async function countByAccount(qualifiedTable: string): Promise<Record<string, number>> {
  return asOwner(async (c) => {
    const r = await c.query<{ account_id: string; n: string }>(
      `SELECT account_id, count(*)::text AS n FROM ${qualifiedTable} GROUP BY account_id`,
    );
    return Object.fromEntries(r.rows.map((row) => [row.account_id, Number(row.n)]));
  });
}

export interface CapturedLogs extends DbLogger {
  entries: (Record<string, unknown> & { level: 'warn' | 'error' })[];
}

/** Bộ ghi nhật ký gom vào mảng. */
export function captureLogs(): CapturedLogs {
  const entries: CapturedLogs['entries'] = [];
  return {
    entries,
    warn: (entry) => entries.push({ level: 'warn', ...entry }),
    error: (entry) => entries.push({ level: 'error', ...entry }),
  };
}

export interface TestDatabase {
  service: DatabaseService;
  logs: CapturedLogs;
  close: () => Promise<void>;
}

/**
 * Tạo DatabaseService thật và đặt làm dịch vụ đang hoạt động. `unit: 'worker'` có bể `system`;
 * `unit: 'api'` có bể `support`.
 */
export function makeDatabase(
  options: {
    unit?: 'api' | 'worker';
    poolMax?: number;
    appEnv?: AppEnv;
    appUrl?: string;
    statementTimeoutMs?: number;
  } = {},
): TestDatabase {
  const logs = captureLogs();
  const unit = options.unit ?? 'worker';
  const service = new DatabaseService({
    unit,
    appEnv: options.appEnv ?? 'test',
    appUrl: options.appUrl ?? dbUrls.app,
    systemUrl: dbUrls.system,
    supportUrl: dbUrls.support,
    poolMax: options.poolMax ?? 5,
    statementTimeoutMs: options.statementTimeoutMs ?? 15_000,
    idleInTxTimeoutMs: 30_000,
    logger: logs,
  });
  setActiveDatabase(service);
  return { service, logs, close: () => service.close() };
}

/** Chạy `fn` trong ngữ cảnh việc nền của một tài khoản (chỉ kiểm thử được nhập bind-account). */
export function withAccount<T>(accountId: string | undefined, fn: () => Promise<T>): Promise<T> {
  return runWithJobContext({ traceId: uuidV7(), accountId }, fn);
}

/** Bể `app` thô – ĐƯỜNG THÔ CHỈ CÓ TRONG KIỂM THỬ, để chứng minh truy vấn tự xác nhận vẫn 0 dòng. */
export function rawAppPool(max = 1): Pool {
  return new Pool({ connectionString: dbUrls.app, max });
}

/** Chạy `fn` với kết nối quản trị cụm (vd `pg_terminate_backend` tiến trình của vai trò khác). */
export async function asAdmin<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: dbUrls.admin });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
