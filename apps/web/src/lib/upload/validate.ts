// Kiểm tệp TRƯỚC KHI tải (FR-021): loại và dung lượng; báo lỗi theo từng tệp, không chặn các tệp hợp lệ khác.

export const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // video ≤ 500 MB
export const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export interface UploadRules {
  maxImageBytes: number;
  maxVideoBytes: number;
  imageTypes: readonly string[];
  videoTypes: readonly string[];
}

export const DEFAULT_RULES: UploadRules = {
  maxImageBytes: DEFAULT_MAX_IMAGE_BYTES,
  maxVideoBytes: MAX_VIDEO_BYTES,
  imageTypes: ['image/jpeg', 'image/png', 'image/webp'],
  videoTypes: ['video/mp4', 'video/quicktime'],
};

export interface FileLike {
  name: string;
  type: string;
  size: number;
}

export type FileCheck = { ok: true } | { ok: false; message: string };

function mb(bytes: number): string {
  return `${String(Math.round(bytes / (1024 * 1024)))} MB`;
}

export function validateFile(file: FileLike, rules: UploadRules = DEFAULT_RULES): FileCheck {
  if (file.size <= 0) {
    return { ok: false, message: `Tệp "${file.name}" trống. Hãy chọn tệp khác.` };
  }
  if (rules.imageTypes.includes(file.type)) {
    return file.size > rules.maxImageBytes
      ? {
          ok: false,
          message: `Ảnh "${file.name}" lớn hơn ${mb(rules.maxImageBytes)}. Hãy chọn ảnh nhỏ hơn.`,
        }
      : { ok: true };
  }
  if (rules.videoTypes.includes(file.type)) {
    return file.size > rules.maxVideoBytes
      ? {
          ok: false,
          message: `Video "${file.name}" lớn hơn ${mb(rules.maxVideoBytes)}. Hãy chọn video nhỏ hơn.`,
        }
      : { ok: true };
  }
  return {
    ok: false,
    message: `Tệp "${file.name}" không đúng loại. Chỉ nhận ảnh (JPG, PNG, WebP) và video (MP4, MOV).`,
  };
}
