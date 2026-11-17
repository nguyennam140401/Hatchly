// Máy trạng thái lượt đăng (013, research R1, Hiến pháp II). ĐÂY LÀ NƠI DUY NHẤT được đổi `status` của
// `publish_attempts`: mọi chuyển là `UPDATE … WHERE id = :id AND status = :expected` và kiểm tra số dòng ảnh hưởng.
// Mất cuộc đua (0 dòng) → `{ ok: false }`, bên gọi thoát mà KHÔNG có tác dụng phụ. Kiểm thử kiến trúc
// (test/unit/publishing-no-raw-status-update) cấm `SET status` ở nơi khác.
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../../core';
import type { AttemptStatus } from '../public-api';
import { publishAttempts, type AttemptPhase, type PublishAttemptRow } from './db/schema';

/** Chuyển hợp lệ (research R1). `succeeded`, `cancelled` là trạng thái cuối. */
export const ALLOWED_TRANSITIONS: Readonly<Record<AttemptStatus, readonly AttemptStatus[]>> = {
  scheduled: ['processing', 'cancelled'],
  processing: ['succeeded', 'retry_wait', 'needs_user', 'unknown', 'cancelled'],
  retry_wait: ['processing', 'cancelled'],
  unknown: ['succeeded', 'retry_wait', 'needs_check'],
  needs_check: ['succeeded', 'scheduled'],
  needs_user: ['scheduled'],
  succeeded: [],
  cancelled: [],
};

export function isAllowedTransition(from: AttemptStatus, to: AttemptStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

type Settable = Omit<
  PublishAttemptRow,
  'id' | 'account_id' | 'status' | 'version' | 'created_at' | 'updated_at'
>;
/** Các cột được cập nhật kèm chuyển trạng thái; giá trị có thể là biểu thức SQL (vd `run_no + 1`). */
export type TransitionPatch = { [K in keyof Settable]?: Settable[K] | SQL };

export class IllegalTransitionError extends Error {
  constructor(from: AttemptStatus, to: AttemptStatus) {
    super(`Chuyển trạng thái lượt đăng không hợp lệ: ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export type TransitionResult = { ok: true; row: PublishAttemptRow } | { ok: false };

/**
 * `from → to` có điều kiện theo trạng thái hiện tại (và, nếu cho `guard`, theo giai đoạn / điều kiện phụ như
 * `reconcile_retry_used = false`).
 * Cặp không hợp lệ là LỖI LẬP TRÌNH (ném); mất cuộc đua là kết quả bình thường (`ok: false`).
 */
export async function transition(
  db: Db,
  id: string,
  from: AttemptStatus | readonly AttemptStatus[],
  to: AttemptStatus,
  patch: TransitionPatch = {},
  guard: { phase?: AttemptPhase; extra?: SQL } = {},
): Promise<TransitionResult> {
  const froms = (Array.isArray(from) ? from : [from]) as AttemptStatus[];
  for (const f of froms) if (!isAllowedTransition(f, to)) throw new IllegalTransitionError(f, to);
  const rows = await db
    .update(publishAttempts)
    .set({
      ...patch,
      status: to,
      version: sql`${publishAttempts.version} + 1`,
      updated_at: sql`now()`,
    })
    .where(
      and(
        eq(publishAttempts.id, id),
        inArray(publishAttempts.status, froms),
        guard.phase === undefined ? undefined : eq(publishAttempts.phase, guard.phase),
        guard.extra,
      ),
    )
    .returning();
  const row = rows[0];
  return row === undefined ? { ok: false } : { ok: true, row };
}

/** Chuyển nhiều lượt cùng `from → to` (vd hủy mọi lượt `scheduled` của bài); trả mã các lượt đã đổi. */
export async function transitionMany(
  db: Db,
  ids: readonly string[],
  from: AttemptStatus | readonly AttemptStatus[],
  to: AttemptStatus,
  patch: TransitionPatch = {},
): Promise<string[]> {
  if (ids.length === 0) return [];
  const froms = (Array.isArray(from) ? from : [from]) as AttemptStatus[];
  for (const f of froms) if (!isAllowedTransition(f, to)) throw new IllegalTransitionError(f, to);
  const rows = await db
    .update(publishAttempts)
    .set({
      ...patch,
      status: to,
      version: sql`${publishAttempts.version} + 1`,
      updated_at: sql`now()`,
    })
    .where(and(inArray(publishAttempts.id, [...ids]), inArray(publishAttempts.status, froms)))
    .returning({ id: publishAttempts.id });
  return rows.map((r) => r.id);
}

/**
 * Cập nhật KHÔNG đổi trạng thái (đổi giai đoạn, ghi mã bài…) có điều kiện theo trạng thái + giai đoạn hiện tại.
 * Không dùng để đổi `status`.
 */
export async function updateInPlace(
  db: Db,
  id: string,
  expect: { status: AttemptStatus | readonly AttemptStatus[]; phase?: AttemptPhase },
  patch: TransitionPatch,
): Promise<TransitionResult> {
  const statuses = (
    Array.isArray(expect.status) ? expect.status : [expect.status]
  ) as AttemptStatus[];
  const rows = await db
    .update(publishAttempts)
    .set({ ...patch, version: sql`${publishAttempts.version} + 1`, updated_at: sql`now()` })
    .where(
      and(
        eq(publishAttempts.id, id),
        inArray(publishAttempts.status, statuses),
        expect.phase === undefined ? undefined : eq(publishAttempts.phase, expect.phase),
      ),
    )
    .returning();
  const row = rows[0];
  return row === undefined ? { ok: false } : { ok: true, row };
}

/**
 * Ghi dấu "Đã gửi, chờ phản hồi" TRƯỚC khi gọi nền tảng (R3, bước A): chỉ thành công khi lượt đang
 * `processing` ở giai đoạn `none` → `content_hash` và `submitted_at` chỉ ghi MỘT lần cho mỗi lượt gửi.
 */
export function stampSubmitted(db: Db, id: string, contentHash: string): Promise<TransitionResult> {
  return updateInPlace(
    db,
    id,
    { status: 'processing', phase: 'none' },
    {
      phase: 'submitted_awaiting_response',
      content_hash: contentHash,
      submitted_at: sql`now()`,
    },
  );
}
