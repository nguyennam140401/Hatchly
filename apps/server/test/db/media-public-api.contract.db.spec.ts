// Hợp đồng giao diện công khai của `media` (014 T069, contracts/media-public-api.md mục 1–2, FR-013/015/016/017, SC-006).
// Bản THẬT trên PostgreSQL + kho memory (đồng hồ tiêm được). Mọi thao tác lấy tài khoản từ ngữ cảnh, không nhận mã tài khoản.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/core/config/load-config';
import { TenantContextError } from '../../src/core/db/errors';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { InvalidRequestError, loc } from '../../src/core/storage';
import { MemoryObjectStorage } from '../../src/core/storage/memory/memory-storage';
import { MediaPublicApiImpl } from '../../src/modules/media/internal/public-api.impl';
import {
  findUsagesOrEmpty,
  hasBlockingUsage,
  registerMediaUsageProvider,
  resetMediaUsageProviderForTests,
  type MediaUsageRef,
} from '../../src/modules/media/internal/usage-registry';
import {
  asOwner,
  createAccount,
  dbUrls,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from './helpers/db';

describeDb('MediaPublicApi – hợp đồng (bản thật)', () => {
  let database: TestDatabase;
  let offsetMs = 0;
  const storage = new MemoryObjectStorage(() => new Date(Date.now() + offsetMs));
  let api: MediaPublicApiImpl;
  let a: string;
  let b: string;
  let readyImage: string;
  let readyVideo: string;
  let processing: string;
  let broken: string;
  let deleted: string;
  let foreign: string; // media của tài khoản B

  async function insert(
    acc: string,
    over: {
      kind?: 'image' | 'video';
      status: 'ready' | 'processing' | 'unprocessable' | 'uploading';
      deleted?: boolean;
    },
  ): Promise<string> {
    const id = uuidV7();
    const kind = over.kind ?? 'image';
    const ready = over.status === 'ready';
    await asOwner((c) =>
      c.query(
        `INSERT INTO media.media (id, account_id, kind, status, display_name, original_content_type, original_bytes, uploaded_by_user_id,
            file_hash, width, height, duration_ms, processed_at, normalized_bytes, thumb_bytes, failure_code, deleted_at)
         VALUES ($1,$2,$3,$4,$5,$6,5000,$7, $8,$9,$9,$10,$11,$12,$13,$14,$15)`,
        [
          id,
          acc,
          kind,
          over.status,
          `${id.slice(0, 8)}.bin`,
          kind === 'image' ? 'image/png' : 'video/mp4',
          uuidV7(),
          ready ? id.replace(/-/g, '').padEnd(64, 'c') : null,
          ready ? 640 : null,
          ready && kind === 'video' ? 4000 : null,
          ready || over.status === 'unprocessable' ? new Date() : null,
          ready && kind === 'image' ? 1200 : null,
          ready ? 300 : null,
          over.status === 'unprocessable' ? 'corrupt' : null,
          over.deleted === true ? new Date() : null,
        ],
      ),
    );
    return id;
  }

  const as = <T>(acc: string, fn: () => Promise<T>) => withAccount(acc, fn);
  const put = (acc: string, l: ReturnType<typeof loc.mediaOriginal>, body: string) =>
    as(acc, () => storage.write(l, Buffer.from(body), { contentType: 'application/octet-stream' }));

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 6 });
    const config = loadConfig({ APP_ENV: 'test', DATABASE_APP_URL: dbUrls.app });
    api = new MediaPublicApiImpl(config, storage);
    a = await createAccount();
    b = await createAccount();
    readyImage = await insert(a, { status: 'ready' });
    readyVideo = await insert(a, { kind: 'video', status: 'ready' });
    processing = await insert(a, { status: 'processing' });
    broken = await insert(a, { status: 'unprocessable' });
    deleted = await insert(a, { status: 'ready', deleted: true });
    foreign = await insert(b, { status: 'ready' });
    for (const [acc, id] of [
      [a, readyImage],
      [a, readyVideo],
      [b, foreign],
    ] as const) {
      await put(acc, loc.mediaOriginal(id), `original:${id}`);
      await put(acc, loc.mediaNormalized(id, 'jpeg'), `normalized:${id}`);
      await put(acc, loc.mediaThumb(id), `thumb:${id}`);
    }
  });
  afterAll(async () => {
    await database.close();
  });

  describe('describe', () => {
    it('giữ nguyên thứ tự đầu vào; ok/deleted/not_found; thuộc tính đúng', async () => {
      const ghost = uuidV7();
      const out = await as(a, () =>
        api.describe([deleted, readyVideo, ghost, readyImage, processing]),
      );
      expect(out.map((r) => r.kind)).toEqual(['deleted', 'ok', 'not_found', 'ok', 'ok']);
      const video = out[1]!;
      const image = out[3]!;
      expect(video).toMatchObject({
        kind: 'ok',
        media: {
          mediaId: readyVideo,
          kind: 'video',
          status: 'ready',
          durationMs: 4000,
          normalizedBytes: null,
          contentType: 'video/mp4',
        },
      });
      // ảnh: thứ sẽ ĐĂNG là JPEG chuẩn hóa
      expect(image).toMatchObject({
        kind: 'ok',
        media: {
          kind: 'image',
          normalizedBytes: 1200,
          width: 640,
          height: 640,
          contentType: 'image/jpeg',
        },
      });
      expect(out[4]).toMatchObject({
        kind: 'ok',
        media: { status: 'processing', width: null, normalizedBytes: null },
      });
    });

    it('mã của tài khoản khác ≡ mã không có: not_found; tối đa 100 mã mỗi lần; media đang tải không có trong thư viện', async () => {
      const uploading = await insert(a, { status: 'uploading' });
      const out = await as(a, () => api.describe([foreign, uuidV7(), uploading]));
      expect(out).toEqual([{ kind: 'not_found' }, { kind: 'not_found' }, { kind: 'not_found' }]);
      await expect(
        as(a, () => api.describe(Array.from({ length: 101 }, () => uuidV7()))),
      ).rejects.toBeInstanceOf(InvalidRequestError);
      expect(await as(a, () => api.describe([]))).toEqual([]);
    });

    it('ngoài ngữ cảnh tài khoản ⇒ TenantContextError (không nhận mã tài khoản từ tham số)', async () => {
      await expect(api.describe([readyImage])).rejects.toBeInstanceOf(TenantContextError);
    });
  });

  describe('assertAttachable (FR-013)', () => {
    it('chỉ "ok" khi ready; processing ⇒ not_ready; unprocessable; deleted; not_found', async () => {
      const out = await as(a, () =>
        api.assertAttachable([readyImage, processing, broken, deleted, uuidV7(), foreign]),
      );
      expect(out.map((r) => r.kind)).toEqual([
        'ok',
        'not_ready',
        'unprocessable',
        'deleted',
        'not_found',
        'not_found',
      ]);
      expect(out[1]).toEqual({ kind: 'not_ready', mediaId: processing });
      expect(out[5]).toMatchObject({ kind: 'not_found', mediaId: foreign });
    });
  });

  describe('getPreviewUrls (FR-017)', () => {
    it('chỉ media ready của tài khoản: URL xem trước ≤ 3600 giây, đọc được ảnh thu nhỏ; còn lại null', async () => {
      const out = await as(a, () => api.getPreviewUrls([readyImage, processing, deleted, foreign]));
      expect(out.map((r) => r.mediaId)).toEqual([readyImage, processing, deleted, foreign]);
      const ok = out[0]!;
      expect(ok.thumbUrl).not.toBeNull();
      expect(ok.expiresAt!.getTime() - Date.now()).toBeLessThanOrEqual(3_600_000 + 2000);
      expect(storage.fetchSigned(ok.thumbUrl!)?.toString()).toBe(`thumb:${readyImage}`);
      for (const r of out.slice(1))
        expect(r).toEqual({ mediaId: r.mediaId, thumbUrl: null, expiresAt: null });
    });
  });

  describe('issuePublicUrl (FR-015/016, SC-006)', () => {
    it('ảnh ⇒ bản JPEG chuẩn hóa; video ⇒ tệp gốc; hạn mặc định 24 giờ', async () => {
      const img = await as(a, () => api.issuePublicUrl(readyImage));
      expect(img.kind).toBe('ok');
      if (img.kind !== 'ok') return;
      expect(storage.fetchSigned(img.url)?.toString()).toBe(`normalized:${readyImage}`);
      expect(img.expiresAt.getTime() - Date.now()).toBeGreaterThan(86_400_000 - 5000);
      expect(img.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(86_400_000 + 1000);
      expect(img.media).toMatchObject({ mediaId: readyImage, contentType: 'image/jpeg' });

      const vid = await as(a, () => api.issuePublicUrl(readyVideo, { ttlSec: 3600 }));
      expect(vid.kind).toBe('ok');
      if (vid.kind !== 'ok') return;
      expect(storage.fetchSigned(vid.url)?.toString()).toBe(`original:${readyVideo}`);
      expect(vid.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(3_600_000 + 1000);
    });

    it('ttlSec > 86.400 ⇒ InvalidRequestError (không âm thầm cắt); ≤ 0 hoặc không nguyên cũng vậy', async () => {
      for (const ttlSec of [86_401, 0, -5, 1.5]) {
        await expect(
          as(a, () => api.issuePublicUrl(readyImage, { ttlSec })),
          String(ttlSec),
        ).rejects.toBeInstanceOf(InvalidRequestError);
      }
    });

    it('not_ready · unprocessable · deleted · not_found đúng nhánh', async () => {
      expect(await as(a, () => api.issuePublicUrl(processing))).toEqual({ kind: 'not_ready' });
      expect(await as(a, () => api.issuePublicUrl(broken))).toEqual({ kind: 'unprocessable' });
      expect(await as(a, () => api.issuePublicUrl(deleted))).toEqual({ kind: 'deleted' });
      expect(await as(a, () => api.issuePublicUrl(uuidV7()))).toEqual({ kind: 'not_found' });
    });

    it('CÔ LẬP: A không lấy được URL của media B (not_found); URL của A chỉ cho đúng tệp, không đoán được tệp khác', async () => {
      expect(await as(a, () => api.issuePublicUrl(foreign))).toEqual({ kind: 'not_found' });
      const ok = await as(a, () => api.issuePublicUrl(readyImage));
      if (ok.kind !== 'ok') throw new Error('mong đợi ok');
      expect(ok.url).toContain(encodeURIComponent(`tenants/${a}/media/${readyImage}/`));
      // sửa khóa sang tệp khác ⇒ chữ ký sai ⇒ không tải được
      const tampered = ok.url.replace(readyImage, readyVideo);
      expect(storage.fetchSigned(tampered)).toBeNull();
      const swapped = ok.url.replace(`tenants%2F${a}`, `tenants%2F${b}`);
      expect(storage.fetchSigned(swapped)).toBeNull();
    });

    it('hết hạn bằng đồng hồ giả ⇒ kho từ chối (SC-006)', async () => {
      const r = await as(a, () => api.issuePublicUrl(readyImage, { ttlSec: 60 }));
      if (r.kind !== 'ok') throw new Error('mong đợi ok');
      expect(storage.fetchSigned(r.url)).not.toBeNull();
      offsetMs += 61_000;
      expect(storage.fetchSigned(r.url)).toBeNull();
      offsetMs = 0;
    });

    it('ngoài ngữ cảnh ⇒ TenantContextError; tài khoản đã bị xóa ⇒ không cấp thêm URL', async () => {
      await expect(api.issuePublicUrl(readyImage)).rejects.toBeInstanceOf(TenantContextError);
      const gone = await createAccount();
      const id = await insert(gone, { status: 'ready' });
      await put(gone, loc.mediaNormalized(id, 'jpeg'), 'x');
      expect((await as(gone, () => api.issuePublicUrl(id))).kind).toBe('ok');
      await asOwner((c) => c.query('DELETE FROM account.accounts WHERE id = $1', [gone]));
      await expect(as(gone, () => api.issuePublicUrl(id))).rejects.toBeInstanceOf(
        TenantContextError,
      );
    });
  });

  describe('getPublishableMedia (bước 2 của 013)', () => {
    it('đủ ⇒ ok kèm đường dẫn, định dạng, dung lượng (ảnh: bản chuẩn hóa), kích thước, thời lượng giây', async () => {
      const r = await as(a, () =>
        api.getPublishableMedia([readyImage, readyVideo], { ttlSec: 3600 }),
      );
      expect(r.kind).toBe('ok');
      if (r.kind !== 'ok') return;
      expect(r.items[0]).toMatchObject({
        mediaId: readyImage,
        kind: 'image',
        format: 'image/jpeg',
        bytes: 1200,
        width: 640,
        height: 640,
      });
      expect(r.items[1]).toMatchObject({
        mediaId: readyVideo,
        kind: 'video',
        format: 'video/mp4',
        bytes: 5000,
        durationSec: 4,
      });
    });

    it('có tệp không cấp được ⇒ unavailable kèm mã các tệp đó; rỗng ⇒ ok rỗng', async () => {
      expect(
        await as(a, () =>
          api.getPublishableMedia([readyImage, processing, deleted], { ttlSec: 3600 }),
        ),
      ).toEqual({
        kind: 'unavailable',
        mediaIds: [processing, deleted],
      });
      expect(await as(a, () => api.getPublishableMedia([], { ttlSec: 3600 }))).toEqual({
        kind: 'ok',
        items: [],
      });
    });
  });
});

