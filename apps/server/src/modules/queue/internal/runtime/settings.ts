// Thông số hàng chờ trong CSDL (research R10, FR-006): infra.queue_settings, đọc lại mỗi
// QUEUE_SETTINGS_REFRESH_MS. CHECK của CSDL là chốt chặn cuối; Zod thêm quy tắc liên cột và thông điệp
// rõ. Dòng không hợp lệ → GIỮ giá trị cũ + nhật ký `queue.settings_invalid` + bộ đếm.
import { z } from 'zod';
import { QUEUE_NAMES, type QueueName } from '../../public-api';
import type { QueueLogger } from '../logger';

export type RetryMode = 'schedule' | 'handler' | 'none';

export interface QueueSettings {
  queue: QueueName;
  concurrencyPerWorker: number;
  /** NULL: không giới hạn theo tenant (notify, scheduled). */
  maxPerTenant: number | null;
  lockSeconds: number;
  heartbeatSeconds: number;
  retryMode: RetryMode;
  maxRetries: number;
  retryDelaysSeconds: number[];
  pollIntervalMs: number;
}

/** Giá trị khởi tạo (trùng migration 0006) – dùng khi chưa đọc được CSDL lần nào. */
export const DEFAULT_SETTINGS: Readonly<Record<QueueName, QueueSettings>> = {
  publish: s('publish', 10, 3, 120, 'handler', 5, [60], 1000),
  media: s('media', 2, 1, 900, 'schedule', 3, [60, 300, 900], 5000),
  ai_batch: s('ai_batch', 5, 3, 180, 'schedule', 2, [30, 120], 2000),
  trends: s('trends', 2, 1, 600, 'schedule', 3, [3600, 14400], 5000),
  notify: s('notify', 5, null, 60, 'schedule', 5, [30, 60, 120, 300, 600], 2000),
  scheduled: s('scheduled', 2, null, 600, 'none', 0, [60], 2000),
};

function s(
  queue: QueueName,
  concurrencyPerWorker: number,
  maxPerTenant: number | null,
  lockSeconds: number,
  retryMode: RetryMode,
  maxRetries: number,
  retryDelaysSeconds: number[],
  pollIntervalMs: number,
): QueueSettings {
  return {
    queue,
    concurrencyPerWorker,
    maxPerTenant,
    lockSeconds,
    heartbeatSeconds: 30,
    retryMode,
    maxRetries,
    retryDelaysSeconds,
    pollIntervalMs,
  };
}

const Row = z
  .object({
    queue: z.enum(QUEUE_NAMES),
    concurrency_per_worker: z.number().int().min(1).max(50),
    max_per_tenant: z.number().int().min(1).nullable(),
    lock_seconds: z.number().int().min(30).max(3600),
    heartbeat_seconds: z.number().int().min(10),
    retry_mode: z.enum(['schedule', 'handler', 'none']),
    max_retries: z.number().int().min(0).max(20),
    retry_delays_seconds: z.array(z.number().int().min(1).max(86_400)).min(1),
    poll_interval_ms: z.number().int().min(200).max(60_000),
  })
  .superRefine((row, ctx) => {
    // Heartbeat phải "đập" ít nhất 2 lần trong một thời gian khóa (bộ chạy gia hạn mỗi 10 giây).
    if (row.heartbeat_seconds * 2 > row.lock_seconds) {
      ctx.addIssue({ code: 'custom', message: 'heartbeat_seconds × 2 phải ≤ lock_seconds' });
    }
    if (row.max_per_tenant !== null && row.max_per_tenant > row.concurrency_per_worker * 10) {
      ctx.addIssue({ code: 'custom', message: 'max_per_tenant vượt concurrency_per_worker × 10' });
    }
    if (row.retry_mode === 'none' && row.max_retries !== 0) {
      ctx.addIssue({ code: 'custom', message: "retry_mode 'none' phải có max_retries = 0" });
    }
  });

export type SettingsRow = z.input<typeof Row>;

export const SETTINGS_SQL = `SELECT queue, concurrency_per_worker, max_per_tenant, lock_seconds, heartbeat_seconds,
       retry_mode, max_retries, retry_delays_seconds, poll_interval_ms
  FROM infra.queue_settings ORDER BY queue`;

