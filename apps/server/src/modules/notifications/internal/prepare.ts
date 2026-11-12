import { NotificationEventSchema, type NotificationEvent } from '@app/shared/notifications';
import { dedupeKey } from './dedupe-keys';
import { assertNoForbidden, NotificationEventInvalidError } from './forbidden';

// Bước kiểm dùng chung (005, R9b): khuôn Zod + trường bị cấm + dựng khóa. Dùng bởi `emit` (bản thật), bộ
// phát chế độ memory và bộ xử lý `deliver` (dữ liệu từ hàng chờ không được tin).

export interface PreparedEvent {
  event: NotificationEvent;
  dedupeKey: string;
}

export function prepareEvent(raw: unknown): PreparedEvent {
  assertNoForbidden(raw);
  const parsed = NotificationEventSchema.safeParse(raw);
  if (!parsed.success) throw new NotificationEventInvalidError('schema');
  return { event: parsed.data, dedupeKey: dedupeKey(parsed.data) };
}
