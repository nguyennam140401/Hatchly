// 014 T054 (R4, FR-011, SC-004): chuẩn hóa ảnh – đúng chiều theo EXIF (8 hướng), cạnh dài ≤ 2048/480, không phóng to, loại EXIF/GPS,
// chất lượng JPEG cố định, giới hạn điểm ảnh kiểm trước khi giải mã, các lỗi vĩnh viễn có mã đúng.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MEDIA_LIMITS } from '@app/shared/media';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  ImagePipelineError,
  processImage,
} from '../../../src/modules/media/internal/image-pipeline';

const fx = (name: string): Buffer => readFileSync(resolve(__dirname, '../../fixtures/media', name));

/** Góc nào của ảnh kết quả có hình vuông ĐỎ (nhận biết chiều). */
async function redCorner(jpeg: Buffer): Promise<'tl' | 'tr' | 'bl' | 'br' | 'none'> {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * info.channels;
    return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]! };
  };
  const isRed = (p: { r: number; g: number; b: number }) => p.r > 170 && p.g < 130 && p.b < 110;
  const m = 8;
  const found: Record<string, boolean> = {
    tl: isRed(at(m, m)),
    tr: isRed(at(info.width - 1 - m, m)),
    bl: isRed(at(m, info.height - 1 - m)),
    br: isRed(at(info.width - 1 - m, info.height - 1 - m)),
  };
  return (Object.keys(found).find((k) => found[k]) ?? 'none') as 'tl' | 'tr' | 'bl' | 'br' | 'none';
}

describe('processImage – đúng chiều theo EXIF (SC-004: 0 ảnh sai chiều)', () => {
  // Ảnh lưu 120×80 có hình vuông đỏ ở GÓC TRÊN-TRÁI của điểm ảnh lưu; mỗi hướng EXIF đưa nó tới một góc khác.
  const expected: [number, 'tl' | 'tr' | 'bl' | 'br', number, number][] = [
    [1, 'tl', 120, 80],
    [2, 'tr', 120, 80],
    [3, 'br', 120, 80],
    [4, 'bl', 120, 80],
    [5, 'tl', 80, 120],
    [6, 'tr', 80, 120],
    [7, 'br', 80, 120],
    [8, 'bl', 80, 120],
  ];
  it.each(expected)(
    'hướng EXIF %i ⇒ góc đỏ %s, kích thước hiển thị %i×%i',
    async (o, corner, w, h) => {
      const result = await processImage(fx(`orient-${String(o)}.jpg`), { heic: false });
      expect([result.width, result.height]).toEqual([w, h]);
      const meta = await sharp(result.normalized).metadata();
      expect([meta.width, meta.height]).toEqual([w, h]);
      expect(await redCorner(result.normalized)).toBe(corner);
      expect(await redCorner(result.thumb)).toBe(corner);
    },
  );
});

