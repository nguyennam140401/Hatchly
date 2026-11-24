import type { AiTask, ModelTier } from '../../public-api';
import { modelRoutes, taskFallback } from '../db/schema';
import { readShared } from '../shared-read';

// Định tuyến mô hình theo bậc + dự phòng theo loại việc (015, FR-024a, contracts/provider-adapter.md mục 3).
// Đệm cấu hình TTL ngắn (mặc định 60 s) – đổi tuyến bằng dữ liệu, không cần phát hành.

export interface RouteAttempt {
  provider: string;
  modelId: string;
}

export interface RouteRow {
  tier: string;
  rank: number;
  provider: string;
  modelId: string;
  enabled: boolean;
}

export interface RouteData {
  routes: RouteRow[];
  /** Loại việc → có bật dự phòng. */
  fallbackEnabled: ReadonlyMap<string, boolean>;
}

/**
 * Thuật toán thuần: rank 1 `enabled` làm chính (thiếu → rỗng, cấu hình thiếu); rank 2 chỉ khi `enabled` **và**
 * `task_fallback[task].enabled`. Trả `[chính]` hoặc `[chính, dự phòng]`.
 */
export function selectAttempts(data: RouteData, task: AiTask, tier: ModelTier): RouteAttempt[] {
  const primary = data.routes.find((r) => r.tier === tier && r.rank === 1 && r.enabled);
  if (primary === undefined) return [];
  const out: RouteAttempt[] = [{ provider: primary.provider, modelId: primary.modelId }];
  const fallback = data.routes.find((r) => r.tier === tier && r.rank === 2 && r.enabled);
  if (fallback !== undefined && data.fallbackEnabled.get(task) === true) {
    out.push({ provider: fallback.provider, modelId: fallback.modelId });
  }
  return out;
}

export interface RouteBookOptions {
  ttlMs: number;
  /** Chỉ cho kiểm thử. */
  load?: () => Promise<RouteData>;
  now?: () => number;
}

async function loadFromDb(): Promise<RouteData> {
  return readShared(async (db) => {
    const routes = await db.select().from(modelRoutes);
    const fallbacks = await db.select().from(taskFallback);
    return {
      routes: routes.map((r) => ({
        tier: r.tier,
        rank: r.rank,
        provider: r.provider,
        modelId: r.model_id,
        enabled: r.enabled,
      })),
      fallbackEnabled: new Map(fallbacks.map((f) => [f.task, f.enabled])),
    };
  });
}

export class RouteBook {
  private cached: { data: RouteData; at: number } | undefined;
  private readonly load: () => Promise<RouteData>;
  private readonly now: () => number;

  constructor(private readonly opts: RouteBookOptions) {
    this.load = opts.load ?? loadFromDb;
    this.now = opts.now ?? Date.now;
  }

  /** Danh sách lượt gọi theo thứ tự. Rỗng → thiếu tuyến chính (bên gọi trả `AI_NOT_CONFIGURED`). */
  async attemptsFor(task: AiTask, tier: ModelTier): Promise<RouteAttempt[]> {
    const t = this.now();
    if (this.cached === undefined || t - this.cached.at >= this.opts.ttlMs) {
      this.cached = { data: await this.load(), at: t };
    }
    return selectAttempts(this.cached.data, task, tier);
  }

  /** Nhà cung cấp của mọi tuyến đang `enabled` (kiểm tra khóa API lúc khởi động – T049). Đọc mới, không dùng đệm. */
  async enabledProviders(): Promise<string[]> {
    const data = await this.load();
    return [...new Set(data.routes.filter((r) => r.enabled).map((r) => r.provider))];
  }

  /** Bỏ đệm (kiểm thử). */
  invalidate(): void {
    this.cached = undefined;
  }
}
