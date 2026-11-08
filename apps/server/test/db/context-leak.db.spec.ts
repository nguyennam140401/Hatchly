// US1-AS4, AS5, SC-002: biến phiên tenant KHÔNG rò qua kết nối dùng lại của bể.
import { sql } from 'drizzle-orm';
import { beforeAll, expect, it } from 'vitest';
import { tenantTx } from '../../src/core/db/transaction';
import { createAccount, describeDb, makeDatabase, seedNotes, withAccount } from './helpers/db';
import { tenantNotes } from './sandbox/schema';

describeDb('Không rò ngữ cảnh tenant qua bể kết nối', () => {
  let a: string;
  let b: string;

  beforeAll(async () => {
    a = await createAccount();
    b = await createAccount();
    await seedNotes(a, 3);
    await seedNotes(b, 2);
  });

  /** Truy vấn THÔ trên kết nối kế tiếp của bể `app` (không ngữ cảnh) – qua chính RolePool. */
  async function rawProbe(database: ReturnType<typeof makeDatabase>) {
    const client = await database.service.pool('app')!.connect();
    try {
      const rows = await client.query('SELECT count(*)::int AS n FROM sandbox.tenant_notes');
      const setting = await client.query<{ v: string | null }>(
        "SELECT current_setting('app.account_id', true) AS v",
      );
      return { n: (rows.rows[0] as { n: number }).n, setting: setting.rows[0]?.v ?? null };
    } finally {
      client.release();
    }
  }

  it('bể 1 kết nối: sau giao dịch A thành công, kết nối dùng lại không ngữ cảnh → 0 dòng', async () => {
    const database = makeDatabase({ poolMax: 1 });
    try {
      const seen = await withAccount(a, () => tenantTx((db) => db.select().from(tenantNotes)));
      expect(seen).toHaveLength(3);
      const probe = await rawProbe(database);
      expect(probe.n).toBe(0);
      expect(probe.setting === '' || probe.setting === null).toBe(true);
      expect(database.service.pool('app')!.totalCount).toBe(1);
    } finally {
      await database.close();
    }
  });

  it('bể 1 kết nối: giao dịch A ném lỗi giữa chừng → kết nối dùng lại vẫn 0 dòng', async () => {
    const database = makeDatabase({ poolMax: 1 });
    try {
      await expect(
        withAccount(a, () =>
          tenantTx(async (db) => {
            await db.select().from(tenantNotes);
            throw new Error('lỗi cố ý');
          }),
        ),
      ).rejects.toThrow('lỗi cố ý');
      const probe = await rawProbe(database);
      expect(probe.n).toBe(0);
      expect(probe.setting === '' || probe.setting === null).toBe(true);
    } finally {
      await database.close();
    }
  });

  it('A và B song song trên 2 kết nối (pg_sleep xen kẽ) → mỗi bên chỉ thấy dòng của mình', async () => {
    const database = makeDatabase({ poolMax: 2 });
    try {
      const run = (account: string, delay: number) =>
        withAccount(account, () =>
          tenantTx(async (db) => {
            await db.execute(sql`SELECT pg_sleep(${delay})`);
            const first = await db.select().from(tenantNotes);
            await db.execute(sql`SELECT pg_sleep(${delay})`);
            const second = await db.select().from(tenantNotes);
            return [...first, ...second].map((r) => r.account_id);
          }),
        );
      const [seenA, seenB] = await Promise.all([run(a, 0.05), run(b, 0.03)]);
      expect(new Set(seenA)).toEqual(new Set([a]));
      expect(new Set(seenB)).toEqual(new Set([b]));
      expect(seenA).toHaveLength(6);
      expect(seenB).toHaveLength(4);
    } finally {
      await database.close();
    }
  });

  it('SC-002: 1.000 giao dịch xen kẽ A/B trên bể 2 kết nối, mỗi vòng thứ 10 lỗi → 0 lần rò', async () => {
    const database = makeDatabase({ poolMax: 2 });
    let leaks = 0;
    let failures = 0;
    try {
      const tasks: Promise<void>[] = [];
      for (let i = 0; i < 1000; i++) {
        const account = i % 2 === 0 ? a : b;
        const fail = i % 10 === 9;
        tasks.push(
          withAccount(account, () =>
            tenantTx(async (db) => {
              const rows = await db
                .select({ account_id: tenantNotes.account_id })
                .from(tenantNotes);
              if (rows.some((r) => r.account_id !== account)) leaks++;
              if (fail) throw new Error('lỗi cố ý');
            }),
          ).catch(() => {
            failures++;
          }),
        );
      }
      await Promise.all(tasks);
      expect(leaks).toBe(0);
      expect(failures).toBe(100);
      const probe = await rawProbe(database);
      expect(probe.n).toBe(0);
    } finally {
      await database.close();
    }
  }, 120_000);
});
