import { Inject, Injectable, Logger } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { inArray } from 'drizzle-orm';
import { APP_CONFIG, tenantTx, type AppConfig } from '../../../core';
import {
  InvalidRequestError,
  OBJECT_STORAGE,
  type ObjectStorage,
  type StorageLocation,
} from '../../../core/storage';
import type {
  AttachResult,
  DescribeResult,
  MediaPublicApi,
  MediaSummary,
  PublicUrlResult,
  PublishableMedia,
  PublishableMediaResult,
} from '../public-api';
import { mediaItems, type MediaRow } from './db/schema';
import { normalizedLoc, originalLoc, thumbLoc } from './media-keys';

// Giao diện công khai của `media` (014 contracts/media-public-api.md mục 1) cho `content` (012: đính media, hiển thị) và
// `publishing` (013 bước 2: `issuePublicUrl`). KHÔNG thao tác nào nhận mã tài khoản – lấy từ ngữ cảnh (phiên / việc nền); gọi
// ngoài ngữ cảnh ⇒ `TenantContextError`. Kết quả nghiệp vụ là hợp đóng có `kind`; chỉ lỗi lập trình/hạ tầng mới ném. Mỗi thao tác
// ghi một dòng nhật ký `media.<op>` + một span OpenTelemetry, KHÔNG chứa URL ký sẵn hay tên tệp (FR-023).

const MAX_BATCH = 100;
const MAX_PUBLIC_TTL_SEC = 86_400;
const tracer = trace.getTracer('media');

function summaryOf(row: MediaRow): MediaSummary {
  return {
    mediaId: row.id,
    kind: row.kind as MediaSummary['kind'],
    displayName: row.display_name,
    status: row.status as MediaSummary['status'],
    originalBytes: row.original_bytes,
    normalizedBytes: row.kind === 'image' ? row.normalized_bytes : null,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    // Thứ sẽ được ĐĂNG: ảnh ⇒ JPEG chuẩn hóa; video ⇒ tệp gốc.
    contentType: row.kind === 'image' ? 'image/jpeg' : row.original_content_type,
  };
}

