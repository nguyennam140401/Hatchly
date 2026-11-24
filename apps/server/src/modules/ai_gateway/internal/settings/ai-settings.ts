import { AiError } from '../errors';
import { readShared } from '../shared-read';
import { aiSettings } from '../db/schema';

// Cấu hình trần/ngưỡng của Cổng AI (015, FR-011, FR-019a, FR-032a): bảng `ai_settings` một dòng (id = 1). Chỉ đệm
// CẤU HÌNH (TTL ngắn, mặc định 60 s); KHÔNG BAO GIỜ đệm số dư ngân sách (Hiến pháp). Giá trị được CHỤP vào dòng
// ngân sách lúc tạo (`DbBudgetStore`), nên đổi cấu hình không đổi trần của chu kỳ đang chạy.

export interface AiSettingsValues {
  /** Trần cứng mỗi tài khoản mỗi chu kỳ (micro-USD). */
  accountCap: number;
  /** Ngưỡng mềm chuyển sang mô hình rẻ (micro-USD). */
  softLimit: number;
  /** Mức tuần cho mỗi ngành của ngân sách hệ thống (micro-USD). */
  perIndustryWeekly: number;
}

export interface AiSettingsOptions {
  /** TTL đệm cấu hình (ms), tối đa 60 000. */
  ttlMs: number;
  /** Chỉ cho kiểm thử: nguồn đọc thay thế và đồng hồ. */
  load?: () => Promise<AiSettingsValues | null>;
  now?: () => number;
}

const MAX_TTL_MS = 60_000;

async function loadFromDb(): Promise<AiSettingsValues | null> {
  const rows = await readShared((db) => db.select().from(aiSettings).limit(1));
  const row = rows[0];
  if (row === undefined) return null;
  return {
    accountCap: Number(row.account_cap_micro_usd),
    softLimit: Number(row.account_soft_limit_micro_usd),
    perIndustryWeekly: Number(row.per_industry_weekly_micro_usd),
  };
}

export class AiSettings {
  private cached: { value: AiSettingsValues; at: number } | undefined;
  private readonly ttlMs: number;
  private readonly load: () => Promise<AiSettingsValues | null>;
  private readonly now: () => number;

  constructor(opts: AiSettingsOptions) {
    this.ttlMs = Math.min(Math.max(0, opts.ttlMs), MAX_TTL_MS);
    this.load = opts.load ?? loadFromDb;
    this.now = opts.now ?? Date.now;
  }

  /** Thiếu dòng cấu hình → `AI_NOT_CONFIGURED` (không đoán trần). */
  async get(): Promise<AiSettingsValues> {
    const t = this.now();
    if (this.cached !== undefined && t - this.cached.at < this.ttlMs) return this.cached.value;
    const value = await this.load();
    if (value === null) throw new AiError('AI_NOT_CONFIGURED');
    this.cached = { value, at: t };
    return value;
  }

  /** Bỏ đệm (kiểm thử / sau khi quản trị đổi cấu hình trong cùng tiến trình). */
  invalidate(): void {
    this.cached = undefined;
  }
}
