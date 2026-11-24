import { describe, expect, it } from 'vitest';
import { asOwner, describeDb } from '../db/helpers/db';

// 015 US7/US8 (Hiến pháp I, VII): kiểm CATALOG quyền EXECUTE của các hàm SECURITY DEFINER mới (0031, 0032, 0033).
// Chỉ đọc pg_proc/pg_roles; không đổi dữ liệu. Vai trò: app, system, support và PUBLIC.

type Who = 'app' | 'system' | 'support';

const EXPECT: { fn: string; allowed: Who[] }[] = [
  { fn: 'ai_gateway.admin_cost_summary', allowed: ['support'] },
  { fn: 'ai_gateway.threshold_ratio', allowed: ['system'] },
  { fn: 'ai_gateway.invoice_ledger_total', allowed: ['system'] },
  { fn: 'ai_gateway.invoice_providers_for_day', allowed: ['system'] },
  { fn: 'account.count_active_accounts', allowed: ['system'] },
  { fn: 'ai_gateway.open_reservations_count', allowed: ['system'] },
  { fn: 'ai_gateway.admin_add_price', allowed: ['support'] },
  { fn: 'ai_gateway.admin_set_settings', allowed: ['support'] },
  { fn: 'ai_gateway.admin_set_route', allowed: ['support'] },
  { fn: 'ai_gateway.admin_set_task_fallback', allowed: ['support'] },
  { fn: 'ai_gateway.admin_enter_invoice', allowed: ['support'] },
  { fn: 'ai_gateway.admin_get_current_price', allowed: ['support'] },
  { fn: 'ai_gateway.admin_get_settings', allowed: ['support'] },
  { fn: 'ai_gateway.admin_model_has_price', allowed: ['support'] },
  { fn: 'ai_gateway.admin_get_route', allowed: ['support'] },
  // Hàm ghi kiểm toán dùng chung: không ai ngoài chủ sở hữu được gọi.
  { fn: 'ai_gateway.admin_write_audit', allowed: [] },
];

interface Row {
  oid: number;
  owner: string;
  secdef: boolean;
  config: string[] | null;
  n: number;
  app: boolean;
  system: boolean;
  support: boolean;
  public_: boolean;
  owner_exec: boolean;
}

async function load(qualified: string): Promise<Row[]> {
  const [schema, name] = qualified.split('.');
  return asOwner(
    async (c) =>
      (
        await c.query<Row>(
          `SELECT p.oid::int AS oid, pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS secdef, p.proconfig AS config,
                  count(*) OVER ()::int AS n,
                  has_function_privilege('app', p.oid, 'EXECUTE') AS app,
                  has_function_privilege('system', p.oid, 'EXECUTE') AS system,
                  has_function_privilege('support', p.oid, 'EXECUTE') AS support,
                  has_function_privilege('public', p.oid, 'EXECUTE') AS public_,
                  has_function_privilege(p.proowner, p.oid, 'EXECUTE') AS owner_exec
             FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
            WHERE ns.nspname = $1 AND p.proname = $2`,
          [schema, name],
        )
      ).rows,
  );
}

describeDb('Quyền EXECUTE của hàm SQL Cổng AI mới (catalog, 0031-0033)', () => {
  for (const { fn, allowed } of EXPECT) {
    describe(fn, () => {
      it('tồn tại đúng một dấu hàm, SECURITY DEFINER, search_path cố định', async () => {
        const rows = await load(fn);
        expect(rows).toHaveLength(1);
        const r = rows[0]!;
        expect(r.secdef).toBe(true);
        const sp = (r.config ?? []).find((s) => s.startsWith('search_path='));
        expect(sp, 'thiếu search_path trong proconfig').toBeDefined();
        // pg_catalog đứng đầu, không có public.
        expect(sp).toMatch(/^search_path=pg_catalog, /);
        expect(sp).not.toMatch(/\bpublic\b/);
      });

      it('không cấp cho PUBLIC', async () => {
        expect((await load(fn))[0]!.public_).toBe(false);
      });

      it(`EXECUTE chỉ cho: ${allowed.join(', ') || '(không ai ngoài owner)'}`, async () => {
        const r = (await load(fn))[0]!;
        for (const who of ['app', 'system', 'support'] as const) {
          expect(r[who], `${who} -> ${fn}`).toBe(allowed.includes(who));
        }
        expect(r.owner_exec).toBe(true);
        expect(['app', 'system', 'support']).not.toContain(r.owner);
      });
    });
  }

  it('app không có EXECUTE trên bất kỳ hàm SECURITY DEFINER nào của 0031-0033', async () => {
    for (const { fn } of EXPECT) expect((await load(fn))[0]!.app, fn).toBe(false);
  });

  it('support không gọi được hàm hệ thống; system không gọi được hàm quản trị', async () => {
    const sys = EXPECT.filter((e) => e.allowed.includes('system'));
    const sup = EXPECT.filter((e) => e.allowed.includes('support'));
    for (const { fn } of sys) expect((await load(fn))[0]!.support, fn).toBe(false);
    for (const { fn } of sup) expect((await load(fn))[0]!.system, fn).toBe(false);
  });
});