/** Một dòng → thông số, hoặc danh sách lỗi (chỉ tên cột/quy tắc – không có giá trị). */
export function parseSettingsRow(
  raw: unknown,
): { ok: true; value: QueueSettings } | { ok: false; issues: string[] } {
  const r = Row.safeParse(raw);
  if (!r.success) {
    return {
      ok: false,
      issues: r.error.issues.map(
        (i) => (i.path.length > 0 ? `${i.path.join('.')}: ` : '') + i.message,
      ),
    };
  }
  const row = r.data;
  return {
    ok: true,
    value: {
      queue: row.queue,
      concurrencyPerWorker: row.concurrency_per_worker,
      maxPerTenant: row.max_per_tenant,
      lockSeconds: row.lock_seconds,
      heartbeatSeconds: row.heartbeat_seconds,
      retryMode: row.retry_mode,
      maxRetries: row.max_retries,
      retryDelaysSeconds: row.retry_delays_seconds,
      pollIntervalMs: row.poll_interval_ms,
    },
  };
}

export interface SettingsChange {
  queue: QueueName;
  previous: QueueSettings;
  next: QueueSettings;
  /** Tên trường đã đổi. */
  fields: (keyof QueueSettings)[];
}

export interface SettingsCacheOptions {
  load: () => Promise<unknown[]>;
  refreshMs: number;
  logger: QueueLogger;
  onInvalid?: (queue: string) => void;
}

/** Bộ nhớ đệm thông số trong tiến trình, đọc lại định kỳ, phát sự kiện thay đổi. */
export class SettingsCache {
  private current = new Map<QueueName, QueueSettings>(
    QUEUE_NAMES.map((q) => [q, DEFAULT_SETTINGS[q]]),
  );
  private timer: NodeJS.Timeout | undefined;
  private readonly listeners: ((changes: SettingsChange[]) => void | Promise<void>)[] = [];
  private loadedOnce = false;

  constructor(private readonly options: SettingsCacheOptions) {}

  get(queue: QueueName): QueueSettings {
    return this.current.get(queue) ?? DEFAULT_SETTINGS[queue];
  }

  get loaded(): boolean {
    return this.loadedOnce;
  }

  onChange(listener: (changes: SettingsChange[]) => void | Promise<void>): void {
    this.listeners.push(listener);
  }

  /** Đọc ngay; lỗi kết nối ném ra cho người gọi (lần khởi động) – các lần định kỳ chỉ ghi nhật ký. */
  async refresh(): Promise<SettingsChange[]> {
    const rows = await this.options.load();
    const changes: SettingsChange[] = [];
    for (const raw of rows) {
      const queueName = (raw as { queue?: unknown }).queue;
      const parsed = parseSettingsRow(raw);
      if (!parsed.ok) {
        this.options.logger.warn({
          event: 'queue.settings_invalid',
          queue: typeof queueName === 'string' ? queueName : null,
          issues: parsed.issues,
        });
        this.options.onInvalid?.(typeof queueName === 'string' ? queueName : 'unknown');
        continue;
      }
      const next = parsed.value;
      const previous = this.get(next.queue);
      const fields = (Object.keys(next) as (keyof QueueSettings)[]).filter(
        (k) => JSON.stringify(next[k]) !== JSON.stringify(previous[k]),
      );
      this.current.set(next.queue, next);
      if (fields.length > 0 && this.loadedOnce) {
        changes.push({ queue: next.queue, previous, next, fields });
      }
    }
    this.loadedOnce = true;
    if (changes.length > 0) {
      for (const listener of this.listeners) await listener(changes);
    }
    return changes;
  }

  start(): void {
    this.timer ??= setInterval(() => {
      this.refresh().catch((err: unknown) => {
        const code = (err as { code?: unknown } | null)?.code;
        this.options.logger.warn({
          event: 'queue.settings_refresh_failed',
          code: typeof code === 'string' ? code : 'UNKNOWN',
        });
      });
    }, this.options.refreshMs);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
