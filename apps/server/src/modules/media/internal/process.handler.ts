import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { UnprocessableCode } from '@app/shared/media';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { currentAccountId, tenantTx } from '../../../core';
import type { ObjectStorage } from '../../../core/storage';
import { enqueue, noRetry, type JobContext, type JobHandlerResult } from '../../queue';
import { purgeDedupeKey, purgeMediaFiles } from '../jobs';
import { mediaItems, uploadSessions } from './db/schema';
import { ImagePipelineError } from './image-errors';
import { processImage, thumbnailOf } from './image-pipeline';
import { normalizedLoc, originalLoc, thumbLoc } from './media-keys';
import type { QuotaStore } from './quota.store';
import { extractFrame, probeVideo, VideoPipelineError } from './video-pipeline';

// Bộ xử lý `media.process` (014 data-model.md mục 3, R3–R5, R11): tải tệp gốc về đĩa tạm, TÍNH SHA-256 Ở WORKER, phát hiện
// trùng nội dung TRƯỚC mọi bước tốn CPU, chuẩn hóa ảnh / lấy ảnh thu nhỏ video, rồi đặt `ready` bằng MỘT câu UPDATE có điều
// kiện. CHẠY LẠI AN TOÀN (hiến pháp V): bỏ qua khi không còn `processing`; tệp phái sinh ghi theo khóa cố định theo `mediaId`
// (ghi đè được); mọi chuyển trạng thái là `UPDATE … WHERE status = 'processing' RETURNING`. Lỗi VĨNH VIỄN (tệp hỏng/không hỗ
// trợ/quá điểm ảnh/ảnh động/không có luồng hình) ⇒ `unprocessable` + trả dung lượng + `noRetry` (không vào việc hỏng); lỗi TẠM
// (kho, ffmpeg bị ngắt) ⇒ ném để hàng chờ thử lại, hết lần thử ⇒ `onFinalFailure`.

export interface ProcessLog {
  info: (entry: Record<string, unknown>) => void;
  warn: (entry: Record<string, unknown>) => void;
}

export interface ProcessDeps {
  storage: ObjectStorage;
  quota: QuotaStore;
  log: ProcessLog;
  /** Thư mục gốc cho tệp tạm của việc (mặc định `os.tmpdir()` – `emptyDir` trong manifest K8s). */
  tmpRoot?: () => string;
  now?: () => number;
}

/** Lỗi do việc bị hủy (tắt có kiểm soát) phải đi ra nguyên vẹn để hàng chờ thử lại sau, không coi là tệp hỏng. */
function isAbort(err: unknown): boolean {
  const e = err as { name?: string; code?: string };
  return e.name === 'AbortError' || e.code === 'ABORT_ERR';
}

function isHashConflict(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const e = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (e.code === '23505') return e.constraint === 'media_account_file_hash_key';
    current = e.cause;
  }
  return false;
}

/** Tải gốc về `file` theo luồng, vừa ghi vừa băm; trả SHA-256 hex. */
async function downloadAndHash(
  storage: ObjectStorage,
  mediaId: string,
  file: string,
  signal: AbortSignal,
): Promise<string> {
  const hash = createHash('sha256');
  const hasher = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  const source = await storage.read(originalLoc(mediaId));
  await pipeline(source, hasher, createWriteStream(file), { signal });
  return hash.digest('hex');
}

