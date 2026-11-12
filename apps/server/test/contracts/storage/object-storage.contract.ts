import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { runWithJobContext } from '../../../src/core/context/bind-account';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import {
  InvalidRequestError,
  loc,
  type ObjectStorage,
  type PresignedUpload,
  type StorageLocation,
} from '../../../src/core/storage';

// Bộ kiểm thử hợp đồng kho tệp (005, contracts/storage.md mục 4). Chạy với `memory` (pnpm test) và
// `s3` → MinIO (pnpm test:infra). `uploader` là "trình duyệt" của bản cài đặt.

export interface StorageHarness {
  storage: ObjectStorage;
  /** Dùng đường dẫn tải lên như trình duyệt; `fields` ghi đè để thử gian lận. true = được nhận. */
  upload(p: PresignedUpload, bytes: Buffer, contentType: string, fields?: Record<string, string>): Promise<boolean>;
  download(url: string): Promise<Buffer | null>;
  /** Làm hết hạn: memory tua đồng hồ; S3 chờ thật. */
  expire(seconds: number): Promise<void>;
  /** Nhãn đối tượng của tệp tạm + luật vòng đời (S3: luật bucket; memory: dọn theo đồng hồ). */
  checkTmpLifecycle(l: StorageLocation): Promise<void>;
  /** Đồng hồ của kho (memory: đồng hồ giả đã tua). */
  now(): number;
}

