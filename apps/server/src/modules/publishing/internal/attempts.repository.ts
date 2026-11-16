// Kho mục lịch đăng (012 data-model.md mục 2–3). Chốt chặn cuối chống đăng trùng là CHỈ MỤC DUY NHẤT có
// điều kiện `(account_id, post_id, channel_connection_id) WHERE status <> 'cancelled'` (Hiến pháp II);
// mọi chuyển trạng thái là cập nhật có điều kiện theo trạng thái hiện tại.
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { currentAccountId, uuidV7, type Db } from '../../../core';
import type { ChannelType } from '@app/shared/content';
import { publishAttempts, type PublishAttemptRow } from './db/schema';

const DAY_MS = 24 * 3_600_000;

export function accountIdOrThrow(): string {
  const id = currentAccountId();
  if (id === null) throw new Error('Thiếu ngữ cảnh tài khoản (TENANT_CONTEXT_MISSING)');
  return id;
}

/**
 * Khóa tư vấn theo kênh – lấy theo thứ tự `connectionId` TĂNG DẦN (tránh khóa chéo giữa hai bài cùng
 * nhiều kênh) để hai lần duyệt đồng thời không cùng vượt hạn mức của một kênh.
 */
export async function lockChannelsForQuota(
  db: Db,
  connectionIds: readonly string[],
): Promise<void> {
  for (const id of [...new Set(connectionIds)].sort()) {
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`publish_quota:${id}`}))`);
  }
}

/**
 * Số mục hiệu lực của kênh quanh giờ `at` có vượt `limit` trong BẤT KỲ cửa sổ trượt 24 giờ nào không,
 * sau khi thêm mục mới ở `at`. `excludePostId`: bỏ các mục của chính bài đang đổi giờ.
 */
export async function wouldExceedQuota(
  db: Db,
  connectionId: string,
  at: Date,
  limit: number,
  excludePostId?: string,
): Promise<boolean> {
  const from = new Date(at.getTime() - DAY_MS);
  const to = new Date(at.getTime() + DAY_MS);
  const rows = await db
    .select({ at: publishAttempts.scheduled_at })
    .from(publishAttempts)
    .where(
      and(
        eq(publishAttempts.channel_connection_id, connectionId),
        ne(publishAttempts.status, 'cancelled'),
        sql`${publishAttempts.scheduled_at} > ${from.toISOString()}::timestamptz`,
        sql`${publishAttempts.scheduled_at} < ${to.toISOString()}::timestamptz`,
        excludePostId === undefined ? undefined : ne(publishAttempts.post_id, excludePostId),
      ),
    );
  const times = [...rows.map((r) => r.at.getTime()), at.getTime()].sort((a, b) => a - b);
  // limit+1 mục nằm gọn trong một cửa sổ 24 giờ ⇒ vượt hạn mức.
  for (let i = 0; i + limit < times.length; i++) {
    if ((times[i + limit] ?? 0) - (times[i] ?? 0) < DAY_MS) return true;
  }
  return false;
}

/** Chèn mục lịch đăng; trùng chỉ mục duy nhất → không chèn (trả `null`). */
export async function insertAttempt(
  db: Db,
  input: {
    postId: string;
    connectionId: string;
    channelType: ChannelType;
    scheduledAt: Date;
    contentVersion: number;
  },
): Promise<string | null> {
  const id = uuidV7();
  const rows = await db
    .insert(publishAttempts)
    .values({
      id,
      account_id: accountIdOrThrow(),
      post_id: input.postId,
      channel_connection_id: input.connectionId,
      channel_type: input.channelType,
      status: 'scheduled',
      scheduled_at: input.scheduledAt,
      content_version: input.contentVersion,
    })
    .onConflictDoNothing({
      target: [
        publishAttempts.account_id,
        publishAttempts.post_id,
        publishAttempts.channel_connection_id,
      ],
      where: sql`${publishAttempts.status} <> 'cancelled'`,
    })
    .returning({ id: publishAttempts.id });
  return rows[0]?.id ?? null;
}

/** Các mục hiệu lực (không `cancelled`) của bài; `lock` → `FOR UPDATE`. */
export async function effectiveAttempts(
  db: Db,
  postId: string,
  lock = false,
): Promise<PublishAttemptRow[]> {
  const q = db
    .select()
    .from(publishAttempts)
    .where(and(eq(publishAttempts.post_id, postId), ne(publishAttempts.status, 'cancelled')))
    .orderBy(asc(publishAttempts.channel_connection_id));
  return lock ? q.for('update') : q;
}

export async function attemptsByPosts(
  db: Db,
  postIds: readonly string[],
): Promise<PublishAttemptRow[]> {
  if (postIds.length === 0) return [];
  return db
    .select()
    .from(publishAttempts)
    .where(
      and(inArray(publishAttempts.post_id, [...postIds]), ne(publishAttempts.status, 'cancelled')),
    )
    .orderBy(asc(publishAttempts.scheduled_at), asc(publishAttempts.channel_connection_id));
}

/** `scheduled → cancelled` có điều kiện; trả số dòng đã đổi. */
export async function cancelScheduled(db: Db, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .update(publishAttempts)
    .set({
      status: 'cancelled',
      version: sql`${publishAttempts.version} + 1`,
      updated_at: sql`now()`,
    })
    .where(and(inArray(publishAttempts.id, [...ids]), eq(publishAttempts.status, 'scheduled')))
    .returning({ id: publishAttempts.id });
  return rows.map((r) => r.id);
}

/** Đổi giờ mục còn `scheduled`; trả mã mục đã đổi. */
export async function moveScheduled(
  db: Db,
  ids: readonly string[],
  scheduledAt: Date,
): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .update(publishAttempts)
    .set({
      scheduled_at: scheduledAt,
      version: sql`${publishAttempts.version} + 1`,
      updated_at: sql`now()`,
    })
    .where(and(inArray(publishAttempts.id, [...ids]), eq(publishAttempts.status, 'scheduled')))
    .returning({ id: publishAttempts.id });
  return rows.map((r) => r.id);
}

/** Chuyển trạng thái có điều kiện theo trạng thái hiện tại; trả `true` nếu đổi được. */
export async function transitionAttempt(
  db: Db,
  id: string,
  from: PublishAttemptRow['status'],
  to: PublishAttemptRow['status'],
): Promise<boolean> {
  const rows = await db
    .update(publishAttempts)
    .set({ status: to, version: sql`${publishAttempts.version} + 1`, updated_at: sql`now()` })
    .where(and(eq(publishAttempts.id, id), eq(publishAttempts.status, from)))
    .returning({ id: publishAttempts.id });
  return rows.length === 1;
}

export async function loadAttempt(db: Db, id: string): Promise<PublishAttemptRow | null> {
  const rows = await db.select().from(publishAttempts).where(eq(publishAttempts.id, id)).limit(1);
  return rows[0] ?? null;
}
