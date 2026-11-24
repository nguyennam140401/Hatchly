import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemTx, tenantTx } from '../../src/core/db/transaction';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import {
  asOwner,
  createAccount,
  describeDb,
  makeDatabase,
  rawAppPool,
  withAccount,
  type TestDatabase,
} from '../db/helpers/db';

// T022 (015, hiến chương I – KHÔNG THƯƠNG LƯỢNG, SC-007): cách ly dữ liệu Cổng AI giữa hai tài khoản trên CSDL THẬT.
// Tài khoản A đọc/sửa/xóa/chèn `ai_budgets`, `ai_reservations`, `ai_cost_ledger`, `ai_trend_allocations` của B → thất bại
// (0 dòng hoặc bị từ chối); thiếu biến phiên → không thấy dòng nào. Bổ sung cho khuôn chung
// `test/db/cross-tenant.db.spec.ts` (fixtures) bằng bản kiểm tường minh theo từng bảng của tính năng.
// Ghi chú tên tệp: `.db.spec.ts` để vitest bộ nhớ bỏ qua; tasks.md ghi `rls-cross-account.spec.ts`.

const PRICE_ID = '0194f100-0000-7000-8000-000000000001'; // dòng giá khởi đầu của migration 0030

interface TableCase {
  table: string;
  /** Vai trò truy cập hợp lệ của tài khoản chủ (app: tenantTx; system: systemTx theo ngữ cảnh tenant). */
  role: 'app' | 'system';
  seed: (accountId: string) => { text: string; values: unknown[] };
  /** Câu SET để thử sửa dòng của tài khoản khác và điều kiện nhận biết dòng chưa bị sửa. */
  set: string;
  untouched: string;
}

const CASES: TableCase[] = [
  {
    table: 'ai_gateway.ai_budgets',
    role: 'app',
    seed: (a) => ({
      text: `INSERT INTO ai_gateway.ai_budgets (id, account_id, cycle_start, cycle_end, cap, soft_limit)
             VALUES ($1, $2, '2026-11-01', '2026-12-01', 4000000, 2000000)`,
      values: [uuidV7(), a],
    }),
    set: 'used = 1',
    untouched: 'used = 0',
  },
  {
    table: 'ai_gateway.ai_reservations',
    role: 'app',
    seed: (a) => ({
      text: `INSERT INTO ai_gateway.ai_reservations
               (id, account_id, cycle_start, task, model_tier, provider, model_id, price_id, estimate)
             VALUES ($1, $2, '2026-11-01', 'post_generation', 'default', 'anthropic', 'claude-sonnet-4-5', $3, 1000)`,
      values: [uuidV7(), a, PRICE_ID],
    }),
    set: "state = 'released'",
    untouched: "state = 'held'",
  },
  {
    table: 'ai_gateway.ai_cost_ledger',
    role: 'app',
    seed: (a) => ({
      text: `INSERT INTO ai_gateway.ai_cost_ledger
               (id, account_id, cycle_start, reservation_id, task, model_tier, model_id, provider,
                cost_micro_usd, estimate_micro_usd)
             VALUES ($1, $2, '2026-11-01', $3, 'post_generation', 'default', 'claude-sonnet-4-5', 'anthropic', 1000, 1500)`,
      values: [uuidV7(), a, uuidV7()],
    }),
    set: 'cost_micro_usd = 0',
    untouched: 'cost_micro_usd = 1000',
  },
  {
    table: 'ai_gateway.ai_trend_allocations',
    role: 'system',
    seed: (a) => ({
      text: `INSERT INTO ai_gateway.ai_trend_allocations
               (id, account_id, week_start, industry_id, cost_micro_usd, shared_ledger_id)
             VALUES ($1, $2, '2026-11-02', $3, 1000, $4)`,
      values: [uuidV7(), a, uuidV7(), uuidV7()],
    }),
    set: 'cost_micro_usd = 5',
    untouched: 'cost_micro_usd = 1000',
  },
];

