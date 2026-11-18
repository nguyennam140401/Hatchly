// Xử lý ảnh (014 R4, FR-011): bản chuẩn hóa JPEG cạnh dài ≤ 2048 px + ảnh thu nhỏ ≤ 480 px, đúng chiều theo EXIF, KHÔNG
// còn EXIF/GPS/ICC, sRGB, chất lượng cố định (82/75). `sharp` (libvips) CHỈ được dùng trong thư mục `internal/` này; kiểm số
// điểm ảnh bằng `metadata()` TRƯỚC khi giải mã (chống nổ bộ nhớ). Thuần hàm trên bộ đệm – tệp tạm do nơi gọi quản lý.
import { MEDIA_LIMITS } from '@app/shared/media';
import sharp, { type Sharp } from 'sharp';
import { decodeHeic, type RawImage } from './heic';
import { ImagePipelineError } from './image-errors';

export { ImagePipelineError, type ImageFailure } from './image-errors';

export interface ProcessedImage {
  normalized: Buffer;
  thumb: Buffer;
  /** Kích thước ảnh gốc ĐÃ xoay đúng chiều. */
  width: number;
  height: number;
}

type Source = Buffer | RawImage;

const isRaw = (s: Source): s is RawImage => !Buffer.isBuffer(s);

function open(source: Source) {
  const options = { limitInputPixels: MEDIA_LIMITS.imageMaxPixels, failOn: 'error' as const };
  return isRaw(source)
    ? sharp(source.data, {
        ...options,
        raw: { width: source.width, height: source.height, channels: source.channels },
      })
    : sharp(source, options);
}

function jpegOf(pipeline: Sharp, maxEdge: number, quality: number): Promise<Buffer> {
  return (
    pipeline
      // EXIF Orientation → điểm ảnh đúng chiều (thẻ xoay bị bỏ); chỉ thu nhỏ, không phóng to.
      .rotate()
      .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
      .toColourspace('srgb')
      // KHÔNG `withMetadata`/`keepExif`: loại EXIF/GPS/ICC nhúng (FR-011, FR-023).
      .jpeg({ quality, progressive: true })
      .toBuffer()
  );
}

/** Ảnh thu nhỏ JPEG ≤ 480 px từ một ảnh bất kỳ (dùng cho khung hình video). */
export async function thumbnailOf(image: Buffer): Promise<Buffer> {
  try {
    return await jpegOf(open(image), MEDIA_LIMITS.thumbMaxEdge, MEDIA_LIMITS.thumbQuality);
  } catch {
    throw new ImagePipelineError('corrupt');
  }
}

/** Chuẩn hóa một ảnh: JPEG ≤ 2048 px + ảnh thu nhỏ ≤ 480 px; `heic` = giải mã bằng WASM trước. */
export async function processImage(
  input: Buffer,
  opts: { heic: boolean; signal?: AbortSignal },
): Promise<ProcessedImage> {
  opts.signal?.throwIfAborted();
  const source: Source = opts.heic ? await decodeHeic(input) : input;
  opts.signal?.throwIfAborted();

  let meta;
  try {
    meta = await open(source).metadata();
  } catch (err) {
    throw classify(err);
  }
  if ((meta.pages ?? 1) > 1) throw new ImagePipelineError('animated');
  const w = meta.width;
  const h = meta.height;
  if (!(w > 0) || !(h > 0)) throw new ImagePipelineError('corrupt');
  if (w * h > MEDIA_LIMITS.imageMaxPixels) throw new ImagePipelineError('too_many_pixels');
  // Hướng EXIF 5–8 hoán đổi rộng/cao (chỉ áp cho nguồn không phải HEIC đã giải mã).
  const swap = !isRaw(source) && (meta.orientation ?? 1) >= 5;
  const width = swap ? h : w;
  const height = swap ? w : h;

  let normalized: Buffer;
  try {
    normalized = await jpegOf(
      open(source),
      MEDIA_LIMITS.normalizedMaxEdge,
      MEDIA_LIMITS.normalizedQuality,
    );
  } catch (err) {
    throw classify(err);
  }
  opts.signal?.throwIfAborted();
  // Ảnh thu nhỏ lấy từ bản chuẩn hóa (đã đúng chiều, nhỏ hơn nên nhanh hơn).
  const thumb = await thumbnailOf(normalized);
  return { normalized, thumb, width, height };
}

function classify(err: unknown): ImagePipelineError {
  const message = err instanceof Error ? err.message : '';
  if (/pixel limit|exceeds/i.test(message)) return new ImagePipelineError('too_many_pixels');
  if (/unsupported image format|unsupported/i.test(message))
    return new ImagePipelineError('unsupported');
  return new ImagePipelineError('corrupt');
}
