// Tính "khung" của việc định kỳ (research R9, FR-026/027): khung gần nhất `slot ≤ giờ CSDL` theo cron và
// múi giờ. `slot` là chuỗi giờ địa phương ISO đầu khung (vd `2026-11-09T05:00+07:00`) – khóa chính cùng
// tên lịch trong infra.schedule_slots → đúng một lần mỗi khung trên mọi bản Worker.
import { CronExpressionParser } from 'cron-parser';

export type ScheduleTz = 'Asia/Ho_Chi_Minh' | 'UTC';

const OFFSET_MINUTES: Record<ScheduleTz, number> = { 'Asia/Ho_Chi_Minh': 7 * 60, UTC: 0 };

/** Số trường của biểu thức cron (5 = phút; 6 = có giây – chỉ cho kiểm thử). */
export function cronFieldCount(cron: string): number {
  return cron.trim().split(/\s+/).length;
}

/**
 * Múi giờ mặc định (FR-026): lịch theo phút/giờ (trường giờ là `*` hoặc bước) → UTC; lịch theo
 * ngày/tuần/tháng (giờ cụ thể) → Asia/Ho_Chi_Minh.
 */
export function defaultTz(cron: string): ScheduleTz {
  const fields = cron.trim().split(/\s+/);
  const hour = fields.length === 6 ? fields[2] : fields[1];
  return hour === undefined || hour.includes('*') ? 'UTC' : 'Asia/Ho_Chi_Minh';
}

/** Kiểm biểu thức cron: 5 trường; 6 trường chỉ khi APP_ENV=test. Sai → ném. */
export function assertCron(cron: string, appEnv: string | undefined): void {
  const n = cronFieldCount(cron);
  if (n === 6 && appEnv !== 'test') {
    throw new Error(`Lịch "${cron}": cron 6 trường (có giây) chỉ dùng khi APP_ENV=test`);
  }
  if (n !== 5 && n !== 6) throw new Error(`Lịch "${cron}": cron phải có 5 trường`);
  CronExpressionParser.parse(cron, { tz: 'UTC' });
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Chuỗi giờ địa phương ISO của một thời điểm (có giây khi `withSeconds`). */
export function localIso(at: Date, tz: ScheduleTz, withSeconds: boolean): string {
  const offset = OFFSET_MINUTES[tz];
  const local = new Date(at.getTime() + offset * 60_000);
  const date = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  const time = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}${withSeconds ? `:${pad(local.getUTCSeconds())}` : ''}`;
  const sign = offset >= 0 ? '+' : '-';
  const off = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return `${date}T${time}${off}`;
}

export interface Slot {
  /** Giờ địa phương ISO đầu khung – khóa của khung. */
  slot: string;
  /** Cùng thời điểm, UTC. */
  slotAt: Date;
}

/** Khung gần nhất có đầu khung ≤ `dbNow` (giờ CSDL – không dùng giờ máy Worker). */
export function currentSlot(cron: string, tz: ScheduleTz, dbNow: Date): Slot {
  // +1 ms: đúng thời điểm đầu khung cũng thuộc khung đó (prev() trả thời điểm < currentDate).
  const expression = CronExpressionParser.parse(cron, {
    currentDate: new Date(dbNow.getTime() + 1),
    tz,
  });
  const slotAt = expression.prev().toDate();
  return { slot: localIso(slotAt, tz, cronFieldCount(cron) === 6), slotAt };
}
