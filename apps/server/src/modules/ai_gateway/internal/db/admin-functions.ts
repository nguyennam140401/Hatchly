import { sql } from 'drizzle-orm';
import { supportCommand } from '../../../../core/db/support';
import { uuidV7 } from '../../../../core/ids/uuid-v7';

// Bọc kiểu quanh các hàm SECURITY DEFINER quản trị cấu hình Cổng AI (015 T039a, migration 0031). Tiến trình API không có
// quyền ghi bảng cấu hình → mọi ghi đi qua `supportCommand` (bể `support`, không tenant). Mỗi hàm GHI tự ghi `infra.audit_log`
// trong cùng giao dịch (kiểm toán lỗi → hoàn tác cả cấu hình). `actor` là mã nhân viên admin (từ phiên, không từ thân yêu cầu).
// Kiểm CỨNG 10× và TTL 60 s (đồng hồ CSDL) nằm ở hàm SQL admin_add_price dưới khóa tư vấn; tầng dịch vụ chỉ có thể kiểm nhanh
// trước (không bắt buộc). Kiểm mềm (mô hình có giá, bật fallback cần rank 2) ở tầng dịch vụ bằng các hàm ĐỌC bên dưới.

export type AiAdminErrorCode =
  | 'AI_PRICE_IMPLAUSIBLE'
  | 'AI_PRICE_EFFECTIVE_TOO_SOON'
  | 'AI_SETTINGS_INVALID'
  | 'AI_ROUTE_INVALID';
const ADMIN_ERROR_CODES: readonly AiAdminErrorCode[] = [
  'AI_PRICE_IMPLAUSIBLE',
  'AI_PRICE_EFFECTIVE_TOO_SOON',
  'AI_SETTINGS_INVALID',
  'AI_ROUTE_INVALID',
];

/**
 * Lấy mã lỗi nghiệp vụ do hàm SQL ném (`RAISE EXCEPTION USING MESSAGE = '<mã>'`, SQLSTATE 22023). Duyệt cả chuỗi `cause`
 * (Drizzle bọc lỗi driver). Trả `undefined` nếu không phải lỗi nghiệp vụ của các hàm quản trị.
 */
export function aiAdminErrorCode(error: unknown): AiAdminErrorCode | undefined {
  for (let e: unknown = error, depth = 0; e !== undefined && e !== null && depth < 5; depth++) {
    const err = e as { message?: unknown; code?: unknown; cause?: unknown };
    if (typeof err.message === 'string') {
      const hit = ADMIN_ERROR_CODES.find(
        (c) => err.message === c || (err.message as string).includes(c),
      );
      if (hit !== undefined && (err.code === undefined || err.code === '22023')) return hit;
    }
    e = err.cause;
  }
  return undefined;
}

export type PriceUnit = 'token' | 'audio_minute';
export type AiTier = 'default' | 'cheap' | 'cheap_vision' | 'stt';

export interface CurrentPrice {
  priceId: string;
  unit: PriceUnit;
  inputPerMTok: bigint | null;
  outputPerMTok: bigint | null;
  cachedInputPerMTok: bigint | null;
  perMinute: bigint | null;
  billingGranularitySec: number;
  effectiveFrom: Date;
}

export interface AddPriceInput {
  provider: string;
  modelId: string;
  unit: PriceUnit;
  inputPerMTok?: number | null;
  outputPerMTok?: number | null;
  cachedInputPerMTok?: number | null;
  perMinute?: number | null;
  billingGranularitySec?: number | null;
  effectiveFrom: Date;
}

export interface AddPriceResult {
  priceId: string;
  /** Dòng giá LIỀN TRƯỚC theo effective_from (≤ của dòng mới); `null` khi đây là dòng giá đầu của (provider, model, unit). */
  previous: Omit<CurrentPrice, 'unit' | 'billingGranularitySec'> | null;
}

export interface SettingsPatch {
  accountCapMicroUsd?: number;
  accountSoftLimitMicroUsd?: number;
  perIndustryWeeklyMicroUsd?: number;
}

export interface AiSettings {
  accountCapMicroUsd: number;
  accountSoftLimitMicroUsd: number;
  perIndustryWeeklyMicroUsd: number;
}

export interface RouteRow {
  provider: string;
  modelId: string;
  enabled: boolean;
}

const traceOf = (trace: string | undefined): string => trace ?? '';
const big = (v: unknown): bigint | null =>
  v === null || v === undefined ? null : BigInt(v as string | number);
const num = (v: unknown): number => Number(v);

