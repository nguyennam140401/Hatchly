import { and, desc, eq } from 'drizzle-orm';
import { modelPrices } from '../db/schema';
import { readShared } from '../shared-read';

// Nguồn giá thật (015, FR-019, FR-020, FR-022): đọc `model_prices` (chỉ-thêm) theo `(provider, model_id, unit)` tại
// thời điểm giữ chỗ; giá hiện hành = dòng `effective_from` lớn nhất ≤ thời điểm tra. Đệm TTL ngắn
// (`AI_PRICE_CACHE_TTL_MS`) – cache cả các dòng tương lai nên giá mới có hiệu lực đúng giờ mà không cần đọc lại.
// Thiếu giá → `null`: KHÔNG đoán giá (bên gọi trả `AI_NOT_CONFIGURED` + sự kiện `ai.price_missing`).
// Tiền là micro-USD nguyên (bigint ở CSDL → number: giá/1M token nằm xa dưới 2^53).

export type PriceUnit = 'token' | 'audio_minute';

/** Một dòng giá hiệu lực, kèm `priceId` để giữ chỗ lưu và quyết toán dùng lại (không tra lại giá). */
export interface PriceRecord {
  priceId: string;
  provider: string;
  modelId: string;
  unit: PriceUnit;
  /** micro-USD mỗi 1 000 000 token (unit = token). */
  /** `null` với unit = audio_minute (không đoán "giá 0"). */
  inputPerMTokMicroUsd: number | null;
  outputPerMTokMicroUsd: number | null;
  cachedInputPerMTokMicroUsd: number | null;
  /** micro-USD mỗi phút âm thanh (unit = audio_minute). */
  perMinuteMicroUsd: number | null;
  billingGranularitySec: number;
  effectiveFrom: Date;
}

/** Nguồn giá tra theo mô hình (khác `PriceSource` tải-hết-theo-bậc của bản giả lập). */
export interface ModelPriceSource {
  priceFor(
    provider: string,
    modelId: string,
    unit: PriceUnit,
    at?: Date,
  ): Promise<PriceRecord | null>;
}

interface CacheEntry {
  rows: PriceRecord[]; // sắp theo effectiveFrom giảm dần
  loadedAt: number;
}

export interface DbPriceSourceOptions {
  ttlMs: number;
  /** Chỉ cho kiểm thử. */
  load?: (provider: string, modelId: string, unit: PriceUnit) => Promise<PriceRecord[]>;
  now?: () => number;
}

async function loadFromDb(
  provider: string,
  modelId: string,
  unit: PriceUnit,
): Promise<PriceRecord[]> {
  const rows = await readShared((db) =>
    db
      .select()
      .from(modelPrices)
      .where(
        and(
          eq(modelPrices.provider, provider),
          eq(modelPrices.model_id, modelId),
          eq(modelPrices.unit, unit),
        ),
      )
      .orderBy(desc(modelPrices.effective_from)),
  );
  return rows.map((r) => ({
    priceId: r.id,
    provider: r.provider,
    modelId: r.model_id,
    unit: r.unit as PriceUnit,
    inputPerMTokMicroUsd: r.input_per_mtok === null ? null : Number(r.input_per_mtok),
    outputPerMTokMicroUsd: r.output_per_mtok === null ? null : Number(r.output_per_mtok),
    cachedInputPerMTokMicroUsd:
      r.cached_input_per_mtok === null ? null : Number(r.cached_input_per_mtok),
    perMinuteMicroUsd: r.per_minute === null ? null : Number(r.per_minute),
    billingGranularitySec: r.billing_granularity_sec,
    effectiveFrom: r.effective_from,
  }));
}

export class DbPriceSource implements ModelPriceSource {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly load: NonNullable<DbPriceSourceOptions['load']>;
  private readonly now: () => number;

  constructor(private readonly opts: DbPriceSourceOptions) {
    this.load = opts.load ?? loadFromDb;
    this.now = opts.now ?? Date.now;
  }

  async priceFor(
    provider: string,
    modelId: string,
    unit: PriceUnit,
    at: Date = new Date(),
  ): Promise<PriceRecord | null> {
    const key = `${provider}\u0000${modelId}\u0000${unit}`;
    const t = this.now();
    let entry = this.cache.get(key);
    if (entry === undefined || t - entry.loadedAt >= this.opts.ttlMs) {
      const rows = [...(await this.load(provider, modelId, unit))].sort(
        (a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime(),
      );
      entry = { rows, loadedAt: t };
      this.cache.set(key, entry);
    }
    return entry.rows.find((r) => r.effectiveFrom.getTime() <= at.getTime()) ?? null;
  }

  /** Bỏ đệm (kiểm thử). */
  invalidate(): void {
    this.cache.clear();
  }
}
