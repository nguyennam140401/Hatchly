import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { tenantTx } from '../../../core';
import type { ObjectStorage } from '../../../core/storage';
import { mediaItems, uploadSessions } from './db/schema';
import { allLocs, originalLoc } from './media-keys';

// Bộ xử lý `media.purge_files` (014 data-model.md mục 3, FR-021, R7): xóa tệp THẬT (gốc, chuẩn hóa, thu nhỏ) của một media đã
// xóa mềm. CHẠY LẠI AN TOÀN: xóa đối tượng không có ⇒ không lỗi; `files_purged_at` đặt bằng UPDATE có điều kiện. Media chưa xóa
// mềm thì KHÔNG bao giờ bị xóa tệp ở đây (chốt chặn: người dùng xóa nhầm không mất tệp vì việc lạc).

export interface PurgeDeps {
  storage: ObjectStorage;
  log: { info: (entry: Record<string, unknown>) => void };
}

/** Xóa mọi tệp của một media (gốc + phái sinh) và hủy tải nhiều phần còn mở. Dùng chung với dọn dẹp. */
export async function deleteMediaObjects(
  storage: ObjectStorage,
  mediaId: string,
  multipartUploadId: string | null,
): Promise<void> {
  if (multipartUploadId !== null) {
    await storage
      .abortMultipart(originalLoc(mediaId), { uploadId: multipartUploadId })
      .catch(() => undefined);
  }
  for (const l of allLocs(mediaId)) await storage.delete(l);
}

export function createPurgeFilesHandler(deps: PurgeDeps) {
  return async (payload: { mediaId: string }): Promise<void> => {
    const { mediaId } = payload;
    const row = await tenantTx(async (db) => {
      const media = (
        await db
          .select({
            deleted: mediaItems.deleted_at,
            purged: mediaItems.files_purged_at,
          })
          .from(mediaItems)
          .where(eq(mediaItems.id, mediaId))
          .limit(1)
      )[0];
      if (media === undefined) return null;
      const session = (
        await db
          .select({ upload: uploadSessions.multipart_upload_id })
          .from(uploadSessions)
          .where(
            and(
              eq(uploadSessions.media_id, mediaId),
              isNotNull(uploadSessions.multipart_upload_id),
            ),
          )
          .limit(1)
      )[0];
      return { ...media, multipart: session?.upload ?? null };
    });
    // Không có dòng (đã xóa hẳn) hoặc chưa xóa mềm ⇒ không động tới tệp; đã purge ⇒ xong.
    if (row === null || row.deleted === null || row.purged !== null) return;

    await deleteMediaObjects(deps.storage, mediaId, row.multipart);
    await tenantTx((db) =>
      db
        .update(mediaItems)
        .set({ files_purged_at: sql`now()` })
        .where(
          and(
            eq(mediaItems.id, mediaId),
            isNotNull(mediaItems.deleted_at),
            isNull(mediaItems.files_purged_at),
          ),
        ),
    );
    deps.log.info({ msg: 'media.purge.done' });
  };
}