describe('cổng "bài nào đang dùng media" (R10)', () => {
  const ref = (status: MediaUsageRef['postStatus'], title = 'Bài'): MediaUsageRef => ({
    mediaId: 'm',
    postId: uuidV7(),
    postTitle: title,
    postStatus: status,
  });

  it('chưa có nhà cung cấp ⇒ rỗng; đăng ký MỘT lần, lần hai ném; tiêu đề rỗng ⇒ "Bài chưa đặt tên"', async () => {
    resetMediaUsageProviderForTests();
    expect(await findUsagesOrEmpty(['m'])).toEqual([]);
    registerMediaUsageProvider({ findUsages: () => Promise.resolve([ref('draft', '  ')]) });
    expect(() => registerMediaUsageProvider({ findUsages: () => Promise.resolve([]) })).toThrow();
    expect((await findUsagesOrEmpty(['m']))[0]!.postTitle).toBe('Bài chưa đặt tên');
    resetMediaUsageProviderForTests();
  });

  it('chia lô ≤ 100 mã; chỉ approved/scheduled chặn xóa, các trạng thái khác cần xác nhận', async () => {
    resetMediaUsageProviderForTests();
    const batches: number[] = [];
    registerMediaUsageProvider({
      findUsages: (ids) => {
        batches.push(ids.length);
        return Promise.resolve([]);
      },
    });
    await findUsagesOrEmpty(Array.from({ length: 250 }, () => uuidV7()));
    expect(batches).toEqual([100, 100, 50]);
    resetMediaUsageProviderForTests();
    for (const s of ['approved', 'scheduled'] as const)
      expect(hasBlockingUsage([ref(s)])).toBe(true);
    for (const s of ['draft', 'pending_review', 'published', 'failed', 'cancelled'] as const) {
      expect(hasBlockingUsage([ref(s)]), s).toBe(false);
    }
    expect(hasBlockingUsage([ref('draft'), ref('scheduled')])).toBe(true);
  });
});