/** Hàm ĐỌC + GHI quản trị Cổng AI. Mọi hàm chạy trong MỘT giao dịch của bể `support`. */
export const aiAdminFunctions = {
  // ---------------------------------------------------------------- ĐỌC
  async getSettings(): Promise<AiSettings> {
    const row = await supportCommand(async (db) => {
      const r = await db.execute(sql`SELECT * FROM ai_gateway.admin_get_settings()`);
      return r.rows[0];
    });
    if (row === undefined) throw new Error('AI_SETTINGS_ROW_MISSING');
    return {
      accountCapMicroUsd: num(row.account_cap_micro_usd),
      accountSoftLimitMicroUsd: num(row.account_soft_limit_micro_usd),
      perIndustryWeeklyMicroUsd: num(row.per_industry_weekly_micro_usd),
    };
  },

  /** Mô hình đã có ít nhất một dòng giá (kể cả hiệu lực tương lai) đúng `unit` (bỏ trống = đơn vị bất kỳ)? */
  async modelHasPrice(provider: string, modelId: string, unit?: PriceUnit): Promise<boolean> {
    return supportCommand(async (db) => {
      const r = await db.execute<{ has: boolean }>(
        sql`SELECT ai_gateway.admin_model_has_price(${provider}, ${modelId}, ${unit ?? null}::text) AS has`,
      );
      return r.rows[0]?.has === true;
    });
  },

  /** Tuyến (tier, rank); `null` nếu chưa có. Dùng rank 2 để quyết định cho phép bật dự phòng. */
  async getRoute(tier: AiTier, rank: 1 | 2): Promise<RouteRow | null> {
    const row = await supportCommand(async (db) => {
      const r = await db.execute<{ provider: string; model_id: string; enabled: boolean }>(
        sql`SELECT * FROM ai_gateway.admin_get_route(${tier}, ${rank}::integer)`,
      );
      return r.rows[0];
    });
    return row === undefined
      ? null
      : { provider: row.provider, modelId: row.model_id, enabled: row.enabled };
  },

  // ---------------------------------------------------------------- GHI (kiểm toán cùng giao dịch)
  /** Thêm dòng giá + `ai.price.add`. Ném lỗi SQL `AI_PRICE_IMPLAUSIBLE` (giá/10×) hoặc `AI_PRICE_EFFECTIVE_TOO_SOON` (TTL 60 s) – xem `aiAdminErrorCode`. */
  async addPrice(input: AddPriceInput, actor: string, trace?: string): Promise<AddPriceResult> {
    const priceId = uuidV7();
    const row = await supportCommand(async (db) => {
      const r = await db.execute(
        sql`SELECT * FROM ai_gateway.admin_add_price(
              ${priceId}::uuid, ${input.provider}, ${input.modelId}, ${input.unit},
              ${input.inputPerMTok ?? null}::bigint, ${input.outputPerMTok ?? null}::bigint,
              ${input.cachedInputPerMTok ?? null}::bigint, ${input.perMinute ?? null}::bigint,
              ${input.billingGranularitySec ?? null}::integer, ${input.effectiveFrom.toISOString()}::timestamptz,
              ${actor}::uuid, ${traceOf(trace)}, ${uuidV7()}::uuid)`,
      );
      return r.rows[0];
    });
    const hasOld = row?.old_price_id !== null && row?.old_price_id !== undefined;
    return {
      priceId,
      previous: hasOld
        ? {
            priceId: String(row.old_price_id),
            inputPerMTok: big(row.old_input_per_mtok),
            outputPerMTok: big(row.old_output_per_mtok),
            cachedInputPerMTok: big(row.old_cached_input_per_mtok),
            perMinute: big(row.old_per_minute),
            effectiveFrom: new Date(row.old_effective_from as string | Date),
          }
        : null,
    };
  },

  /** Đổi cấu hình (trường không truyền = giữ nguyên) + `ai.settings.change` mỗi trường đổi. Trả số trường đã đổi. */
  async setSettings(patch: SettingsPatch, actor: string, trace?: string): Promise<number> {
    return supportCommand(async (db) => {
      const r = await db.execute<{ n: number }>(
        sql`SELECT ai_gateway.admin_set_settings(
              ${patch.accountCapMicroUsd ?? null}::bigint, ${patch.accountSoftLimitMicroUsd ?? null}::bigint,
              ${patch.perIndustryWeeklyMicroUsd ?? null}::bigint, ${actor}::uuid, ${traceOf(trace)},
              ARRAY[${uuidV7()}, ${uuidV7()}, ${uuidV7()}]::uuid[]) AS n`,
      );
      return num(r.rows[0]?.n ?? 0);
    });
  },

  /** Đặt tuyến (tier, rank) + `ai.route.change`. Ném `AI_ROUTE_INVALID` khi rank/tier sai hoặc mô hình chưa có giá. */
  async setRoute(
    route: { tier: AiTier; rank: number; provider: string; modelId: string; enabled: boolean },
    actor: string,
    trace?: string,
  ): Promise<void> {
    await supportCommand(async (db) => {
      await db.execute(
        sql`SELECT ai_gateway.admin_set_route(
              ${route.tier}, ${route.rank}::integer, ${route.provider}, ${route.modelId}, ${route.enabled}::boolean,
              ${actor}::uuid, ${traceOf(trace)}, ${uuidV7()}::uuid)`,
      );
    });
  },

  /** Bật/tắt dự phòng theo loại việc + `ai.task_fallback.change`. Trả giá trị cũ. */
  async setTaskFallback(
    task: string,
    enabled: boolean,
    actor: string,
    trace?: string,
  ): Promise<boolean | null> {
    return supportCommand(async (db) => {
      const r = await db.execute<{ old: boolean | null }>(
        sql`SELECT ai_gateway.admin_set_task_fallback(
              ${task}, ${enabled}::boolean, ${actor}::uuid, ${traceOf(trace)}, ${uuidV7()}::uuid) AS old`,
      );
      return r.rows[0]?.old ?? null;
    });
  },

  /** Nhập (hoặc thay thế) hóa đơn nhà cung cấp + `ai.invoice.enter`. Trả tổng cũ (`null` nếu mới). */
  async enterInvoice(
    invoice: { provider: string; invoiceDate: string; totalMicroUsd: number },
    actor: string,
    trace?: string,
  ): Promise<bigint | null> {
    return supportCommand(async (db) => {
      const r = await db.execute<{ old: string | null }>(
        sql`SELECT ai_gateway.admin_enter_invoice(
              ${uuidV7()}::uuid, ${invoice.provider}, ${invoice.invoiceDate}::date, ${invoice.totalMicroUsd}::bigint,
              ${actor}::uuid, ${traceOf(trace)}, ${uuidV7()}::uuid) AS old`,
      );
      return big(r.rows[0]?.old);
    });
  },
};