@Injectable()
export class MediaPublicApiImpl implements MediaPublicApi {
  private readonly logger = new Logger('media');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage | null,
  ) {}

  /** Một span + một dòng nhật ký cho mỗi thao tác; lỗi được ghi nhận rồi ném lại nguyên vẹn. */
  private async traced<T>(op: string, count: number, fn: () => Promise<T>): Promise<T> {
    return tracer.startActiveSpan(`media.${op}`, async (span) => {
      span.setAttribute('media.count', count);
      try {
        const result = await fn();
        this.logger.log({ msg: `media.${op}`, count });
        return result;
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  private checkBatch(ids: readonly string[]): void {
    if (ids.length > MAX_BATCH)
      throw new InvalidRequestError(`tối đa ${String(MAX_BATCH)} mã mỗi lần`);
  }

  /** Đọc các dòng (kể cả xóa mềm) của tài khoản trong ngữ cảnh; `uploading` coi như chưa có trong thư viện. */
  private async load(ids: readonly string[]): Promise<Map<string, MediaRow>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await tenantTx((db) =>
      db.select().from(mediaItems).where(inArray(mediaItems.id, unique)),
    );
    return new Map(rows.filter((r) => r.status !== 'uploading').map((r) => [r.id, r]));
  }

  async describe(mediaIds: readonly string[]): Promise<DescribeResult[]> {
    this.checkBatch(mediaIds);
    return await this.traced('describe', mediaIds.length, async () => {
      const rows = await this.load(mediaIds);
      return mediaIds.map((id): DescribeResult => {
        const row = rows.get(id);
        if (row === undefined) return { kind: 'not_found' };
        if (row.deleted_at !== null) return { kind: 'deleted' };
        return { kind: 'ok', media: summaryOf(row) };
      });
    });
  }

  async assertAttachable(mediaIds: readonly string[]): Promise<AttachResult[]> {
    this.checkBatch(mediaIds);
    return await this.traced('assert_attachable', mediaIds.length, async () => {
      const rows = await this.load(mediaIds);
      return mediaIds.map((mediaId): AttachResult => {
        const row = rows.get(mediaId);
        if (row === undefined) return { kind: 'not_found', mediaId };
        if (row.deleted_at !== null) return { kind: 'deleted', mediaId };
        if (row.status === 'ready') return { kind: 'ok', media: summaryOf(row) };
        // `processing` ⇒ chưa đính được (FR-013); `unprocessable` ⇒ không bao giờ đính được.
        return { kind: row.status === 'processing' ? 'not_ready' : 'unprocessable', mediaId };
      });
    });
  }

  async getPreviewUrls(
    mediaIds: readonly string[],
  ): Promise<{ mediaId: string; thumbUrl: string | null; expiresAt: Date | null }[]> {
    this.checkBatch(mediaIds);
    return await this.traced('preview_urls', mediaIds.length, async () => {
      const rows = await this.load(mediaIds);
      return Promise.all(
        mediaIds.map(async (mediaId) => {
          const row = rows.get(mediaId);
          if (row?.deleted_at !== null || row.status !== 'ready' || this.storage === null) {
            return { mediaId, thumbUrl: null, expiresAt: null };
          }
          // LUÔN loại `preview` hạn ≤ 1 giờ – giao diện không bao giờ nhận đường dẫn công khai (FR-017).
          const signed = await this.storage.signedUrl(
            thumbLoc(mediaId),
            'preview',
            this.config.MEDIA_PREVIEW_URL_TTL_SEC,
          );
          return { mediaId, thumbUrl: signed.url, expiresAt: signed.expiresAt };
        }),
      );
    });
  }

  async issuePublicUrl(mediaId: string, opts: { ttlSec?: number } = {}): Promise<PublicUrlResult> {
    const ttl = opts.ttlSec ?? this.config.MEDIA_PUBLIC_URL_TTL_SEC;
    // Không âm thầm cắt: vượt trần là lỗi lập trình của nơi gọi.
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_PUBLIC_TTL_SEC)
      throw new InvalidRequestError('ttlSec');
    return await this.traced('issue_public_url', 1, async () => {
      const row = (await this.load([mediaId])).get(mediaId);
      if (row === undefined) return { kind: 'not_found' };
      if (row.deleted_at !== null) return { kind: 'deleted' };
      if (row.status === 'processing') return { kind: 'not_ready' };
      if (row.status === 'unprocessable') return { kind: 'unprocessable' };
      if (this.storage === null) throw new Error('Kho tệp chưa được cấu hình');
      const target: StorageLocation =
        row.kind === 'image' ? normalizedLoc(mediaId) : originalLoc(mediaId);
      const signed = await this.storage.signedUrl(target, 'public', ttl);
      return { kind: 'ok', url: signed.url, expiresAt: signed.expiresAt, media: summaryOf(row) };
    });
  }

  /** Bước 2 của 013: bọc `issuePublicUrl` cho nhiều tệp; có tệp không cấp được ⇒ `unavailable` kèm mã các tệp đó. */
  async getPublishableMedia(
    mediaIds: readonly string[],
    options: { ttlSec: number },
  ): Promise<PublishableMediaResult> {
    const items: PublishableMedia[] = [];
    const missing: string[] = [];
    for (const mediaId of mediaIds) {
      const r = await this.issuePublicUrl(mediaId, { ttlSec: options.ttlSec });
      if (r.kind !== 'ok') {
        missing.push(mediaId);
        continue;
      }
      const m = r.media;
      items.push({
        mediaId,
        kind: m.kind,
        url: r.url,
        format: m.contentType,
        bytes: m.kind === 'image' ? (m.normalizedBytes ?? m.originalBytes) : m.originalBytes,
        width: m.width ?? 0,
        height: m.height ?? 0,
        ...(m.durationMs !== null ? { durationSec: Math.round(m.durationMs / 1000) } : {}),
      });
    }
    return missing.length > 0 ? { kind: 'unavailable', mediaIds: missing } : { kind: 'ok', items };
  }
}
