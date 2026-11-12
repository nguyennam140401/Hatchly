// 005 T070 (US4-AS3, FR-041, FR-043): kiểm thử KIỂU – tệp chỉ cần biên dịch được (`pnpm typecheck`). Mỗi
// `@ts-expect-error` khẳng định một lời gọi SAI không biên dịch được; nếu lời gọi đó lại hợp lệ, tsc báo
// "Unused '@ts-expect-error'" và cổng kiểm tra thất bại. Chỉ thị đặt NGAY TRÊN dòng vi phạm (prettier ngắt dòng).
import type { Db } from '../../../src/core';
import type { NotificationsPublicApi } from '../../../src/modules/notifications';

declare const notifications: NotificationsPublicApi;
declare const tx: Db;
const refs = { cycleStart: '2026-11-01' };

export async function typeChecks(): Promise<void> {
  // Hợp lệ.
  await notifications.emit(tx, { type: 'ai_usage_80', refs });

  // @ts-expect-error – loại ngoài danh mục.
  await notifications.emit(tx, { type: 'khuyen_mai_moi', refs: {} });

  // @ts-expect-error – thiếu tx (phải phát trong giao dịch nghiệp vụ).
  await notifications.emit({ type: 'ai_usage_80', refs });

  await notifications.emit(tx, {
    type: 'ai_usage_80',
    refs,
    // @ts-expect-error – bên phát không truyền được khóa chống trùng.
    dedupeKey: 'x',
  });

  await notifications.emit(tx, {
    type: 'ai_usage_80',
    refs,
    // @ts-expect-error – bên phát không chọn được kênh.
    channels: ['email'],
  });

  await notifications.emit(tx, {
    type: 'ai_usage_80',
    refs,
    // @ts-expect-error – bên phát không chọn được người nhận.
    recipients: ['u'],
  });

  // @ts-expect-error – tham chiếu sai loại.
  await notifications.emit(tx, { type: 'post_returned', refs });
}
