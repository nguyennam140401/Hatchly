// SC-006: đặt ngữ cảnh tenant (set_config + kiểm tài khoản) thêm ≤ 5 ms p95.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { tenantTx } from '../../src/core/db/transaction';
import {
  createAccount,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from './helpers/db';

const N = 500;

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

describeDb('Hiệu năng ngữ cảnh tenant', () => {
  let database: TestDatabase;
  let a: string;

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 1 });
    a = await createAccount();
  });
  afterAll(async () => {
    await database.close();
  });

  it(`p95(tenantTx) − p95(giao dịch thô) ≤ 5 ms trên ${N} lần SELECT 1`, async () => {
    const pool = database.service.pool('app')!;
    // Làm nóng kết nối và bộ đệm kế hoạch.
    for (let i = 0; i < 20; i++)
      await withAccount(a, () => tenantTx((db) => db.execute(sql`SELECT 1`)));

    const raw: number[] = [];
    for (let i = 0; i < N; i++) {
      const t = performance.now();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT 1');
        await client.query('COMMIT');
      } finally {
        client.release();
      }
      raw.push(performance.now() - t);
    }

    const withContext: number[] = [];
    await withAccount(a, async () => {
      for (let i = 0; i < N; i++) {
        const t = performance.now();
        await tenantTx((db) => db.execute(sql`SELECT 1`));
        withContext.push(performance.now() - t);
      }
    });

    const report = {
      raw: { p50: percentile(raw, 50), p95: percentile(raw, 95) },
      tenant: { p50: percentile(withContext, 50), p95: percentile(withContext, 95) },
    };
    console.log(
      `SC-006 – thô p50 ${report.raw.p50.toFixed(2)} ms / p95 ${report.raw.p95.toFixed(2)} ms; ` +
        `tenantTx p50 ${report.tenant.p50.toFixed(2)} ms / p95 ${report.tenant.p95.toFixed(2)} ms; ` +
        `chênh p95 ${(report.tenant.p95 - report.raw.p95).toFixed(2)} ms`,
    );
    expect(report.tenant.p95 - report.raw.p95).toBeLessThanOrEqual(5);
  });
});
