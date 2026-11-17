// Dò nội dung THẬT của tệp bằng magic bytes (014 R8, FR-004): không tin đuôi tệp hay Content-Type do trình duyệt
// gửi. Hàm thuần, chỉ đọc phần đầu tệp. Từ chối GIF, WebP/PNG/HEIC động, SVG, HTML, EXE, âm thanh…
import { mediaKindOf, type MediaKind } from '@app/shared/media';

/** Số byte đầu tệp cần đọc để dò (đủ cho ftyp, RIFF/VP8X và khối `acTL` của PNG động). */
export const SNIFF_HEAD_BYTES = 4096;

export type SniffRejection = 'type_unsupported' | 'animated' | 'type_mismatch';

export type SniffResult =
  { kind: MediaKind; contentType: string; animated?: false } | { rejected: SniffRejection };

const ascii = (b: Uint8Array, from: number, to: number): string =>
  String.fromCharCode(...b.subarray(from, to));

const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'mif1']);
/** Chuỗi ảnh HEIF (động). */
const HEIF_SEQUENCE_BRANDS = new Set(['hevc', 'hevx', 'msf1', 'hevm', 'hevs']);
/** Ảnh AVIF/AVIS và âm thanh M4A: không nhận. */
const REJECTED_BRANDS = new Set(['avif', 'avis', 'M4A ', 'M4B ', 'M4P ']);
/** Khối đầu tệp MOV đời cũ không có `ftyp`. */
const QT_ATOMS = new Set(['moov', 'mdat', 'wide', 'free', 'skip']);

/** Tìm chuỗi ASCII trong phần đầu tệp. */
function contains(head: Uint8Array, needle: string): boolean {
  const n = needle.length;
  outer: for (let i = 0; i + n <= head.length; i++) {
    for (let j = 0; j < n; j++) {
      if (head[i + j] !== needle.charCodeAt(j)) continue outer;
    }
    return true;
  }
  return false;
}

/** Loại thật của tệp theo nội dung (không so với khai báo). */
function detect(head: Uint8Array): SniffResult {
  if (head.length < 12) return { rejected: 'type_unsupported' };

  // JPEG
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { kind: 'image', contentType: 'image/jpeg' };
  }
  // PNG (APNG có khối `acTL` trước dữ liệu ảnh)
  if (
    head[0] === 0x89 &&
    ascii(head, 1, 4) === 'PNG' &&
    head[4] === 0x0d &&
    head[5] === 0x0a &&
    head[6] === 0x1a &&
    head[7] === 0x0a
  ) {
    return contains(head, 'acTL')
      ? { rejected: 'animated' }
      : { kind: 'image', contentType: 'image/png' };
  }
  // GIF
  if (ascii(head, 0, 4) === 'GIF8') return { rejected: 'type_unsupported' };
  // WebP: "RIFF" size "WEBP"; động khi VP8X có cờ hoạt ảnh (bit 1 của byte cờ) hoặc có khối ANIM/ANMF
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') {
    const chunk = ascii(head, 12, 16);
    if (chunk === 'VP8X') {
      const flags = head[20] ?? 0;
      if ((flags & 0x02) !== 0 || contains(head, 'ANIM') || contains(head, 'ANMF')) {
        return { rejected: 'animated' };
      }
      return { kind: 'image', contentType: 'image/webp' };
    }
    if (chunk === 'VP8 ' || chunk === 'VP8L') return { kind: 'image', contentType: 'image/webp' };
    return { rejected: 'type_unsupported' };
  }
  // Họ ISO-BMFF: HEIC/HEIF, MP4, MOV
  if (ascii(head, 4, 8) === 'ftyp') {
    const brand = ascii(head, 8, 12);
    if (HEIC_BRANDS.has(brand)) return { kind: 'image', contentType: 'image/heic' };
    if (HEIF_SEQUENCE_BRANDS.has(brand)) return { rejected: 'animated' };
    if (REJECTED_BRANDS.has(brand)) return { rejected: 'type_unsupported' };
    if (brand === 'qt  ') return { kind: 'video', contentType: 'video/quicktime' };
    return { kind: 'video', contentType: 'video/mp4' };
  }
  if (QT_ATOMS.has(ascii(head, 4, 8))) return { kind: 'video', contentType: 'video/quicktime' };

  return { rejected: 'type_unsupported' };
}

/** HEIC và HEIF là một họ; MP4 và MOV cùng là video (trình duyệt gắn nhãn tùy đuôi tệp). */
function compatible(detected: string, declared: string): boolean {
  if (detected === declared) return true;
  const imageHeif = new Set(['image/heic', 'image/heif']);
  if (imageHeif.has(detected) && imageHeif.has(declared)) return true;
  const video = new Set(['video/mp4', 'video/quicktime']);
  return video.has(detected) && video.has(declared);
}

/**
 * Dò nội dung và so với loại khai báo. Trả loại THẬT (để lưu `original_content_type`) hoặc lý do bác:
 * `type_unsupported` (không thuộc danh sách nhận), `animated` (ảnh động), `type_mismatch` (khác loại khai báo).
 */
export function sniffMedia(head: Uint8Array, declaredContentType: string): SniffResult {
  const found = detect(head);
  if ('rejected' in found) return found;
  if (mediaKindOf(found.contentType) === null) return { rejected: 'type_unsupported' };
  if (!compatible(found.contentType, declaredContentType)) return { rejected: 'type_mismatch' };
  return found;
}
