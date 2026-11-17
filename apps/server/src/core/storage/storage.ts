import type { Readable } from 'node:stream';
import { InvalidRequestError, type StorageLocation, type StoragePrefix } from './location';

// Giao diện kho tệp (005, contracts/storage.md mục 1). Kiểu SDK AWS KHÔNG xuất hiện ở đây (FR-008).

export const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
  'application/pdf',
] as const;
export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

export interface PresignedUpload {
  url: string;
  fields: Record<string, string>;
  expiresAt: Date;
  maxBytes: number;
  contentType: AllowedContentType;
}

export interface SignedUrl {
  url: string;
  expiresAt: Date;
  purpose: 'preview' | 'public';
}

export type ObjectInfo =
  | { exists: false }
  | { exists: true; bytes: number; contentType: string; sha256?: string; lastModified: Date };

/** Phiên tải nhiều phần – chuỗi mờ, KHÔNG vào nhật ký/chỉ số/thông điệp lỗi (014, storage-multipart.md). */
export interface MultipartHandle {
  uploadId: string;
}

export interface PartInfo {
  partNumber: number;
  bytes: number;
  etag: string;
}

/** Ghép phần thất bại vì thiếu phần / lệch kích thước – KHÔNG chứa khóa hay uploadId. */
export class MultipartIncompleteError extends Error {
  readonly code = 'MULTIPART_INCOMPLETE';
  constructor() {
    super('Tệp chưa lên đủ các phần');
    this.name = 'MultipartIncompleteError';
  }
}

/** Trần an toàn của một tệp tải nhiều phần (gấp 10 lần video lớn nhất). */
export const MAX_MULTIPART_BYTES = 5 * 1024 ** 3;
/** Phần tối thiểu của S3 (trừ phần cuối / khi chỉ có một phần). */
export const MIN_PART_BYTES = 5 * 1024 * 1024;
export const MAX_PART_NUMBER = 10_000;

export interface ObjectStorage {
  presignUpload(
    loc: StorageLocation,
    opts: { contentType: AllowedContentType; maxBytes: number; ttlSec?: number },
  ): Promise<PresignedUpload>;
  stat(loc: StorageLocation, opts?: { hash?: boolean }): Promise<ObjectInfo>;
  read(loc: StorageLocation): Promise<Readable>;
  write(
    loc: StorageLocation,
    body: Readable | Buffer,
    opts: { contentType: string },
  ): Promise<{ bytes: number; sha256: string }>;
  copy(from: StorageLocation, to: StorageLocation): Promise<void>;
  delete(loc: StorageLocation): Promise<void>;
  list(
    prefix: StoragePrefix,
    opts?: { after?: string; limit?: number },
  ): Promise<{ items: { loc: StorageLocation; bytes: number }[]; next?: string }>;
  signedUrl(
    loc: StorageLocation,
    purpose: 'preview' | 'public',
    ttlSec?: number,
  ): Promise<SignedUrl>;
  deleteAllForCurrentAccount(): Promise<{ deleted: number }>;

  /** Mở phiên nhiều phần cho `media_original` (014). `bytes` = dung lượng khai báo. */
  createMultipart(
    loc: StorageLocation,
    opts: { contentType: AllowedContentType; bytes: number; partSizeBytes: number },
  ): Promise<MultipartHandle>;
  /** URL ký sẵn `PUT` cho MỘT phần; hạn ≤ MAX_UPLOAD_TTL_SEC. */
  presignPart(
    loc: StorageLocation,
    h: MultipartHandle,
    part: { partNumber: number; contentLength: number; ttlSec?: number },
  ): Promise<{ url: string; expiresAt: Date; headers: Record<string, string> }>;
  /** Phần đã lên – nguồn sự thật cho tiếp tục tải (trả đủ, phân trang nội bộ). */
  listParts(loc: StorageLocation, h: MultipartHandle): Promise<PartInfo[]>;
  /** Ghép phần; thiếu/lệch ⇒ `MultipartIncompleteError` (không ghép). Gọi lại khi đã ghép ⇒ `{bytes}` đúng. */
  completeMultipart(
    loc: StorageLocation,
    h: MultipartHandle,
    expect: { bytes: number },
  ): Promise<{ bytes: number }>;
  /** Hủy phiên và xóa các phần đã lên. Phiên không còn ⇒ không lỗi. */
  abortMultipart(loc: StorageLocation, h: MultipartHandle): Promise<void>;
}

/** Token NestJS của ObjectStorage. */
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export const MAX_UPLOAD_TTL_SEC = 900;
export const MAX_PREVIEW_TTL_SEC = 3600;
export const MAX_PUBLIC_TTL_SEC = 86_400;
/** Nhãn đối tượng của tệp tạm – luật vòng đời của bucket xóa sau 1 ngày. */
export const TMP_TAG = { key: 'lifecycle', value: 'tmp' } as const;

