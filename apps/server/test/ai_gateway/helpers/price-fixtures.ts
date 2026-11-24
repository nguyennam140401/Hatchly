import { randomBytes } from 'node:crypto';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import type { PriceEntry } from '../../../src/modules/ai_gateway/internal/prices/price-book';
import type { PriceRecord } from '../../../src/modules/ai_gateway/internal/prices/db-price-source';
import type { RouteBook } from '../../../src/modules/ai_gateway/internal/routing/route-book';
import { asOwner } from '../../db/helpers/db';

// Dữ liệu mồi dùng chung cho kiểm thử giá/sổ của Cổng AI (015 US3). Bảng `model_prices` CHỈ THÊM và dùng chung cho mọi
// ca → mỗi ca tự đặt (provider, model) RIÊNG (tiền tố `qa-`) để dòng giá của ca này không làm bẩn ca khác; không thể dọn
// (trigger chặn DELETE kể cả owner) nên dòng mồi nằm lại trong CSDL thử tạm, bị bỏ cùng CSDL sau khi chạy.

export interface TestModel {
  provider: string;
  modelId: string;
}

/** Mô hình riêng của ca kiểm thử (không trùng bất kỳ dòng giá/tuyến nào khác). */
export function uniqueModel(tag = 'm'): TestModel {
  const s = randomBytes(5).toString('hex');
  return { provider: `qa-prov-${s}`, modelId: `qa-${tag}-${s}` };
}

export interface PriceSeed {
  unit?: 'token' | 'audio_minute';
  input?: number;
  output?: number;
  cached?: number | null;
  perMinute?: number;
  granularitySec?: number;
  /** Thời điểm hiệu lực (ISO hoặc Date). */
  effectiveFrom: Date | string;
}

/** Thêm một dòng giá bằng vai trò owner (đường quản trị thật là `POST /admin/ai/prices`, nhưng có ràng buộc `effectiveFrom`). */
export async function insertPrice(m: TestModel, seed: PriceSeed): Promise<string> {
  const id = uuidV7();
  const unit = seed.unit ?? 'token';
  const effective =
    seed.effectiveFrom instanceof Date ? seed.effectiveFrom.toISOString() : seed.effectiveFrom;
  await asOwner((c) =>
    c.query(
      `INSERT INTO ai_gateway.model_prices
         (id, provider, model_id, unit, input_per_mtok, output_per_mtok, cached_input_per_mtok, per_minute,
          billing_granularity_sec, effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, 'qa-test')`,
      [
        id,
        m.provider,
        m.modelId,
        unit,
        unit === 'token' ? (seed.input ?? 1_000_000) : null,
        unit === 'token' ? (seed.output ?? 2_000_000) : null,
        unit === 'token' ? (seed.cached === undefined ? 100_000 : seed.cached) : null,
        unit === 'audio_minute' ? (seed.perMinute ?? 6_000) : null,
        seed.granularitySec ?? 1,
        effective,
      ],
    ),
  );
  return id;
}

/** Tuyến thay thế cho `DbBudgetStore`: `attemptsFor` luôn trả đúng danh sách lượt cho trước (0 chính, 1 dự phòng). */
export function stubRoutes(...attempts: TestModel[]): Pick<RouteBook, 'attemptsFor'> {
  return { attemptsFor: () => Promise.resolve(attempts.map((a) => ({ ...a }))) };
}

/** `PriceRecord` (nguồn giá CSDL) → `PriceEntry` (đầu vào của `actualTokensCost`/`estimateTokens`). */
export function toEntry(r: PriceRecord, tier: PriceEntry['modelTier'] = 'default'): PriceEntry {
  return {
    modelTier: tier,
    modelId: r.modelId,
    provider: r.provider,
    inputPerMTokMicroUsd: r.inputPerMTokMicroUsd ?? 0,
    outputPerMTokMicroUsd: r.outputPerMTokMicroUsd ?? 0,
    cachedInputPerMTokMicroUsd: r.cachedInputPerMTokMicroUsd ?? 0,
    effectiveFrom: r.effectiveFrom,
  };
}

/** Dòng giữ chỗ của tài khoản (owner) theo thứ tự giữ. */
export async function reservationRows(accountId: string): Promise<
  {
    id: string;
    provider: string;
    model_id: string;
    price_id: string;
    state: string;
    estimate: string;
  }[]
> {
  return asOwner(
    async (c) =>
      (
        await c.query<{
          id: string;
          provider: string;
          model_id: string;
          price_id: string;
          state: string;
          estimate: string;
        }>(
          `SELECT id, provider, model_id, price_id, state, estimate::text
             FROM ai_gateway.ai_reservations WHERE account_id = $1 ORDER BY reserved_at, id`,
          [accountId],
        )
      ).rows,
  );
}