export function createProcessMediaHandler(deps: ProcessDeps) {
  const now = deps.now ?? Date.now;

  /** `unprocessable` + trả dung lượng, trong MỘT giao dịch; đã chuyển rồi (chạy lại) ⇒ không trả lần hai. */
  async function markUnprocessable(mediaId: string, code: UnprocessableCode): Promise<void> {
    await tenantTx(async (db) => {
      const moved = await db
        .update(mediaItems)
        .set({ status: 'unprocessable', failure_code: code, processed_at: sql`now()` })
        .where(
          and(
            eq(mediaItems.id, mediaId),
            eq(mediaItems.status, 'processing'),
            isNull(mediaItems.deleted_at),
          ),
        )
        .returning({ bytes: mediaItems.original_bytes });
      const row = moved[0];
      if (row !== undefined) await deps.quota.refundUsed(db, row.bytes);
    });
    deps.log.warn({ msg: 'media.process.unprocessable', failureCode: code });
  }

  /**
   * Tệp trùng nội dung với một media đã có của CÙNG tài khoản: phiên `completed → duplicate`, trả dung lượng, bỏ dòng mới
   * (xóa mềm) và xóa tệp dở của NÓ (không đụng tệp của media đã có). Không chạy `sharp`/`ffmpeg`.
   */
  async function markDuplicate(mediaId: string, hash: string): Promise<void> {
    await tenantTx(async (db) => {
      const existing = (
        await db
          .select({ id: mediaItems.id })
          .from(mediaItems)
          .where(
            and(
              eq(mediaItems.file_hash, hash),
              isNull(mediaItems.deleted_at),
              ne(mediaItems.id, mediaId),
              sql`${mediaItems.status} IN ('processing', 'ready')`,
            ),
          )
          .limit(1)
      )[0];
      const gone = await db
        .update(mediaItems)
        .set({ deleted_at: sql`now()`, processed_at: sql`now()` })
        .where(
          and(
            eq(mediaItems.id, mediaId),
            eq(mediaItems.status, 'processing'),
            isNull(mediaItems.deleted_at),
          ),
        )
        .returning({ bytes: mediaItems.original_bytes });
      const row = gone[0];
      if (row === undefined) return; // đã xử lý ở lần chạy trước
      await deps.quota.refundUsed(db, row.bytes);
      if (existing !== undefined) {
        await db
          .update(uploadSessions)
          .set({ state: 'duplicate', duplicate_of_media_id: existing.id })
          .where(and(eq(uploadSessions.media_id, mediaId), eq(uploadSessions.state, 'completed')));
      }
      await enqueue(purgeMediaFiles, { mediaId }, { dedupeKey: purgeDedupeKey(mediaId) });
    });
    deps.log.info({ msg: 'media.process.duplicate' });
  }

  const handler = async (
    payload: { mediaId: string },
    ctx: JobContext,
  ): Promise<JobHandlerResult> => {
    const { mediaId } = payload;
    const started = now();
    const row = await tenantTx(
      async (db) =>
        (await db.select().from(mediaItems).where(eq(mediaItems.id, mediaId)).limit(1))[0],
    );
    // Đã xóa / không còn `processing` (xử lý rồi, trùng, hết lần thử) ⇒ bỏ qua – chạy lại an toàn.
    if (row === undefined || row.deleted_at !== null || row.status !== 'processing') return;

    const dir = await mkdtemp(join(deps.tmpRoot?.() ?? tmpdir(), `media-${mediaId.slice(0, 8)}-`));
    try {
      const file = join(dir, 'original');
      const hash = await downloadAndHash(deps.storage, mediaId, file, ctx.signal);

      // Dấu tệp: đặt NGAY (trước mọi bước tốn CPU) để chỉ mục duy nhất bắt tệp trùng, kể cả hai thiết bị cùng lúc.
      if (row.file_hash !== hash) {
        try {
          await tenantTx((db) =>
            db
              .update(mediaItems)
              .set({ file_hash: hash })
              .where(
                and(
                  eq(mediaItems.id, mediaId),
                  eq(mediaItems.status, 'processing'),
                  isNull(mediaItems.deleted_at),
                ),
              ),
          );
        } catch (err) {
          if (!isHashConflict(err)) throw err;
          await markDuplicate(mediaId, hash);
          return;
        }
      }
      ctx.signal.throwIfAborted();

      let width: number;
      let height: number;
      let durationMs: number | null = null;
      let normalizedBytes: number | null = null;
      let thumbBytes: number;

      if (row.kind === 'image') {
        const input = await readFile(file);
        const result = await processImage(input, {
          heic:
            row.original_content_type === 'image/heic' ||
            row.original_content_type === 'image/heif',
          signal: ctx.signal,
        });
        await deps.storage.write(normalizedLoc(mediaId), result.normalized, {
          contentType: 'image/jpeg',
        });
        await deps.storage.write(thumbLoc(mediaId), result.thumb, { contentType: 'image/jpeg' });
        width = result.width;
        height = result.height;
        normalizedBytes = result.normalized.length;
        thumbBytes = result.thumb.length;
      } else {
        const info = await probeVideo(file, { signal: ctx.signal });
        const frameFile = join(dir, 'frame.png');
        await extractFrame(file, frameFile, info, { signal: ctx.signal });
        const thumb = await thumbnailOf(await readFile(frameFile));
        await deps.storage.write(thumbLoc(mediaId), thumb, { contentType: 'image/jpeg' });
        width = info.width;
        height = info.height;
        durationMs = info.durationMs;
        thumbBytes = thumb.length;
      }

      // Chốt: MỘT câu UPDATE có điều kiện; 0 dòng = đã bị xóa/xử lý bởi nơi khác ⇒ không làm gì thêm.
      const done = await tenantTx(async (db) =>
        db
          .update(mediaItems)
          .set({
            status: 'ready',
            file_hash: hash,
            width,
            height,
            duration_ms: durationMs,
            normalized_bytes: normalizedBytes,
            thumb_bytes: thumbBytes,
            processed_at: sql`now()`,
          })
          .where(
            and(
              eq(mediaItems.id, mediaId),
              eq(mediaItems.status, 'processing'),
              isNull(mediaItems.deleted_at),
            ),
          )
          .returning({ id: mediaItems.id }),
      );
      if (done.length > 0) {
        deps.log.info({ msg: 'media.process.ready', kind: row.kind, ms: now() - started });
      }
      return;
    } catch (err) {
      if (isAbort(err)) throw err;
      if (err instanceof ImagePipelineError || err instanceof VideoPipelineError) {
        await markUnprocessable(mediaId, err.failure);
        return noRetry(err.failure);
      }
      throw err; // lỗi tạm (kho, tiến trình con): hàng chờ thử lại
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  };

  /** Hết lần thử: chuyển `unprocessable` (storage_mismatch) và trả dung lượng. */
  const onFinalFailure = async (payload: { mediaId: string }): Promise<void> => {
    if (currentAccountId() === null) return;
    await markUnprocessable(payload.mediaId, 'storage_mismatch');
  };

  return { handler, onFinalFailure };
}