/** Kiểm tham số dùng chung cho mọi bản cài đặt (vượt trần → lỗi, không âm thầm cắt). */
export function checkPresign(
  l: StorageLocation,
  opts: { contentType: string; maxBytes: number; ttlSec?: number },
): number {
  if (l.kind === 'job_tmp') throw new InvalidRequestError('tệp tạm không có đường dẫn tải lên');
  if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(opts.contentType)) {
    throw new InvalidRequestError('loại tệp không được phép');
  }
  if (opts.contentType === 'application/pdf' && l.kind !== 'context_file') {
    throw new InvalidRequestError('PDF chỉ cho tệp ngữ cảnh');
  }
  if (!Number.isInteger(opts.maxBytes) || opts.maxBytes < 1)
    throw new InvalidRequestError('maxBytes');
  const ttl = opts.ttlSec ?? MAX_UPLOAD_TTL_SEC;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_UPLOAD_TTL_SEC)
    throw new InvalidRequestError('ttlSec');
  return ttl;
}

export function checkSignedUrl(
  l: StorageLocation,
  purpose: 'preview' | 'public',
  ttlSec?: number,
): number {
  if (purpose === 'preview' && l.kind === 'job_tmp') {
    throw new InvalidRequestError('giao diện không xem tệp tạm');
  }
  const max = purpose === 'preview' ? MAX_PREVIEW_TTL_SEC : MAX_PUBLIC_TTL_SEC;
  const ttl = ttlSec ?? max;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > max) throw new InvalidRequestError('ttlSec');
  return ttl;
}

/** Kiểm tham số `createMultipart` dùng chung cho mọi bản cài đặt. */
export function checkCreateMultipart(
  l: StorageLocation,
  opts: { contentType: string; bytes: number; partSizeBytes: number },
): void {
  if (l.kind !== 'media_original') {
    throw new InvalidRequestError('chỉ tệp gốc media được tải nhiều phần');
  }
  if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(opts.contentType)) {
    throw new InvalidRequestError('loại tệp không được phép');
  }
  if (opts.contentType === 'application/pdf')
    throw new InvalidRequestError('loại tệp không được phép');
  if (!Number.isInteger(opts.bytes) || opts.bytes < 1 || opts.bytes > MAX_MULTIPART_BYTES) {
    throw new InvalidRequestError('bytes');
  }
  if (!Number.isInteger(opts.partSizeBytes) || opts.partSizeBytes < 1) {
    throw new InvalidRequestError('partSizeBytes');
  }
  if (opts.partSizeBytes < MIN_PART_BYTES && opts.bytes > opts.partSizeBytes) {
    throw new InvalidRequestError('partSizeBytes quá nhỏ');
  }
  if (Math.ceil(opts.bytes / opts.partSizeBytes) > MAX_PART_NUMBER) {
    throw new InvalidRequestError('quá nhiều phần');
  }
}

/** Kiểm tham số `presignPart`; trả về hạn (giây). */
export function checkPresignPart(
  l: StorageLocation,
  part: { partNumber: number; contentLength: number; ttlSec?: number },
): number {
  if (l.kind !== 'media_original')
    throw new InvalidRequestError('chỉ tệp gốc media được tải nhiều phần');
  if (
    !Number.isInteger(part.partNumber) ||
    part.partNumber < 1 ||
    part.partNumber > MAX_PART_NUMBER
  ) {
    throw new InvalidRequestError('partNumber');
  }
  if (!Number.isInteger(part.contentLength) || part.contentLength < 1) {
    throw new InvalidRequestError('contentLength');
  }
  const ttl = part.ttlSec ?? MAX_UPLOAD_TTL_SEC;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_UPLOAD_TTL_SEC)
    throw new InvalidRequestError('ttlSec');
  return ttl;
}

/** Các phần đã lên có đủ để ghép không (mọi phần 1..N, trừ phần cuối đúng partSize, tổng đúng bytes). */
export function partsComplete(
  parts: PartInfo[],
  partSizeBytes: number,
  totalBytes: number,
): boolean {
  const n = Math.ceil(totalBytes / partSizeBytes);
  const byNumber = new Map(parts.map((p) => [p.partNumber, p.bytes]));
  if (byNumber.size !== n) return false;
  let sum = 0;
  for (let i = 1; i <= n; i++) {
    const b = byNumber.get(i);
    if (b === undefined) return false;
    if (i < n && b !== partSizeBytes) return false;
    sum += b;
  }
  return sum === totalBytes;
}
