import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  MEDIA_LIMITS,
  mediaKindOf,
  maxBytesOf,
  partCountOf,
  uploadModeOf,
  type CompleteUploadResponse,
  type PartUrlsResponse,
  type StartUploadBody,
  type StartUploadResponse,
  type UploadStatusResponse,
  type UploadRejectCode,
} from '@app/shared/media';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  APP_CONFIG,
  currentAccountId,
  requireCustomer,
  tenantTx,
  uuidV7,
  type AppConfig,
  type Db,
} from '../../../core';
import {
  MultipartIncompleteError,
  OBJECT_STORAGE,
  type AllowedContentType,
  type MultipartHandle,
  type ObjectStorage,
} from '../../../core/storage';
import { enqueue } from '../../queue';
import { processDedupeKey, processMedia } from '../jobs';
import { mediaItems, uploadSessions, type UploadSessionRow } from './db/schema';
import { mediaError, mediaNotFound } from './media-errors';
import { InvalidDisplayNameError, normalizeDisplayName, originalLoc } from './media-keys';
import { QuotaExceededError, QuotaStore } from './quota.store';
import { SNIFF_HEAD_BYTES, sniffMedia } from './sniff';
import { UPLOAD_GATE, type UploadGate } from './upload-gate';
import { closeSession } from './upload-sessions';

// Dịch vụ tải lên (014 contracts/media-http-api.md mục 2–6). Tệp KHÔNG đi qua API (hiến pháp V, FR-002): API chỉ cấp
// đường dẫn ký sẵn sau khi giữ chỗ dung lượng, rồi xác nhận bằng `stat` + dò nội dung. Mã tài khoản và người dùng CHỈ
// lấy từ phiên. Mọi thay đổi trạng thái là UPDATE có điều kiện (chạy lại an toàn); giữ chỗ, tạo `media`/phiên và tạo
// việc `media.process` nằm trong CÙNG giao dịch (hiến pháp II/V).

const CLAIM_STALE_MS = 120_000;

/** Lỗi trùng chỉ mục "một phiên đang hoạt động mỗi (người, tệp)". */
function isActiveSessionConflict(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const e = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (e.code === '23505') return e.constraint === 'upload_sessions_active_fingerprint_key';
    current = e.cause;
  }
  return false;
}

/** 4,9 GB kiểu Việt Nam (cơ số 1024, một chữ số thập phân). */
export function formatGib(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1).replace('.', ',');
}

