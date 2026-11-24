// 015 (FR-012, hiến chương nguyên tắc I): ba khung nhìn hỗ trợ của Cổng AI – chỉ đọc qua supportViewAccount, lọc đúng tài
// khoản được xem, không có cột lời nhắc/văn bản/bí mật, support không đọc thẳng bảng gốc, app/system không đọc khung nhìn,
// mỗi lần xem có kiểm toán. Là bằng chứng (`proof`) trong test/db/fixtures/access-path-inventory.ts.
import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { supportViewAccount } from '../../src/core/db/support';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import {
  asOwner,
  createAccount,
  dbUrls,
  describeDb,
  makeDatabase,
  type TestDatabase,
} from '../db/helpers/db';

const VIEWS = [
  'ai_gateway.support_ai_budget_detail',
  'ai_gateway.support_ai_cost_ledger',
  'ai_gateway.support_ai_trend_allocations',
] as const;
const BASE_TABLES = [
  'ai_gateway.ai_budgets',
  'ai_gateway.ai_cost_ledger',
  'ai_gateway.ai_trend_allocations',
] as const;

describeDb('Khung nhìn hỗ trợ Cổng AI', () => {
  let database: TestDatabase;
  let a: string;
  let b: string;

  /** Mồi một dòng cho mỗi bảng gốc bằng owner. `tag` làm dấu nhận biết (cost_micro_usd). */
  async function seed(accountId: string, tag: bigint): Promise<void> {
    await asOwner(async (c) => {
      await c.query(
        `INSERT INTO ai_gateway.ai_budgets (id, account_id, cycle_start, cycle_end, cap, soft_limit)
         VALUES ($1, $2, '2026-11-01', '2026-12-01', 4000000, 2000000)`,
        [uuidV7(), accountId],
      );
      await c.query(
        `INSERT INTO ai_gateway.ai_cost_ledger
           (id, account_id, cycle_start, reservation_id, task, model_tier, model_id, provider,
            cost_micro_usd, estimate_micro_usd)
         VALUES ($1, $2, '2026-11-01', $3, 'post_generation', 'default', 'claude-sonnet-4-5', 'anthropic', $4, 1500)`,
        [uuidV7(), accountId, uuidV7(), tag],
      );
      await c.query(
        `INSERT INTO ai_gateway.ai_trend_allocations
           (id, account_id, week_start, industry_id, cost_micro_usd, shared_ledger_id)
         VALUES ($1, $2, '2026-11-02', $3, $4, $5)`,
        [uuidV7(), accountId, uuidV7(), tag, uuidV7()],
      );
    });
  }

  beforeAll(async () => {
    database = makeDatabase({ unit: 'api' });
    a = await createAccount();
    b = await createAccount();
    await seed(a, 1111n);
    await seed(b, 2222n);
  });
  afterAll(async () => {
    await asOwner(async (c) => {
      for (const t of BASE_TABLES)
        await c.query(`DELETE FROM ${t} WHERE account_id = ANY($1)`, [[a, b]]);
    });
    await database.close();
  });

  describe('support SELECT thẳng bảng gốc → 42501', () => {
    for (const table of BASE_TABLES) {
      it(table, async () => {
        const c = new Client({ connectionString: dbUrls.support });
        await c.connect();
        try {
          const err = await c.query(`SELECT * FROM ${table}`).catch((e: unknown) => e);
          expect((err as { code?: string }).code).toBe('42501');
        } finally {
          await c.end();
        }
      });
    }
  });

  describe('vai trò app, system không đọc được khung nhìn → 42501', () => {
    for (const view of VIEWS) {
      for (const role of ['app', 'system'] as const) {
        it(`${role} đọc ${view}`, async () => {
          const c = new Client({ connectionString: dbUrls[role] });
          await c.connect();
          try {
            const err = await c.query(`SELECT * FROM ${view}`).catch((e: unknown) => e);
            expect((err as { code?: string }).code).toBe('42501');
          } finally {
            await c.end();
          }
        });
      }
    }
  });

  for (const [who, other] of [
    ['A', 'B'],
    ['B', 'A'],
  ] as const) {
    it(`supportViewAccount(${who}) chỉ thấy dòng của ${who}, không thấy ${other}; có 1 dòng kiểm toán`, async () => {
      const own = who === 'A' ? a : b;
      const tag = who === 'A' ? '1111' : '2222';
      const staff = { staffId: `nv-${uuidV7()}` };
      const result = await supportViewAccount(staff, own, 'Khách hỏi về hạn mức AI', async (db) => {
        const out: Record<string, Record<string, unknown>[]> = {};
        for (const view of VIEWS) {
          out[view] = (await db.execute(sql.raw(`SELECT * FROM ${view}`))).rows;
        }
        return out;
      });
      for (const view of VIEWS) {
        const rows = result[view] ?? [];
        expect(rows).toHaveLength(1);
        expect(rows[0]?.account_id).toBe(own);
      }
      expect(String(result['ai_gateway.support_ai_cost_ledger']?.[0]?.cost_micro_usd)).toBe(tag);
      expect(String(result['ai_gateway.support_ai_trend_allocations']?.[0]?.cost_micro_usd)).toBe(
        tag,
      );

      const audit = await asOwner(
        async (c) =>
          (
            await c.query<{ action: string; account_id: string }>(
              'SELECT action, account_id FROM infra.audit_log WHERE actor_id = $1',
              [staff.staffId],
            )
          ).rows,
      );
      expect(audit).toEqual([{ action: 'support.view_account', account_id: own }]);
    });
  }

  it('khung nhìn không có cột lời nhắc, văn bản kết quả hay bí mật', async () => {
    const cols = await asOwner(
      async (c) =>
        (
          await c.query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns
              WHERE table_schema = 'ai_gateway' AND table_name = ANY($1)`,
            [VIEWS.map((v) => v.split('.')[1])],
          )
        ).rows,
    );
    expect(cols.length).toBeGreaterThan(0);
    const bad = cols.filter((r) =>
      /prompt|content|text|output_text|secret|token_value|key/i.test(r.column_name),
    );
    // input_tokens/output_tokens là số đếm, không phải nội dung.
    expect(bad.map((r) => r.column_name).filter((n) => !n.endsWith('_tokens'))).toEqual([]);
  });

  it('không ngữ cảnh tenant → khung nhìn trả 0 dòng (supportViewAccount với tài khoản không có dữ liệu)', async () => {
    const empty = await createAccount();
    const staff = { staffId: `nv-${uuidV7()}` };
    const rows = await supportViewAccount(
      staff,
      empty,
      'Kiểm tra tài khoản trống',
      async (db) => (await db.execute(sql.raw(`SELECT * FROM ${VIEWS[0]}`))).rows,
    );
    expect(rows).toHaveLength(0);
  });
});