/** Thử một thao tác: `ok=false` (bị từ chối) hoặc `rows` rỗng đều là "thất bại" như yêu cầu. */
async function attempt(fn: () => Promise<unknown>): Promise<{ ok: boolean; rows: unknown[] }> {
  try {
    const res = (await fn()) as { rows?: unknown[] };
    return { ok: true, rows: res.rows ?? [] };
  } catch {
    return { ok: false, rows: [] };
  }
}

describeDb('Cách ly tài khoản – bảng Cổng AI thật (RLS)', () => {
  let database: TestDatabase;
  let a: string;
  let b: string;

  const run = (role: 'app' | 'system', accountId: string, text: string) =>
    withAccount(accountId, () =>
      role === 'app'
        ? tenantTx((db) => db.execute(sql.raw(text)))
        : systemTx((db) => db.execute(sql.raw(text)), { tenant: 'from-context' }),
    );

  const ownerCount = (table: string, accountId: string, where = 'true') =>
    asOwner(async (c) => {
      const r = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${table} WHERE account_id = $1 AND ${where}`,
        [accountId],
      );
      return Number(r.rows[0]!.n);
    });

  beforeAll(async () => {
    database = makeDatabase({ unit: 'worker' });
    a = await createAccount();
    b = await createAccount();
    await asOwner(async (c) => {
      for (const t of CASES)
        for (const owner of [a, b]) {
          const s = t.seed(owner);
          await c.query(s.text, s.values);
        }
    });
  });
  afterAll(async () => {
    await asOwner(async (c) => {
      for (const t of CASES)
        await c.query(`DELETE FROM ${t.table} WHERE account_id = ANY($1)`, [[a, b]]);
    });
    await database.close();
  });

  it('mọi bảng khách của tính năng đã bật RLS và có chính sách tenant_isolation', async () => {
    const r = await asOwner((c) =>
      c.query<{ rel: string; rls: boolean; policies: string[] }>(
        `SELECT c.oid::regclass::text AS rel, c.relrowsecurity AS rls,
                ARRAY(SELECT polname::text FROM pg_policy WHERE polrelid = c.oid) AS policies
           FROM pg_class c WHERE c.oid = ANY($1::regclass[])`,
        [CASES.map((t) => t.table)],
      ),
    );
    expect(r.rows).toHaveLength(CASES.length);
    for (const row of r.rows) {
      expect(row.rls, row.rel).toBe(true);
      expect(row.policies, row.rel).toContain('tenant_isolation');
    }
  });

  for (const t of CASES) {
    for (const [selfName, otherName] of [
      ['A', 'B'],
      ['B', 'A'],
    ] as const) {
      const self = () => (selfName === 'A' ? a : b);
      const other = () => (selfName === 'A' ? b : a);

      describe(`${t.table} (${t.role}): ${selfName} → ${otherName}`, () => {
        it('đọc: chỉ thấy dòng của mình, lọc theo mã tài khoản kia → 0 dòng', async () => {
          const own = await attempt(() => run(t.role, self(), `SELECT account_id FROM ${t.table}`));
          expect(own.ok).toBe(true);
          expect(own.rows).toHaveLength(1);
          expect((own.rows[0] as { account_id: string }).account_id).toBe(self());
          const cross = await attempt(() =>
            run(t.role, self(), `SELECT 1 FROM ${t.table} WHERE account_id = '${other()}'`),
          );
          expect(cross.rows).toHaveLength(0);
        });

        it('sửa: không chạm dòng của tài khoản kia (0 dòng hoặc bị từ chối)', async () => {
          const res = await attempt(() =>
            run(
              t.role,
              self(),
              `UPDATE ${t.table} SET ${t.set} WHERE account_id = '${other()}' RETURNING 1`,
            ),
          );
          expect(!res.ok || res.rows.length === 0).toBe(true);
          expect(await ownerCount(t.table, other(), t.untouched)).toBe(1);
        });

        it('xóa: không xóa dòng của tài khoản kia (0 dòng hoặc bị từ chối)', async () => {
          const res = await attempt(() =>
            run(
              t.role,
              self(),
              `DELETE FROM ${t.table} WHERE account_id = '${other()}' RETURNING 1`,
            ),
          );
          expect(!res.ok || res.rows.length === 0).toBe(true);
          expect(await ownerCount(t.table, other())).toBe(1);
          expect(await ownerCount(t.table, self())).toBe(1);
        });

        it('chèn dòng mang mã tài khoản kia → bị từ chối, không có dòng mới', async () => {
          const seed = t.seed(other());
          // Ghép giá trị vào câu lệnh (id/uuid do kiểm thử sinh) để chạy qua lớp tenantTx/systemTx.
          const text = seed.values.reduce<string>(
            (acc, v, i) => acc.replace(new RegExp(`\\$${i + 1}(?!\\d)`, 'g'), `'${String(v)}'`),
            seed.text,
          );
          const res = await attempt(() => run(t.role, self(), text));
          expect(res.ok).toBe(false);
          expect(await ownerCount(t.table, other())).toBe(1);
        });

        it('đổi account_id của dòng mình sang tài khoản kia → bị từ chối', async () => {
          const res = await attempt(() =>
            run(
              t.role,
              self(),
              `UPDATE ${t.table} SET account_id = '${other()}' WHERE account_id = '${self()}' RETURNING 1`,
            ),
          );
          expect(res.ok).toBe(false);
          expect(await ownerCount(t.table, self())).toBe(1);
          expect(await ownerCount(t.table, other())).toBe(1);
        });
      });
    }
  }

  it('khách (app) không chạm được ai_trend_allocations dù đúng tenant (đã thu hồi quyền – chỉ system)', async () => {
    for (const verb of [
      'SELECT 1 FROM ai_gateway.ai_trend_allocations',
      "UPDATE ai_gateway.ai_trend_allocations SET cost_micro_usd = 5 WHERE account_id = '" +
        a +
        "'",
      "DELETE FROM ai_gateway.ai_trend_allocations WHERE account_id = '" + a + "'",
    ]) {
      expect((await attempt(() => run('app', a, verb))).ok).toBe(false);
    }
    expect(await ownerCount('ai_gateway.ai_trend_allocations', a)).toBe(1);
  });

  it('sổ chi phí chỉ-thêm: khách không sửa/xóa được dòng của chính mình', async () => {
    for (const verb of [
      `UPDATE ai_gateway.ai_cost_ledger SET cost_micro_usd = 0 WHERE account_id = '${a}'`,
      `DELETE FROM ai_gateway.ai_cost_ledger WHERE account_id = '${a}'`,
    ]) {
      expect((await attempt(() => run('app', a, verb))).ok).toBe(false);
    }
    expect(await ownerCount('ai_gateway.ai_cost_ledger', a, 'cost_micro_usd = 1000')).toBe(1);
  });

  it('thiếu biến phiên tenant → không thấy dòng nào (vai trò app, kết nối thô không đặt tenant)', async () => {
    const pool = rawAppPool(1);
    try {
      for (const t of CASES.filter((c) => c.role === 'app')) {
        const r = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${t.table}`);
        expect(Number(r.rows[0]!.n), t.table).toBe(0);
      }
    } finally {
      await pool.end();
    }
  });

  it('thiếu biến phiên tenant → system cũng không thấy dòng ai_trend_allocations nào', async () => {
    const rows = await systemTx(
      (db) => db.execute(sql.raw('SELECT 1 FROM ai_gateway.ai_trend_allocations')),
      { tenant: 'none' },
    );
    expect((rows as { rows: unknown[] }).rows).toHaveLength(0);
  });
});
