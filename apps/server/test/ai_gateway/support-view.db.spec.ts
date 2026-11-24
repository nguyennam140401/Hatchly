import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { collaboratorOf, staffAgent } from '../auth/helpers/actors';
import { createTestApp, registerAndVerify, type Agent, type TestApp } from '../auth/helpers/app';
import { asOwner, describeDb } from '../db/helpers/db';
import { addDays, localToday } from './helpers/alerts-fixtures';

// 015 US8 T065 (FR-018, FR-035, contracts/admin-ops.md mục 3; hiến chương I và III): điểm cuối xem chi phí AI dành cho
// nhân viên, qua HTTP/Nest THẬT (khuôn test/auth/staff.e2e.spec.ts và test/e2e/channels-staff.e2e.spec.ts).
// Viết TRƯỚC mã (T068): ĐỎ tạm vì chưa có `internal/admin/support.controller.ts` (cả hai điểm cuối hiện trả 404).
//
// Hình dạng phản hồi đặt cho T068 (tiền là micro-USD nguyên; tên trường camelCase; phản hồi chỉ cho nhân viên):
//  GET /api/v1/support/ai/budget/:accountId?reason=…  →  200
//    { used, reserved, cap, softLimit, state: 'normal'|'cheap_model'|'blocked',
//      ledger: [{ task, modelId, provider, inputTokens, outputTokens, costMicroUsd, anomaly }]   (mới nhất trước),
//      trendAllocations: [{ weekStart, industryId, costMicroUsd }] }                             (của chu kỳ hiện hành)
//  GET /api/v1/support/ai/summary?cycle=YYYY-MM-DD (ngày bắt đầu chu kỳ) → 200
//    { cycle, totalMicroUsd, accounts, averagePerAccountMicroUsd, averagePerPostMicroUsd,
//      byTask: [{ task, calls, costMicroUsd }], byProvider: [{ provider, calls, costMicroUsd }],
//      byModel: [{ provider, modelId, calls, costMicroUsd }] }   – KHÔNG có mã tài khoản nào (FR-018).
//  `averagePerPost` = chi phí các dòng sổ `post_generation` (đã quyết toán = có dòng sổ) / số dòng đó.
// Lý do tối thiểu của `supportViewAccount` là 5 ký tự (core/db/support.ts); thiếu/ngắn → 400 trước khi đọc và ghi kiểm toán.

const BUDGET = (accountId: string, reason?: string): string =>
  `/api/v1/support/ai/budget/${accountId}${reason === undefined ? '' : `?reason=${encodeURIComponent(reason)}`}`;
const SUMMARY = (cycle: string): string =>
  `/api/v1/support/ai/summary?cycle=${encodeURIComponent(cycle)}`;
const REASON = 'Khách hỏi vì sao bị chuyển mô hình rẻ';

interface LedgerItem {
  task: string;
  modelId: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  anomaly: string | null;
}
interface BudgetBody {
  used: number;
  reserved: number;
  cap: number;
  softLimit: number;
  state: string;
  ledger: LedgerItem[];
  trendAllocations: { weekStart: string; industryId: string; costMicroUsd: number }[];
}
interface SummaryBody {
  cycle: string;
  totalMicroUsd: number;
  accounts: number;
  averagePerAccountMicroUsd: number;
  averagePerPostMicroUsd: number;
  byTask: { task: string; calls: number; costMicroUsd: number }[];
  byProvider: { provider: string; calls: number; costMicroUsd: number }[];
  byModel: { provider: string; modelId: string; calls: number; costMicroUsd: number }[];
}

// Số tiền đặc trưng để quét nhật ký truy cập (không được xuất hiện ở đó).
const USED = 3_141_592;
const COSTS_X = [111_111, 222_222, 333_333]; // mới nhất → cũ nhất
const COSTS_Y = [999_001, 999_002];
const TREND_X = 55_555;
const SENTINELS = [USED, ...COSTS_X, TREND_X].map(String);

const SUMMARY_CYCLE = '2031-03-01';
const OTHER_CYCLE = '2031-04-01';

