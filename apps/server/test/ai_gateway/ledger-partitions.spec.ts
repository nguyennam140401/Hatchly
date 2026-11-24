// T006c (015, data-model.md mục 2.3, FR-015, FR-016): sổ chi phí `ai_gateway.ai_cost_ledger` phân vùng theo tháng.
// Khuôn: nhật ký `publishing.publish_steps` (migration 0020). Cần PostgreSQL thật (chạy bằng `pnpm test:db`);
// khi không có CSDL kiểm thử (`dbAvailable` sai, kể cả chạy bằng cấu hình đơn vị) cả nhóm được bỏ qua.
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asOwner, dbUrls, describeDb } from '../db/helpers/db';

const LEDGER = 'ai_gateway.ai_cost_ledger';
const ENSURE = 'ai_gateway.ensure_ai_cost_ledger_partitions';
const DROP = 'ai_gateway.drop_ai_cost_ledger_partitions_before';

/** Tên các phân vùng hiện có của sổ, theo thứ tự tên. */
async function partitions(c: Client): Promise<{ name: string; rls: boolean; bound: string }[]> {
  const r = await c.query<{ name: string; rls: boolean; bound: string }>(
    `SELECT c.relname AS name, c.relrowsecurity AS rls, pg_get_expr(c.relpartbound, c.oid) AS bound
       FROM pg_inherits i
       JOIN pg_class c ON c.oid = i.inhrelid
       JOIN pg_class p ON p.oid = i.inhparent
       JOIN pg_namespace n ON n.oid = p.relnamespace
      WHERE n.nspname = 'ai_gateway' AND p.relname = 'ai_cost_ledger'
      ORDER BY c.relname`,
  );
  return r.rows;
}

