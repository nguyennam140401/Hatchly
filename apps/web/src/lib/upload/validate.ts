// Kiểm tệp TRƯỚC KHI tải (FR-021, 014 FR-001/003): loại và dung lượng; báo lỗi theo từng tệp, không chặn các tệp hợp lệ
// khác. Giới hạn lấy từ `@app/shared/media` (MỘT nguồn với máy chủ, hiến pháp: kiểm hai lần).
import { IMAGE_CONTENT_TYPES, MEDIA_LIMITS, VIDEO_CONTENT_TYPES } from '@app/shared/media';

export const MAX_VIDEO_BYTES = MEDIA_LIMITS.videoMaxBytes; // video ≤ 500 MB
export const DEFAULT_MAX_IMAGE_BYTES = MEDIA_LIMITS.imageMaxBytes; // ảnh ≤ 20 MB

export interface UploadRules {
  maxImageBytes: number;
  maxVideoBytes: number;
  imageTypes: readonly string[];
  videoTypes: readonly string[];
}

export const DEFAULT_RULES: UploadRules = {
  maxImageBytes: DEFAULT_MAX_IMAGE_BYTES,
  maxVideoBytes: MAX_VIDEO_BYTES,
  imageTypes: IMAGE_CONTENT_TYPES,
  videoTypes: VIDEO_CONTENT_TYPES,
};

export interface FileLike {
  name: string;
  type: string;
  size: number;
}

export type FileCheck = { ok: true } | { ok: false; message: string };

/** Một số trình duyệt (Safari iOS) để trống `type` với HEIC – suy ra từ đuôi tệp. */
const BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

/** Loại nội dung dùng để kiểm và khai báo với máy chủ: `type` của trình duyệt, nếu trống thì theo đuôi tệp. */
export function resolveContentType(file: Pick<FileLike, 'name' | 'type'>): string {
  if (file.type !== '') return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return BY_EXTENSION[ext] ?? '';
}

function mb(bytes: number): string {
  return `${String(Math.round(bytes / (1024 * 1024)))} MB`;
}

export function validateFile(file: FileLike, rules: UploadRules = DEFAULT_RULES): FileCheck {
  if (file.size <= 0) {
    return { ok: false, message: `Tệp "${file.name}" trống. Hãy chọn tệp khác.` };
  }
  const type = resolveContentType(file);
  if (rules.imageTypes.includes(type)) {
    return file.size > rules.maxImageBytes
      ? {
          ok: false,
          message: `Ảnh "${file.name}" lớn hơn ${mb(rules.maxImageBytes)}. Ảnh tối đa ${mb(rules.maxImageBytes)} – hãy giảm kích thước rồi tải lại.`,
        }
      : { ok: true };
  }
  if (rules.videoTypes.includes(type)) {
    return file.size > rules.maxVideoBytes
      ? {
          ok: false,
          message: `Video "${file.name}" lớn hơn ${mb(rules.maxVideoBytes)}. Video tối đa ${mb(rules.maxVideoBytes)} – hãy cắt ngắn hoặc nén rồi tải lại.`,
        }
      : { ok: true };
  }
  return {
    ok: false,
    message: `Tệp "${file.name}" không đúng loại. Chỉ nhận ảnh (JPG, PNG, WebP, HEIC) và video (MP4, MOV).`,
  };
}