describeDb('Hỗ trợ xem chi phí AI (HTTP, 015 US8)', () => {
  let t: TestApp;
  let owner: Awaited<ReturnType<typeof registerAndVerify>>;
  let other: Awaited<ReturnType<typeof registerAndVerify>>;
  let collaborator: Agent;
  let anonymous: Agent;
  let support: { agent: Agent; id: string };
  let admin: { agent: Agent; id: string };
  let x: string;
  let y: string;

  async function seedAccount(
    accountId: string,
    cycle: { start: string; end: string },
    older: { start: string; end: string },
    costs: number[],
    withTrend: number | null,
  ): Promise<void> {
    await asOwner(async (c) => {
      await c.query(
        `INSERT INTO ai_gateway.ai_budgets (id, account_id, cycle_start, cycle_end, used, reserved, cap, soft_limit)
         VALUES ($1, $2, $3::date, $4::date, $5, 0, 4000000, 2000000),
                ($6, $2, $7::date, $8::date, 1000, 0, 4000000, 2000000)`,
        [uuidV7(), accountId, cycle.start, cycle.end, USED, uuidV7(), older.start, older.end],
      );
      const tasks = ['post_generation', 'topic_suggestion', 'image_labeling'];
      const tiers = ['default', 'cheap', 'cheap_vision'];
      for (const [i, cost] of costs.entries()) {
        await c.query(
          `INSERT INTO ai_gateway.ai_cost_ledger
             (id, account_id, cycle_start, reservation_id, task, model_tier, model_id, provider,
              input_tokens, output_tokens, cost_micro_usd, estimate_micro_usd, anomaly, created_at)
           VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, 120, 80, $9, $9, $10, now() - ($11 || ' minutes')::interval)`,
          [
            uuidV7(),
            accountId,
            cycle.start,
            uuidV7(),
            tasks[i % 3],
            tiers[i % 3],
            `qa-model-${i}`,
            i % 2 === 0 ? 'anthropic' : 'openai',
            cost,
            i === 1 ? 'over_estimate' : null,
            String(i + 1),
          ],
        );
      }
      if (withTrend !== null) {
        await c.query(
          `INSERT INTO ai_gateway.ai_trend_allocations
             (id, account_id, week_start, industry_id, cost_micro_usd, shared_ledger_id)
           VALUES ($1, $2, $3::date, $4, $5, $6)`,
          [uuidV7(), accountId, cycle.start, uuidV7(), withTrend, uuidV7()],
        );
      }
    });
  }

  beforeAll(async () => {
    t = await createTestApp({});
    owner = await registerAndVerify(t);
    other = await registerAndVerify(t);
    collaborator = (await collaboratorOf(t, owner.me)).agent;
    anonymous = t.agent();
    support = await staffAgent(t, 'support');
    admin = await staffAgent(t, 'admin');
    x = owner.me.account.id;
    y = other.me.account.id;

    const today = await localToday();
    const cycle = { start: addDays(today, -3), end: addDays(today, 27) };
    const older = { start: addDays(today, -33), end: addDays(today, -3) };
    await seedAccount(x, cycle, older, COSTS_X, TREND_X);
    await seedAccount(y, cycle, older, COSTS_Y, 77_777);
  });
  afterAll(async () => {
    await asOwner(async (c) => {
      for (const sql of [
        'DELETE FROM ai_gateway.ai_cost_ledger WHERE account_id = ANY($1) OR cycle_start = ANY($2::date[])',
        'DELETE FROM ai_gateway.ai_trend_allocations WHERE account_id = ANY($1)',
        'DELETE FROM ai_gateway.ai_budgets WHERE account_id = ANY($1)',
      ]) {
        await c.query(
          sql,
          sql.includes('$2')
            ? [
                [x, y],
                [SUMMARY_CYCLE, OTHER_CYCLE],
              ]
            : [[x, y]],
        );
      }
    });
    await t.close();
  });

  const audit = (actorId: string, accountId: string) =>
    asOwner(
      async (c) =>
        (
          await c.query<{ action: string; reason: string | null; metadata: unknown }>(
            `SELECT action, reason, metadata FROM infra.audit_log
              WHERE actor_id = $1 AND account_id = $2 AND action = 'support.view_account' ORDER BY occurred_at, id`,
            [actorId, accountId],
          )
        ).rows,
    );

  // ------------------------------------------------------------------------------------------------------------
  // Quyền
  // ------------------------------------------------------------------------------------------------------------
  describe('phân quyền (ai.cost.view: support, admin; không phải khách)', () => {
    it('khách (chủ, cộng tác viên) và người chưa đăng nhập → 401/403 ở cả hai điểm cuối, không đọc được số tiền', async () => {
      for (const [label, who] of [
        ['chủ', owner.agent],
        ['cộng tác viên', collaborator],
        ['ẩn danh', anonymous],
      ] as const) {
        for (const path of [BUDGET(x, REASON), SUMMARY(SUMMARY_CYCLE)]) {
          const res = await who.get(path);
          expect([401, 403], `${label} ${path} → ${res.status}`).toContain(res.status);
          const text = JSON.stringify(res.body);
          for (const s of SENTINELS) expect(text).not.toContain(s);
        }
      }
      // Khách bị chặn nên tuyệt đối không có dòng kiểm toán xem tài khoản.
      expect(await audit(owner.me.user.id, x)).toEqual([]);
    });

    it('support và admin có ai.cost.view → 200', async () => {
      expect((await support.agent.get(BUDGET(x, REASON))).status).toBe(200);
      expect((await admin.agent.get(BUDGET(x, REASON))).status).toBe(200);
      expect((await support.agent.get(SUMMARY(SUMMARY_CYCLE))).status).toBe(200);
      expect((await admin.agent.get(SUMMARY(SUMMARY_CYCLE))).status).toBe(200);
    });
  });

  // ------------------------------------------------------------------------------------------------------------
  // GET /support/ai/budget/:accountId
  // ------------------------------------------------------------------------------------------------------------
  describe('GET /support/ai/budget/:accountId?reason=…', () => {
    it('thiếu, quá ngắn hoặc chỉ khoảng trắng → 400, không đọc dữ liệu, không ghi kiểm toán', async () => {
      const staff = await staffAgent(t, 'support');
      for (const path of [BUDGET(x), BUDGET(x, ''), BUDGET(x, 'abc'), BUDGET(x, '      ')]) {
        const res = await staff.agent.get(path);
        expect(res.status, path).toBe(400);
        const text = JSON.stringify(res.body);
        for (const s of SENTINELS) expect(text).not.toContain(s);
      }
      expect(await audit(staff.id, x)).toEqual([]);
    });

    it('mã tài khoản không hợp lệ → 400; tài khoản không tồn tại → 4xx (không 5xx, không đọc gì)', async () => {
      const staff = await staffAgent(t, 'support');
      expect((await staff.agent.get(BUDGET('khong-phai-uuid', REASON))).status).toBe(400);
      const missing = await staff.agent.get(BUDGET(uuidV7(), REASON));
      expect(missing.status).toBeGreaterThanOrEqual(400);
      expect(missing.status).toBeLessThan(500);
      expect([401, 403]).not.toContain(missing.status);
    });

    it('xem được chi tiết: used/reserved/cap/softLimit/state, sổ mới nhất trước, chi phí xu hướng; chỉ chu kỳ hiện hành', async () => {
      const res = await support.agent.get(BUDGET(x, REASON));
      expect(res.status).toBe(200);
      const body = res.body as BudgetBody;
      // Chu kỳ hiện hành (không phải dòng ngân sách cũ có used = 1000).
      expect(body).toMatchObject({
        used: USED,
        reserved: 0,
        cap: 4_000_000,
        softLimit: 2_000_000,
        state: 'cheap_model',
      });
      expect(body.ledger.map((l) => l.costMicroUsd)).toEqual(COSTS_X);
      expect(body.ledger[0]).toMatchObject({
        task: 'post_generation',
        provider: 'anthropic',
        modelId: 'qa-model-0',
        inputTokens: 120,
        outputTokens: 80,
        anomaly: null,
      });
      expect(body.ledger[1]).toMatchObject({ anomaly: 'over_estimate', provider: 'openai' });
      expect(body.trendAllocations.map((a) => a.costMicroUsd)).toEqual([TREND_X]);
    });

    it('chỉ thấy đúng tài khoản được xem: X không lẫn dữ liệu Y và ngược lại', async () => {
      const resX = await support.agent.get(BUDGET(x, REASON));
      const resY = await support.agent.get(BUDGET(y, REASON));
      const textX = JSON.stringify(resX.body);
      const textY = JSON.stringify(resY.body);
      for (const c of COSTS_Y) expect(textX).not.toContain(String(c));
      expect(textX).not.toContain('77777');
      for (const c of COSTS_X) expect(textY).not.toContain(String(c));
      expect((resY.body as BudgetBody).ledger.map((l) => l.costMicroUsd)).toEqual(
        COSTS_Y.slice(0, 2),
      );
      expect((resY.body as BudgetBody).trendAllocations.map((a) => a.costMicroUsd)).toEqual([
        77_777,
      ]);
    });

    it('mỗi lần xem ghi đúng một dòng support.view_account kèm lý do (đã cắt khoảng trắng), mã nhân viên và mã tài khoản', async () => {
      const staff = await staffAgent(t, 'support');
      expect(await audit(staff.id, x)).toEqual([]);
      expect((await staff.agent.get(BUDGET(x, `  ${REASON}  `))).status).toBe(200);
      let rows = await audit(staff.id, x);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: 'support.view_account', reason: REASON });
      expect((await staff.agent.get(BUDGET(x, 'Kiểm tra lại cùng khách'))).status).toBe(200);
      rows = await audit(staff.id, x);
      expect(rows.map((r) => r.reason)).toEqual([REASON, 'Kiểm tra lại cùng khách']);
      // Xem tài khoản khác không ghi vào dòng của X.
      expect((await staff.agent.get(BUDGET(y, REASON))).status).toBe(200);
      expect(await audit(staff.id, x)).toHaveLength(2);
      expect(await audit(staff.id, y)).toHaveLength(1);
    });

    it('nhật ký truy cập chung (kiểm toán + nhật ký ứng dụng) ghi mã tài khoản/nhân viên nhưng KHÔNG ghi số tiền', async () => {
      const staff = await staffAgent(t, 'support');
      const before = t.rawLogs.length;
      expect((await staff.agent.get(BUDGET(x, REASON))).status).toBe(200);
      const rows = await audit(staff.id, x);
      expect(rows).toHaveLength(1);
      const auditText = JSON.stringify(rows);
      const appLogs = t.rawLogs.slice(before).join('\n');
      for (const s of SENTINELS) {
        expect(auditText, `kiểm toán lộ ${s}`).not.toContain(s);
        expect(appLogs, `nhật ký ứng dụng lộ ${s}`).not.toContain(s);
      }
    });

    it('điểm cuối đọc CHỈ qua supportViewAccount + ba khung nhìn support_ai_*, không đọc thẳng bảng gốc', () => {
      // Vai trò support không có quyền SELECT bảng gốc (đã kiểm ở support-views.db.spec.ts) nên đây là kiểm tĩnh cho ràng buộc
      // thiết kế của T068: không dùng đường tắt (vd owner/system) và không bỏ lý do/kiểm toán.
      const source = readFileSync(
        resolve(__dirname, '../../src/modules/ai_gateway/internal/admin/support.controller.ts'),
        'utf8',
      );
      expect(source).toContain('supportViewAccount');
      expect(source).toContain("StaffAccess('ai.cost.view')");
      for (const view of [
        'support_ai_budget_detail',
        'support_ai_cost_ledger',
        'support_ai_trend_allocations',
      ]) {
        expect(source).toContain(view);
      }
      expect(source).not.toMatch(
        /(FROM|JOIN)\s+ai_gateway\.ai_(budgets|cost_ledger|trend_allocations)\b/i,
      );
    });
  });

  // ------------------------------------------------------------------------------------------------------------
  // GET /support/ai/summary
  // ------------------------------------------------------------------------------------------------------------
  describe('GET /support/ai/summary?cycle=…', () => {
    const accountIds = [uuidV7(), uuidV7(), uuidV7()];

    beforeAll(async () => {
      const [a, b, c] = accountIds;
      const rows: [string, string, string, string, string, number][] = [
        // [tài khoản, chu kỳ, task, nhà cung cấp, mô hình, chi phí]
        [a!, SUMMARY_CYCLE, 'post_generation', 'anthropic', 'qa-sonnet', 100_000],
        [a!, SUMMARY_CYCLE, 'post_generation', 'anthropic', 'qa-sonnet', 300_000],
        [a!, SUMMARY_CYCLE, 'topic_suggestion', 'anthropic', 'qa-haiku', 50_000],
        [b!, SUMMARY_CYCLE, 'post_generation', 'openai', 'qa-gpt', 200_000],
        [b!, SUMMARY_CYCLE, 'image_labeling', 'openai', 'qa-gpt', 150_000],
        [c!, SUMMARY_CYCLE, 'transcription', 'qa-stt-prov', 'qa-stt', 30_000],
        // Chu kỳ khác: không được tính vào chu kỳ đang xem.
        [a!, OTHER_CYCLE, 'post_generation', 'anthropic', 'qa-sonnet', 999_000],
      ];
      const tier: Record<string, string> = {
        post_generation: 'default',
        topic_suggestion: 'cheap',
        image_labeling: 'cheap_vision',
        transcription: 'stt',
      };
      await asOwner(async (client) => {
        for (const [account, cycle, task, provider, model, cost] of rows) {
          await client.query(
            `INSERT INTO ai_gateway.ai_cost_ledger
               (id, account_id, cycle_start, reservation_id, task, model_tier, model_id, provider,
                cost_micro_usd, estimate_micro_usd)
             VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $9)`,
            [uuidV7(), account, cycle, uuidV7(), task, tier[task], model, provider, cost],
          );
        }
      });
    });

    it('tổng hợp theo loại việc, mô hình, nhà cung cấp; trung bình mỗi tài khoản và mỗi bài (post_generation); chỉ chu kỳ được chọn', async () => {
      const res = await support.agent.get(SUMMARY(SUMMARY_CYCLE));
      expect(res.status).toBe(200);
      const body = res.body as SummaryBody;
      expect(body.cycle).toBe(SUMMARY_CYCLE);
      expect(body.totalMicroUsd).toBe(830_000);
      expect(body.accounts).toBe(3);
      // 830.000 / 3 = 276.666,67 → số nguyên micro-USD (cắt hoặc làm tròn đều chấp nhận).
      expect(body.averagePerAccountMicroUsd).toBeGreaterThanOrEqual(276_666);
      expect(body.averagePerAccountMicroUsd).toBeLessThanOrEqual(276_667);
      expect(Number.isInteger(body.averagePerAccountMicroUsd)).toBe(true);
      // post_generation: 100.000 + 300.000 + 200.000 = 600.000 trên 3 bài.
      expect(body.averagePerPostMicroUsd).toBe(200_000);

      const sorted = <T extends object>(list: T[], key: keyof T) =>
        [...list].sort((p, q) => String(p[key]).localeCompare(String(q[key])));
      expect(sorted(body.byTask, 'task')).toEqual([
        { task: 'image_labeling', calls: 1, costMicroUsd: 150_000 },
        { task: 'post_generation', calls: 3, costMicroUsd: 600_000 },
        { task: 'topic_suggestion', calls: 1, costMicroUsd: 50_000 },
        { task: 'transcription', calls: 1, costMicroUsd: 30_000 },
      ]);
      expect(sorted(body.byProvider, 'provider')).toEqual([
        { provider: 'anthropic', calls: 3, costMicroUsd: 450_000 },
        { provider: 'openai', calls: 2, costMicroUsd: 350_000 },
        { provider: 'qa-stt-prov', calls: 1, costMicroUsd: 30_000 },
      ]);
      expect(sorted(body.byModel, 'modelId')).toEqual([
        { provider: 'openai', modelId: 'qa-gpt', calls: 2, costMicroUsd: 350_000 },
        { provider: 'anthropic', modelId: 'qa-haiku', calls: 1, costMicroUsd: 50_000 },
        { provider: 'anthropic', modelId: 'qa-sonnet', calls: 2, costMicroUsd: 400_000 },
        { provider: 'qa-stt-prov', modelId: 'qa-stt', calls: 1, costMicroUsd: 30_000 },
      ]);
    });

    it('chỉ số tổng hợp: không có mã tài khoản hay dữ liệu từng tài khoản nhận dạng được', async () => {
      const res = await support.agent.get(SUMMARY(SUMMARY_CYCLE));
      expect(res.status).toBe(200);
      const text = JSON.stringify(res.body);
      for (const id of accountIds) expect(text).not.toContain(id);
      expect(text).not.toMatch(/account_?id/i);
      // Cũng không rò mã tài khoản thật của hai chủ thử nghiệm.
      expect(text).not.toContain(x);
      expect(text).not.toContain(y);
    });

    it('chu kỳ không có dữ liệu → 200 với số 0 (không lỗi chia cho 0); cycle sai định dạng → 400', async () => {
      const empty = await support.agent.get(SUMMARY('2031-09-01'));
      expect(empty.status).toBe(200);
      expect(empty.body).toMatchObject({
        totalMicroUsd: 0,
        accounts: 0,
        averagePerAccountMicroUsd: 0,
        averagePerPostMicroUsd: 0,
        byTask: [],
        byProvider: [],
        byModel: [],
      });
      for (const bad of ['abc', '2031-13-40', '']) {
        const res = await support.agent.get(SUMMARY(bad));
        expect(res.status, bad).toBe(400);
      }
    });

    it('tổng hợp không chọn tài khoản nên không ghi support.view_account', async () => {
      const staff = await staffAgent(t, 'support');
      expect((await staff.agent.get(SUMMARY(SUMMARY_CYCLE))).status).toBe(200);
      const rows = await asOwner(
        async (c) =>
          (
            await c.query<{ one: number }>(
              "SELECT 1 AS one FROM infra.audit_log WHERE actor_id = $1 AND action = 'support.view_account'",
              [staff.id],
            )
          ).rows,
      );
      expect(rows).toEqual([]);
    });
  });
});
