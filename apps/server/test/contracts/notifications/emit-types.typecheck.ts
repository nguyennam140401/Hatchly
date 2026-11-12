// 005 T070 (US4-AS3, FR-041, FR-043): kiểm thử KIỂU – tệp chỉ cần biên dịch được (`pnpm typecheck`). Mỗi
// `@ts-expect-error` khẳng định một lời gọi SAI không biên dịch được; nếu lời gọi đó lại hợp lệ, tsc báo
// "Unused '@ts-expect-error'" và cổng kiểm tra thất bại.
import type { Db } from '../../../src/core';
import type { NotificationsPublicApi } from '../../../src/modules/notifications';

declare const notifications: NotificationsPublicApi;
declare const tx: Db;

export async function typeChecks(): Promise<void> {
  // Hợp lệ.
  await notifications.emit(tx, { type: 'ai_usage_80', refs: { cycleStart: '2026-11-01' } });

  // @ts-expect-error – loại ngoài danh mục.
  await notifications.emit(tx, { type: 'khuyen_mai_moi', refs: {} });

  // @ts-expect-error – thiếu tx (phải phát trong giao dịch nghiệp vụ).
  await notifications.emit({ type: 'ai_usage_80', refs: { cycleStart: '2026-11-01' } });

  // @ts-expect-error – bên phát không truyền được khóa chống trùng.
  await notifications.emit(tx, { type: 'ai_usage_80', refs: { cycleStart: '2026-11-01' }, dedupeKey: 'x' });

  // @ts-expect-error – bên phát không chọn được kênh.
  await notifications.emit(tx, { type: 'ai_usage_80', refs: { cycleStart: '2026-11-01' }, channels: ['email'] });

  // @ts-expect-error – bên phát không chọn được người nhận.
  await notifications.emit(tx, { type: 'ai_usage_80', refs: { cycleStart: '2026-11-01' }, recipients: ['u'] });

  // @ts-expect-error – tham chiếu sai loại.
  await notifications.emit(tx, { type: 'post_returned', refs: { cycleStart: '2026-11-01' } });
}
