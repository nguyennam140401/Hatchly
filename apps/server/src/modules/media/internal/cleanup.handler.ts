import { and, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { tenantTx } from '../../../core';
import type { ObjectStorage } from '../../../core/storage';
import { mediaItems, storageQuotas, uploadSessions, type UploadSessionRow } from './db/schema';
import { originalLoc } from './media-keys';
import { deleteMediaObjects } from './purge.handler';
import type { QuotaStore } from './quota.store';
import { closeSession } from './upload-sessions';

// Bộ xử lý `media.cleanup` (014 data-model.md mục 3, R7, FR-009, FR-021, FR-028) cho MỘT tài khoản, CHẠY LẠI AN TOÀN – mỗi
// bước đọc trạng thái rồi mới làm, mọi chuyển trạng thái là UPDATE có điều kiện:
//   `stale`: phiên tải quá 24 giờ kể từ hoạt động cuối ⇒ `expired` + hủy nhiều phần + xóa tệp dở + trả giữ chỗ + xóa dòng dở;
//            xóa tệp thật của media đã xóa mềm mà việc purge bị lạc.
//   `full` (tuần): thêm — xóa HẲN dòng đã xóa mềm > 30 ngày, tệp mồ côi trong kho (không có bản ghi), bản ghi mất tệp (báo
//            "Không xử lý được" + trả dung lượng), đối soát bộ đếm dung lượng với tổng thực (ghi độ lệch rồi sửa).

const BATCH = 100;
const MAX_BATCHES = 50;
const SOFT_DELETE_DAYS = 30;
const STUCK_COMPLETING_MS = 3_600_000;
/** Tệp trong kho mới hơn mức này chưa chắc là mồ côi (có thể đang được tải): chỉ xử lý tệp cũ hơn 1 ngày. */
const ORPHAN_MIN_AGE_MS = 86_400_000;

export interface CleanupResult {
  expired: number;
  purged: number;
  deleted: number;
  orphans: number;
  missing: number;
  /** Độ lệch bộ đếm đã sửa, tính bằng byte (|used lệch| + |giữ chỗ lệch|). */
  drift: number;
}

export interface CleanupDeps {
  storage: ObjectStorage;
  quota: QuotaStore;
  log: {
    info: (entry: Record<string, unknown>) => void;
    warn: (entry: Record<string, unknown>) => void;
  };
  now?: () => Date;
  /** Báo độ lệch bộ đếm (chỉ số `media_quota_drift_total`). */
  onDrift?: (bytes: number) => void;
}

const empty = (): CleanupResult => ({
  expired: 0,
  purged: 0,
  deleted: 0,
  orphans: 0,
  missing: 0,
  drift: 0,
});

export function createCleanupHandler(deps: CleanupDeps) {
  const now = () => (deps.now ?? (() => new Date()))();

  /** Phiên `open` quá hạn (hoặc `completing` bị bỏ dở > 1 giờ). */
  async function expireStaleSessions(result: CleanupResult): Promise<void> {
    for (let i = 0; i < MAX_BATCHES; i++) {
      const cutoff = now();
      const batch = await tenantTx((db) =>
        db
          .select({ id: uploadSessions.id, state: uploadSessions.state })
          .from(uploadSessions)
          .where(
            or(
              and(eq(uploadSessions.state, 'open'), lt(uploadSessions.expires_at, cutoff)),
              and(
                eq(uploadSessions.state, 'completing'),
                lt(
                  uploadSessions.last_activity_at,
                  new Date(cutoff.getTime() - STUCK_COMPLETING_MS),
                ),
              ),
            ),
          )
          .limit(BATCH),
      );
      if (batch.length === 0) return;
      let progressed = 0;
      for (const s of batch) {
        const closed: UploadSessionRow | null = await tenantTx((db) =>
          closeSession(db, deps.quota, s.id, 'expired', undefined, [
            s.state as 'open' | 'completing',
          ]),
        );
        if (closed === null) continue;
        progressed += 1;
        // Tệp dở trong kho (tải một lần hoặc nhiều phần) – lỗi kho không chặn các phiên khác.
        await deleteMediaObjects(deps.storage, closed.media_id, closed.multipart_upload_id).catch(
          () => undefined,
        );
        deps.log.info({ msg: 'media.upload.expired' });
      }
      result.expired += progressed;
      if (progressed === 0) return;
    }
  }

  /** Media đã xóa mềm mà tệp thật chưa được xóa (việc purge bị lạc / lỗi). */
  async function purgeLost(result: CleanupResult): Promise<void> {
    for (let i = 0; i < MAX_BATCHES; i++) {
      const rows = await tenantTx((db) =>
        db
          .select({ id: mediaItems.id })
          .from(mediaItems)
          .where(and(isNotNull(mediaItems.deleted_at), isNull(mediaItems.files_purged_at)))
          .limit(BATCH),
      );
      if (rows.length === 0) return;
      for (const r of rows) {
        await deleteMediaObjects(deps.storage, r.id, null);
        const marked = await tenantTx((db) =>
          db
            .update(mediaItems)
            .set({ files_purged_at: sql`now()` })
            .where(and(eq(mediaItems.id, r.id), isNull(mediaItems.files_purged_at)))
            .returning({ id: mediaItems.id }),
        );
        result.purged += marked.length;
      }
    }
  }

  /** Xóa HẲN dòng đã xóa mềm > 30 ngày (tệp thật đã xóa trước đó); phiên tải của nó đi theo (CASCADE). */
  async function hardDelete(result: CleanupResult): Promise<void> {
    const cutoff = new Date(now().getTime() - SOFT_DELETE_DAYS * 86_400_000);
    const gone = await tenantTx((db) =>
      db
        .delete(mediaItems)
        .where(
          and(
            isNotNull(mediaItems.deleted_at),
            lt(mediaItems.deleted_at, cutoff),
            isNotNull(mediaItems.files_purged_at),
          ),
        )
        .returning({ id: mediaItems.id }),
    );
    result.deleted += gone.length;
  }

  /** Tệp trong kho không có bản ghi nào ⇒ mồ côi (chỉ tệp cũ > 1 ngày). */
  async function sweepOrphans(result: CleanupResult): Promise<void> {
    const known = await tenantTx(async (db) => {
      const rows = await db.select({ id: mediaItems.id }).from(mediaItems);
      return new Set(rows.map((r) => r.id));
    });
    let after: string | undefined;
    const seen = new Set<string>();
    do {
      const page = await deps.storage.list(
        { kind: 'media' },
        { ...(after !== undefined ? { after } : {}), limit: 500 },
      );
      for (const item of page.items) {
        if (
          item.loc.kind === 'media_original' ||
          item.loc.kind === 'media_normalized' ||
          item.loc.kind === 'media_thumb'
        ) {
          const id = item.loc.mediaId;
          if (known.has(id) || seen.has(id)) continue;
          const info = await deps.storage.stat(item.loc);
          if (!info.exists || now().getTime() - info.lastModified.getTime() < ORPHAN_MIN_AGE_MS)
            continue;
          seen.add(id);
          await deleteMediaObjects(deps.storage, id, null);
          result.orphans += 1;
        }
      }
      after = page.next; // KHÓA đối tượng do kho trả – truyền lại nguyên văn
    } while (after !== undefined);
  }

  /** Bản ghi `ready` mà tệp gốc không còn ⇒ "Không xử lý được" + trả dung lượng (người dùng tải lại, không có ô trống). */
  async function markMissing(result: CleanupResult): Promise<void> {
    const ready = await tenantTx((db) =>
      db
        .select({ id: mediaItems.id })
        .from(mediaItems)
        .where(and(eq(mediaItems.status, 'ready'), isNull(mediaItems.deleted_at))),
    );
    for (const r of ready) {
      const info = await deps.storage.stat(originalLoc(r.id));
      if (info.exists) continue;
      const moved = await tenantTx(async (db) => {
        const m = await db
          .update(mediaItems)
          .set({
            status: 'unprocessable',
            failure_code: 'storage_mismatch',
            processed_at: sql`now()`,
          })
          .where(
            and(
              eq(mediaItems.id, r.id),
              eq(mediaItems.status, 'ready'),
              isNull(mediaItems.deleted_at),
            ),
          )
          .returning({ bytes: mediaItems.original_bytes });
        if (m[0] === undefined) return false;
        await deps.quota.refundUsed(db, m[0].bytes);
        return true;
      });
      if (moved) result.missing += 1;
    }
  }

  /** Đối soát bộ đếm với tổng thực; khóa dòng bộ đếm trước khi tính để không đua với thao tác đang chạy. */
  async function reconcileQuota(result: CleanupResult): Promise<void> {
    const drift = await tenantTx(async (db) => {
      const locked = (await db.select().from(storageQuotas).limit(1).for('update'))[0];
      if (locked === undefined) return 0;
      const used = await db
        .select({ total: sql<string>`coalesce(sum(${mediaItems.original_bytes}), 0)::text` })
        .from(mediaItems)
        .where(
          and(isNull(mediaItems.deleted_at), sql`${mediaItems.status} IN ('processing', 'ready')`),
        );
      const reserved = await db
        .select({ total: sql<string>`coalesce(sum(${uploadSessions.declared_bytes}), 0)::text` })
        .from(uploadSessions)
        .where(sql`${uploadSessions.state} IN ('open', 'completing')`);
      const expectedUsed = Number(used[0]?.total ?? 0);
      const expectedReserved = Number(reserved[0]?.total ?? 0);
      if (expectedUsed === locked.used_bytes && expectedReserved === locked.reserved_bytes)
        return 0;
      await db
        .update(storageQuotas)
        .set({ used_bytes: expectedUsed, reserved_bytes: expectedReserved })
        .where(eq(storageQuotas.id, locked.id));
      return (
        Math.abs(expectedUsed - locked.used_bytes) +
        Math.abs(expectedReserved - locked.reserved_bytes)
      );
    });
    if (drift > 0) {
      result.drift += drift;
      deps.onDrift?.(drift);
      deps.log.warn({ msg: 'media.quota.drift', bytes: drift });
    }
  }

  return async (payload: { scope: 'stale' | 'full' }): Promise<CleanupResult> => {
    const result = empty();
    await expireStaleSessions(result);
    await purgeLost(result);
    if (payload.scope === 'full') {
      await hardDelete(result);
      await sweepOrphans(result);
      await markMissing(result);
      await reconcileQuota(result);
    }
    deps.log.info({ msg: 'media.cleanup.done', scope: payload.scope, ...result });
    return result;
  };
}
