import { Inject, Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@app/shared/core';
import {
  UNPROCESSABLE_CODES,
  UNPROCESSABLE_MESSAGES,
  type ListQuery,
  type ListResponse,
  type MediaDetail,
  type MediaItem,
  type Quota,
  type UnprocessableCode,
  type UsagesResponse,
} from '@app/shared/media';
import { and, desc, eq, gte, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  APP_CONFIG,
  AppError,
  requireCustomer,
  tenantTx,
  type AppConfig,
  type CustomerActor,
} from '../../../core';
import { OBJECT_STORAGE, type ObjectStorage, type StorageLocation } from '../../../core/storage';
import { ACCOUNT_PUBLIC_API, type AccountPublicApi } from '../../account';
import { enqueue } from '../../queue';
import { purgeDedupeKey, purgeMediaFiles } from '../jobs';
import { mediaItems, type MediaRow } from './db/schema';
import { mediaError, mediaNotFound } from './media-errors';
import { normalizedLoc, originalLoc, thumbLoc } from './media-keys';
import { recordStorageBytes } from './metrics';
import { QuotaStore } from './quota.store';
import { findUsagesOrEmpty, hasBlockingUsage, type MediaUsageRef } from './usage-registry';

// Thư viện: danh sách, chi tiết, bài đang dùng, xóa (014 contracts/media-http-api.md mục 1, 7–10). Mọi truy cập CSDL
// trong `tenantTx`; mã tài khoản/người dùng chỉ từ phiên. `uploading` và dòng xóa mềm KHÔNG bao giờ xuất hiện.

const LEFT_MEMBER_LABEL = null; // web hiện "Thành viên đã rời" khi displayName = null

interface Cursor {
  c: string;
  i: string;
}

function encodeCursor(row: Pick<MediaRow, 'created_at' | 'id'>): string {
  const cursor: Cursor = { c: row.created_at.toISOString(), i: row.id };
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (
      typeof parsed.c === 'string' &&
      typeof parsed.i === 'string' &&
      !Number.isNaN(Date.parse(parsed.c))
    ) {
      return { c: parsed.c, i: parsed.i };
    }
  } catch {
    // rơi xuống null
  }
  return null;
}

