// Kho dữ liệu của bài (012 data-model.md mục 1): mọi thao tác chạy trên `Db` của giao dịch đang mở.
// Mọi chuyển trạng thái là `UPDATE … WHERE version = :đã_xem AND status = ANY(:từ)`; 0 dòng là thất bại có
// chủ đích (xung đột / sai trạng thái), KHÔNG phải lỗi 500. Sự kiện ghi cùng giao dịch, KHÔNG có nội dung bài.
import { and, asc, desc, eq, ilike, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { currentAccountId, uuidV7, type Db } from '../../../core';
import type {
  PostEventInput,
  PostEventRecord,
  PostRecord,
  TransitionInput,
  TransitionResult,
  TransitionSet,
  VariantRecord,
} from '../public-api';
import {
  channelVariants,
  postEvents,
  posts,
  type ChannelVariantRow,
  type PostRow,
} from './db/schema';

type VariantMedia = VariantRecord['media'];

export function accountIdOrThrow(): string {
  const id = currentAccountId();
  if (id === null) throw new Error('Thiếu ngữ cảnh tài khoản (TENANT_CONTEXT_MISSING)');
  return id;
}

export function toVariantRecord(row: ChannelVariantRow): VariantRecord {
  return {
    id: row.id,
    connectionId: row.connection_id,
    channelType: row.channel_type as VariantRecord['channelType'],
    customized: row.customized,
    text: row.text,
    hashtags: row.hashtags,
    media: row.media as VariantMedia,
    version: row.version,
  };
}

export function toPostRecord(row: PostRow, variants: ChannelVariantRow[]): PostRecord {
  return {
    id: row.id,
    status: row.status as PostRecord['status'],
    source: row.source as PostRecord['source'],
    internalName: row.internal_name,
    sharedText: row.shared_text,
    scheduledAt: row.scheduled_at,
    createdBy: row.created_by,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    submissionId: row.submission_id,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    returnedNote: row.returned_note,
    returnedBy: row.returned_by,
    returnedAt: row.returned_at,
    editedAfterApproval: row.edited_after_approval,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    variants: variants
      .filter((v) => v.post_id === row.id)
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id.localeCompare(b.id))
      .map(toVariantRecord),
  };
}

/** Đọc bài (chưa xóa mềm) kèm phiên bản kênh; `lock` → `FOR UPDATE` trên dòng bài. */
export async function loadPost(db: Db, id: string, lock = false): Promise<PostRecord | null> {
  const q = db
    .select()
    .from(posts)
    .where(and(eq(posts.id, id), isNull(posts.deleted_at)))
    .limit(1);
  const rows = await (lock ? q.for('update') : q);
  const row = rows[0];
  if (row === undefined) return null;
  const variants = await db.select().from(channelVariants).where(eq(channelVariants.post_id, id));
  return toPostRecord(row, variants);
}

export async function loadPostsByIds(db: Db, ids: readonly string[]): Promise<PostRecord[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(posts)
    .where(and(inArray(posts.id, [...ids]), isNull(posts.deleted_at)));
  return attachVariants(db, rows);
}

export async function attachVariants(db: Db, rows: PostRow[]): Promise<PostRecord[]> {
  if (rows.length === 0) return [];
  const variants = await db
    .select()
    .from(channelVariants)
    .where(
      inArray(
        channelVariants.post_id,
        rows.map((r) => r.id),
      ),
    );
  return rows.map((r) => toPostRecord(r, variants));
}

/** Cột bài ứng với `TransitionSet` (chỉ trường được đặt). */
export function setToColumns(set: TransitionSet | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (set === undefined) return out;
  const map: [keyof TransitionSet, string][] = [
    ['scheduledAt', 'scheduled_at'],
    ['approvedBy', 'approved_by'],
    ['approvedAt', 'approved_at'],
    ['submittedBy', 'submitted_by'],
    ['submittedAt', 'submitted_at'],
    ['submissionId', 'submission_id'],
    ['returnedNote', 'returned_note'],
    ['returnedBy', 'returned_by'],
    ['returnedAt', 'returned_at'],
    ['editedAfterApproval', 'edited_after_approval'],
  ];
  for (const [key, column] of map) {
    if (set[key] !== undefined) out[column] = set[key];
  }
  return out;
}

export async function appendEvent(db: Db, postId: string, event: PostEventInput): Promise<void> {
  await db.insert(postEvents).values({
    id: uuidV7(),
    account_id: accountIdOrThrow(),
    post_id: postId,
    type: event.type,
    actor_user_id: event.actorUserId,
    data: event.data,
  });
}

/**
 * Đổi trạng thái có điều kiện. Thành công → ghi sự kiện cùng giao dịch. Thất bại → đọc lại để phân biệt
 * `conflict` (lệch phiên bản) với `wrong_state` (đúng phiên bản nhưng sai trạng thái – hiếm vì mọi ghi tăng
 * phiên bản) và `not_found`.
 */
