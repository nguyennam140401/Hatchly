import { getExecutionContext } from '../context/request-context';
import { currentAccountId } from '../db/transaction';
import { TenantContextError } from '../db/errors';
import { gatewayEvent } from '../gateways/op-log';

// Vị trí tệp HỢP KIỂU (005, data-model.md mục 4, research R13) – không có thao tác nhận chuỗi khóa thô.
// Khóa dựng từ `currentAccountId()` (+ mã việc đang chạy với `job_tmp`) + mã UUID. MỌI khóa – kể cả tệp
// tạm – nằm dưới `tenants/{acc}/` (hiến pháp nguyên tắc I). Tên tệp của người dùng không bao giờ vào khóa.

export type StorageKind = 'media_original' | 'media_normalized' | 'media_thumb' | 'context_file' | 'job_tmp';

export type StorageLocation =
  | { kind: 'media_original'; mediaId: string }
  | { kind: 'media_normalized'; mediaId: string; variant: string }
  | { kind: 'media_thumb'; mediaId: string }
  | { kind: 'context_file'; fileId: string }
  | { kind: 'job_tmp'; jobId: string; name: string };

export type StoragePrefix = { kind: 'media'; mediaId?: string } | { kind: 'context' } | { kind: 'account' };

/** Lỗi lập trình/yêu cầu sai (vd hạn ký vượt trần, tổ hợp bị cấm) – thông điệp không chứa khóa. */
export class InvalidRequestError extends Error {
  readonly code = 'INVALID_REQUEST';
  constructor(reason: string) {
    super(`Yêu cầu kho tệp không hợp lệ: ${reason}`);
    this.name = 'InvalidRequestError';
  }
}

/** Khóa không thuộc tiền tố của tài khoản trong ngữ cảnh – KHÔNG chứa khóa trong thông điệp. */
export class StorageAccessDenied extends Error {
  readonly code = 'STORAGE_ACCESS_DENIED';
  constructor() {
    super('Không được truy cập tệp này');
    this.name = 'StorageAccessDenied';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME = /^[a-z0-9_-]{1,40}(\.[a-z0-9]{1,8})?$/;

function uuid(value: string, field: string): string {
  if (!UUID.test(value)) throw new InvalidRequestError(`${field} phải là UUID`);
  return value.toLowerCase();
}

function name(value: string, field: string): string {
  if (!NAME.test(value)) throw new InvalidRequestError(`${field} sai định dạng`);
  return value;
}

/** Dựng vị trí – kiểm định dạng ngay khi dựng. */
export const loc = {
  mediaOriginal: (mediaId: string): StorageLocation => ({ kind: 'media_original', mediaId: uuid(mediaId, 'mediaId') }),
  mediaNormalized: (mediaId: string, variant: string): StorageLocation => ({
    kind: 'media_normalized',
    mediaId: uuid(mediaId, 'mediaId'),
    variant: name(variant, 'variant'),
  }),
  mediaThumb: (mediaId: string): StorageLocation => ({ kind: 'media_thumb', mediaId: uuid(mediaId, 'mediaId') }),
  contextFile: (fileId: string): StorageLocation => ({ kind: 'context_file', fileId: uuid(fileId, 'fileId') }),
  /** Tệp tạm của VIỆC ĐANG CHẠY: mã việc lấy từ ngữ cảnh – ngoài việc nền → TenantContextError. */
  jobTmp: (fileName: string): StorageLocation => {
    const jobId = getExecutionContext()?.jobId;
    if (jobId === undefined) throw new TenantContextError('TENANT_CONTEXT_MISSING');
    return { kind: 'job_tmp', jobId: uuid(jobId, 'jobId'), name: name(fileName, 'name') };
  },
};

function accountOrThrow(): string {
  const acc = currentAccountId();
  if (acc === null) throw new TenantContextError('TENANT_CONTEXT_MISSING');
  return acc.toLowerCase();
}

/** Tiền tố của tài khoản trong ngữ cảnh: `tenants/{acc}/`. */
export function accountPrefix(): string {
  return `tenants/${accountOrThrow()}/`;
}

/** Khóa S3 của vị trí, dựng từ ngữ cảnh. */
export function resolveKey(l: StorageLocation): string {
  const p = accountPrefix();
  switch (l.kind) {
    case 'media_original':
      return `${p}media/${uuid(l.mediaId, 'mediaId')}/original`;
    case 'media_normalized':
      return `${p}media/${uuid(l.mediaId, 'mediaId')}/normalized/${name(l.variant, 'variant')}`;
    case 'media_thumb':
      return `${p}media/${uuid(l.mediaId, 'mediaId')}/thumb`;
    case 'context_file':
      return `${p}context/${uuid(l.fileId, 'fileId')}`;
    case 'job_tmp':
      return `${p}tmp/${uuid(l.jobId, 'jobId')}/${name(l.name, 'name')}`;
  }
}

export function resolvePrefix(prefix: StoragePrefix): string {
  const p = accountPrefix();
  switch (prefix.kind) {
    case 'media':
      return prefix.mediaId === undefined ? `${p}media/` : `${p}media/${uuid(prefix.mediaId, 'mediaId')}/`;
    case 'context':
      return `${p}context/`;
    case 'account':
      return p;
  }
}

/**
 * Kiểm LẦN HAI trước mỗi lời gọi kho (không ngoại lệ): khóa phải bắt đầu `tenants/{currentAccountId()}/`.
 * Sai → StorageAccessDenied + nhật ký `storage.access_denied` chỉ có `kind` (không in khóa).
 */
export function assertKeyInScope(key: string, kind: string): void {
  if (!key.startsWith(accountPrefix()) || key.includes('..')) {
    gatewayEvent('warn', 'storage.access_denied', { storage_kind: kind });
    throw new StorageAccessDenied();
  }
}

/** Đọc lại vị trí từ khóa (liệt kê) – chỉ trong tiền tố của tài khoản. */
export function locationFromKey(key: string): StorageLocation | null {
  const p = accountPrefix();
  if (!key.startsWith(p)) return null;
  const rest = key.slice(p.length).split('/');
  if (rest[0] === 'media' && rest[1] !== undefined && UUID.test(rest[1])) {
    if (rest[2] === 'original') return { kind: 'media_original', mediaId: rest[1] };
    if (rest[2] === 'thumb') return { kind: 'media_thumb', mediaId: rest[1] };
    if (rest[2] === 'normalized' && rest[3] !== undefined) {
      return { kind: 'media_normalized', mediaId: rest[1], variant: rest[3] };
    }
  }
  if (rest[0] === 'context' && rest[1] !== undefined) return { kind: 'context_file', fileId: rest[1] };
  if (rest[0] === 'tmp' && rest[1] !== undefined && rest[2] !== undefined) {
    return { kind: 'job_tmp', jobId: rest[1], name: rest[2] };
  }
  return null;
}
