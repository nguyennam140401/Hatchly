// Nhóm (h) – việc nền `media.process` (014 data-model.md mục 3, FR-011..014, SC-004, hiến pháp V).
// Bộ xử lý THẬT trên PostgreSQL thật + kho memory + tệp mẫu thật (ảnh + video; video cần ffmpeg/ffprobe – FFMPEG_PATH/FFPROBE_PATH).
// Kiểm: ảnh → ready đúng chiều/đủ phái sinh/không GPS; video không chuyển mã; lỗi vĩnh viễn → unprocessable + trả dung lượng + noRetry;
// lỗi tạm → ném để thử lại, hết lần → onFinalFailure; chạy lại hai lần cùng kết quả; hai Worker; hủy giữa chừng dọn tệp tạm.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runWithJobContext } from '../../src/core/context/bind-account';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { loc } from '../../src/core/storage';
import { MemoryObjectStorage } from '../../src/core/storage/memory/memory-storage';
import { processMedia } from '../../src/modules/media/jobs';
import { createProcessMediaHandler } from '../../src/modules/media/internal/process.handler';
import { QuotaStore } from '../../src/modules/media/internal/quota.store';
import { registerJobHandler } from '../../src/modules/queue';
import { unregisterJobHandler } from '../../src/modules/queue/internal/handlers';
import { expectIdempotent, runJobInline, startTestProducer } from '../support/queue-test-kit';
import {
  asOwner,
  createAccount,
  describeDb,
  makeDatabase,
  resetQueues,
  withAccount,
  type TestDatabase,
} from './helpers/queue-db';

const fx = (name: string): Buffer => readFileSync(resolve(__dirname, '../fixtures/media', name));

const hasFfmpeg = (() => {
  const bin = process.env.FFPROBE_PATH ?? 'ffprobe';
  return spawnSync(bin, ['-version']).status === 0;
})();

/** Kho memory có thể làm lỗi `read` (mô phỏng kho tạm ngắt). */
class FlakyStorage extends MemoryObjectStorage {
  failRead = false;
  override async read(l: Parameters<MemoryObjectStorage['read']>[0]) {
    if (this.failRead) throw new Error('kho tạm ngắt');
    return super.read(l);
  }
}

interface Row {
  status: string;
  failure_code: string | null;
  file_hash: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  normalized_bytes: string | null;
  thumb_bytes: string | null;
  processed_at: Date | null;
}