@Injectable()
export class UploadService {
  private readonly logger = new Logger('media');
  private readonly quota: QuotaStore;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storageOrNull: ObjectStorage | null,
    @Inject(UPLOAD_GATE) private readonly gate: UploadGate,
  ) {
    this.quota = new QuotaStore(config.MEDIA_QUOTA_BYTES);
  }

  private get storage(): ObjectStorage {
    if (this.storageOrNull === null) throw mediaError('STORAGE_UNAVAILABLE');
    return this.storageOrNull;
  }

  private sessionExpiry(): Date {
    return new Date(Date.now() + MEDIA_LIMITS.sessionTtlSec * 1000);
  }

  // ---------- Bắt đầu hoặc nhận lại phiên ----------

  async start(body: StartUploadBody): Promise<{ status: 200 | 201; body: StartUploadResponse }> {
    const actor = requireCustomer();
    const kind = mediaKindOf(body.contentType);
    if (kind === null) throw mediaError('MEDIA_TYPE_UNSUPPORTED');
    if (body.sizeBytes > maxBytesOf(kind)) {
      throw mediaError('MEDIA_TOO_LARGE', {
        message:
          kind === 'image'
            ? 'Ảnh tối đa 20 MB – hãy giảm kích thước rồi tải lại.'
            : 'Video tối đa 500 MB – hãy cắt ngắn hoặc nén rồi tải lại.',
        extra: { maxBytes: maxBytesOf(kind) },
      });
    }
    let displayName: string;
    try {
      displayName = normalizeDisplayName(body.fileName);
    } catch (err) {
      if (err instanceof InvalidDisplayNameError) {
        throw mediaError('MEDIA_TYPE_UNSUPPORTED', {
          message: 'Tên tệp không hợp lệ. Hãy đổi tên tệp rồi chọn lại.',
        });
      }
      throw err;
    }
    const gate = await this.gate.canUpload();
    if (!gate.allowed) throw mediaError('MEDIA_PLAN_EXPIRED');

    // Hai thiết bị bấm gần như cùng lúc: bên thua gặp lỗi trùng chỉ mục ⇒ làm lại một lần, lần này nhận lại phiên.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.startOnce(actor.userId, body, kind, displayName);
      } catch (err) {
        if (attempt === 0 && isActiveSessionConflict(err)) continue;
        if (err instanceof QuotaExceededError) {
          const q = err.quota;
          throw mediaError('MEDIA_QUOTA_EXCEEDED', {
            message: `Thư viện đã đầy (${formatGib(q.usedBytes + q.reservedBytes)}/${formatGib(q.limitBytes)} GB). Hãy xóa bớt ảnh/video cũ rồi tải lại.`,
            extra: { quota: q },
          });
        }
        throw err;
      }
    }
  }

  private async startOnce(
    userId: string,
    body: StartUploadBody,
    kind: 'image' | 'video',
    displayName: string,
  ): Promise<{ status: 200 | 201; body: StartUploadResponse }> {
    const toAbort: { mediaId: string; handle: MultipartHandle }[] = [];
    const result = await tenantTx(async (db) => {
      // Phiên đang mở của cùng người + cùng tệp?
      const existing = (
        await db
          .select()
          .from(uploadSessions)
          .where(
            and(
              eq(uploadSessions.created_by_user_id, userId),
              eq(uploadSessions.fingerprint, body.fingerprint),
              inArray(uploadSessions.state, ['open', 'completing']),
            ),
          )
          .limit(1)
      )[0];

      let previousExpired = false;
      if (existing !== undefined) {
        if (existing.state === 'open' && existing.expires_at.getTime() <= Date.now()) {
          // Hết 24 giờ: dọn phiên cũ, tạo phiên mới (FR-009).
          const closed = await closeSession(db, this.quota, existing.id, 'expired', undefined, [
            'open',
          ]);
          if (closed?.multipart_upload_id != null) {
            toAbort.push({
              mediaId: closed.media_id,
              handle: { uploadId: closed.multipart_upload_id },
            });
          }
          previousExpired = true;
        } else {
          return { response: await this.resume(db, existing), status: 200 as const };
        }
      }

      // Giữ chỗ TRƯỚC (0 dòng ⇒ hết chỗ, rollback toàn bộ: không tạo media/phiên/URL).
      await this.quota.reserve(db, body.sizeBytes);
      const accountId = currentAccountId();
      if (accountId === null) throw new Error('Thiếu ngữ cảnh tài khoản');

      const mediaId = uuidV7();
      const mode = uploadModeOf(body.sizeBytes);
      await db.insert(mediaItems).values({
        id: mediaId,
        account_id: accountId,
        kind,
        status: 'uploading',
        display_name: displayName,
        original_content_type: body.contentType,
        original_bytes: body.sizeBytes,
        uploaded_by_user_id: userId,
      });

      let handle: MultipartHandle | null = null;
      if (mode === 'multipart') {
        handle = await this.storage.createMultipart(originalLoc(mediaId), {
          contentType: body.contentType as AllowedContentType,
          bytes: body.sizeBytes,
          partSizeBytes: MEDIA_LIMITS.partSizeBytes,
        });
      }
      const expiresAt = this.sessionExpiry();
      const sessionId = uuidV7();
      await db.insert(uploadSessions).values({
        id: sessionId,
        account_id: accountId,
        media_id: mediaId,
        created_by_user_id: userId,
        fingerprint: body.fingerprint,
        mode,
        declared_bytes: body.sizeBytes,
        declared_content_type: body.contentType,
        multipart_upload_id: handle?.uploadId ?? null,
        part_size_bytes: mode === 'multipart' ? MEDIA_LIMITS.partSizeBytes : null,
        part_count: mode === 'multipart' ? partCountOf(body.sizeBytes) : null,
        state: 'open',
        expires_at: expiresAt,
      });
      this.logger.log({ msg: 'media.upload.started', mode, kind });

      const session = (
        await db.select().from(uploadSessions).where(eq(uploadSessions.id, sessionId))
      )[0];
      if (session === undefined) throw new Error('Phiên vừa tạo không đọc lại được');
      const response = await this.describeSession(session, false);
      return {
        response: { ...response, ...(previousExpired ? { previousExpired: true } : {}) },
        status: 201 as const,
      };
    });

    for (const a of toAbort) {
      await this.storage.abortMultipart(originalLoc(a.mediaId), a.handle).catch(() => undefined);
      await this.storage.delete(originalLoc(a.mediaId)).catch(() => undefined);
    }
    return { status: result.status, body: result.response };
  }

  /** Nhận lại phiên đang mở: gia hạn 24 giờ và trả lại đường dẫn mới (+ các phần đã lên nếu nhiều phần). */
  private async resume(db: Db, session: UploadSessionRow): Promise<StartUploadResponse> {
    const expiresAt = this.sessionExpiry();
    await db
      .update(uploadSessions)
      .set({ last_activity_at: sql`now()`, expires_at: expiresAt })
      .where(eq(uploadSessions.id, session.id));
    return this.describeSession({ ...session, expires_at: expiresAt }, true);
  }

  /** Dựng phản hồi bắt đầu/nhận lại phiên. */
  private async describeSession(
    session: UploadSessionRow,
    resumed: boolean,
  ): Promise<StartUploadResponse> {
    const base = {
      uploadId: session.id,
      mediaId: session.media_id,
      resumed,
      expiresAt: session.expires_at.toISOString(),
    };
    if (session.mode === 'multipart') {
      const handle = { uploadId: session.multipart_upload_id ?? '' };
      const parts = resumed
        ? await this.storage.listParts(originalLoc(session.media_id), handle)
        : [];
      return {
        ...base,
        mode: 'multipart',
        partSizeBytes: session.part_size_bytes ?? MEDIA_LIMITS.partSizeBytes,
        partCount: session.part_count ?? partCountOf(session.declared_bytes),
        completedParts: parts.map((p) => p.partNumber),
      };
    }
    const post = await this.storage.presignUpload(originalLoc(session.media_id), {
      contentType: session.declared_content_type as AllowedContentType,
      maxBytes: session.declared_bytes,
    });
    return {
      ...base,
      mode: 'single',
      post: { url: post.url, fields: post.fields, expiresAt: post.expiresAt.toISOString() },
    };
  }

  // ---------- Xác nhận ----------

  async complete(uploadId: string): Promise<CompleteUploadResponse> {
    const actor = requireCustomer();
    const claimed = await this.claim(uploadId, actor.userId);
    if ('done' in claimed) return claimed.done;
    const session = claimed.session;
    const location = originalLoc(session.media_id);

    // 1) Ghép (nhiều phần) rồi kiểm kho – ngoài giao dịch (có gọi mạng).
    let verdict:
      { ok: true; contentType: string; bytes: number } | { ok: false; code: UploadRejectCode };
    try {
      if (session.mode === 'multipart') {
        await this.storage.completeMultipart(
          location,
          { uploadId: session.multipart_upload_id ?? '' },
          { bytes: session.declared_bytes },
        );
      }
      const info = await this.storage.stat(location);
      if (!info.exists) {
        await this.reopen(session.id);
        throw mediaError('UPLOAD_INCOMPLETE');
      }
      if (info.bytes !== session.declared_bytes) {
        verdict = { ok: false, code: 'size_mismatch' };
      } else {
        const head = await this.readHead(session.media_id);
        const sniffed = sniffMedia(head, session.declared_content_type);
        verdict =
          'rejected' in sniffed
            ? { ok: false, code: sniffed.rejected }
            : { ok: true, contentType: sniffed.contentType, bytes: info.bytes };
      }
    } catch (err) {
      if (err instanceof MultipartIncompleteError) {
        await this.reopen(session.id);
        throw mediaError('UPLOAD_INCOMPLETE');
      }
      if (err instanceof Error && err.name === 'AppError') throw err;
      if (typeof err === 'object' && err !== null && 'httpStatus' in err) throw err;
      await this.reopen(session.id);
      this.logger.warn({ msg: 'media.upload.storage_error' });
      throw mediaError('STORAGE_UNAVAILABLE');
    }

    // 2) Chốt (hoặc bác) trong MỘT giao dịch.
    if (!verdict.ok) return this.reject(session, verdict.code);
    const accepted = verdict;
    const outcome = await tenantTx(async (db) => {
      const moved = await db
        .update(uploadSessions)
        .set({ state: 'completed', completed_at: sql`now()`, last_activity_at: sql`now()` })
        .where(and(eq(uploadSessions.id, session.id), eq(uploadSessions.state, 'completing')))
        .returning({ id: uploadSessions.id });
      if (moved.length === 0) return 'taken_over' as const; // người khác đã xử lý xong
      await this.quota.commit(db, session.declared_bytes, accepted.bytes);
      await db
        .update(mediaItems)
        .set({ status: 'processing', original_content_type: accepted.contentType })
        .where(and(eq(mediaItems.id, session.media_id), eq(mediaItems.status, 'uploading')));
      await enqueue(
        processMedia,
        { mediaId: session.media_id },
        { dedupeKey: processDedupeKey(session.media_id) },
      );
      return 'done' as const;
    });
    if (outcome === 'done')
      this.logger.log({
        msg: 'media.upload.completed',
        kind: mediaKindOf(session.declared_content_type),
      });
    return { uploadId: session.id, mediaId: session.media_id, state: 'completed' };
  }

  /** Đọc phần đầu tệp gốc để dò nội dung thật (không đọc cả tệp). */
  private async readHead(mediaId: string): Promise<Uint8Array> {
    const stream = await this.storage.read(originalLoc(mediaId));
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of stream) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
        chunks.push(buf);
        size += buf.length;
        if (size >= SNIFF_HEAD_BYTES) break;
      }
    } finally {
      stream.destroy();
    }
    return new Uint8Array(Buffer.concat(chunks).subarray(0, SNIFF_HEAD_BYTES));
  }

  /** Giành quyền xác nhận: `open → completing`. Đã hoàn tất ⇒ `done` (idempotent). */
  private async claim(
    uploadId: string,
    userId: string,
  ): Promise<{ session: UploadSessionRow } | { done: CompleteUploadResponse }> {
    for (let i = 0; i < 12; i++) {
      const step = await tenantTx(async (db) => {
        const row = (
          await db
            .select()
            .from(uploadSessions)
            .where(
              and(eq(uploadSessions.id, uploadId), eq(uploadSessions.created_by_user_id, userId)),
            )
            .limit(1)
        )[0];
        if (row === undefined) return { kind: 'missing' as const };
        if (row.state === 'completed' || row.state === 'duplicate')
          return { kind: 'done' as const, row };
        if (row.state === 'cancelled' || row.state === 'expired' || row.state === 'failed') {
          return { kind: 'missing' as const };
        }
        // open ⇒ giành; completing do yêu cầu khác ⇒ chờ, trừ khi bỏ dở quá lâu (tiến trình chết) ⇒ giành lại.
        const stale = row.last_activity_at.getTime() < Date.now() - CLAIM_STALE_MS;
        if (row.state === 'open' || stale) {
          if (row.state === 'open' && row.expires_at.getTime() <= Date.now())
            return { kind: 'missing' as const };
          const got = await db
            .update(uploadSessions)
            .set({ state: 'completing', last_activity_at: sql`now()` })
            .where(
              and(
                eq(uploadSessions.id, uploadId),
                inArray(uploadSessions.state, ['open', 'completing']),
              ),
            )
            .returning();
          const mine = got[0];
          if (mine !== undefined) return { kind: 'claimed' as const, row: mine };
        }
        return { kind: 'wait' as const };
      });
      if (step.kind === 'missing')
        throw mediaNotFound('Lần tải này không còn. Hãy chọn lại tệp để tải.');
      if (step.kind === 'done') {
        return { done: { uploadId: step.row.id, mediaId: step.row.media_id, state: 'completed' } };
      }
      if (step.kind === 'claimed') return { session: step.row };
      await new Promise((r) => setTimeout(r, 250));
    }
    throw mediaError('UPLOAD_INCOMPLETE');
  }

  /** Lỗi tạm: trả phiên về `open` để người dùng thử lại (tiếp tục được). */
  private async reopen(sessionId: string): Promise<void> {
    await tenantTx((db) =>
      db
        .update(uploadSessions)
        .set({ state: 'open' })
        .where(and(eq(uploadSessions.id, sessionId), eq(uploadSessions.state, 'completing'))),
    );
  }

  /** Tệp bị bác: đóng phiên, trả giữ chỗ, xóa dòng dở và tệp dở; trả 422. */
  private async reject(session: UploadSessionRow, code: UploadRejectCode): Promise<never> {
    await tenantTx((db) =>
      closeSession(db, this.quota, session.id, 'failed', code, ['completing']),
    );
    await this.discardObjects(session);
    this.logger.warn({ msg: 'media.upload.rejected', failureCode: code });
    throw mediaError('UPLOAD_REJECTED', { extra: { failureCode: code }, detail: code });
  }

  private async discardObjects(session: UploadSessionRow): Promise<void> {
    const location = originalLoc(session.media_id);
    if (session.multipart_upload_id !== null) {
      await this.storage
        .abortMultipart(location, { uploadId: session.multipart_upload_id })
        .catch(() => undefined);
    }
    await this.storage.delete(location).catch(() => undefined);
  }

  // ---------- Hỏi trạng thái, hủy ----------

  async status(uploadId: string): Promise<UploadStatusResponse> {
    const actor = requireCustomer();
    const found = await tenantTx(async (db) => {
      const session = (
        await db
          .select()
          .from(uploadSessions)
          .where(
            and(
              eq(uploadSessions.id, uploadId),
              eq(uploadSessions.created_by_user_id, actor.userId),
            ),
          )
          .limit(1)
      )[0];
      if (session === undefined) return null;
      const media = (
        await db
          .select({ status: mediaItems.status })
          .from(mediaItems)
          .where(eq(mediaItems.id, session.media_id))
          .limit(1)
      )[0];
      const dup =
        session.duplicate_of_media_id === null
          ? undefined
          : (
              await db
                .select({ id: mediaItems.id, name: mediaItems.display_name })
                .from(mediaItems)
                .where(eq(mediaItems.id, session.duplicate_of_media_id))
                .limit(1)
            )[0];
      return { session, media, dup };
    });
    if (found === null) throw mediaNotFound('Lần tải này không còn. Hãy chọn lại tệp để tải.');
    const { session, media, dup } = found;
    const completedParts =
      session.mode === 'multipart' && session.state === 'open'
        ? (
            await this.storage.listParts(originalLoc(session.media_id), {
              uploadId: session.multipart_upload_id ?? '',
            })
          ).map((p) => p.partNumber)
        : undefined;
    return {
      uploadId: session.id,
      state: session.state as UploadStatusResponse['state'],
      mediaId: media === undefined ? null : session.media_id,
      mediaStatus:
        media === undefined ? null : (media.status as UploadStatusResponse['mediaStatus']),
      duplicateOf: dup === undefined ? null : { mediaId: dup.id, displayName: dup.name },
      failureCode: session.failure_code,
      ...(completedParts !== undefined ? { completedParts } : {}),
      expiresAt: session.expires_at.toISOString(),
    };
  }

  /** Hủy một lần tải đang mở: trả giữ chỗ, xóa dòng dở, hủy nhiều phần. Phiên đã đóng/không có ⇒ không tác dụng (204). */
  async cancel(uploadId: string): Promise<void> {
    const actor = requireCustomer();
    const closed = await tenantTx(async (db) => {
      const row = (
        await db
          .select({ id: uploadSessions.id })
          .from(uploadSessions)
          .where(
            and(
              eq(uploadSessions.id, uploadId),
              eq(uploadSessions.created_by_user_id, actor.userId),
            ),
          )
          .limit(1)
      )[0];
      if (row === undefined) return null;
      return closeSession(db, this.quota, row.id, 'cancelled', undefined, ['open']);
    });
    if (closed !== null) {
      await this.discardObjects(closed);
      this.logger.log({ msg: 'media.upload.cancelled' });
    }
  }

  // ---------- URL cho từng phần ----------

  async partUrls(uploadId: string, partNumbers: readonly number[]): Promise<PartUrlsResponse> {
    const actor = requireCustomer();
    const session = await tenantTx(async (db) => {
      const row = (
        await db
          .select()
          .from(uploadSessions)
          .where(
            and(
              eq(uploadSessions.id, uploadId),
              eq(uploadSessions.created_by_user_id, actor.userId),
              eq(uploadSessions.state, 'open'),
              eq(uploadSessions.mode, 'multipart'),
            ),
          )
          .limit(1)
      )[0];
      if (row === undefined) return null;
      await db
        .update(uploadSessions)
        .set({ last_activity_at: sql`now()`, expires_at: this.sessionExpiry() })
        .where(eq(uploadSessions.id, row.id));
      return row;
    });
    if (session === null) throw mediaNotFound('Lần tải này không còn. Hãy chọn lại tệp để tải.');
    const count = session.part_count ?? 0;
    const partSize = session.part_size_bytes ?? MEDIA_LIMITS.partSizeBytes;
    const parts: PartUrlsResponse['parts'] = [];
    for (const partNumber of partNumbers) {
      if (partNumber < 1 || partNumber > count) {
        throw mediaError('MEDIA_TOO_LARGE', {
          message: 'Số phần không hợp lệ.',
          detail: 'part_out_of_range',
        });
      }
      const contentLength =
        partNumber < count ? partSize : session.declared_bytes - partSize * (count - 1);
      const signed = await this.storage.presignPart(
        originalLoc(session.media_id),
        { uploadId: session.multipart_upload_id ?? '' },
        { partNumber, contentLength },
      );
      parts.push({
        partNumber,
        url: signed.url,
        contentLength,
        expiresAt: signed.expiresAt.toISOString(),
      });
    }
    return { parts };
  }
}