export async function transitionPost(db: Db, input: TransitionInput): Promise<TransitionResult> {
  const rows = await db
    .update(posts)
    .set({
      status: input.to,
      ...setToColumns(input.set),
      version: sql`${posts.version} + 1`,
      updated_at: sql`now()`,
    })
    .where(
      and(
        eq(posts.id, input.postId),
        eq(posts.version, input.expectedVersion),
        inArray(posts.status, input.from),
        isNull(posts.deleted_at),
      ),
    )
    .returning();
  const updated = rows[0];
  if (updated !== undefined) {
    await appendEvent(db, input.postId, input.event);
    const post = await loadPost(db, input.postId);
    if (post === null) throw new Error('Bài vừa cập nhật nhưng không đọc lại được');
    return { kind: 'ok', post };
  }
  const current = await loadPost(db, input.postId);
  if (current === null) return { kind: 'not_found' };
  if (current.version !== input.expectedVersion) return { kind: 'conflict', current };
  return { kind: 'wrong_state', current };
}

/** Dấu vân tay nội dung đã đăng: chữ chung, mỗi kênh (chữ riêng, hashtag, media) và TẬP KÊNH. */
export function contentFingerprint(post: {
  sharedText: string;
  variants: Pick<VariantRecord, 'connectionId' | 'customized' | 'text' | 'hashtags' | 'media'>[];
}): string {
  const variants = [...post.variants]
    .sort((a, b) => a.connectionId.localeCompare(b.connectionId))
    .map((v) => ({
      c: v.connectionId,
      z: v.customized,
      t: v.customized ? v.text : '',
      h: v.hashtags,
      m: v.media,
    }));
  return JSON.stringify({ s: post.sharedText, v: variants });
}

// ---------------------------------------------------------------------------------------------
// Danh sách / tìm kiếm / chờ duyệt / lịch

export function encodeCursor(parts: (string | number)[]): string {
  return Buffer.from(parts.join('|'), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined): string[] | null {
  if (cursor === undefined) return null;
  try {
    return Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  } catch {
    return null;
  }
}

/** Thoát `%`, `_`, `\` để từ khóa của người dùng không thành mẫu tìm kiếm. */
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function listPostRows(
  db: Db,
  filter: {
    status?: string | undefined;
    q?: string | undefined;
    cursor?: string | undefined;
    limit: number;
  },
): Promise<{ rows: PostRow[]; nextCursor: string | null }> {
  const conds: (SQL | undefined)[] = [isNull(posts.deleted_at)];
  if (filter.status !== undefined) conds.push(eq(posts.status, filter.status));
  if (filter.q !== undefined && filter.q.trim() !== '') {
    const pattern = `%${escapeLike(filter.q.trim())}%`;
    conds.push(or(ilike(posts.shared_text, pattern), ilike(posts.internal_name, pattern)));
  }
  const cursor = decodeCursor(filter.cursor);
  if (cursor !== null && cursor.length === 2) {
    const [at, id] = cursor as [string, string];
    conds.push(
      or(
        lt(posts.created_at, new Date(at)),
        and(eq(posts.created_at, new Date(at)), lt(posts.id, id)),
      ),
    );
  }
  const rows = await db
    .select()
    .from(posts)
    .where(and(...conds))
    .orderBy(desc(posts.created_at), desc(posts.id))
    .limit(filter.limit + 1);
  const page = rows.slice(0, filter.limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > filter.limit && last !== undefined
      ? encodeCursor([last.created_at.toISOString(), last.id])
      : null;
  return { rows: page, nextCursor };
}

export async function listPendingRows(
  db: Db,
  page: { cursor?: string | undefined; limit: number },
): Promise<{ rows: PostRow[]; nextCursor: string | null }> {
  const cursor = decodeCursor(page.cursor);
  const offset = Math.max(0, Number(cursor?.[0]) || 0);
  const rows = await db
    .select()
    .from(posts)
    .where(and(eq(posts.status, 'pending_review'), isNull(posts.deleted_at)))
    .orderBy(sql`${posts.scheduled_at} ASC NULLS LAST`, asc(posts.id))
    .limit(page.limit + 1)
    .offset(offset);
  const items = rows.slice(0, page.limit);
  return {
    rows: items,
    nextCursor: rows.length > page.limit ? encodeCursor([offset + page.limit]) : null,
  };
}

export async function countPending(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(posts)
    .where(and(eq(posts.status, 'pending_review'), isNull(posts.deleted_at)));
  return row?.n ?? 0;
}

export async function listCalendarRows(db: Db, from: Date, to: Date): Promise<PostRow[]> {
  return db
    .select()
    .from(posts)
    .where(
      and(
        isNull(posts.deleted_at),
        sql`${posts.scheduled_at} >= ${from.toISOString()}::timestamptz`,
        sql`${posts.scheduled_at} < ${to.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(posts.scheduled_at), asc(posts.id));
}

export async function listEventRows(db: Db, postId: string): Promise<PostEventRecord[]> {
  const rows = await db
    .select()
    .from(postEvents)
    .where(eq(postEvents.post_id, postId))
    .orderBy(asc(postEvents.occurred_at), asc(postEvents.id));
  return rows.map((r) => ({
    id: r.id,
    type: r.type as PostEventRecord['type'],
    actorUserId: r.actor_user_id,
    occurredAt: r.occurred_at,
    data: r.data as PostEventRecord['data'],
  }));
}
