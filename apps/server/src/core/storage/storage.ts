import type { Readable } from 'node:stream';
import { InvalidRequestError, type StorageLocation, type StoragePrefix } from './location';

// Giao diện kho tệp (005, contracts/storage.md mục 1). Kiểu SDK AWS KHÔNG xuất hiện ở đây (FR-008).

export const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
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

export interface ObjectStorage {
  presignUpload(
    loc: StorageLocation,
    opts: { contentType: AllowedContentType; maxBytes: number; ttlSec?: number },
  ): Promise<PresignedUpload>;
  stat(loc: StorageLocation, opts?: { hash?: boolean }): Promise<ObjectInfo>;
  read(loc: StorageLocation): Promise<Readable>;
  write(loc: StorageLocation, body: Readable | Buffer, opts: { contentType: string }): Promise<{ bytes: number; sha256: string }>;
  copy(from: StorageLocation, to: StorageLocation): Promise<void>;
  delete(loc: StorageLocation): Promise<void>;
  list(
    prefix: StoragePrefix,
    opts?: { after?: string; limit?: number },
  ): Promise<{ items: { loc: StorageLocation; bytes: number }[]; next?: string }>;
  signedUrl(loc: StorageLocation, purpose: 'preview' | 'public', ttlSec?: number): Promise<SignedUrl>;
  deleteAllForCurrentAccount(): Promise<{ deleted: number }>;
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
  if (!Number.isInteger(opts.maxBytes) || opts.maxBytes < 1) throw new InvalidRequestError('maxBytes');
  const ttl = opts.ttlSec ?? MAX_UPLOAD_TTL_SEC;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_UPLOAD_TTL_SEC) throw new InvalidRequestError('ttlSec');
  return ttl;
}

export function checkSignedUrl(l: StorageLocation, purpose: 'preview' | 'public', ttlSec?: number): number {
  if (purpose === 'preview' && l.kind === 'job_tmp') {
    throw new InvalidRequestError('giao diện không xem tệp tạm');
  }
  const max = purpose === 'preview' ? MAX_PREVIEW_TTL_SEC : MAX_PUBLIC_TTL_SEC;
  const ttl = ttlSec ?? max;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > max) throw new InvalidRequestError('ttlSec');
  return ttl;
}