describeDb('Sổ chi phí AI phân vùng (015)', () => {
  let system: Client;
  let app: Client;
  const created: string[] = [];

  /** Mã lỗi SQLSTATE hoặc 'ok'. */
  const code = async (client: Client, text: string, values: unknown[] = []): Promise<string> => {
    try {
      await client.query(text, values);
      return 'ok';
    } catch (err) {
      return (err as { code?: string }).code ?? 'unknown';
    }
  };

  /** Tạo (bằng owner) phân vùng tháng cách tháng hiện tại `monthsAgo` tháng, trả tên. */
  async function createOldPartition(monthsAgo: number): Promise<string> {
    return asOwner(async (c) => {
      // Cận phân vùng phải là hằng → tính trước bằng truy vấn rồi ghép vào câu DDL.
      const r = await c.query<{ name: string; lo: string; hi: string }>(
        `SELECT format('ai_cost_ledger_y%sm%s', to_char(m, 'YYYY'), to_char(m, 'MM')) AS name,
                to_char(m, 'YYYY-MM-DD') || ' 00:00:00+00' AS lo,
                to_char(m + interval '1 month', 'YYYY-MM-DD') || ' 00:00:00+00' AS hi
           FROM (SELECT (date_trunc('month', now() AT TIME ZONE 'UTC') - make_interval(months => $1::int))::date AS m) s`,
        [monthsAgo],
      );
      const { name, lo, hi } = r.rows[0]!;
      await c.query(
        `CREATE TABLE IF NOT EXISTS ai_gateway.${name} PARTITION OF ${LEDGER}
           FOR VALUES FROM ('${lo}') TO ('${hi}')`,
      );
      created.push(name);
      return name;
    });
  }

  beforeAll(async () => {
    system = new Client({ connectionString: dbUrls.system, options: '-c TimeZone=UTC' });
    app = new Client({ connectionString: dbUrls.app, options: '-c TimeZone=UTC' });
    await system.connect();
    await app.connect();
  });

  afterAll(async () => {
    await system.end();
    await app.end();
    await asOwner(async (c) => {
      for (const name of created) await c.query(`DROP TABLE IF EXISTS ai_gateway.${name}`);
    });
  });

  it('bảng sổ là bảng phân vùng theo khoảng (RANGE) trên created_at, bật RLS với chính sách tenant_isolation', async () => {
    const r = await asOwner((c) =>
      c.query<{ strategy: string; key: string; rls: boolean }>(
        `SELECT pt.partstrat AS strategy,
                (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum = pt.partattrs[0]) AS key,
                c.relrowsecurity AS rls
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           JOIN pg_partitioned_table pt ON pt.partrelid = c.oid
          WHERE n.nspname = 'ai_gateway' AND c.relname = 'ai_cost_ledger'`,
      ),
    );
    expect(r.rows).toEqual([{ strategy: 'r', key: 'created_at', rls: true }]);
    const policy = await asOwner((c) =>
      c.query<{ polname: string }>(
        `SELECT polname FROM pg_policy WHERE polrelid = 'ai_gateway.ai_cost_ledger'::regclass`,
      ),
    );
    expect(policy.rows.map((p) => p.polname)).toContain('tenant_isolation');
  });

  describe('hàm tạo trước phân vùng tháng', () => {
    it('chạy hai lần cho cùng kết quả (idempotent): cùng tập phân vùng, không lỗi', async () => {
      await system.query(`SELECT ${ENSURE}(2)`);
      const first = await partitions(system);
      await system.query(`SELECT ${ENSURE}(2)`);
      const second = await partitions(system);
      expect(second).toEqual(first);
      // Tháng hiện tại + 2 tháng sau (≥ 3 phân vùng).
      expect(first.length).toBeGreaterThanOrEqual(3);
    });

    it('phân vùng phủ tháng hiện tại và tháng kế; mọi phân vùng bật RLS (chặn truy cập thẳng)', async () => {
      await system.query(`SELECT ${ENSURE}(1)`);
      const parts = await partitions(system);
      const now = await system.query<{ cur: string; next: string }>(
        `SELECT to_char(date_trunc('month', now() AT TIME ZONE 'UTC'), 'YYYY-MM') AS cur,
                to_char(date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month', 'YYYY-MM') AS next`,
      );
      const { cur, next } = now.rows[0]!;
      for (const month of [cur, next]) {
        expect(
          parts.some((p) => p.bound.includes(`'${month}-01 00:00:00+00'`)),
          `thiếu phân vùng bắt đầu ${month}-01`,
        ).toBe(true);
      }
      for (const p of parts) expect(p.rls, p.name).toBe(true);
    });

    it('months_ahead ngoài 0–24 bị từ chối', async () => {
      expect(await code(system, `SELECT ${ENSURE}(25)`)).not.toBe('ok');
      expect(await code(system, `SELECT ${ENSURE}(-1)`)).not.toBe('ok');
    });

    it('vai trò app không gọi được (chỉ system)', async () => {
      expect(await code(app, `SELECT ${ENSURE}(1)`)).toBe('42501');
    });
  });

  describe('hàm bỏ phân vùng cũ hơn N tháng', () => {
    it('bỏ phân vùng quá 12 tháng, giữ phân vùng trong hạn; chạy lần hai không bỏ thêm gì', async () => {
      await system.query(`SELECT ${ENSURE}(1)`);
      const tooOld = await createOldPartition(13); // chặn trên = đầu tháng của 12 tháng trước → bị bỏ
      const keep = await createOldPartition(12); // chặn trên sau mốc cắt → còn
      const before = await partitions(system);
      expect(before.map((p) => p.name)).toEqual(expect.arrayContaining([tooOld, keep]));

      const r1 = await system.query<{ n: number }>(`SELECT ${DROP}(12) AS n`);
      expect(r1.rows[0]!.n).toBeGreaterThanOrEqual(1);
      const afterFirst = await partitions(system);
      expect(afterFirst.map((p) => p.name)).not.toContain(tooOld);
      expect(afterFirst.map((p) => p.name)).toContain(keep);

      const r2 = await system.query<{ n: number }>(`SELECT ${DROP}(12) AS n`);
      expect(r2.rows[0]!.n).toBe(0);
      expect(await partitions(system)).toEqual(afterFirst);
    });

    it('không bao giờ bỏ phân vùng của tháng hiện tại và các tháng tới', async () => {
      await system.query(`SELECT ${ENSURE}(2)`);
      const before = await partitions(system);
      await system.query(`SELECT ${DROP}(1)`);
      const after = await partitions(system);
      const futureOrCurrent = before.filter((p) => {
        const m = /FROM \('(\d{4})-(\d{2})/.exec(p.bound);
        if (m === null) return false;
        const start = new Date(`${m[1]}-${m[2]}-01T00:00:00Z`).getTime();
        const monthStart = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
        return start >= monthStart;
      });
      expect(futureOrCurrent.length).toBeGreaterThanOrEqual(3);
      for (const p of futureOrCurrent) expect(after.map((x) => x.name)).toContain(p.name);
    });

    it('tham số ngoài 1–120 bị từ chối; app không gọi được', async () => {
      expect(await code(system, `SELECT ${DROP}(0)`)).not.toBe('ok');
      expect(await code(system, `SELECT ${DROP}(121)`)).not.toBe('ok');
      expect(await code(app, `SELECT ${DROP}(12)`)).toBe('42501');
    });
  });

  describe('sổ chỉ-thêm: thu hồi UPDATE/DELETE', () => {
    it.each(['app', 'system'])(
      'vai trò %s: có INSERT/SELECT, không có UPDATE/DELETE/TRUNCATE',
      async (role) => {
        const r = await asOwner((c) =>
          c.query<Record<string, boolean>>(
            `SELECT has_table_privilege($1, $2, 'SELECT') AS sel,
                    has_table_privilege($1, $2, 'INSERT') AS ins,
                    has_table_privilege($1, $2, 'UPDATE') AS upd,
                    has_table_privilege($1, $2, 'DELETE') AS del,
                    has_table_privilege($1, $2, 'TRUNCATE') AS trunc`,
            [role, LEDGER],
          ),
        );
        expect(r.rows[0]).toEqual({ sel: true, ins: true, upd: false, del: false, trunc: false });
      },
    );

    it('UPDATE/DELETE thật sự bị từ chối (42501) cho cả app lẫn system', async () => {
      for (const client of [app, system]) {
        expect(await code(client, `UPDATE ${LEDGER} SET anomaly = NULL WHERE false`)).toBe('42501');
        expect(await code(client, `DELETE FROM ${LEDGER} WHERE false`)).toBe('42501');
        expect(await code(client, `TRUNCATE ${LEDGER}`)).toBe('42501');
      }
    });

    it('không có ngữ cảnh tài khoản thì SELECT thấy 0 dòng (RLS)', async () => {
      const r = await app.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${LEDGER}`);
      expect(r.rows[0]!.n).toBe('0');
    });
  });
});
