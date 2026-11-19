import { and, count, eq, ne, sql } from 'drizzle-orm';
import { AppError } from '../../../../core';
import type { Db } from '../../../../core/db';
import { channelConnections } from '../db/schema';

// Giới hạn số kết nối mỗi nền tảng (010 FR-007, R8). Đếm CHỈ đúng khi giữ khóa tư vấn theo (tài khoản, nền tảng) trong
// cùng giao dịch với lệnh chèn – nếu không, hai thẻ trình duyệt cùng thấy "còn chỗ" rồi cùng chèn, vượt giới hạn.
// Kết nối "Cần kết nối lại" vẫn tính (chưa ngắt); kết nối lại không tốn thêm chỗ (cập nhật tại chỗ, không chèn).

/**
 * Khóa tư vấn theo giao dịch cho `(accountId, channelType)` rồi đếm kết nối chưa ngắt. Phải gọi TRONG giao dịch
 * sẽ chèn kết nối; khóa nhả khi COMMIT/ROLLBACK. Trả số đã dùng.
 */
export async function lockAndCountUsed(
  db: Db,
  accountId: string,
  channelType: string,
): Promise<number> {
  await db.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`channel_limit:${accountId}:${channelType}`}, 0))`,
  );
  const rows = await db
    .select({ n: count() })
    .from(channelConnections)
    .where(
      and(
        eq(channelConnections.account_id, accountId),
        eq(channelConnections.channel_type, channelType),
        ne(channelConnections.status, 'disconnected'),
      ),
    );
  return rows[0]?.n ?? 0;
}

/** Số chỗ còn lại (không âm). */
export function remainingSlots(used: number, max: number): number {
  return Math.max(0, max - used);
}

/** `409 LIMIT_REACHED {used, limit}` – nêu rõ số liệu và cách khắc phục (ngắt bớt kênh). */
export function limitReached(used: number, limit: number): AppError {
  return new AppError({
    code: 'LIMIT_REACHED',
    httpStatus: 409,
    message: `Bạn đã kết nối tối đa ${limit} kênh cho nền tảng này. Hãy ngắt bớt kênh không dùng rồi thử lại.`,
    actions: [{ kind: 'navigate', label: 'Ngắt bớt kênh', href: '/channels' }],
    extra: { used, limit },
  });
}
