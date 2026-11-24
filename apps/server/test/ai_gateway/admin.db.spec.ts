import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  registerAndVerify,
  type Agent,
  type ErrorBody,
  type TestApp,
} from '../auth/helpers/app';
import { collaboratorOf, staffAgent } from '../auth/helpers/actors';
import { asOwner, describeDb } from '../db/helpers/db';
import { insertPrice, uniqueModel, type TestModel } from './helpers/price-fixtures';

// 015 US3 T038 (FR-019a, contracts/admin-ops.md mục 1–2): điểm cuối quản trị cấu hình Cổng AI qua HTTP/Nest THẬT (khuôn
// test/auth/staff.e2e.spec.ts). Viết TRƯỚC mã (T039–T041): hiện đỏ vì chưa có `admin.controller.ts` (mọi điểm cuối 404).
// Giả định đã chốt theo hợp đồng + khuôn nhân viên: tiền tố `/api/v1`, lỗi nghiệp vụ là 4xx (không 401/403) với `error.code`
// và ≥ 1 hành động khắc phục; kiểm tra thân yêu cầu nghiêm ngặt (trường lạ, kể cả `accountId`, bị từ chối).
// Dữ liệu dùng chung (model_prices chỉ-thêm, model_routes, task_fallback, ai_settings) chỉ đụng bằng (provider, model) riêng
// của ca hoặc khôi phục lại giá trị ban đầu bằng owner sau mỗi ca.

const BASE = '/api/v1/admin/ai';
const MIN = 60_000;
const BASELINE = { input: 1_000_000, output: 2_000_000, cached: 100_000 };

interface AuditRow {
  actor_type: string;
  actor_id: string;
  metadata: Record<string, unknown> | null;
}

async function audit(action: string, actorId: string): Promise<AuditRow[]> {
  return asOwner(
    async (c) =>
      (
        await c.query<AuditRow>(
          `SELECT actor_type, actor_id, metadata FROM infra.audit_log
            WHERE action = $1 AND actor_id = $2 ORDER BY occurred_at, id`,
          [action, actorId],
        )
      ).rows,
  );
}

interface PriceRow {
  id: string;
  input_per_mtok: string | null;
  output_per_mtok: string | null;
  cached_input_per_mtok: string | null;
  per_minute: string | null;
  effective_from: Date;
  created_by: string;
  unit: string;
}

async function priceRows(m: TestModel): Promise<PriceRow[]> {
  return asOwner(
    async (c) =>
      (
        await c.query<PriceRow>(
          `SELECT id, unit, input_per_mtok::text, output_per_mtok::text, cached_input_per_mtok::text,
                  per_minute::text, effective_from, created_by
             FROM ai_gateway.model_prices WHERE provider = $1 AND model_id = $2 ORDER BY effective_from, id`,
          [m.provider, m.modelId],
        )
      ).rows,
  );
}

function expectDomainError(res: { status: number; body: unknown }, code: string): void {
  expect(res.status, JSON.stringify(res.body)).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
  expect([401, 403]).not.toContain(res.status);
  const error = (res.body as ErrorBody).error;
  expect(error.code).toBe(code);
  expect(error.message.length).toBeGreaterThan(0);
  // Hiến chương VI: mỗi thông báo lỗi có ít nhất một hành động khắc phục.
  expect(error.actions.length).toBeGreaterThanOrEqual(1);
}

const expectOk = (res: { status: number; body: unknown }) => {
  expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
};

const expectRejected = (res: { status: number; body: unknown }) => {
  expect(res.status, JSON.stringify(res.body)).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
  // Điểm cuối phải TỒN TẠI (404 không phải "bị từ chối vì dữ liệu sai") và không phải lỗi quyền.
  expect([401, 403, 404]).not.toContain(res.status);
};

