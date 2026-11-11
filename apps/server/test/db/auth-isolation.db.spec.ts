import { eq, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DbPolicyViolationError } from '../../src/core/db/errors';
import { tenantTx } from '../../src/core/db/transaction';
import {
  authTokens,
  loginIdentities,
  memberships,
  sessions,
  users,
} from '../../src/modules/account/internal/db/schema';
import { describeDb, makeDatabase, rawAppPool, withAccount, type TestDatabase } from './helpers/db';
import { seedSession, seedUser, type SeededUser } from './helpers/auth-seed';

// T014 (004, hiến pháp I – cổng CI số 1): truy cập chéo cho 5 bảng tenant mới của xác thực.
// Khuôn chung `describeCrossTenant` (002) mồi dòng bằng `insertRow()` không biết tài khoản; các bảng
// này có FK tới người dùng và ràng buộc duy nhất theo người dùng nên dữ liệu mồi đi qua
// `account.auth_register` (đường thật) – các khẳng định giữ nguyên như khuôn chung.

type TenantTable = PgTable & { account_id: unknown };

const TABLES: { name: string; table: TenantTable; touch: Record<string, unknown> }[] = [
  { name: 'users', table: users, touch: { display_name: 'đã sửa' } },
  {
    name: 'login_identities',
    table: loginIdentities,
    touch: { last_used_at: new Date() },
  },
  { name: 'memberships', table: memberships, touch: { updated_at: new Date() } },
  { name: 'sessions', table: sessions, touch: { revoke_reason: 'logout' } },
  { name: 'auth_tokens', table: authTokens, touch: { used_at: new Date() } },
];

describeDb('Truy cập chéo tenant – bảng xác thực', () => {
  let database: TestDatabase;
  let a: SeededUser;
  let b: SeededUser;

  beforeAll(async () => {
    database = makeDatabase({ unit: 'api' });
    a = await seedUser();
    b = await seedUser();
    await seedSession(a);
    await seedSession(b);
  });
  afterAll(async () => {
    await database.close();
  });

  for (const { name, table, touch } of TABLES) {
    for (const dir of ['A→B', 'B→A'] as const) {
      it(`${name} ${dir}: đọc/sửa/xóa chỉ chạm dòng của mình`, async () => {
        const [self, other] = dir === 'A→B' ? [a, b] : [b, a];
        const t = table as PgTable;
        const accountCol = (table as unknown as { account_id: Parameters<typeof eq>[0] })
          .account_id;

        const seen = await withAccount(self.accountId, () => tenantTx((db) => db.select().from(t)));
        expect(seen.length).toBeGreaterThan(0);
        expect(new Set(seen.map((r) => (r as { account_id: string }).account_id))).toEqual(
          new Set([self.accountId]),
        );

        // Nhắm thẳng vào dòng của tài khoản kia → 0 dòng.
        const updated = await withAccount(self.accountId, () =>
          tenantTx((db) =>
            db.update(t).set(touch).where(eq(accountCol, other.accountId)).returning(),
          ),
        );
        expect(updated).toHaveLength(0);
        const deleted = await withAccount(self.accountId, () =>
          tenantTx((db) => db.delete(t).where(eq(accountCol, other.accountId)).returning()),
        );
        expect(deleted).toHaveLength(0);

        // Dòng của tài khoản kia vẫn còn nguyên.
        const otherRows = await withAccount(other.accountId, () =>
          tenantTx((db) => db.select().from(t)),
        );
        expect(otherRows.length).toBeGreaterThan(0);
      });
    }

    it(`${name}: chuyển dòng sang tài khoản khác → DB_POLICY_VIOLATION`, async () => {
      const t = table as PgTable;
      await expect(
        withAccount(a.accountId, () =>
          tenantTx((db) => db.update(t).set({ account_id: b.accountId }).returning()),
        ),
      ).rejects.toBeInstanceOf(DbPolicyViolationError);
    });

    it(`${name}: không có ngữ cảnh tenant (bể app thô) → 0 dòng`, async () => {
      const pool = rawAppPool();
      try {
        const r = await pool.query(`SELECT count(*)::int AS n FROM account.${name}`);
        expect(r.rows[0]).toEqual({ n: 0 });
      } finally {
        await pool.end();
      }
    });
  }

  it('users: không đọc được dòng của tài khoản khác dù biết id', async () => {
    const rows = await withAccount(a.accountId, () =>
      tenantTx((db) => db.select().from(users).where(eq(users.id, b.userId))),
    );
    expect(rows).toHaveLength(0);
    const viaSql = await withAccount(a.accountId, () =>
      tenantTx((db) => db.execute(sql`SELECT id FROM account.users WHERE id = ${b.userId}`)),
    );
    expect(viaSql.rows).toHaveLength(0);
  });
});
