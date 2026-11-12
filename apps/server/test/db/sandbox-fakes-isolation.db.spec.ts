// 005 T019 (data-model.md mục 5): truy cập chéo trên MỌI bảng tenant `sandbox.*fake*` (khuôn 002); bảng
// hệ thống `ai_fake_system_*` không đọc/ghi được từ vai trò tenant; migration dev không áp ở production.
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import * as fakes from '../../src/dev/sandbox/schema';
import { describeCrossTenant } from './helpers/cross-tenant';
import { asOwner, dbUrls, describeDb } from './helpers/db';
import { Client } from 'pg';

const future = () => new Date(Date.now() + 600_000);
let n = 0;
const next = () => ++n;

describeCrossTenant({
  table: fakes.fakeScenarios,
  insertRow: () => ({ component: 'platform' as const, target: '*', spec: { submit: 'published' } }),
  updateRow: () => ({ remaining_uses: 1 }),
});
describeCrossTenant({
  table: fakes.pgFakeOauthStates,
  insertRow: () => ({
    state_hash: Buffer.from(uuidV7()),
    user_id: uuidV7(),
    channel_type: 'facebook_page',
    expires_at: future(),
  }),
  updateRow: () => ({ used_at: new Date() }),
});
describeCrossTenant({
  table: fakes.pgFakeSelections,
  insertRow: () => ({
    channel_type: 'facebook_page',
    user_id: uuidV7(),
    candidates: [],
    expires_at: future(),
  }),
  updateRow: () => ({ used_at: new Date() }),
});
describeCrossTenant({
  table: fakes.pgFakeConnections,
  insertRow: () => ({
    channel_type: 'facebook_page',
    external_id: `page-${next()}`,
    display_name: 'Page giả',
    token_ciphertext: Buffer.from('x'),
    token_expires_at: future(),
  }),
  updateRow: () => ({ status: 'disconnected' as const }),
});
describeCrossTenant({
  table: fakes.pgFakePosts,
  insertRow: () => ({
    connection_id: uuidV7(),
    platform_post_id: `p-${next()}`,
    content_hash: 'ch1:x',
    stored_text_hash: 'ch1:x',
    permalink: 'https://fake.local/p',
    state: 'published' as const,
  }),
  updateRow: () => ({ state: 'failed' as const }),
});
describeCrossTenant({
  table: fakes.aiFakeBudgets,
  insertRow: () => ({
    cycle_start: `2026-${String((next() % 12) + 1).padStart(2, '0')}-${String((n % 28) + 1).padStart(2, '0')}`,
    cap: 4_000_000n,
    soft_limit: 2_000_000n,
  }),
  updateRow: () => ({ notified_80: true }),
});
describeCrossTenant({
  table: fakes.aiFakeReservations,
  insertRow: () => ({
    cycle_start: '2026-11-01',
    estimate: 100n,
    model_tier: 'default',
    task: 'post_generation',
  }),
  updateRow: () => ({ state: 'released' as const }),
});
describeCrossTenant({
  table: fakes.aiFakeCostLedger,
  insertRow: () => ({
    cycle_start: '2026-11-01',
    reservation_id: uuidV7(),
    task: 'post_generation',
    model_tier: 'default',
    model_id: 'fake-default',
    provider: 'fake',
    input_tokens: 1,
    output_tokens: 1,
    cached_input_tokens: 0,
    cost_micro_usd: 10n,
    estimate_micro_usd: 20n,
  }),
  updateRow: () => ({ anomaly: 'over_estimate' as const }),
});
describeCrossTenant({
  table: fakes.ntfFakeEvents,
  insertRow: () => ({ dedupe_key: `k-${next()}`, type: 'ai_usage_80', refs: {} }),
  updateRow: () => ({ refs: { x: 1 } }),
});
describeCrossTenant({
  table: fakes.ntfFakeNotifications,
  insertRow: () => ({
    dedupe_key: `k-${next()}`,
    type: 'ai_usage_80',
    recipient_user_id: uuidV7(),
    channel: 'in_app' as const,
    title_vi: 't',
    body_vi: 'b',
    actions: [],
    refs: {},
  }),
  updateRow: () => ({ email_result: 'sent' }),
});

/** Mọi bảng tenant của schema giả lập phải có dòng describeCrossTenant ở trên. */
const COVERED = [
  'fake_scenarios',
  'pg_fake_oauth_states',
  'pg_fake_selections',
  'pg_fake_connections',
  'pg_fake_posts',
  'ai_fake_budgets',
  'ai_fake_reservations',
  'ai_fake_cost_ledger',
  'ntf_fake_events',
  'ntf_fake_notifications',
];

describeDb('Bảng giả lập – phủ đủ và quyền bảng hệ thống', () => {
  let app: Client;

  beforeAll(async () => {
    app = new Client({ connectionString: dbUrls.app });
    await app.connect();
  });
  afterAll(async () => {
    await app.end();
  });

  it('mọi bảng có account_id của schema sandbox (trừ bảng mẫu 002) đều được kiểm truy cập chéo', async () => {
    const tables = await asOwner(async (c) => {
      const r = await c.query<{ table: string }>(
        `SELECT c.relname AS table FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
           JOIN pg_namespace ns ON ns.oid = c.relnamespace
          WHERE ns.nspname = 'sandbox' AND a.attname = 'account_id' AND c.relkind = 'r'
            AND c.relname <> 'tenant_notes' ORDER BY 1`,
      );
      return r.rows.map((row) => row.table);
    });
    expect(tables).toEqual([...COVERED].sort());
    const declared = Object.values(fakes)
      .filter((v) => typeof v === 'object' && Symbol.for('drizzle:Name') in v)
      .map((t) => getTableConfig(t as typeof fakes.fakeScenarios).name)
      .filter((name) => !name.startsWith('ai_fake_system_'));
    expect(declared.sort()).toEqual([...COVERED].sort());
  });

  it('vai trò app (tenant) không đọc/ghi được bảng ai_fake_system_*', async () => {
    for (const table of [
      'ai_fake_system_budgets',
      'ai_fake_system_reservations',
      'ai_fake_system_cost_ledger',
    ]) {
      await expect(app.query(`SELECT 1 FROM sandbox.${table} LIMIT 1`)).rejects.toMatchObject({
        code: '42501',
      });
    }
    await expect(
      app.query(
        "INSERT INTO sandbox.ai_fake_system_budgets (week_start, cap, soft_limit) VALUES ('2026-11-09', 1, 1)",
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('vai trò system ghi được bảng hệ thống; CHECK used + reserved <= cap là chốt cuối', async () => {
    const system = new Client({ connectionString: dbUrls.system });
    await system.connect();
    try {
      const week = '2001-01-01';
      await system
        .query('DELETE FROM sandbox.ai_fake_system_budgets WHERE week_start = $1', [week])
        .catch(() => undefined);
      await system.query(
        'INSERT INTO sandbox.ai_fake_system_budgets (week_start, cap, soft_limit) VALUES ($1, 100, 100) ON CONFLICT DO NOTHING',
        [week],
      );
      await expect(
        system.query(
          'UPDATE sandbox.ai_fake_system_budgets SET reserved = 101 WHERE week_start = $1',
          [week],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      await system.end();
    }
  });
});