const png = (n = 64) => Buffer.concat([Buffer.from('89504e47', 'hex'), randomBytes(n)]);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export function describeObjectStorageContract(harness: () => StorageHarness): void {
  const s = () => harness().storage;
  const inAcc = <T>(acc: string, fn: () => Promise<T>, jobId?: string) =>
    runWithJobContext({ traceId: uuidV7(), accountId: acc, ...(jobId !== undefined ? { jobId } : {}) }, fn);

  describe('1–3. tải lên bằng đường dẫn ký sẵn', () => {
    it('tải đúng → stat đúng kích thước/loại; hash = SHA-256; dùng lại trong hạn → ghi đè', async () => {
      const acc = uuidV7();
      await inAcc(acc, async () => {
        const l = loc.mediaOriginal(uuidV7());
        const up = await s().presignUpload(l, { contentType: 'image/png', maxBytes: 10_000 });
        expect(up.expiresAt.getTime()).toBeLessThanOrEqual(harness().now() + 900_000 + 1000);
        const body = png();
        expect(await harness().upload(up, body, 'image/png')).toBe(true);
        expect(await s().stat(l)).toMatchObject({ exists: true, bytes: body.length, contentType: 'image/png' });
        expect(await s().stat(l, { hash: true })).toMatchObject({ sha256: sha(body) });
        const again = png(100);
        expect(await harness().upload(up, again, 'image/png')).toBe(true);
        expect(await s().stat(l, { hash: true })).toMatchObject({ bytes: again.length, sha256: sha(again) });
      });
    });

    it('quá maxBytes / sai Content-Type / đổi key / sau hạn → bị từ chối', async () => {
      const acc = uuidV7();
      await inAcc(acc, async () => {
        const l = loc.mediaOriginal(uuidV7());
        const up = await s().presignUpload(l, { contentType: 'image/png', maxBytes: 100 });
        expect(await harness().upload(up, png(500), 'image/png')).toBe(false);
        expect(await harness().upload(up, png(), 'image/jpeg', { 'Content-Type': 'image/jpeg' })).toBe(false);
        const other = `tenants/${acc}/media/${uuidV7()}/original`;
        expect(await harness().upload(up, png(), 'image/png', { key: other })).toBe(false);
        expect(await s().stat(l)).toEqual({ exists: false });
        const short = await s().presignUpload(l, { contentType: 'image/png', maxBytes: 100, ttlSec: 1 });
        await harness().expire(3);
        expect(await harness().upload(short, png(), 'image/png')).toBe(false);
        expect(await s().stat(l)).toEqual({ exists: false });
      });
    });

    it('ttlSec > 900 → InvalidRequestError; loại tệp ngoài danh sách / PDF ngoài ngữ cảnh → từ chối', async () => {
      await inAcc(uuidV7(), async () => {
        const l = loc.mediaOriginal(uuidV7());
        await expect(s().presignUpload(l, { contentType: 'image/png', maxBytes: 1, ttlSec: 901 })).rejects.toBeInstanceOf(InvalidRequestError);
        await expect(s().presignUpload(l, { contentType: 'text/html' as never, maxBytes: 1 })).rejects.toBeInstanceOf(InvalidRequestError);
        await expect(s().presignUpload(l, { contentType: 'application/pdf', maxBytes: 1 })).rejects.toBeInstanceOf(InvalidRequestError);
        await expect(
          s().presignUpload(loc.contextFile(uuidV7()), { contentType: 'application/pdf', maxBytes: 1 }),
        ).resolves.toMatchObject({ contentType: 'application/pdf' });
      });
    });
  });

  describe('4. ma trận truy cập chéo (SC-005)', () => {
    it('mọi thao tác × mọi kind: ngữ cảnh A không chạm được gì của B; lỗi không chứa khóa của B', async () => {
      const a = uuidV7();
      const b = uuidV7();
      const jobB = uuidV7();
      const ids = { media: uuidV7(), file: uuidV7() };
      const kinds: { name: string; make: () => StorageLocation }[] = [
        { name: 'media_original', make: () => loc.mediaOriginal(ids.media) },
        { name: 'media_normalized', make: () => loc.mediaNormalized(ids.media, 'w1080') },
        { name: 'media_thumb', make: () => loc.mediaThumb(ids.media) },
        { name: 'context_file', make: () => loc.contextFile(ids.file) },
        { name: 'job_tmp', make: () => loc.jobTmp('audio.mp3') },
      ];
      const bodies = new Map<string, Buffer>();
      for (const k of kinds) {
        const body = png();
        bodies.set(k.name, body);
        await inAcc(b, () => s().write(k.make(), body, { contentType: 'image/png' }), jobB);
      }
      const errors: string[] = [];
      const capture = async (p: Promise<unknown>) => {
        try {
          await p;
        } catch (err) {
          errors.push(String(err), (err as Error).stack ?? '');
        }
      };
      await inAcc(
        a,
        async () => {
          for (const k of kinds) {
            const l = k.make();
            expect(await s().stat(l), k.name).toEqual({ exists: false });
            await capture(s().read(l).then(async (r) => {
              for await (const _ of r) throw new Error('đọc được tệp của B');
            }));
            await capture(s().copy(l, loc.mediaThumb(uuidV7())));
            await s().delete(l);
            if (k.name !== 'job_tmp') {
              await capture(s().presignUpload(l, { contentType: 'image/png', maxBytes: 10 }));
              const url = await s().signedUrl(l, 'preview');
              expect(await harness().download(url.url), k.name).toBeNull();
            }
            const pub = await s().signedUrl(l, 'public');
            expect(await harness().download(pub.url), k.name).toBeNull();
          }
          for (const prefix of [{ kind: 'media' as const }, { kind: 'context' as const }, { kind: 'account' as const }]) {
            expect((await s().list(prefix)).items).toEqual([]);
          }
          expect(await s().deleteAllForCurrentAccount()).toEqual({ deleted: 0 });
        },
        uuidV7(),
      );
      // B còn nguyên.
      await inAcc(
        b,
        async () => {
          for (const k of kinds) {
            expect(await s().stat(k.make(), { hash: true }), k.name).toMatchObject({ exists: true, sha256: sha(bodies.get(k.name)!) });
          }
        },
        jobB,
      );
      expect(errors.join('\n')).not.toContain(b);
    });
  });

  describe('5. đường dẫn xem / công khai', () => {
    it('preview ≤ 3600 s, public ≤ 86400 s; vượt → InvalidRequestError; hết hạn không tải được', async () => {
      await inAcc(uuidV7(), async () => {
        const l = loc.mediaThumb(uuidV7());
        const body = png();
        await s().write(l, body, { contentType: 'image/png' });
        const pv = await s().signedUrl(l, 'preview');
        expect(pv.expiresAt.getTime()).toBeLessThanOrEqual(harness().now() + 3600_000 + 1000);
        expect(await harness().download(pv.url)).toEqual(body);
        await expect(s().signedUrl(l, 'preview', 3601)).rejects.toBeInstanceOf(InvalidRequestError);
        await expect(s().signedUrl(l, 'public', 86_401)).rejects.toBeInstanceOf(InvalidRequestError);
        expect((await s().signedUrl(l, 'public', 86_400)).purpose).toBe('public');
        const short = await s().signedUrl(l, 'public', 1);
        await harness().expire(3);
        expect(await harness().download(short.url)).toBeNull();
      });
    });
  });

  describe('6. tệp tạm của việc', () => {
    it('ngoài ngữ cảnh việc → TenantContextError; khóa tenants/{acc}/tmp/{jobId}/; không tải lên / không preview', async () => {
      const acc = uuidV7();
      await inAcc(acc, async () => {
        expect(() => loc.jobTmp('a.mp3')).toThrow(expect.objectContaining({ name: 'TenantContextError' }));
      });
      const jobId = uuidV7();
      await inAcc(
        acc,
        async () => {
          const l = loc.jobTmp('audio.mp3');
          expect(l).toEqual({ kind: 'job_tmp', jobId, name: 'audio.mp3' });
          await expect(s().presignUpload(l, { contentType: 'image/png', maxBytes: 1 })).rejects.toBeInstanceOf(InvalidRequestError);
          await s().write(l, png(), { contentType: 'audio/mpeg' });
          await expect(s().signedUrl(l, 'preview')).rejects.toBeInstanceOf(InvalidRequestError);
          await expect(s().signedUrl(l, 'public')).resolves.toMatchObject({ purpose: 'public' });
          const listed = await s().list({ kind: 'account' });
          expect(listed.items.map((i) => i.loc)).toContainEqual({ kind: 'job_tmp', jobId, name: 'audio.mp3' });
          await harness().checkTmpLifecycle(l);
        },
        jobId,
      );
    });

    it('tên tệp chứa ../ hoặc ký tự lạ → từ chối, không ảnh hưởng khóa', async () => {
      await inAcc(
        uuidV7(),
        async () => {
          expect(() => loc.jobTmp('../../x')).toThrow(InvalidRequestError);
          expect(() => loc.mediaNormalized(uuidV7(), 'A/B')).toThrow(InvalidRequestError);
          expect(() => loc.mediaOriginal('khong-phai-uuid')).toThrow(InvalidRequestError);
        },
        uuidV7(),
      );
    });
  });

  describe('7. xóa theo tài khoản', () => {
    it('deleteAllForCurrentAccount của A xóa mọi tệp của A (kể cả tệp tạm), B còn nguyên', async () => {
      const a = uuidV7();
      const b = uuidV7();
      const keepB = loc.mediaOriginal(uuidV7());
      await inAcc(b, () => s().write(keepB, png(), { contentType: 'image/png' }));
      const jobA = uuidV7();
      await inAcc(
        a,
        async () => {
          await s().write(loc.mediaOriginal(uuidV7()), png(), { contentType: 'image/png' });
          await s().write(loc.contextFile(uuidV7()), png(), { contentType: 'application/pdf' });
          await s().write(loc.jobTmp('x.bin'), png(), { contentType: 'application/octet-stream' });
          expect(await s().deleteAllForCurrentAccount()).toEqual({ deleted: 3 });
          expect((await s().list({ kind: 'account' })).items).toEqual([]);
        },
        jobA,
      );
      await inAcc(b, async () => {
        expect((await s().stat(keepB)).exists).toBe(true);
      });
    });
  });

  describe('8. thời gian (SC-011)', () => {
    it('tải lên bằng đường dẫn ký sẵn rồi stat thấy tệp đúng vị trí trong ≤ 10 giây', async () => {
      await inAcc(uuidV7(), async () => {
        const started = Date.now();
        const l = loc.mediaOriginal(uuidV7());
        const up = await s().presignUpload(l, { contentType: 'image/jpeg', maxBytes: 5_000_000 });
        expect(await harness().upload(up, randomBytes(1_000_000), 'image/jpeg')).toBe(true);
        expect((await s().stat(l)).exists).toBe(true);
        expect(Date.now() - started).toBeLessThanOrEqual(10_000);
      });
    });
  });
}
