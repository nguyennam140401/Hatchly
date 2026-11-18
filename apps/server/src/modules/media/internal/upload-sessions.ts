// Đóng một phiên tải đang mở: chuyển trạng thái (UPDATE có điều kiện), trả giữ chỗ, xóa dòng `uploading` – dùng chung
// cho hủy (API), xác nhận bị bác và hết hạn (dọn nền). Chạy lại an toàn: phiên đã đóng ⇒ trả `null`, không trả giữ chỗ
// lần hai (hiến pháp V). Mọi thao tác nằm trong giao dịch của NƠI GỌI.
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../../core';
import { mediaItems, uploadSessions, type UploadSessionRow } from './db/schema';
import type { QuotaStore } from './quota.store';

export type ClosedState = 'cancelled' | 'expired' | 'failed';

/**
 * Đóng phiên `open`/`completing` thành `to`. Trả dòng phiên (trước khi đóng) nếu LẦN NÀY đóng được, `null` nếu người
 * khác đã đóng. Trả giữ chỗ và xóa dòng `media` còn `uploading` cùng giao dịch.
 */
export async function closeSession(
  db: Db,
  quota: QuotaStore,
  sessionId: string,
  to: ClosedState,
  failureCode?: string,
  from: readonly ('open' | 'completing')[] = ['open', 'completing'],
): Promise<UploadSessionRow | null> {
  const closed = await db
    .update(uploadSessions)
    .set({
      state: to,
      ...(failureCode !== undefined ? { failure_code: failureCode } : {}),
      completed_at: sql`now()`,
    })
    .where(and(eq(uploadSessions.id, sessionId), inArray(uploadSessions.state, [...from])))
    .returning();
  const row = closed[0];
  if (row === undefined) return null;
  await quota.releaseReservation(db, row.declared_bytes);
  // Dòng `media` chưa vào thư viện: bỏ hẳn (không xóa mềm – chưa từng có tệp xác nhận).
  await db
    .delete(mediaItems)
    .where(and(eq(mediaItems.id, row.media_id), eq(mediaItems.status, 'uploading')));
  return row;
}
