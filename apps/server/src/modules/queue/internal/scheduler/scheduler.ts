// Bộ hẹn giờ việc định kỳ (research R9, FR-027/028) – chạy trên MỌI bản Worker, không cần bản chính:
// nhịp QUEUE_SCHEDULER_TICK_MS, giờ CSDL (`SELECT now()`), mỗi lịch xét khung gần nhất. Một giao dịch
// `system`: chèn khung (ON CONFLICT DO NOTHING) → chèn được mới tạo việc với khóa `scheduled:{name}`
// (`exclusive`) → lần trước còn chờ/chạy thì ghi `skipped_overlap`. Không bao giờ bù nhiều khung.
import { and, eq } from 'drizzle-orm';
import { systemTx } from '../../../../core/db/transaction';
import { listSchedules } from '../../schedules';
import { scheduleSlots } from '../db/schema';
import { enqueue } from '../producer';
import type { QueueRuntime, RuntimeService } from '../runtime/queue-runtime';
import { currentSlot } from './slots';

export interface SchedulerOptions {
  tickMs: number;
  appEnv: string;
  /** Chỉ xét các lịch này (kiểm thử); mặc định mọi lịch đã khai báo. */
  only?: readonly string[];
}

export class SchedulerService implements RuntimeService {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | undefined;
  private runtime: QueueRuntime | undefined;
  /** Khung đã xử lý gần nhất của từng lịch trên bản này (bỏ qua nhanh – khóa thật nằm trong CSDL). */
  private readonly seen = new Map<string, string>();
  private stopped = false;

  constructor(private readonly options: SchedulerOptions) {}

  start(runtime: QueueRuntime): void {
    this.runtime = runtime;
    this.stopped = false;
    this.timer = setInterval(() => {
      if (this.running === undefined) {
        this.running = this.tick().finally(() => (this.running = undefined));
      }
    }, this.options.tickMs);
    this.timer.unref();
    this.running = this.tick().finally(() => (this.running = undefined));
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await this.running;
  }

  /** Một nhịp: trả số khung mới đã xử lý trên bản này. */
  async tick(): Promise<number> {
    const runtime = this.runtime;
    if (runtime === undefined || this.stopped) return 0;
    let handled = 0;
    try {
      const nowRow = await runtime.pool.query<{ now: Date }>('SELECT now() AS now');
      const dbNow = nowRow.rows[0]!.now;
      for (const schedule of listSchedules()) {
        if (this.stopped) break;
        if (this.options.only !== undefined && !this.options.only.includes(schedule.name)) continue;
        const { slot, slotAt } = currentSlot(schedule.cron, schedule.tz, dbNow);
        if (this.seen.get(schedule.name) === slot) continue;
        const lateSeconds = Math.max(0, Math.floor((dbNow.getTime() - slotAt.getTime()) / 1000));
        const outcome = await systemTx(async (db) => {
          const inserted = await db
            .insert(scheduleSlots)
            .values({
              name: schedule.name,
              slot,
              slot_at: slotAt,
              status: 'enqueued',
              late_seconds: lateSeconds,
            })
            .onConflictDoNothing()
            .returning({ name: scheduleSlots.name });
          if (inserted.length === 0) return 'taken' as const;
          const result = await enqueue(
            schedule.jobType,
            {},
            { dedupeKey: `scheduled:${schedule.name}` },
          );
          const where = and(eq(scheduleSlots.name, schedule.name), eq(scheduleSlots.slot, slot));
          if (result.status === 'created') {
            await db.update(scheduleSlots).set({ job_id: result.jobId }).where(where);
            return 'enqueued' as const;
          }
          // Lần chạy trước của lịch này còn chờ/đang chạy → không chồng (FR-028).
          await db.update(scheduleSlots).set({ status: 'skipped_overlap' }).where(where);
          return 'skipped_overlap' as const;
        });
        this.seen.set(schedule.name, slot);
        if (outcome !== 'taken') {
          handled++;
          runtime.logger.info({
            event: 'queue.schedule_slot',
            name: schedule.name,
            slot,
            status: outcome,
            late_seconds: lateSeconds,
          });
        }
      }
      runtime.markControlSuccess();
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      runtime.logger.warn({
        event: 'queue.scheduler_tick_failed',
        code: typeof code === 'string' ? code : 'UNKNOWN',
      });
    }
    return handled;
  }
}
