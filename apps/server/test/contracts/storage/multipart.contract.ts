import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { runWithJobContext } from '../../../src/core/context/bind-account';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import {
  InvalidRequestError,
  loc,
  MultipartIncompleteError,
  type ObjectStorage,
  type StorageLocation,
} from '../../../src/core/storage';

// Bộ kiểm thử hợp đồng tải nhiều phần của kho tệp (014, contracts/storage-multipart.md mục 4).
// Chạy với `memory` (pnpm test) và `s3` → MinIO (pnpm test:infra).

export interface MultipartHarness {
  storage: ObjectStorage;
  /** "Trình duyệt" PUT một phần bằng URL ký sẵn. true = kho nhận. */
  uploadPart(url: string, bytes: Buffer): Promise<boolean>;
  /** Làm hết hạn: memory tua đồng hồ; S3 chờ thật. */
  expire(seconds: number): Promise<void>;
  /** Số phiên nhiều phần còn mở của tài khoản trong ngữ cảnh (chỉ memory; S3: undefined). */
  openSessions?: () => number | Promise<number>;
  /** Chạy thêm mục 9 (25 MiB / 4 phần ngắt giữa chừng) – chỉ ở `infra`. */
  runLargeScenario?: boolean;
}

const MIB = 1024 * 1024;
const PART = 5 * MIB;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export function describeMultipartContract(harness: () => MultipartHarness): void {
  const s = () => harness().storage;
  const inAcc = <T>(acc: string, fn: () => Promise<T>) =>
    runWithJobContext({ traceId: uuidV7(), accountId: acc }, fn);

  /** Cắt thân thành các phần cỡ `size`. */
  const split = (body: Buffer, size: number) => {
    const out: Buffer[] = [];
    for (let i = 0; i < body.length; i += size) out.push(body.subarray(i, i + size));
    return out;
  };

  /** Mở phiên và (tùy chọn) tải các phần có số chỉ định. */
  async function open(body: Buffer, size = PART, l = loc.mediaOriginal(uuidV7())) {
    const h = await s().createMultipart(l, {
      contentType: 'video/mp4',
      bytes: body.length,
      partSizeBytes: size,
    });
    return { l, h, parts: split(body, size) };
  }

  async function put(l: StorageLocation, h: { uploadId: string }, n: number, bytes: Buffer) {
    const p = await s().presignPart(l, h, { partNumber: n, contentLength: bytes.length });
    return harness().uploadPart(p.url, bytes);
  }

  describe('1. tải đủ phần rồi ghép', () => {
    it('stat đúng kích thước, hash = SHA-256 nội dung; gọi lại complete trả {bytes} đúng', async () => {
      await inAcc(uuidV7(), async () => {
        const body = randomBytes(2 * PART + 123_456); // 3 phần: 5, 5, ~0,1 MiB
        const { l, h, parts } = await open(body);
        for (const [i, p] of parts.entries()) expect(await put(l, h, i + 1, p)).toBe(true);
        expect(await s().listParts(l, h)).toHaveLength(3);
        expect(await s().completeMultipart(l, h, { bytes: body.length })).toEqual({
          bytes: body.length,
        });
        expect(await s().stat(l, { hash: true })).toMatchObject({
          exists: true,
          bytes: body.length,
          sha256: sha(body),
        });
        // Gọi lặp: idempotent
        expect(await s().completeMultipart(l, h, { bytes: body.length })).toEqual({
          bytes: body.length,
        });
      });
    });

    it('chỉ một phần (nhỏ hơn 5 MiB) vẫn hợp lệ', async () => {
      await inAcc(uuidV7(), async () => {
        const body = randomBytes(1000);
        const { l, h, parts } = await open(body);
        expect(await put(l, h, 1, parts[0]!)).toBe(true);
        expect(await s().completeMultipart(l, h, { bytes: 1000 })).toEqual({ bytes: 1000 });
      });
    });
  });

  describe('2. thiếu phần → tiếp tục tải', () => {
    it('thiếu phần 2 ⇒ MultipartIncompleteError, listParts còn đúng 1 và 3, bù phần 2 rồi ghép được', async () => {
      await inAcc(uuidV7(), async () => {
        const body = randomBytes(2 * PART + 777);
        const { l, h, parts } = await open(body);
        expect(await put(l, h, 1, parts[0]!)).toBe(true);
        expect(await put(l, h, 3, parts[2]!)).toBe(true);
        await expect(s().completeMultipart(l, h, { bytes: body.length })).rejects.toBeInstanceOf(
          MultipartIncompleteError,
        );
        expect((await s().listParts(l, h)).map((p) => p.partNumber)).toEqual([1, 3]);
        expect((await s().stat(l)).exists).toBe(false); // không ghép khi thiếu
        expect(await put(l, h, 2, parts[1]!)).toBe(true);
        await s().completeMultipart(l, h, { bytes: body.length });
        expect(await s().stat(l, { hash: true })).toMatchObject({ sha256: sha(body) });
      });
    });

    it('tổng khai báo sai ⇒ MultipartIncompleteError và không ghép', async () => {
      await inAcc(uuidV7(), async () => {
        const body = randomBytes(PART + 10);
        const { l, h, parts } = await open(body);
        for (const [i, p] of parts.entries()) await put(l, h, i + 1, p);
        await expect(
          s().completeMultipart(l, h, { bytes: body.length + 1 }),
        ).rejects.toBeInstanceOf(MultipartIncompleteError);
        expect((await s().stat(l)).exists).toBe(false);
      });
    });
  });

  describe('3. ghi đè một phần', () => {
    it('URL mới cùng số phần ⇒ phần mới thắng', async () => {
      await inAcc(uuidV7(), async () => {
        const body = randomBytes(PART + 500);
        const { l, h, parts } = await open(body);
        expect(await put(l, h, 1, randomBytes(PART))).toBe(true); // bản sai
        expect(await put(l, h, 1, parts[0]!)).toBe(true); // bản đúng ghi đè
        expect(await put(l, h, 2, parts[1]!)).toBe(true);
        await s().completeMultipart(l, h, { bytes: body.length });
        expect(await s().stat(l, { hash: true })).toMatchObject({ sha256: sha(body) });
      });
    });
  });

  describe('4. hạn của URL phần', () => {
    it('hết hạn ⇒ bị từ chối; ttlSec > 900 ⇒ InvalidRequestError', async () => {
      await inAcc(uuidV7(), async () => {
        const body = randomBytes(PART + 10);
        const { l, h, parts } = await open(body);
        const short = await s().presignPart(l, h, {
          partNumber: 1,
          contentLength: PART,
          ttlSec: 1,
        });
        await harness().expire(3);
        expect(await harness().uploadPart(short.url, parts[0]!)).toBe(false);
        await expect(
          s().presignPart(l, h, { partNumber: 1, contentLength: PART, ttlSec: 901 }),
        ).rejects.toBeInstanceOf(InvalidRequestError);
      });
    });
  });

  describe('5. phần sai contentLength', () => {
    it('bị kho từ chối khi tải, hoặc (không ký được) complete bác theo tổng', async () => {
      await inAcc(uuidV7(), async () => {
        const body = randomBytes(2 * PART + 100);
        const { l, h, parts } = await open(body);
        expect(await put(l, h, 1, parts[0]!)).toBe(true);
        // Xin URL cho PART byte nhưng gửi thừa 100 byte.
        const p2 = await s().presignPart(l, h, { partNumber: 2, contentLength: PART });
        const accepted = await harness().uploadPart(
          p2.url,
          Buffer.concat([parts[1]!, randomBytes(100)]),
        );
        expect(await put(l, h, 3, parts[2]!)).toBe(true);
        if (accepted) {
          await expect(s().completeMultipart(l, h, { bytes: body.length })).rejects.toBeInstanceOf(
            MultipartIncompleteError,
          );
        }
        expect((await s().stat(l)).exists).toBe(false);
      });
    });
  });

  describe('6. abortMultipart', () => {
    it('listParts rỗng, stat không có, gọi lặp không lỗi', async () => {
      await inAcc(uuidV7(), async () => {
        const body = randomBytes(PART + 10);
        const { l, h, parts } = await open(body);
        await put(l, h, 1, parts[0]!);
        await s().abortMultipart(l, h);
        expect(await s().listParts(l, h)).toEqual([]);
        expect((await s().stat(l)).exists).toBe(false);
        await expect(s().abortMultipart(l, h)).resolves.toBeUndefined();
      });
    });
  });

  describe('7. truy cập chéo A ↔ B', () => {
    it('B không tác động được phiên của A bằng cả 5 thao tác', async () => {
      const accA = uuidV7();
      const accB = uuidV7();
      const mediaId = uuidV7();
      const body = randomBytes(PART + 99);
      const a = await inAcc(accA, async () => {
        const o = await open(body, PART, loc.mediaOriginal(mediaId));
        await put(o.l, o.h, 1, o.parts[0]!);
        return o;
      });

      await inAcc(accB, async () => {
        const lb = loc.mediaOriginal(mediaId); // cùng mediaId, nhưng khóa dưới tenants/{B}/
        const swallow = async (fn: () => Promise<unknown>) => {
          try {
            return await fn();
          } catch {
            return undefined;
          }
        };
        const presigned = (await swallow(() =>
          s().presignPart(lb, a.h, { partNumber: 2, contentLength: 99 }),
        )) as { url: string } | undefined;
        if (presigned !== undefined) {
          // Nếu kho vẫn cấp URL thì tải lên bằng URL đó KHÔNG được tác động phiên của A.
          expect(await harness().uploadPart(presigned.url, a.parts[1]!)).toBe(false);
        }
        await swallow(() => s().listParts(lb, a.h));
        await expect(s().completeMultipart(lb, a.h, { bytes: body.length })).rejects.toBeDefined();
        await swallow(() => s().abortMultipart(lb, a.h));
        expect((await s().stat(lb)).exists).toBe(false);
      });

      // Phiên của A còn nguyên và hoàn tất được.
      await inAcc(accA, async () => {
        expect((await s().listParts(a.l, a.h)).map((p) => p.partNumber)).toEqual([1]);
        expect(await put(a.l, a.h, 2, a.parts[1]!)).toBe(true);
        await s().completeMultipart(a.l, a.h, { bytes: body.length });
        expect(await s().stat(a.l, { hash: true })).toMatchObject({ sha256: sha(body) });
      });
    });
  });

  describe('8. deleteAllForCurrentAccount hủy phiên đang mở', () => {
    it('không để rác nhiều phần', async () => {
      const acc = uuidV7();
      await inAcc(acc, async () => {
        const body = randomBytes(PART + 10);
        const { l, h, parts } = await open(body);
        await put(l, h, 1, parts[0]!);
        await s().deleteAllForCurrentAccount();
        expect(await s().listParts(l, h)).toEqual([]);
        const open2 = harness().openSessions;
        if (open2 !== undefined) expect(await open2()).toBe(0);
      });
    });
  });

  describe('quy tắc tham số (mục 2)', () => {
    it('chỉ media_original; partSize < 5 MiB khi nhiều phần; vượt trần; partNumber ngoài [1, 10000]', async () => {
      await inAcc(uuidV7(), async () => {
        const base = { contentType: 'video/mp4' as const, bytes: 10 * MIB, partSizeBytes: PART };
        await expect(s().createMultipart(loc.mediaThumb(uuidV7()), base)).rejects.toBeInstanceOf(
          InvalidRequestError,
        );
        await expect(s().createMultipart(loc.contextFile(uuidV7()), base)).rejects.toBeInstanceOf(
          InvalidRequestError,
        );
        const l = loc.mediaOriginal(uuidV7());
        await expect(
          s().createMultipart(l, { ...base, partSizeBytes: MIB }),
        ).rejects.toBeInstanceOf(InvalidRequestError);
        await expect(
          s().createMultipart(l, { ...base, bytes: 5 * 1024 ** 3 + 1 }),
        ).rejects.toBeInstanceOf(InvalidRequestError);
        const h = await s().createMultipart(l, base);
        for (const partNumber of [0, 10_001]) {
          await expect(
            s().presignPart(l, h, { partNumber, contentLength: PART }),
          ).rejects.toBeInstanceOf(InvalidRequestError);
        }
        await s().abortMultipart(l, h);
      });
    });
  });

  describe('9. (infra) 25 MiB / 4 phần ngắt giữa chừng', () => {
    it.runIf(harness().runLargeScenario === true)(
      'listParts đúng sau ngắt, ghép sau khi bù phần (kiểm V5)',
      async () => {
        await inAcc(uuidV7(), async () => {
          const size = 8 * MIB;
          const body = randomBytes(25 * MIB); // 8 + 8 + 8 + 1
          const { l, h, parts } = await open(body, size);
          expect(parts).toHaveLength(4);
          expect(await put(l, h, 1, parts[0]!)).toBe(true);
          expect(await put(l, h, 2, parts[1]!)).toBe(true);
          // "ngắt": mở lại bằng listParts – nguồn sự thật
          expect((await s().listParts(l, h)).map((p) => p.partNumber)).toEqual([1, 2]);
          expect(await put(l, h, 3, parts[2]!)).toBe(true);
          expect(await put(l, h, 4, parts[3]!)).toBe(true);
          await s().completeMultipart(l, h, { bytes: body.length });
          expect(await s().stat(l, { hash: true })).toMatchObject({
            bytes: body.length,
            sha256: sha(body),
          });
        });
      },
      120_000,
    );
  });
}
