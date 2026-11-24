import type { ModelTier } from '../../public-api';

// Bảng giá mô hình là CẤU HÌNH (hiến pháp III): PriceBook đọc qua PriceSource được tiêm vào – bản giả
// lập: JSON; bản thật (WBS 3.1): bảng `model_prices`. Đổi giá không cần phát hành; giá đổi giữa chu kỳ
// không tính lại quá khứ (chọn dòng `effectiveFrom <= at` mới nhất).

export interface PriceEntry {
  modelTier: ModelTier;
  modelId: string;
  provider: string;
  /** micro-USD mỗi 1 000 000 token. */
  inputPerMTokMicroUsd: number;
  outputPerMTokMicroUsd: number;
  cachedInputPerMTokMicroUsd: number;
  /** micro-USD mỗi phút âm thanh (STT). */
  perAudioMinuteMicroUsd?: number;
  /** Độ chi tiết tính tiền STT (giây; 1 hoặc 60). Thiếu = 1. */
  billingGranularitySec?: number;
  effectiveFrom: Date;
}

export interface PriceSource {
  load(): Promise<PriceEntry[]>;
}

export class PriceBook {
  private entries: PriceEntry[] = [];

  constructor(private readonly source: PriceSource) {}

  /** Nạp (lại) bảng giá từ nguồn. */
  async refresh(): Promise<void> {
    this.entries = [...(await this.source.load())].sort(
      (a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime(),
    );
  }

  priceFor(tier: ModelTier, at: Date = new Date()): PriceEntry {
    const entry = this.entries.find(
      (e) => e.modelTier === tier && e.effectiveFrom.getTime() <= at.getTime(),
    );
    if (entry === undefined) throw new Error(`Chưa có giá cho hạng mô hình ${tier}`);
    return entry;
  }
}

interface JsonPrice extends Omit<PriceEntry, 'effectiveFrom'> {
  effectiveFrom: string;
}

/** Nguồn giá từ dữ liệu JSON (bản giả lập). */
export class JsonPriceSource implements PriceSource {
  constructor(private readonly rows: readonly JsonPrice[]) {}

  load(): Promise<PriceEntry[]> {
    return Promise.resolve(
      this.rows.map((r) => ({ ...r, effectiveFrom: new Date(r.effectiveFrom) })),
    );
  }
}