describe('processImage – kích thước, chất lượng, siêu dữ liệu', () => {
  it('ảnh lớn thu về cạnh dài 2048 (chuẩn hóa) và 480 (thu nhỏ); ảnh nhỏ KHÔNG bị phóng to', async () => {
    const big = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 30, g: 90, b: 160 } },
    })
      .jpeg()
      .toBuffer();
    const r = await processImage(big, { heic: false });
    const n = await sharp(r.normalized).metadata();
    const t = await sharp(r.thumb).metadata();
    expect([n.width, n.height]).toEqual([MEDIA_LIMITS.normalizedMaxEdge, 1365]);
    expect([t.width, t.height]).toEqual([MEDIA_LIMITS.thumbMaxEdge, 320]);
    expect([r.width, r.height]).toEqual([3000, 2000]); // kích thước ảnh GỐC (đã xoay)

    const small = await processImage(fx('plain.jpg'), { heic: false }); // 400×300
    const sn = await sharp(small.normalized).metadata();
    expect([sn.width, sn.height]).toEqual([400, 300]);
    const st = await sharp(small.thumb).metadata();
    expect([st.width, st.height]).toEqual([400, 300]); // < 480 ⇒ giữ nguyên
  });

  it('bản chuẩn hóa và ảnh thu nhỏ là JPEG sRGB, KHÔNG còn EXIF/GPS/ICC', async () => {
    const source = fx('exif-rotated-gps.jpg');
    expect((await sharp(source).metadata()).exif).toBeDefined(); // gốc có EXIF + GPS
    const r = await processImage(source, { heic: false });
    for (const out of [r.normalized, r.thumb]) {
      const meta = await sharp(out).metadata();
      expect(meta.format).toBe('jpeg');
      expect(meta.space).toBe('srgb');
      expect(meta.exif).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      expect(meta.orientation).toBeUndefined(); // thẻ xoay đã được áp vào điểm ảnh
      expect(out.includes(Buffer.from('GPS'))).toBe(false);
      expect(out.includes(Buffer.from('FixtureCam'))).toBe(false);
    }
    expect([r.width, r.height]).toEqual([400, 300]); // 300×400 lưu dọc + EXIF 6 ⇒ 400×300
  });

  it('PNG, WebP tĩnh, HEIC đều ra JPEG đúng kích thước', async () => {
    for (const [file, heic] of [
      ['plain.png', false],
      ['plain.webp', false],
      ['plain.heic', true],
    ] as const) {
      const r = await processImage(fx(file), { heic });
      const meta = await sharp(r.normalized).metadata();
      expect(meta.format, file).toBe('jpeg');
      expect(r.width, file).toBeGreaterThan(0);
      expect(r.thumb.length, file).toBeLessThan(r.normalized.length + 1);
    }
    const heic = await processImage(fx('plain.heic'), { heic: true });
    expect([heic.width, heic.height]).toEqual([400, 300]);
    expect(await redCorner(heic.normalized)).toBe('tl');
  });

  it('chất lượng JPEG cố định: cùng đầu vào ⇒ cùng đầu ra (xác định)', async () => {
    const a = await processImage(fx('plain.jpg'), { heic: false });
    const b = await processImage(fx('plain.jpg'), { heic: false });
    expect(a.normalized.equals(b.normalized)).toBe(true);
    expect(a.thumb.equals(b.thumb)).toBe(true);
  });
});

describe('processImage – lỗi vĩnh viễn có mã đúng', () => {
  const failure = async (input: Buffer, heic = false) =>
    processImage(input, { heic }).then(
      () => null,
      (err: unknown) => (err instanceof ImagePipelineError ? err.failure : String(err)),
    );

  it('vượt 50 triệu điểm ảnh ⇒ too_many_pixels (kiểm từ metadata, không giải mã)', async () => {
    const huge = await sharp({
      create: { width: 8000, height: 7000, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(await failure(huge)).toBe('too_many_pixels');
  });

  it('ảnh động (WebP, GIF) ⇒ animated', async () => {
    expect(await failure(fx('animated.webp'))).toBe('animated');
    expect(await failure(fx('animated.gif'))).toBe('animated');
  });

  it('tệp hỏng / cắt dở ⇒ corrupt; không phải ảnh ⇒ unsupported', async () => {
    expect(await failure(fx('truncated.jpg'))).toBe('corrupt');
    expect(await failure(fx('fake-html.jpg'))).toBe('unsupported');
    expect(await failure(Buffer.alloc(0))).toBeTruthy();
  });

  it('HEIC hỏng ⇒ corrupt', async () => {
    expect(await failure(Buffer.from('not-a-heic-file-at-all-0123456789'), true)).toBe('corrupt');
  });

  it('bị hủy (tắt có kiểm soát) ⇒ ném AbortError, không phải lỗi tệp', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      processImage(fx('plain.jpg'), { heic: false, signal: ctrl.signal }),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