describeDb('Việc media.process', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  const storage = new FlakyStorage();
  const quota = new QuotaStore(5 * 1024 ** 3);
  let tmpRoot: string;
  let accountId: string;
  const logs: Record<string, unknown>[] = [];

  const handlers = () =>
    createProcessMediaHandler({
      storage,
      quota,
      tmpRoot: () => tmpRoot,
      log: { info: (e) => logs.push(e), warn: (e) => logs.push(e) },
    });

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 8 });
    stopProducer = await startTestProducer();
    tmpRoot = mkdtempSync(join(tmpdir(), 'media-test-'));
    const h = handlers();
    unregisterJobHandler(processMedia.name);
    registerJobHandler(processMedia, h.handler, { onFinalFailure: h.onFinalFailure });
  });
  afterAll(async () => {
    unregisterJobHandler(processMedia.name);
    await stopProducer();
    await database.close();
    rmSync(tmpRoot, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await resetQueues();
    logs.length = 0;
    storage.failRead = false;
    accountId = await createAccount();
  });

  /** Mồi một media `processing` + tệp gốc trong kho + dung lượng đã chốt. */
  async function seed(file: string, contentType: string, bytes?: Buffer) {
    const body = bytes ?? fx(file);
    const mediaId = uuidV7();
    const kind = contentType.startsWith('video/') ? 'video' : 'image';
    await asOwner(async (c) => {
      await c.query(
        `INSERT INTO media.media (id, account_id, kind, status, display_name, original_content_type, original_bytes, uploaded_by_user_id)
         VALUES ($1, $2, $3, 'processing', $4, $5, $6, $7)`,
        [mediaId, accountId, kind, file, contentType, body.length, uuidV7()],
      );
      await c.query(
        `INSERT INTO media.storage_quotas (id, account_id, used_bytes, limit_bytes) VALUES ($1, $2, $3, 5368709120)
         ON CONFLICT (account_id) DO UPDATE SET used_bytes = media.storage_quotas.used_bytes + $3`,
        [uuidV7(), accountId, body.length],
      );
    });
    await withAccount(accountId, () =>
      storage.write(loc.mediaOriginal(mediaId), body, { contentType }),
    );
    return { mediaId, body };
  }

  const rowOf = (mediaId: string): Promise<Row> =>
    asOwner(async (c) => {
      const r = await c.query<Row>(
        `SELECT status, failure_code, file_hash, width, height, duration_ms, normalized_bytes::text, thumb_bytes::text, processed_at
           FROM media.media WHERE id = $1`,
        [mediaId],
      );
      return r.rows[0]!;
    });

  const usedBytes = (): Promise<number> =>
    asOwner(async (c) => {
      const r = await c.query<{ u: string }>(
        'SELECT used_bytes::text AS u FROM media.storage_quotas WHERE account_id = $1',
        [accountId],
      );
      return Number(r.rows[0]?.u ?? 0);
    });

  const objectOf = (l: ReturnType<typeof loc.mediaOriginal>) =>
    withAccount(accountId, async () => {
      const info = await storage.stat(l);
      if (!info.exists) return null;
      const chunks: Buffer[] = [];
      for await (const c of await storage.read(l)) chunks.push(Buffer.from(c as Buffer));
      return Buffer.concat(chunks);
    });

  const run = (mediaId: string, opts: { signal?: AbortSignal } = {}) =>
    runJobInline(processMedia, { mediaId }, { accountId, ...opts });

  describe('ảnh', () => {
    const cases: [string, string][] = [
      ['plain.png', 'image/png'],
      ['plain.webp', 'image/webp'],
      ['plain.jpg', 'image/jpeg'],
      ['plain.heic', 'image/heic'],
      ['exif-rotated-gps.jpg', 'image/jpeg'],
    ];
    it.each(cases)(
      '%s ⇒ ready: đủ bản chuẩn hóa + ảnh thu nhỏ, đúng chiều, không GPS, gốc nguyên vẹn',
      async (file, type) => {
        const { mediaId, body } = await seed(file, type);
        expect(await run(mediaId)).toBeUndefined();
        const row = await rowOf(mediaId);
        expect(row).toMatchObject({ status: 'ready', failure_code: null });
        expect(row.file_hash).toBe(createHash('sha256').update(body).digest('hex'));
        expect(row.processed_at).not.toBeNull();
        expect(Number(row.normalized_bytes)).toBeGreaterThan(0);
        expect(Number(row.thumb_bytes)).toBeGreaterThan(0);

        const normalized = await objectOf(loc.mediaNormalized(mediaId, 'jpeg'));
        const thumb = await objectOf(loc.mediaThumb(mediaId));
        expect(normalized).not.toBeNull();
        expect(thumb).not.toBeNull();
        const nm = await sharp(normalized!).metadata();
        expect(Math.max(nm.width, nm.height)).toBeLessThanOrEqual(2048);
        expect([nm.width, nm.height]).toEqual([row.width, row.height]); // kích thước đã xoay đúng chiều
        expect(nm.exif).toBeUndefined();
        expect(
          Math.max(
            ...Object.values(await sharp(thumb!).metadata()).filter(
              (v): v is number => typeof v === 'number' && v < 5000,
            ),
          ),
        ).toBeGreaterThan(0);
        // gốc nguyên vẹn
        expect((await objectOf(loc.mediaOriginal(mediaId)))!.equals(body)).toBe(true);
        expect(logs.some((l) => l.msg === 'media.process.ready')).toBe(true);
      },
    );

    it('ảnh xoay bằng EXIF: 300×400 lưu dọc + EXIF 6 ⇒ width/height lưu 400×300', async () => {
      const { mediaId } = await seed('exif-rotated-gps.jpg', 'image/jpeg');
      await run(mediaId);
      expect(await rowOf(mediaId)).toMatchObject({ width: 400, height: 300 });
    });

    it('ảnh lớn thu về cạnh dài ≤ 2048; ảnh nhỏ không phóng to', async () => {
      const big = await sharp({
        create: { width: 4000, height: 3000, channels: 3, background: { r: 9, g: 9, b: 9 } },
      })
        .jpeg()
        .toBuffer();
      const { mediaId } = await seed('big.jpg', 'image/jpeg', big);
      await run(mediaId);
      const nm = await sharp((await objectOf(loc.mediaNormalized(mediaId, 'jpeg')))!).metadata();
      expect([nm.width, nm.height]).toEqual([2048, 1536]);
      expect(await rowOf(mediaId)).toMatchObject({ width: 4000, height: 3000 });
    });

    it('chạy lại hai lần ⇒ cùng kết quả (expectIdempotent): hàng, tệp phái sinh, dung lượng', async () => {
      const { mediaId } = await seed('plain.png', 'image/png');
      await expectIdempotent(
        processMedia,
        { mediaId },
        {
          accountId,
          snapshot: async () => ({
            row: await rowOf(mediaId),
            normalized: (await objectOf(loc.mediaNormalized(mediaId, 'jpeg')))?.toString('base64'),
            thumb: (await objectOf(loc.mediaThumb(mediaId)))?.toString('base64'),
            used: await usedBytes(),
          }),
        },
      );
      expect((await rowOf(mediaId)).status).toBe('ready');
    });

    it('hai Worker cùng lấy một việc ⇒ một kết quả, không tệp trùng', async () => {
      const { mediaId } = await seed('plain.webp', 'image/webp');
      await Promise.all([run(mediaId), run(mediaId)]);
      const row = await rowOf(mediaId);
      expect(row.status).toBe('ready');
      const keys = (storage as unknown as { objects: Map<string, unknown> }).objects;
      const mine = [...keys.keys()].filter((k) => k.includes(`/media/${mediaId}/`));
      expect(mine.sort()).toEqual(
        [`/original`, `/normalized/jpeg`, `/thumb`]
          .map((s) => `tenants/${accountId}/media/${mediaId}${s}`)
          .sort(),
      );
    });
  });

  describe.skipIf(!hasFfmpeg)('video (cần ffmpeg/ffprobe)', () => {
    const videos: [string, string, number, number][] = [
      ['moov-end.mp4', 'video/mp4', 320, 240],
      ['faststart.mp4', 'video/mp4', 320, 240],
      ['clip.mov', 'video/quicktime', 320, 240],
      ['rotated90.mp4', 'video/mp4', 240, 320], // xoay 90° ⇒ kích thước hiển thị đảo
    ];
    it.each(videos)(
      '%s ⇒ ready: ảnh thu nhỏ + thời lượng, video KHÔNG chuyển mã, không có bản chuẩn hóa',
      async (file, type, w, h) => {
        const { mediaId, body } = await seed(file, type);
        expect(await run(mediaId)).toBeUndefined();
        const row = await rowOf(mediaId);
        expect(row).toMatchObject({ status: 'ready', width: w, height: h, normalized_bytes: null });
        expect(row.duration_ms).toBeGreaterThanOrEqual(1900);
        expect(row.duration_ms).toBeLessThanOrEqual(2100);
        const thumb = await objectOf(loc.mediaThumb(mediaId));
        const tm = await sharp(thumb!).metadata();
        expect([tm.width, tm.height]).toEqual([w, h]); // thumbnail đúng chiều
        expect(await objectOf(loc.mediaNormalized(mediaId, 'jpeg'))).toBeNull();
        expect((await objectOf(loc.mediaOriginal(mediaId)))!.equals(body)).toBe(true); // không chuyển mã
      },
    );

    it('video chỉ có âm thanh ⇒ unprocessable no_video_stream', async () => {
      const { mediaId } = await seed('audio-only.mp4', 'video/mp4');
      const result = await run(mediaId);
      expect(result).toMatchObject({ kind: 'no_retry', reason: 'no_video_stream' });
      expect(await rowOf(mediaId)).toMatchObject({
        status: 'unprocessable',
        failure_code: 'no_video_stream',
      });
    });
  });

  describe('lỗi vĩnh viễn ⇒ unprocessable + trả dung lượng + noRetry (không vào việc hỏng)', () => {
    const bad: [string, string, string, () => Promise<Buffer> | Buffer][] = [
      ['webp động', 'image/webp', 'animated', () => fx('animated.webp')],
      ['ảnh cắt dở', 'image/jpeg', 'corrupt', () => fx('truncated.jpg')],
      ['không phải ảnh', 'image/jpeg', 'unsupported', () => fx('fake-html.jpg')],
      [
        'quá 50 triệu điểm ảnh',
        'image/png',
        'too_many_pixels',
        () =>
          sharp({
            create: { width: 8000, height: 7000, channels: 3, background: { r: 1, g: 2, b: 3 } },
          })
            .png({ compressionLevel: 9 })
            .toBuffer(),
      ],
    ];
    it.each(bad)('%s ⇒ %s', async (_name, type, code, make) => {
      const body = await make();
      const { mediaId } = await seed('x', type, body);
      const usedBefore = await usedBytes();
      const result = await run(mediaId);
      expect(result).toMatchObject({ kind: 'no_retry', reason: code });
      expect(await rowOf(mediaId)).toMatchObject({ status: 'unprocessable', failure_code: code });
      expect(await usedBytes()).toBe(usedBefore - body.length); // trả dung lượng
      // chạy lại: không trả lần hai
      await run(mediaId);
      expect(await usedBytes()).toBe(usedBefore - body.length);
      expect(await objectOf(loc.mediaNormalized(mediaId, 'jpeg'))).toBeNull();
    });
  });

  describe('lỗi tạm / hủy / bỏ qua', () => {
    it('kho tạm ngắt ⇒ bộ xử lý NÉM (hàng chờ thử lại), media vẫn "đang xử lý", chưa trả dung lượng; thử lại thành công', async () => {
      const { mediaId, body } = await seed('plain.jpg', 'image/jpeg');
      const usedBefore = await usedBytes();
      storage.failRead = true;
      await expect(run(mediaId)).rejects.toThrow('kho tạm ngắt');
      expect(await rowOf(mediaId)).toMatchObject({ status: 'processing' });
      expect(await usedBytes()).toBe(usedBefore);
      storage.failRead = false;
      await run(mediaId); // lần thử lại
      expect((await rowOf(mediaId)).status).toBe('ready');
      expect(await usedBytes()).toBe(usedBefore);
      expect(body.length).toBeGreaterThan(0);
    });

    it('hết lần thử ⇒ onFinalFailure chuyển unprocessable (storage_mismatch) và trả dung lượng ĐÚNG MỘT LẦN', async () => {
      const { mediaId, body } = await seed('plain.jpg', 'image/jpeg');
      const usedBefore = await usedBytes();
      const h = handlers();
      const final = () =>
        runWithJobContext({ traceId: uuidV7(), accountId }, () => h.onFinalFailure({ mediaId }));
      await final();
      expect(await rowOf(mediaId)).toMatchObject({
        status: 'unprocessable',
        failure_code: 'storage_mismatch',
      });
      expect(await usedBytes()).toBe(usedBefore - body.length);
      await final(); // gọi lại không trả lần hai
      expect(await usedBytes()).toBe(usedBefore - body.length);
    });

    it('media đã xóa mềm / không còn processing ⇒ bỏ qua, không đổi gì', async () => {
      const a = await seed('plain.jpg', 'image/jpeg');
      await asOwner((c) =>
        c.query('UPDATE media.media SET deleted_at = now() WHERE id = $1', [a.mediaId]),
      );
      await run(a.mediaId);
      expect((await rowOf(a.mediaId)).status).toBe('processing');
      expect(await objectOf(loc.mediaThumb(a.mediaId))).toBeNull();

      const b = await seed('plain.png', 'image/png');
      await run(b.mediaId);
      const before = await rowOf(b.mediaId);
      await run(b.mediaId); // đã ready ⇒ bỏ qua
      expect(await rowOf(b.mediaId)).toEqual(before);
    });

    it('bị hủy giữa chừng (tắt có kiểm soát) ⇒ ném AbortError và DỌN tệp tạm; media vẫn processing', async () => {
      const { mediaId } = await seed('plain.jpg', 'image/jpeg');
      const ctrl = new AbortController();
      ctrl.abort();
      await expect(run(mediaId, { signal: ctrl.signal })).rejects.toMatchObject({
        name: 'AbortError',
      });
      expect(readdirSync(tmpRoot).filter((d) => d.startsWith('media-'))).toEqual([]);
      expect((await rowOf(mediaId)).status).toBe('processing');
    });

    it('tệp tạm luôn được dọn sau khi xong (kể cả lỗi vĩnh viễn)', async () => {
      const { mediaId } = await seed('x', 'image/jpeg', fx('fake-html.jpg'));
      await run(mediaId);
      expect(readdirSync(tmpRoot).filter((d) => d.startsWith('media-'))).toEqual([]);
    });
  });
});
