// Việc định kỳ (contracts/queue-api.md mục 5, research R9, FR-026…029). Khai báo lúc khởi động; bộ hẹn
// giờ của MỌI bản Worker tính khung bằng giờ CSDL, khóa khung trong infra.schedule_slots.
import { assertCron, defaultTz } from './internal/scheduler/slots';
import type { JobTypeDefinition, PartitionedLogDefinition, ScheduleDefinition } from './public-api';

const schedules = new Map<string, ScheduleDefinition>();
const partitionedLogs = new Map<string, PartitionedLogDefinition>();

const NAME = /^[a-z_]+\.[a-z_]+$/;
const SQL_FUNCTION = /^[a-z_]+\.[a-z_]+$/;

/** Khai báo một việc định kỳ. Loại việc phải `scope: 'system'` (chạy không thuộc tài khoản nào). */
export function defineSchedule(def: {
  name: string;
  cron: string;
  tz?: 'Asia/Ho_Chi_Minh' | 'UTC';
  jobType: JobTypeDefinition<Record<string, never>>;
}): ScheduleDefinition {
  if (!NAME.test(def.name)) throw new Error(`Tên lịch "${def.name}" phải dạng <module>.<việc>`);
  if (schedules.has(def.name)) throw new Error(`Lịch ${def.name} đã được khai báo`);
  if (def.jobType.scope !== 'system') {
    throw new Error(`Lịch ${def.name}: loại việc ${def.jobType.name} phải có scope 'system'`);
  }
  assertCron(def.cron, process.env.APP_ENV);
  const schedule: ScheduleDefinition = Object.freeze({
    name: def.name,
    cron: def.cron.trim(),
    tz: def.tz ?? defaultTz(def.cron),
    jobType: def.jobType,
  });
  schedules.set(def.name, schedule);
  return schedule;
}

export function listSchedules(): ScheduleDefinition[] {
  return [...schedules.values()];
}

/** CHỈ kiểm thử: gỡ một lịch. */
export function removeSchedule(name: string): void {
  schedules.delete(name);
}

/**
 * Đăng ký bảng nhật ký phân vùng theo tháng: việc định kỳ `queue.partitions` tạo trước `monthsAhead`
 * tháng và (nếu có chính sách giữ) bỏ phân vùng quá `retentionMonths` tháng. Hàm SQL phải là
 * SECURITY DEFINER đã cấp EXECUTE cho `system`.
 */
export function registerPartitionedLog(def: PartitionedLogDefinition): void {
  if (partitionedLogs.has(def.table)) throw new Error(`Bảng ${def.table} đã được đăng ký`);
  if (!SQL_FUNCTION.test(def.ensureFunction))
    throw new Error('ensureFunction phải dạng schema.hàm');
  if (def.dropFunction !== undefined && !SQL_FUNCTION.test(def.dropFunction)) {
    throw new Error('dropFunction phải dạng schema.hàm');
  }
  if (!Number.isInteger(def.monthsAhead) || def.monthsAhead < 1 || def.monthsAhead > 6) {
    throw new Error('monthsAhead phải trong khoảng 1–6');
  }
  if ((def.retentionMonths === undefined) !== (def.dropFunction === undefined)) {
    throw new Error('retentionMonths và dropFunction phải đi cùng nhau');
  }
  partitionedLogs.set(def.table, Object.freeze({ ...def }));
}

export function listPartitionedLogs(): PartitionedLogDefinition[] {
  return [...partitionedLogs.values()];
}

// Nhật ký kiểm toán của 002 (data-model mục 7): tạo trước 2 tháng, giữ 12 tháng.
registerPartitionedLog({
  table: 'infra.audit_log',
  ensureFunction: 'infra.ensure_audit_log_partitions',
  monthsAhead: 2,
  retentionMonths: 12,
  dropFunction: 'infra.drop_audit_log_partitions_before',
});
