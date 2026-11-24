import { Controller, Get, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireStaff, StaffAccess, ValidParam, ValidQuery } from '../../../../core';
import { supportViewAccount } from '../../../../core/db/support';
import { adminCostSummary, type CostSummary } from '../db/summary-functions';

// Hỗ trợ/quản trị xem chi phí AI (015 US8, FR-018, FR-035, contracts/admin-ops.md mục 3). Chỉ nhân viên có `ai.cost.view`
// (support, admin); chủ/cộng tác viên → 403. Đây là nơi DUY NHẤT số tiền chi phí AI ra ngoài (nhân viên nội bộ); khách không
// bao giờ thấy số tiền (hiến chương III). Mã tài khoản trong đường dẫn là ngoại lệ có chủ đích của hỗ trợ (hiến chương I):
// luôn kèm lý do, đọc qua `supportViewAccount` (ghi `support.view_account` cùng giao dịch, KHÔNG ghi số tiền vào kiểm toán) và CHỈ
// qua ba khung nhìn `ai_gateway.support_ai_*` (không đọc thẳng bảng gốc).

const accountParam = z.strictObject({ accountId: z.uuid() });
const reasonQuery = z.strictObject({ reason: z.string().trim().min(5).max(500) });

const isRealDate = (s: string): boolean => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
};
const cycleQuery = z.strictObject({
  cycle: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isRealDate, 'Ngày không hợp lệ'),
});

/** Số dòng sổ gần nhất trả về cho một lần xem. */
const LEDGER_LIMIT = 50;
const TREND_LIMIT = 20;

export type AiBudgetState = 'normal' | 'cheap_model' | 'blocked';

export interface SupportBudgetView {
  used: number;
  reserved: number;
  cap: number | null;
  softLimit: number | null;
  state: AiBudgetState;
  ledger: {
    task: string;
    modelId: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    audioSeconds: number | null;
    costMicroUsd: number;
    anomaly: string | null;
    createdAt: string;
  }[];
  trendAllocations: { weekStart: string; industryId: string; costMicroUsd: number }[];
}

const num = (v: unknown): number => Number(v ?? 0);
const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
const dateText = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

/** Trạng thái hiển thị cho nhân viên: ≥ trần → blocked; ≥ ngưỡng mềm → cheap_model. */
export function budgetState(
  used: number,
  reserved: number,
  cap: number,
  soft: number,
): AiBudgetState {
  const spent = used + reserved;
  if (spent >= cap) return 'blocked';
  return spent >= soft ? 'cheap_model' : 'normal';
}

@Controller('support/ai')
export class AiSupportController {
  @Get('budget/:accountId')
  @StaffAccess('ai.cost.view')
  async budget(
    @ValidParam(accountParam) params: z.infer<typeof accountParam>,
    @ValidQuery(reasonQuery) query: z.infer<typeof reasonQuery>,
  ): Promise<SupportBudgetView> {
    const staff = requireStaff();
    return supportViewAccount(
      { staffId: staff.staffId },
      params.accountId,
      query.reason,
      async (db): Promise<SupportBudgetView> => {
        // Ngữ cảnh tài khoản do supportViewAccount đặt; mọi khung nhìn đã lọc theo account.current_account_id().
        const [budget] = (
          await db.execute(
            sql`SELECT cycle_start, cycle_end, used, reserved, cap, soft_limit
                  FROM ai_gateway.support_ai_budget_detail
                 WHERE cycle_start <= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
                   AND cycle_end > (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
                 ORDER BY cycle_start DESC
                 LIMIT 1`,
          )
        ).rows;
        if (budget === undefined) {
          return {
            used: 0,
            reserved: 0,
            cap: null,
            softLimit: null,
            state: 'normal',
            ledger: [],
            trendAllocations: [],
          };
        }
        const cycleStart = dateText(budget.cycle_start);
        const cycleEnd = dateText(budget.cycle_end);
        const ledger = (
          await db.execute(
            sql`SELECT task, model_id, provider, input_tokens, output_tokens, audio_seconds,
                       cost_micro_usd, anomaly, created_at
                  FROM ai_gateway.support_ai_cost_ledger
                 WHERE cycle_start = ${cycleStart}::date
                 ORDER BY created_at DESC, id DESC
                 LIMIT ${LEDGER_LIMIT}`,
          )
        ).rows;
        const trends = (
          await db.execute(
            sql`SELECT week_start, industry_id, cost_micro_usd
                  FROM ai_gateway.support_ai_trend_allocations
                 WHERE week_start >= ${cycleStart}::date AND week_start < ${cycleEnd}::date
                 ORDER BY week_start DESC, id DESC
                 LIMIT ${TREND_LIMIT}`,
          )
        ).rows;
        const used = num(budget.used);
        const reserved = num(budget.reserved);
        const cap = num(budget.cap);
        const softLimit = num(budget.soft_limit);
        return {
          used,
          reserved,
          cap,
          softLimit,
          state: budgetState(used, reserved, cap, softLimit),
          ledger: ledger.map((r) => ({
            task: String(r.task),
            modelId: String(r.model_id),
            provider: String(r.provider),
            inputTokens: num(r.input_tokens),
            outputTokens: num(r.output_tokens),
            audioSeconds: r.audio_seconds === null ? null : num(r.audio_seconds),
            costMicroUsd: num(r.cost_micro_usd),
            anomaly: typeof r.anomaly === 'string' ? r.anomaly : null,
            createdAt: iso(r.created_at),
          })),
          trendAllocations: trends.map((r) => ({
            weekStart: dateText(r.week_start),
            industryId: String(r.industry_id),
            costMicroUsd: num(r.cost_micro_usd),
          })),
        };
      },
    ).catch((err: unknown) => {
      // Tài khoản không tồn tại: hàm kiểm tra của supportViewAccount ném trước khi đọc/ghi kiểm toán → 404, không 5xx.
      if ((err as { code?: unknown } | null)?.code === 'TENANT_NOT_FOUND') {
        throw new NotFoundException();
      }
      throw err;
    });
  }

  /** Tổng hợp nội bộ theo chu kỳ: chỉ số tổng, không mã tài khoản (hàm SQL tổng hợp, FR-018). */
  @Get('summary')
  @StaffAccess('ai.cost.view')
  async summary(
    @ValidQuery(cycleQuery) query: z.infer<typeof cycleQuery>,
  ): Promise<CostSummary & { cycle: string }> {
    requireStaff();
    const summary = await adminCostSummary(query.cycle);
    return { cycle: query.cycle, ...summary };
  }
}
