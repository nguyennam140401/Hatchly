// Giới hạn thư viện media (014 data-model mục 5) – MỘT nguồn cho web (kiểm trước khi tải) và máy chủ
// (kiểm lại trước khi cấp quyền tải). Dung lượng là số nguyên byte, không số thực.

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

export const MEDIA_LIMITS = {
  /** Ảnh tối đa 20 MB (FR-003, làm rõ Q4); hệ thống nén phía máy chủ khi chuẩn hóa. */
  imageMaxBytes: 20 * MIB,
  /** Video tối đa 500 MB (FR-03). */
  videoMaxBytes: 500 * MIB,
  /** Ảnh vượt số điểm ảnh này bị từ chối khi xử lý (chống nổ bộ nhớ). */
  imageMaxPixels: 50_000_000,
  /** Tệp ≤ ngưỡng này tải một lần (POST ký sẵn); lớn hơn tải nhiều phần (R1). */
  singleUploadMaxBytes: 8 * MIB,
  /** Kích thước mỗi phần của tải nhiều phần (phần cuối có thể nhỏ hơn). */
  partSizeBytes: 8 * MIB,
  /** Phiên tải tiếp tục được trong 24 giờ kể từ hoạt động cuối (FR-005, FR-009). */
  sessionTtlSec: 86_400,
  /** Số tệp tải song song tối đa ở trình duyệt (FR-007). */
  parallelUploads: 3,
  /** Cạnh dài tối đa của bản chuẩn hóa JPEG (FR-011). */
  normalizedMaxEdge: 2048,
  /** Cạnh dài tối đa của ảnh thu nhỏ. */
  thumbMaxEdge: 480,
  normalizedQuality: 82,
  thumbQuality: 75,
  /** Từ ngưỡng này trở lên báo "Sắp đầy" (FR-010). */
  nearFullPercent: 80,
} as const;

/** Hạn mức dung lượng mặc định mỗi tài khoản: 5 GB (cơ số 1024). */
export const MEDIA_QUOTA_BYTES_DEFAULT = 5 * GIB;

/** Loại ảnh được nhận. HEIC/HEIF phụ thuộc kết quả thử nghiệm T029 (research R4). */
export const IMAGE_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

export const VIDEO_CONTENT_TYPES = ['video/mp4', 'video/quicktime'] as const;

export const MEDIA_ACCEPTED = {
  image: IMAGE_CONTENT_TYPES,
  video: VIDEO_CONTENT_TYPES,
} as const;

export const ALLOWED_CONTENT_TYPES = [...IMAGE_CONTENT_TYPES, ...VIDEO_CONTENT_TYPES] as const;
export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

export type MediaKind = 'image' | 'video';

/** Loại phương tiện theo loại nội dung đã khai báo; `null` khi không nhận. */
export function mediaKindOf(contentType: string): MediaKind | null {
  if ((IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType)) return 'image';
  if ((VIDEO_CONTENT_TYPES as readonly string[]).includes(contentType)) return 'video';
  return null;
}

/** Dung lượng tối đa của một tệp theo loại. */
export function maxBytesOf(kind: MediaKind): number {
  return kind === 'image' ? MEDIA_LIMITS.imageMaxBytes : MEDIA_LIMITS.videoMaxBytes;
}

/** Số phần của một tệp tải nhiều phần. */
export function partCountOf(sizeBytes: number): number {
  return Math.ceil(sizeBytes / MEDIA_LIMITS.partSizeBytes);
}

/** Tệp này tải một lần hay nhiều phần. */
export function uploadModeOf(sizeBytes: number): 'single' | 'multipart' {
  return sizeBytes > MEDIA_LIMITS.singleUploadMaxBytes ? 'multipart' : 'single';
}