describeDb('Quản trị cấu hình Cổng AI (HTTP)', () => {
  let t: TestApp;
  let owner: Awaited<ReturnType<typeof registerAndVerify>>;
  let collaborator: Agent;
  let supportAgent: Agent;
  let anonymous: Agent;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await registerAndVerify(t);
    collaborator = (await collaboratorOf(t, owner.me)).agent;
    supportAgent = (await staffAgent(t, 'support')).agent;
    anonymous = t.agent();
  });
  afterAll(async () => {
    await t.close();
  });

  const newAdmin = () => staffAgent(t, 'admin');
  const effectiveAfterTtl = () => new Date(Date.now() + 5 * MIN).toISOString();

  /** Dòng giá hiện hành (đã hiệu lực) của một mô hình riêng của ca. */
  async function baselineModel(unit: 'token' | 'audio_minute' = 'token'): Promise<TestModel> {
    const m = uniqueModel();
    await insertPrice(m, {
      unit,
      ...BASELINE,
      perMinute: 6_000,
      effectiveFrom: new Date(Date.now() - 60 * MIN),
    });
    return m;
  }

  const priceBody = (m: TestModel, over: Record<string, unknown> = {}) => ({
    provider: m.provider,
    modelId: m.modelId,
    unit: 'token',
    inputPerMTok: BASELINE.input,
    outputPerMTok: BASELINE.output,
    cachedInputPerMTok: BASELINE.cached,
    effectiveFrom: effectiveAfterTtl(),
    ...over,
  });

  // ------------------------------------------------------------------------------------------------------------
  // Phân quyền: ai.pricing.manage chỉ admin (FR-019a)
  // ------------------------------------------------------------------------------------------------------------
  describe('phân quyền (ai.pricing.manage chỉ admin)', () => {
    const endpoints = (m: TestModel) =>
      [
        ['post', `${BASE}/prices`, priceBody(m)],
        ['put', `${BASE}/settings`, { perIndustryWeeklyMicroUsd: 1_000_000 }],
        [
          'put',
          `${BASE}/routes`,
          { tier: 'stt', rank: 2, provider: m.provider, modelId: m.modelId, enabled: false },
        ],
        ['put', `${BASE}/task-fallback`, { task: 'post_generation', enabled: true }],
        [
          'post',
          `${BASE}/provider-invoices`,
          { provider: m.provider, invoiceDate: '2026-11-01', totalMicroUsd: 1_000 },
        ],
      ] as const;

    it('khách (chủ, cộng tác viên) → 401/403; hỗ trợ (đã đăng nhập nhân viên, thiếu quyền) → 403; ẩn danh → 401/403; không đổi dữ liệu, không kiểm toán', async () => {
      const m = await baselineModel();
      const before = await priceRows(m);
      // Khách không có phiên nhân viên: cổng nhân viên trả 401 (no_session) hoặc 403; tuyệt đối không 2xx/404.
      for (const [label, who] of [
        ['chủ', owner.agent],
        ['cộng tác viên', collaborator],
      ] as const) {
        for (const [method, path, body] of endpoints(m)) {
          const res = await who[method](path, body);
          expect([401, 403], `${label} ${method} ${path}`).toContain(res.status);
        }
      }
      // Hỗ trợ đã đăng nhập nhân viên nhưng không có ai.pricing.manage → đúng 403.
      for (const [method, path, body] of endpoints(m)) {
        const res = await supportAgent[method](path, body);
        expect(res.status, `hỗ trợ ${method} ${path}`).toBe(403);
      }
      for (const [method, path, body] of endpoints(m)) {
        const res = await anonymous[method](path, body);
        expect([401, 403], `ẩn danh ${path}`).toContain(res.status);
      }
      expect(await priceRows(m)).toEqual(before);
      const invoices = await asOwner(
        async (c) =>
          (
            await c.query<{ n: string }>(
              'SELECT count(*)::text AS n FROM ai_gateway.provider_invoices WHERE provider = $1',
              [m.provider],
            )
          ).rows[0]!.n,
      );
      expect(invoices).toBe('0');
    });

    it('mã tài khoản không nhận từ người gọi: trường accountId trong thân yêu cầu bị từ chối', async () => {
      const { agent } = await newAdmin();
      const m = await baselineModel();
      const res = await agent.post(
        `${BASE}/prices`,
        priceBody(m, { accountId: owner.me.account.id }),
      );
      expectRejected(res);
      expect(await priceRows(m)).toHaveLength(1);
    });
  });

  // ------------------------------------------------------------------------------------------------------------
  // POST /admin/ai/prices
  // ------------------------------------------------------------------------------------------------------------
  describe('POST /admin/ai/prices', () => {
    it('admin thêm giá hợp lệ: dòng mới + dòng cũ nguyên vẹn + kiểm toán ai.price.add đủ trường', async () => {
      const { agent, id } = await newAdmin();
      const m = await baselineModel();
      const [oldRow] = await priceRows(m);
      const effectiveFrom = effectiveAfterTtl();
      const res = await agent.post(
        `${BASE}/prices`,
        priceBody(m, {
          inputPerMTok: 2_000_000,
          outputPerMTok: 4_000_000,
          cachedInputPerMTok: 200_000,
          effectiveFrom,
        }),
      );
      expectOk(res);

      const rows = await priceRows(m);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual(oldRow); // không sửa dòng cũ
      const added = rows[1]!;
      expect(added).toMatchObject({
        unit: 'token',
        input_per_mtok: '2000000',
        output_per_mtok: '4000000',
        cached_input_per_mtok: '200000',
        per_minute: null,
        created_by: id,
      });
      expect(added.effective_from.getTime()).toBe(new Date(effectiveFrom).getTime());

      const events = await audit('ai.price.add', id);
      expect(events).toHaveLength(1);
      const [event] = events;
      expect(event!.actor_type).toBe('admin');
      expect(event!.metadata).toMatchObject({
        priceId: added.id,
        provider: m.provider,
        modelId: m.modelId,
        unit: 'token',
      });
      expect(new Date(String(event!.metadata!.effectiveFrom)).getTime()).toBe(
        new Date(effectiveFrom).getTime(),
      );
      // Giá cũ và giá mới đều có trong bản ghi kiểm toán.
      const text = JSON.stringify({ old: event!.metadata!.old, new: event!.metadata!.new });
      expect(event!.metadata!.old).toBeDefined();
      expect(event!.metadata!.new).toBeDefined();
      expect(text).toContain('1000000');
      expect(text).toContain('2000000');
      // Dòng kiểm toán không chứa bí mật/ mật khẩu / cookie.
      expect(JSON.stringify(event!.metadata)).not.toMatch(/password|cookie|secret|api[_-]?key/i);
    });

    it('dòng giá ĐẦU TIÊN của mô hình chỉ cần > 0 (không có dòng hiện hành để so)', async () => {
      const { agent, id } = await newAdmin();
      const m = uniqueModel();
      const res = await agent.post(
        `${BASE}/prices`,
        priceBody(m, {
          inputPerMTok: 123_456_789,
          outputPerMTok: 7,
          cachedInputPerMTok: undefined,
        }),
      );
      expectOk(res);
      expect(await priceRows(m)).toHaveLength(1);
      const [event] = await audit('ai.price.add', id);
      expect(event!.metadata).toMatchObject({ provider: m.provider, modelId: m.modelId });
    });

    it('đơn vị audio_minute: giá theo phút > 0 và lệch ≤ 10×; kiểm tra đúng theo unit', async () => {
      const { agent } = await newAdmin();
      const m = await baselineModel('audio_minute');
      const audio = (over: Record<string, unknown>) => ({
        provider: m.provider,
        modelId: m.modelId,
        unit: 'audio_minute',
        perMinute: 6_000,
        billingGranularitySec: 60,
        effectiveFrom: effectiveAfterTtl(),
        ...over,
      });
      expectDomainError(
        await agent.post(`${BASE}/prices`, audio({ perMinute: 0 })),
        'AI_PRICE_IMPLAUSIBLE',
      );
      expectDomainError(
        await agent.post(`${BASE}/prices`, audio({ perMinute: 60_001 })),
        'AI_PRICE_IMPLAUSIBLE',
      );
      expectDomainError(
        await agent.post(`${BASE}/prices`, audio({ perMinute: 599 })),
        'AI_PRICE_IMPLAUSIBLE',
      );
      expect(await priceRows(m)).toHaveLength(1);
      expectOk(await agent.post(`${BASE}/prices`, audio({ perMinute: 60_000 })));
      const rows = await priceRows(m);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        unit: 'audio_minute',
        per_minute: '60000',
        input_per_mtok: null,
      });
    });

    it('giá ≤ 0 → AI_PRICE_IMPLAUSIBLE; không thêm dòng, không kiểm toán', async () => {
      const { agent, id } = await newAdmin();
      for (const bad of [
        { inputPerMTok: 0 },
        { inputPerMTok: -5 },
        { outputPerMTok: 0 },
        { outputPerMTok: -1 },
        { cachedInputPerMTok: 0 },
      ]) {
        const m = await baselineModel();
        const res = await agent.post(`${BASE}/prices`, priceBody(m, bad));
        expectDomainError(res, 'AI_PRICE_IMPLAUSIBLE');
        expect(await priceRows(m), JSON.stringify(bad)).toHaveLength(1);
      }
      expect(await audit('ai.price.add', id)).toHaveLength(0);
    });

    it('lệch > 10× so với dòng hiện hành (cả tăng và giảm, từng trường giá) → AI_PRICE_IMPLAUSIBLE', async () => {
      const { agent, id } = await newAdmin();
      for (const bad of [
        { inputPerMTok: 10_000_001 }, // 10,000001×
        { inputPerMTok: 99_999 }, // < 1/10
        { outputPerMTok: 20_000_001 },
        { outputPerMTok: 199_999 },
        { cachedInputPerMTok: 1_000_001 },
        { inputPerMTok: 50_000_000 },
      ]) {
        const m = await baselineModel();
        const res = await agent.post(`${BASE}/prices`, priceBody(m, bad));
        expectDomainError(res, 'AI_PRICE_IMPLAUSIBLE');
        expect(await priceRows(m), JSON.stringify(bad)).toHaveLength(1);
      }
      expect(await audit('ai.price.add', id)).toHaveLength(0);
    });

    it('đúng biên 10× (tăng) và 1/10 (giảm) được nhận', async () => {
      const { agent, id } = await newAdmin();
      for (const ok of [
        { inputPerMTok: 10_000_000, outputPerMTok: 20_000_000, cachedInputPerMTok: 1_000_000 },
        { inputPerMTok: 100_000, outputPerMTok: 200_000, cachedInputPerMTok: 10_000 },
      ]) {
        const m = await baselineModel();
        expectOk(await agent.post(`${BASE}/prices`, priceBody(m, ok)));
        expect(await priceRows(m), JSON.stringify(ok)).toHaveLength(2);
      }
      expect(await audit('ai.price.add', id)).toHaveLength(2);
    });

    it('effectiveFrom < now + TTL đệm (hoặc ở quá khứ) → AI_PRICE_EFFECTIVE_TOO_SOON', async () => {
      const { agent, id } = await newAdmin();
      for (const when of [
        new Date(Date.now() - 24 * 60 * MIN), // quá khứ
        new Date(Date.now()), // ngay bây giờ
        new Date(Date.now() + 10_000), // 10 giây
        new Date(Date.now() + 30_000), // 30 giây < TTL 60 giây
      ]) {
        const m = await baselineModel();
        const res = await agent.post(
          `${BASE}/prices`,
          priceBody(m, { effectiveFrom: when.toISOString() }),
        );
        expectDomainError(res, 'AI_PRICE_EFFECTIVE_TOO_SOON');
        expect(await priceRows(m), when.toISOString()).toHaveLength(1);
      }
      expect(await audit('ai.price.add', id)).toHaveLength(0);
      // Sau TTL thì được.
      const ok = await baselineModel();
      expectOk(
        await agent.post(
          `${BASE}/prices`,
          priceBody(ok, { effectiveFrom: new Date(Date.now() + 2 * MIN).toISOString() }),
        ),
      );
    });

    it('thân yêu cầu thiếu/sai kiểu (thiếu giá ra, unit lạ, effectiveFrom không phải ngày giờ) → 4xx, không thêm dòng', async () => {
      const { agent } = await newAdmin();
      const m = await baselineModel();
      const missingOutput: Record<string, unknown> = priceBody(m);
      delete missingOutput.outputPerMTok;
      for (const bad of [
        missingOutput,
        priceBody(m, { unit: 'bogus' }),
        priceBody(m, { effectiveFrom: 'hôm qua' }),
        priceBody(m, { inputPerMTok: 1.5 }),
        priceBody(m, { inputPerMTok: '2000000' }),
        priceBody(m, { provider: '' }),
      ]) {
        expectRejected(await agent.post(`${BASE}/prices`, bad));
      }
      expect(await priceRows(m)).toHaveLength(1);
    });
  });

  // ------------------------------------------------------------------------------------------------------------
  // PUT /admin/ai/settings
  // ------------------------------------------------------------------------------------------------------------
  describe('PUT /admin/ai/settings', () => {
    interface SettingsRow {
      account_cap_micro_usd: string;
      account_soft_limit_micro_usd: string;
      per_industry_weekly_micro_usd: string;
    }
    const settingsRow = () =>
      asOwner(
        async (c) =>
          (
            await c.query<SettingsRow>(
              `SELECT account_cap_micro_usd::text, account_soft_limit_micro_usd::text,
                      per_industry_weekly_micro_usd::text FROM ai_gateway.ai_settings WHERE id = 1`,
            )
          ).rows[0]!,
      );
    const restore = (s: SettingsRow) =>
      asOwner((c) =>
        c.query(
          `UPDATE ai_gateway.ai_settings
              SET account_cap_micro_usd = $1, account_soft_limit_micro_usd = $2, per_industry_weekly_micro_usd = $3`,
          [
            s.account_cap_micro_usd,
            s.account_soft_limit_micro_usd,
            s.per_industry_weekly_micro_usd,
          ],
        ),
      );

    it('soft ≥ cap → AI_SETTINGS_INVALID (cả giá trị gộp với cấu hình hiện có); không đổi gì, không kiểm toán', async () => {
      const { agent, id } = await newAdmin();
      const before = await settingsRow();
      for (const bad of [
        { accountCapMicroUsd: 3_000_000, accountSoftLimitMicroUsd: 3_000_000 }, // bằng
        { accountCapMicroUsd: 3_000_000, accountSoftLimitMicroUsd: 3_500_000 }, // lớn hơn
        { accountSoftLimitMicroUsd: Number(before.account_cap_micro_usd) }, // chỉ soft: = cap hiện có
        { accountCapMicroUsd: Number(before.account_soft_limit_micro_usd) }, // chỉ cap: = soft hiện có
        { accountCapMicroUsd: 1_000_000 }, // cap thấp hơn soft hiện có
      ]) {
        expectDomainError(await agent.put(`${BASE}/settings`, bad), 'AI_SETTINGS_INVALID');
      }
      expect(await settingsRow()).toEqual(before);
      expect(await audit('ai.settings.change', id)).toHaveLength(0);
    });

    it('giá trị không nguyên dương / sai kiểu / thân rỗng → bị từ chối, không đổi gì', async () => {
      const { agent, id } = await newAdmin();
      const before = await settingsRow();
      for (const bad of [
        { accountCapMicroUsd: 0 },
        { accountCapMicroUsd: -4_000_000 },
        { accountSoftLimitMicroUsd: 0 },
        { perIndustryWeeklyMicroUsd: 0 },
        { perIndustryWeeklyMicroUsd: 1.5 },
        { accountCapMicroUsd: '4000000' },
        { accountCapMicroUsd: 4_000_000, unknownField: 1 },
        {},
      ]) {
        expectRejected(await agent.put(`${BASE}/settings`, bad));
      }
      expect(await settingsRow()).toEqual(before);
      expect(await audit('ai.settings.change', id)).toHaveLength(0);
    });

    it('đổi hợp lệ: ghi cấu hình, kiểm toán {field, old, new} mỗi trường đổi; chu kỳ đã tạo giữ nguyên trần cũ', async () => {
      const { agent, id } = await newAdmin();
      const before = await settingsRow();
      // Một dòng ngân sách đã có (chụp trần lúc tạo) KHÔNG đổi theo cấu hình mới (áp cho chu kỳ tạo sau).
      const accountId = owner.me.account.id;
      await asOwner((c) =>
        c.query(
          `INSERT INTO ai_gateway.ai_budgets (id, account_id, cycle_start, cycle_end, cap, soft_limit)
           VALUES (gen_random_uuid(), $1, '2020-02-01', '2020-03-01', 4000000, 2000000)
           ON CONFLICT (account_id, cycle_start) DO NOTHING`,
          [accountId],
        ),
      );
      try {
        const res = await agent.put(`${BASE}/settings`, {
          accountCapMicroUsd: 5_000_000,
          accountSoftLimitMicroUsd: 2_500_000,
          perIndustryWeeklyMicroUsd: 1_500_000,
        });
        expectOk(res);
        expect(await settingsRow()).toEqual({
          account_cap_micro_usd: '5000000',
          account_soft_limit_micro_usd: '2500000',
          per_industry_weekly_micro_usd: '1500000',
        });
        const events = await audit('ai.settings.change', id);
        expect(events).toHaveLength(3);
        const byField = (re: RegExp) => events.find((e) => re.test(String(e.metadata?.field)));
        // Số tiền trong metadata có thể là số hoặc chuỗi số nguyên: so theo giá trị.
        const values = (re: RegExp) => {
          const meta = byField(re)?.metadata;
          return [Number(meta?.old), Number(meta?.new)];
        };
        expect(values(/cap/i)).toEqual([4_000_000, 5_000_000]);
        expect(values(/soft/i)).toEqual([2_000_000, 2_500_000]);
        expect(values(/industry/i)).toEqual([
          Number(before.per_industry_weekly_micro_usd),
          1_500_000,
        ]);
        expect(events.every((e) => e.actor_type === 'admin')).toBe(true);
        const snapshot = await asOwner(
          async (c) =>
            (
              await c.query<{ cap: string; soft_limit: string }>(
                `SELECT cap::text, soft_limit::text FROM ai_gateway.ai_budgets
                  WHERE account_id = $1 AND cycle_start = '2020-02-01'`,
                [accountId],
              )
            ).rows[0],
        );
        expect(snapshot).toEqual({ cap: '4000000', soft_limit: '2000000' });
      } finally {
        await restore(before);
        await asOwner((c) =>
          c.query(
            `DELETE FROM ai_gateway.ai_budgets WHERE account_id = $1 AND cycle_start = '2020-02-01'`,
            [accountId],
          ),
        );
      }
    });
  });

  // ------------------------------------------------------------------------------------------------------------
  // PUT /admin/ai/routes, PUT /admin/ai/task-fallback
  // ------------------------------------------------------------------------------------------------------------
  describe('PUT /admin/ai/routes', () => {
    const routeRows = (tier: string, rank: number) =>
      asOwner(
        async (c) =>
          (
            await c.query<{
              provider: string;
              model_id: string;
              enabled: boolean;
              updated_by: string;
            }>(
              'SELECT provider, model_id, enabled, updated_by FROM ai_gateway.model_routes WHERE tier = $1 AND rank = $2',
              [tier, rank],
            )
          ).rows,
      );
    const cleanup = () =>
      asOwner((c) =>
        c.query(`DELETE FROM ai_gateway.model_routes WHERE tier = 'stt' AND rank = 2`),
      );

    it('rank ∉ {1,2}, bậc lạ → bị từ chối (rank → AI_ROUTE_INVALID); không đổi bảng tuyến', async () => {
      const { agent, id } = await newAdmin();
      const m = await baselineModel('audio_minute');
      const countAll = () =>
        asOwner(
          async (c) =>
            (
              await c.query<{ n: string }>(
                'SELECT count(*)::text AS n FROM ai_gateway.model_routes',
              )
            ).rows[0]!.n,
        );
      const before = await countAll();
      for (const rank of [0, 3, -1, 99]) {
        const res = await agent.put(`${BASE}/routes`, {
          tier: 'stt',
          rank,
          provider: m.provider,
          modelId: m.modelId,
          enabled: true,
        });
        expectDomainError(res, 'AI_ROUTE_INVALID');
      }
      expectRejected(
        await agent.put(`${BASE}/routes`, {
          tier: 'bogus',
          rank: 1,
          provider: m.provider,
          modelId: m.modelId,
          enabled: true,
        }),
      );
      expect(await countAll()).toBe(before);
      expect(await audit('ai.route.change', id)).toHaveLength(0);
    });

    it('mô hình chưa có dòng giá nào → AI_ROUTE_INVALID (không cho trỏ tuyến vào mô hình không có giá)', async () => {
      const { agent, id } = await newAdmin();
      const noPrice = uniqueModel('noprice');
      const res = await agent.put(`${BASE}/routes`, {
        tier: 'stt',
        rank: 2,
        provider: noPrice.provider,
        modelId: noPrice.modelId,
        enabled: true,
      });
      expectDomainError(res, 'AI_ROUTE_INVALID');
      expect(await routeRows('stt', 2)).toHaveLength(0);
      expect(await audit('ai.route.change', id)).toHaveLength(0);
    });

    it('mô hình có giá (kể cả chỉ có dòng hiệu lực tương lai) → ghi tuyến + kiểm toán ai.route.change; cập nhật cùng khóa (tier, rank) không nhân đôi', async () => {
      const { agent, id } = await newAdmin();
      const priced = await baselineModel('audio_minute');
      const futureOnly = uniqueModel('future');
      await insertPrice(futureOnly, {
        unit: 'audio_minute',
        effectiveFrom: new Date(Date.now() + 60 * MIN),
      });
      try {
        expectOk(
          await agent.put(`${BASE}/routes`, {
            tier: 'stt',
            rank: 2,
            provider: priced.provider,
            modelId: priced.modelId,
            enabled: false,
          }),
        );
        expect(await routeRows('stt', 2)).toEqual([
          { provider: priced.provider, model_id: priced.modelId, enabled: false, updated_by: id },
        ]);
        expectOk(
          await agent.put(`${BASE}/routes`, {
            tier: 'stt',
            rank: 2,
            provider: futureOnly.provider,
            modelId: futureOnly.modelId,
            enabled: false,
          }),
        );
        expect(await routeRows('stt', 2)).toEqual([
          {
            provider: futureOnly.provider,
            model_id: futureOnly.modelId,
            enabled: false,
            updated_by: id,
          },
        ]);
        const events = await audit('ai.route.change', id);
        expect(events).toHaveLength(2);
        expect(events[0]!.actor_type).toBe('admin');
        expect(JSON.stringify(events[1]!.metadata)).toContain(futureOnly.modelId);
        expect(JSON.stringify(events[1]!.metadata)).toContain(priced.modelId); // giá trị cũ
      } finally {
        await cleanup();
      }
    });
  });

  describe('PUT /admin/ai/task-fallback', () => {
    const fallbackOf = (task: string) =>
      asOwner(
        async (c) =>
          (
            await c.query<{ enabled: boolean }>(
              'SELECT enabled FROM ai_gateway.task_fallback WHERE task = $1',
              [task],
            )
          ).rows[0]?.enabled,
      );

    it('task lạ → bị từ chối; bật cho loại việc mà bậc không có tuyến rank 2 (transcription → stt) → AI_ROUTE_INVALID', async () => {
      const { agent, id } = await newAdmin();
      expectRejected(await agent.put(`${BASE}/task-fallback`, { task: 'bogus', enabled: true }));
      const before = await fallbackOf('transcription');
      const res = await agent.put(`${BASE}/task-fallback`, {
        task: 'transcription',
        enabled: true,
      });
      expectDomainError(res, 'AI_ROUTE_INVALID');
      expect(await fallbackOf('transcription')).toBe(before);
      expect(await audit('ai.task_fallback.change', id)).toHaveLength(0);
    });

    it('bật cho loại việc có tuyến rank 2 (image_labeling → cheap_vision) ghi cấu hình + kiểm toán; tắt luôn hợp lệ', async () => {
      const { agent, id } = await newAdmin();
      const original = await fallbackOf('image_labeling');
      try {
        expectOk(
          await agent.put(`${BASE}/task-fallback`, { task: 'image_labeling', enabled: true }),
        );
        expect(await fallbackOf('image_labeling')).toBe(true);
        expectOk(
          await agent.put(`${BASE}/task-fallback`, { task: 'image_labeling', enabled: false }),
        );
        expect(await fallbackOf('image_labeling')).toBe(false);
        const events = await audit('ai.task_fallback.change', id);
        expect(events).toHaveLength(2);
        expect(JSON.stringify(events[0]!.metadata)).toContain('image_labeling');
        expect(events[0]!.actor_type).toBe('admin');
      } finally {
        await asOwner((c) =>
          c.query('UPDATE ai_gateway.task_fallback SET enabled = $2 WHERE task = $1', [
            'image_labeling',
            original ?? false,
          ]),
        );
      }
    });
  });

  // ------------------------------------------------------------------------------------------------------------
  // POST /admin/ai/provider-invoices
  // ------------------------------------------------------------------------------------------------------------
  describe('POST /admin/ai/provider-invoices', () => {
    const invoiceRows = (provider: string) =>
      asOwner(
        async (c) =>
          (
            await c.query<{ invoice_date: string; total_micro_usd: string; entered_by: string }>(
              `SELECT invoice_date::text, total_micro_usd::text, entered_by
                 FROM ai_gateway.provider_invoices WHERE provider = $1 ORDER BY invoice_date`,
              [provider],
            )
          ).rows,
      );

    it('nhập hóa đơn; nhập lại cùng (provider, ngày) thay thế kèm kiểm toán giá trị cũ/mới; tổng < 0 bị từ chối', async () => {
      const { agent, id } = await newAdmin();
      const provider = uniqueModel().provider;
      expectOk(
        await agent.post(`${BASE}/provider-invoices`, {
          provider,
          invoiceDate: '2026-11-01',
          totalMicroUsd: 1_234_567,
        }),
      );
      expect(await invoiceRows(provider)).toEqual([
        { invoice_date: '2026-11-01', total_micro_usd: '1234567', entered_by: id },
      ]);
      expectOk(
        await agent.post(`${BASE}/provider-invoices`, {
          provider,
          invoiceDate: '2026-11-01',
          totalMicroUsd: 2_000_000,
        }),
      );
      expect(await invoiceRows(provider)).toEqual([
        { invoice_date: '2026-11-01', total_micro_usd: '2000000', entered_by: id },
      ]);
      expectOk(
        await agent.post(`${BASE}/provider-invoices`, {
          provider,
          invoiceDate: '2026-11-02',
          totalMicroUsd: 0,
        }),
      );
      expect(await invoiceRows(provider)).toHaveLength(2);

      const events = await audit('ai.invoice.enter', id);
      expect(events).toHaveLength(3);
      const replaced = JSON.stringify(events[1]!.metadata);
      expect(replaced).toContain('1234567'); // giá trị cũ
      expect(replaced).toContain('2000000'); // giá trị mới

      for (const bad of [
        { provider, invoiceDate: '2026-11-03', totalMicroUsd: -1 },
        { provider, invoiceDate: '2026-11-03', totalMicroUsd: 1.5 },
        { provider, invoiceDate: 'không-phải-ngày', totalMicroUsd: 1 },
        { provider: '', invoiceDate: '2026-11-03', totalMicroUsd: 1 },
      ]) {
        expectRejected(await agent.post(`${BASE}/provider-invoices`, bad));
      }
      expect(await invoiceRows(provider)).toHaveLength(2);
      expect(await audit('ai.invoice.enter', id)).toHaveLength(3);
    });
  });

  // ------------------------------------------------------------------------------------------------------------
  // Ghi cấu hình và kiểm toán CÙNG MỘT giao dịch (contracts/admin-ops.md mục 2; hiến chương VIII)
  // ------------------------------------------------------------------------------------------------------------
  describe('cùng một giao dịch: kiểm toán lỗi → hoàn tác cả cấu hình', () => {
    const TRIGGER = 'qa_block_ai_audit';
    const arm = () =>
      asOwner(async (c) => {
        await c.query(`
          CREATE OR REPLACE FUNCTION infra.${TRIGGER}() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION 'qa: chặn kiểm toán ai.*'; END $$`);
        await c.query(`
          CREATE TRIGGER ${TRIGGER} BEFORE INSERT ON infra.audit_log
            FOR EACH ROW WHEN (NEW.action LIKE 'ai.%') EXECUTE FUNCTION infra.${TRIGGER}()`);
      });
    const disarm = () =>
      asOwner(async (c) => {
        await c.query(`DROP TRIGGER IF EXISTS ${TRIGGER} ON infra.audit_log`);
        await c.query(`DROP FUNCTION IF EXISTS infra.${TRIGGER}()`);
      });

    it('ghi kiểm toán ai.* bị lỗi → 5xx và KHÔNG có dòng giá/hóa đơn/tuyến/cài đặt nào được lưu', async () => {
      const { agent, id } = await newAdmin();
      const m = await baselineModel('audio_minute');
      const inv = uniqueModel().provider;
      const settingsSql = `SELECT account_cap_micro_usd::text, account_soft_limit_micro_usd::text,
                      per_industry_weekly_micro_usd::text FROM ai_gateway.ai_settings`;
      const fallbackSql = 'SELECT task, enabled FROM ai_gateway.task_fallback ORDER BY task';
      const rowsOf = (sql: string, params: unknown[] = []): Promise<unknown[]> =>
        asOwner(async (c) => (await c.query<Record<string, unknown>>(sql, params)).rows);
      const settingsBefore = await rowsOf(settingsSql);
      const fallbackBefore = await rowsOf(fallbackSql);
      await arm();
      try {
        const results = [
          await agent.post(`${BASE}/prices`, {
            provider: m.provider,
            modelId: m.modelId,
            unit: 'audio_minute',
            perMinute: 7_000,
            effectiveFrom: effectiveAfterTtl(),
          }),
          await agent.put(`${BASE}/settings`, { perIndustryWeeklyMicroUsd: 3_333_333 }),
          await agent.put(`${BASE}/routes`, {
            tier: 'stt',
            rank: 2,
            provider: m.provider,
            modelId: m.modelId,
            enabled: false,
          }),
          await agent.put(`${BASE}/task-fallback`, { task: 'image_labeling', enabled: true }),
          await agent.post(`${BASE}/provider-invoices`, {
            provider: inv,
            invoiceDate: '2026-11-01',
            totalMicroUsd: 5,
          }),
        ];
        for (const [i, res] of results.entries()) {
          expect(res.status, `điểm cuối #${i}: ${JSON.stringify(res.body)}`).toBeGreaterThanOrEqual(
            500,
          );
        }
      } finally {
        await disarm();
      }
      expect(await priceRows(m)).toHaveLength(1);
      const routes = await rowsOf(
        `SELECT 1 FROM ai_gateway.model_routes WHERE tier = 'stt' AND rank = 2`,
      );
      const invoices = await rowsOf(
        'SELECT 1 FROM ai_gateway.provider_invoices WHERE provider = $1',
        [inv],
      );
      expect(routes).toHaveLength(0);
      expect(invoices).toHaveLength(0);
      expect(await rowsOf(settingsSql)).toEqual(settingsBefore);
      expect(await rowsOf(fallbackSql)).toEqual(fallbackBefore);
      for (const action of [
        'ai.price.add',
        'ai.settings.change',
        'ai.route.change',
        'ai.task_fallback.change',
        'ai.invoice.enter',
      ]) {
        expect(await audit(action, id), action).toHaveLength(0);
      }
    });
  });
});
