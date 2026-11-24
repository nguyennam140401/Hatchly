// Truy cập chéo tenant cho `ai_gateway.ai_trend_allocations` (015, FR-033, hiến chương nguyên tắc I).
// Bảng này CHỈ vai trò `system` ghi/đọc (migration 0030 thu hồi mọi quyền của `app`), nên khuôn chung
// `describeCrossTenant` (dùng tenantTx/app) không áp dụng được – kiểm bằng systemTx trong ngữ cảnh tenant.
// Chép mẫu này khi: bảng tenant chỉ dành cho Worker/nhân viên.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { DbPolicyViolationError } from '../../src/core/db/errors';
import { systemTx, tenantTx } from '../../src/core/db/transaction';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { aiTrendAllocations } from '../../src/modules/ai_gateway/internal/db/schema';
import {
  asOwner,
  countByAccount,
  createAccount,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from '../db/helpers/db';

const TABLE = 'ai_gateway.ai_trend_allocations';
const PER_ACCOUNT = 3;

describeDb('Truy cập chéo tenant – ai_gateway.ai_trend_allocations (chỉ system)', () => {
  let database: TestDatabase;
  let a: string;
  let b: string;

  const row = (accountId: string) => ({
    account_id: accountId,
    week_start: '2026-11-02',
    industry_id: uuidV7(),
    cost_micro_usd: 1000n,
    shared_ledger_id: uuidV7(),
  });

  beforeAll(async () => {
    database = makeDatabase({ unit: 'worker' });
    a = await createAccount();
    b = await createAccount();
  });
  afterAll(async () => {
    await asOwner(async (c) => {
      await c.query(`DELETE FROM ${TABLE} WHERE account_id = ANY($1)`, [[a, b]]);
    });
    await database.close();
  });
  beforeEach(async () => {
    await asOwner(async (c) => {
      await c.query(`DELETE FROM ${TABLE} WHERE account_id = ANY($1)`, [[a, b]]);
    });
    for (const owner of [a, b]) {
      await withAccount(owner, () =>
        systemTx(
          async (db) => {
            for (let i = 0; i < PER_ACCOUNT; i++)
              await db.insert(aiTrendAllocations).values(row(owner));
          },
          { tenant: 'from-context' },
        ),
      );
    }
  });

  it('bảng đã bật RLS, có chính sách tenant_isolation', async () => {
    const r = await asOwner((c) =>
      c.query<{ rls: boolean; policies: string[] }>(
        `SELECT c.relrowsecurity AS rls,
                ARRAY(SELECT polname FROM pg_policy WHERE polrelid = c.oid) AS policies
           FROM pg_class c WHERE c.oid = $1::regclass`,
        [TABLE],
      ),
    );
    expect(r.rows[0]?.rls).toBe(true);
    expect(r.rows[0]?.policies).toContain('tenant_isolation');
  });

  for (const [selfName, otherName] of [
    ['A', 'B'],
    ['B', 'A'],
  ] as const) {
    const self = () => (selfName === 'A' ? a : b);
    const other = () => (selfName === 'A' ? b : a);

    it(`${selfName}→${otherName}: đọc toàn bảng chỉ thấy dòng của ${selfName}`, async () => {
      const rows = await withAccount(self(), () =>
        systemTx((db) => db.select().from(aiTrendAllocations), { tenant: 'from-context' }),
      );
      expect(rows).toHaveLength(PER_ACCOUNT);
      expect(new Set(rows.map((r) => r.account_id))).toEqual(new Set([self()]));
    });

    it(`${selfName}→${otherName}: sửa toàn bảng chỉ chạm dòng của ${selfName}`, async () => {
      const updated = await withAccount(self(), () =>
        systemTx((db) => db.update(aiTrendAllocations).set({ cost_micro_usd: 5n }).returning(), {
          tenant: 'from-context',
        }),
      );
      expect(updated).toHaveLength(PER_ACCOUNT);
      expect(updated.every((r) => r.account_id === self())).toBe(true);
      const left = await asOwner((c) =>
        c.query(`SELECT 1 FROM ${TABLE} WHERE account_id = $1 AND cost_micro_usd = 1000`, [
          other(),
        ]),
      );
      expect(left.rowCount).toBe(PER_ACCOUNT);
    });

    it(`${selfName}→${otherName}: xóa toàn bảng chỉ xóa dòng của ${selfName}`, async () => {
      await withAccount(self(), () =>
        systemTx((db) => db.delete(aiTrendAllocations), { tenant: 'from-context' }),
      );
      const counts = await countByAccount(TABLE);
      expect(counts[self()] ?? 0).toBe(0);
      expect(counts[other()]).toBe(PER_ACCOUNT);
    });

    it(`${selfName}→${otherName}: chèn account_id = ${otherName} → DB_POLICY_VIOLATION, hoàn tác`, async () => {
      await expect(
        withAccount(self(), () =>
          systemTx(
            async (db) => {
              await db.insert(aiTrendAllocations).values(row(self()));
              await db.insert(aiTrendAllocations).values(row(other()));
            },
            { tenant: 'from-context' },
          ),
        ),
      ).rejects.toBeInstanceOf(DbPolicyViolationError);
      const counts = await countByAccount(TABLE);
      expect(counts[self()]).toBe(PER_ACCOUNT);
      expect(counts[other()]).toBe(PER_ACCOUNT);
    });

    it(`${selfName}→${otherName}: sửa thành account_id = ${otherName} → DB_POLICY_VIOLATION, dòng ${otherName} nguyên vẹn`, async () => {
      await expect(
        withAccount(self(), () =>
          systemTx((db) => db.update(aiTrendAllocations).set({ account_id: other() }), {
            tenant: 'from-context',
          }),
        ),
      ).rejects.toBeInstanceOf(DbPolicyViolationError);
      const counts = await countByAccount(TABLE);
      expect(counts[self()]).toBe(PER_ACCOUNT);
      expect(counts[other()]).toBe(PER_ACCOUNT);
    });
  }

  it('vai trò app (khách) không đọc được bảng (đã thu hồi quyền) dù ở đúng tenant', async () => {
    await expect(
      withAccount(a, () => tenantTx((db) => db.execute(sql`SELECT 1 FROM ${aiTrendAllocations}`))),
    ).rejects.toThrow();
  });
});