/** Thoát ký tự đặc biệt của LIKE. */
function likePattern(q: string): string {
  const normalized = q.replace(/\s+/g, ' ').trim().toLowerCase();
  return `%${normalized.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

@Injectable()
export class LibraryService {
  private readonly logger = new Logger('media');
  private readonly quota: QuotaStore;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage | null,
    @Inject(ACCOUNT_PUBLIC_API) private readonly account: AccountPublicApi,
  ) {
    this.quota = new QuotaStore(config.MEDIA_QUOTA_BYTES);
  }

  /** URL xem trước ≤ 1 giờ cho một vị trí; không có kho ⇒ null. LUÔN loại `preview` (không bao giờ `public`). */
  private async previewUrl(loc: StorageLocation): Promise<string | null> {
    if (this.storage === null) return null;
    const signed = await this.storage.signedUrl(
      loc,
      'preview',
      this.config.MEDIA_PREVIEW_URL_TTL_SEC,
    );
    return signed.url;
  }

  private canDelete(actor: CustomerActor, row: MediaRow): boolean {
    return actor.role === 'owner' || row.uploaded_by_user_id === actor.userId;
  }

  private async toItems(rows: MediaRow[], actor: CustomerActor): Promise<MediaItem[]> {
    const userIds = [...new Set(rows.map((r) => r.uploaded_by_user_id))];
    const names = new Map<string, string>();
    for (let i = 0; i < userIds.length; i += 100) {
      const found = await this.account.describeMembers(userIds.slice(i, i + 100));
      for (const m of found) if (m.status === 'active') names.set(m.userId, m.displayName);
    }
    return Promise.all(
      rows.map(async (row): Promise<MediaItem> => {
        const failure =
          row.status === 'unprocessable' && row.failure_code !== null
            ? UNPROCESSABLE_MESSAGES[
                (UNPROCESSABLE_CODES as readonly string[]).includes(row.failure_code)
                  ? (row.failure_code as UnprocessableCode)
                  : 'corrupt'
              ]
            : null;
        return {
          id: row.id,
          kind: row.kind as MediaItem['kind'],
          displayName: row.display_name,
          status: row.status as MediaItem['status'],
          originalBytes: row.original_bytes,
          width: row.width,
          height: row.height,
          durationMs: row.duration_ms,
          createdAt: row.created_at.toISOString(),
          uploadedBy: {
            userId: row.uploaded_by_user_id,
            displayName: names.get(row.uploaded_by_user_id) ?? LEFT_MEMBER_LABEL,
          },
          thumbUrl: row.status === 'ready' ? await this.previewUrl(thumbLoc(row.id)) : null,
          failure:
            failure === null || row.failure_code === null
              ? null
              : { code: row.failure_code, title: failure.title, action: failure.action },
          canDelete: this.canDelete(actor, row),
        };
      }),
    );
  }

  /** Điều kiện chung: chỉ media đã vào thư viện (không `uploading`, không xóa mềm). */
  private visible(): SQL[] {
    return [isNull(mediaItems.deleted_at), ne(mediaItems.status, 'uploading')];
  }

  async list(query: ListQuery): Promise<ListResponse> {
    const actor = requireCustomer();
    const cursor = query.cursor === undefined ? null : decodeCursor(query.cursor);
    if (query.cursor !== undefined && cursor === null) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_FAILED,
        httpStatus: 400,
        message: 'Trang này không còn hợp lệ. Hãy tải lại danh sách.',
        actions: [{ kind: 'retry', label: 'Tải lại' }],
      });
    }
    const { rows, quota } = await tenantTx(async (db) => {
      const where: SQL[] = this.visible();
      if (query.kind !== undefined) where.push(eq(mediaItems.kind, query.kind));
      if (query.from !== undefined) where.push(gte(mediaItems.created_at, new Date(query.from)));
      if (query.to !== undefined) where.push(lte(mediaItems.created_at, new Date(query.to)));
      if (query.q !== undefined && query.q.trim() !== '') {
        where.push(sql`lower(${mediaItems.display_name}) LIKE ${likePattern(query.q)} ESCAPE '\\'`);
      }
      if (cursor !== null) {
        const at = new Date(cursor.c);
        const older = or(
          sql`${mediaItems.created_at} < ${at}`,
          and(sql`${mediaItems.created_at} = ${at}`, sql`${mediaItems.id} < ${cursor.i}`),
        );
        if (older !== undefined) where.push(older);
      }
      const found = await db
        .select()
        .from(mediaItems)
        .where(and(...where))
        .orderBy(desc(mediaItems.created_at), desc(mediaItems.id))
        .limit(query.limit + 1);
      return { rows: found, quota: await this.quota.read(db) };
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: await this.toItems(page, actor),
      nextCursor: rows.length > query.limit && last !== undefined ? encodeCursor(last) : null,
      quota,
    };
  }

  async readQuota(): Promise<Quota> {
    requireCustomer();
    return tenantTx((db) => this.quota.read(db));
  }

  private async loadVisible(mediaId: string): Promise<MediaRow> {
    const row = await tenantTx(
      async (db) =>
        (
          await db
            .select()
            .from(mediaItems)
            .where(and(eq(mediaItems.id, mediaId), ...this.visible()))
            .limit(1)
        )[0],
    );
    if (row === undefined) throw mediaNotFound();
    return row;
  }

  async get(mediaId: string): Promise<MediaDetail> {
    const actor = requireCustomer();
    const row = await this.loadVisible(mediaId);
    const [item] = await this.toItems([row], actor);
    if (item === undefined) throw mediaNotFound();
    let previewUrl: string | null = null;
    if (row.status === 'ready') {
      previewUrl = await this.previewUrl(
        row.kind === 'image' ? normalizedLoc(row.id) : originalLoc(row.id),
      );
    }
    return {
      ...item,
      previewUrl,
      mimeType: row.kind === 'image' ? 'image/jpeg' : row.original_content_type,
    };
  }

  async usages(mediaId: string): Promise<UsagesResponse> {
    requireCustomer();
    const row = await this.loadVisible(mediaId);
    const found = await tenantTx(() => findUsagesOrEmpty([row.id]));
    return {
      usages: found.map(({ postId, postTitle, postStatus }) => ({ postId, postTitle, postStatus })),
      blocking: hasBlockingUsage(found),
    };
  }

  async remove(mediaId: string, confirm: boolean): Promise<void> {
    const actor = requireCustomer();
    await tenantTx(async (db) => {
      const row = (
        await db
          .select()
          .from(mediaItems)
          .where(and(eq(mediaItems.id, mediaId), ...this.visible()))
          .limit(1)
      )[0];
      if (row === undefined) throw mediaNotFound();
      if (!this.canDelete(actor, row)) throw mediaError('MEDIA_DELETE_NOT_OWNER');

      // Tra bài đang dùng LẠI lúc xóa (không tin `GET …/usages`).
      const usages: MediaUsageRef[] = await findUsagesOrEmpty([row.id]);
      const shaped = usages.map(({ postId, postTitle, postStatus }) => ({
        postId,
        postTitle,
        postStatus,
      }));
      if (hasBlockingUsage(usages)) {
        const n = usages.filter(
          (u) => u.postStatus === 'approved' || u.postStatus === 'scheduled',
        ).length;
        throw mediaError('MEDIA_IN_USE', {
          message: `Ảnh/video này đang dùng trong ${n} bài đã duyệt hoặc đã lên lịch nên chưa xóa được.`,
          extra: { usages: shaped },
        });
      }
      if (usages.length > 0 && !confirm) {
        throw mediaError('MEDIA_USED_CONFIRM_REQUIRED', { extra: { usages: shaped } });
      }

      const marked = await db
        .update(mediaItems)
        .set({ deleted_at: sql`now()` })
        .where(
          and(
            eq(mediaItems.id, row.id),
            isNull(mediaItems.deleted_at),
            inArray(mediaItems.status, ['processing', 'ready', 'unprocessable']),
          ),
        )
        .returning({ status: mediaItems.status, bytes: mediaItems.original_bytes });
      const done = marked[0];
      if (done === undefined) throw mediaNotFound(); // người khác vừa xóa
      // Trả dung lượng chỉ khi dòng còn chiếm chỗ (processing/ready); `unprocessable` đã trả lúc chuyển trạng thái.
      if (done.status === 'processing' || done.status === 'ready') {
        await this.quota.refundUsed(db, done.bytes);
      }
      await enqueue(purgeMediaFiles, { mediaId: row.id }, { dedupeKey: purgeDedupeKey(row.id) });
      // Chỉ số dung lượng theo loại: media `ready` đã được cộng khi xử lý xong, nay trừ đi.
      if (done.status === 'ready') recordStorageBytes(row.kind === 'video' ? 'video' : 'image', -done.bytes);
    });
    this.logger.log({ msg: 'media.delete', result: 'ok' });
  }
}
