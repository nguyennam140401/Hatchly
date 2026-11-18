import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  accountPrefix,
  assertKeyInScope,
  StorageAccessDenied,
  locationFromKey,
  resolveKey,
  resolvePrefix,
  type StorageLocation,
  type StoragePrefix,
} from '../location';
import {
  checkCreateMultipart,
  checkPresign,
  checkPresignPart,
  checkSignedUrl,
  MultipartIncompleteError,
  partsComplete,
  TMP_TAG,
  type AllowedContentType,
  type MultipartHandle,
  type PartInfo,
  type ObjectInfo,
  type ObjectStorage,
  type PresignedUpload,
  type SignedUrl,
} from '../storage';

/* eslint-disable @typescript-eslint/require-await -- bản bộ nhớ đồng bộ, giữ chữ ký async của ObjectStorage */
// Kho tệp TRONG BỘ NHỚ (005, contracts/storage.md mục 3) – chỉ kiểm thử. Đường dẫn tải lên `memory://…`
// ký HMAC + hạn; `simulateBrowserUpload` "dùng" đường dẫn như trình duyệt và kiểm ĐÚNG các điều kiện của
// POST policy (khóa chính xác, Content-Type chính xác, 1 ≤ kích thước ≤ maxBytes, còn hạn).

interface Obj {
  body: Buffer;
  contentType: string;
  createdAt: Date;
  sha256: string;
  tags: Record<string, string>;
}

interface MultipartSession {
  key: string;
  contentType: string;
  bytes: number;
  partSizeBytes: number;
  parts: Map<number, Buffer>;
  completed: boolean;
}

const DAY_MS = 86_400_000;

async function toBuffer(body: Readable | Buffer): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  const chunks: Buffer[] = [];
  for await (const c of body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as string));
  return Buffer.concat(chunks);
}

export class UploadRejected extends Error {
  constructor(readonly reason: 'signature' | 'expired' | 'content_type' | 'size') {
    super(`Tải lên bị từ chối (${reason})`);
    this.name = 'UploadRejected';
  }
}

export class MemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, Obj>();
  private readonly multiparts = new Map<string, MultipartSession>();
  private readonly secret = randomBytes(32);

  constructor(private readonly now: () => Date = () => new Date()) {}

  private sign(parts: string[]): string {
    return createHmac('sha256', this.secret).update(parts.join('|')).digest('base64url');
  }

  private verify(parts: string[], sig: string): boolean {
    const expected = Buffer.from(this.sign(parts));
    const got = Buffer.from(sig);
    return expected.length === got.length && timingSafeEqual(expected, got);
  }

  private key(l: StorageLocation): string {
    const key = resolveKey(l);
    assertKeyInScope(key, l.kind);
    return key;
  }

  presignUpload(
    l: StorageLocation,
    opts: { contentType: AllowedContentType; maxBytes: number; ttlSec?: number },
  ): Promise<PresignedUpload> {
    try {
      const ttl = checkPresign(l, opts);
      const key = this.key(l);
      const expiresAt = new Date(this.now().getTime() + ttl * 1000);
      const fields = {
        key,
        'Content-Type': opts.contentType,
        'x-max-bytes': String(opts.maxBytes),
        'x-expires': String(expiresAt.getTime()),
      };
      const signature = this.sign([
        fields.key,
        fields['Content-Type'],
        fields['x-max-bytes'],
        fields['x-expires'],
      ]);
      return Promise.resolve({
        url: 'memory://upload',
        fields: { ...fields, 'x-signature': signature },
        expiresAt,
        maxBytes: opts.maxBytes,
        contentType: opts.contentType,
      });
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** "Trình duyệt" dùng đường dẫn ký sẵn (bộ hợp đồng – FR-053). Không cần ngữ cảnh tài khoản. */
  simulateBrowserUpload(
    upload: { fields: Record<string, string> },
    bytes: Buffer,
    contentType: string,
  ): Promise<void> {
    const f = upload.fields;
    const parts = [
      f.key ?? '',
      f['Content-Type'] ?? '',
      f['x-max-bytes'] ?? '',
      f['x-expires'] ?? '',
    ];
    if (!this.verify(parts, f['x-signature'] ?? ''))
      return Promise.reject(new UploadRejected('signature'));
    if (this.now().getTime() > Number(f['x-expires']))
      return Promise.reject(new UploadRejected('expired'));
    if (contentType !== f['Content-Type'])
      return Promise.reject(new UploadRejected('content_type'));
    if (bytes.length < 1 || bytes.length > Number(f['x-max-bytes'])) {
      return Promise.reject(new UploadRejected('size'));
    }
    const key = f.key;
    if (key === undefined) return Promise.reject(new UploadRejected('signature'));
    this.objects.set(key, {
      body: Buffer.from(bytes),
      contentType,
      createdAt: this.now(),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      tags: {},
    });
    return Promise.resolve();
  }

  async stat(l: StorageLocation, opts?: { hash?: boolean }): Promise<ObjectInfo> {
    const o = this.objects.get(this.key(l));
    if (o === undefined) return { exists: false };
    return {
      exists: true,
      bytes: o.body.length,
      contentType: o.contentType,
      lastModified: o.createdAt,
      ...(opts?.hash === true ? { sha256: o.sha256 } : {}),
    };
  }

  async read(l: StorageLocation): Promise<Readable> {
    const o = this.objects.get(this.key(l));
    if (o === undefined) throw new Error('NoSuchKey');
    return Readable.from([o.body]);
  }

  async write(
    l: StorageLocation,
    body: Readable | Buffer,
    opts: { contentType: string },
  ): Promise<{ bytes: number; sha256: string }> {
    const key = this.key(l);
    const buf = await toBuffer(body);
    const sha256 = createHash('sha256').update(buf).digest('hex');
    this.objects.set(key, {
      body: buf,
      contentType: opts.contentType,
      createdAt: this.now(),
      sha256,
      tags: l.kind === 'job_tmp' ? { [TMP_TAG.key]: TMP_TAG.value } : {},
    });
    return { bytes: buf.length, sha256 };
  }

  async copy(from: StorageLocation, to: StorageLocation): Promise<void> {
    const src = this.objects.get(this.key(from));
    const dst = this.key(to);
    if (src === undefined) throw new Error('NoSuchKey');
    this.objects.set(dst, {
      ...src,
      body: Buffer.from(src.body),
      createdAt: this.now(),
      tags: to.kind === 'job_tmp' ? { [TMP_TAG.key]: TMP_TAG.value } : {},
    });
  }

  async delete(l: StorageLocation): Promise<void> {
    this.objects.delete(this.key(l));
  }

  async list(
    prefix: StoragePrefix,
    opts?: { after?: string; limit?: number },
  ): Promise<{ items: { loc: StorageLocation; bytes: number }[]; next?: string }> {
    const p = resolvePrefix(prefix);
    const limit = Math.min(Math.max(opts?.limit ?? 1000, 1), 1000);
    const keys = [...this.objects.keys()]
      .filter((k) => k.startsWith(p) && (opts?.after === undefined || k > opts.after))
      .sort();
    const page = keys.slice(0, limit);
    const items = page.flatMap((k) => {
      const l = locationFromKey(k);
      return l === null ? [] : [{ loc: l, bytes: this.objects.get(k)?.body.length ?? 0 }];
    });
    const last = page.at(-1);
    return { items, ...(keys.length > limit && last !== undefined ? { next: last } : {}) };
  }

  async signedUrl(
    l: StorageLocation,
    purpose: 'preview' | 'public',
    ttlSec?: number,
  ): Promise<SignedUrl> {
    const ttl = checkSignedUrl(l, purpose, ttlSec);
    const key = this.key(l);
    const expiresAt = new Date(this.now().getTime() + ttl * 1000);
    const exp = String(expiresAt.getTime());
    const sig = this.sign(['get', key, exp]);
    const url = `memory://get/${encodeURIComponent(key)}?exp=${exp}&sig=${sig}`;
    return { url, expiresAt, purpose };
  }

  /** "Tải về" bằng đường dẫn ký sẵn: sai chữ ký / hết hạn / không có → null. */
  fetchSigned(url: string): Buffer | null {
    const u = new URL(url);
    const key = decodeURIComponent(u.pathname.replace(/^\//, ''));
    const exp = u.searchParams.get('exp') ?? '';
    if (!this.verify(['get', key, exp], u.searchParams.get('sig') ?? '')) return null;
    if (this.now().getTime() > Number(exp)) return null;
    return this.objects.get(key)?.body ?? null;
  }

  // ---------- Tải nhiều phần (014, contracts/storage-multipart.md) ----------

  /** Phiên của đúng khóa trong ngữ cảnh; khóa khác (tài khoản khác) ⇒ StorageAccessDenied. */
  private session(l: StorageLocation, h: MultipartHandle): MultipartSession | undefined {
    const key = this.key(l);
    const s = this.multiparts.get(h.uploadId);
    if (s === undefined) return undefined;
    if (s.key !== key) throw new StorageAccessDenied();
    return s;
  }

  async createMultipart(
    l: StorageLocation,
    opts: { contentType: AllowedContentType; bytes: number; partSizeBytes: number },
  ): Promise<MultipartHandle> {
    checkCreateMultipart(l, opts);
    const key = this.key(l);
    const uploadId = randomBytes(16).toString('hex');
    this.multiparts.set(uploadId, {
      key,
      contentType: opts.contentType,
      bytes: opts.bytes,
      partSizeBytes: opts.partSizeBytes,
      parts: new Map(),
      completed: false,
    });
    return { uploadId };
  }

  async presignPart(
    l: StorageLocation,
    h: MultipartHandle,
    part: { partNumber: number; contentLength: number; ttlSec?: number },
  ): Promise<{ url: string; expiresAt: Date; headers: Record<string, string> }> {
    const ttl = checkPresignPart(l, part);
    const s = this.session(l, h);
    if (s === undefined || s.completed) throw new Error('NoSuchUpload');
    const expiresAt = new Date(this.now().getTime() + ttl * 1000);
    const exp = String(expiresAt.getTime());
    const sig = this.sign([
      'part',
      h.uploadId,
      String(part.partNumber),
      String(part.contentLength),
      exp,
    ]);
    const url = `memory://part/${h.uploadId}/${part.partNumber}?len=${part.contentLength}&exp=${exp}&sig=${sig}`;
    return { url, expiresAt, headers: {} };
  }

  /** "Trình duyệt" PUT một phần bằng URL ký sẵn: kiểm chữ ký, hạn và `Content-Length` đã ký. */
  simulateBrowserUploadPart(url: string, bytes: Buffer): Promise<{ etag: string }> {
    const u = new URL(url);
    const [uploadId = '', partNo = ''] = u.pathname.replace(/^\//, '').split('/');
    const len = u.searchParams.get('len') ?? '';
    const exp = u.searchParams.get('exp') ?? '';
    if (!this.verify(['part', uploadId, partNo, len, exp], u.searchParams.get('sig') ?? '')) {
      return Promise.reject(new UploadRejected('signature'));
    }
    if (this.now().getTime() > Number(exp)) return Promise.reject(new UploadRejected('expired'));
    if (bytes.length !== Number(len)) return Promise.reject(new UploadRejected('size'));
    const s = this.multiparts.get(uploadId);
    if (s === undefined || s.completed) return Promise.reject(new UploadRejected('signature'));
    s.parts.set(Number(partNo), Buffer.from(bytes));
    return Promise.resolve({ etag: createHash('md5').update(bytes).digest('hex') });
  }

  async listParts(l: StorageLocation, h: MultipartHandle): Promise<PartInfo[]> {
    const s = this.session(l, h);
    if (s === undefined || s.completed) return [];
    return [...s.parts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([partNumber, body]) => ({
        partNumber,
        bytes: body.length,
        etag: createHash('md5').update(body).digest('hex'),
      }));
  }

  async completeMultipart(
    l: StorageLocation,
    h: MultipartHandle,
    expect: { bytes: number },
  ): Promise<{ bytes: number }> {
    const s = this.session(l, h);
    if (s === undefined) throw new MultipartIncompleteError();
    if (s.completed) return { bytes: s.bytes };
    const parts = await this.listParts(l, h);
    if (expect.bytes !== s.bytes || !partsComplete(parts, s.partSizeBytes, s.bytes)) {
      throw new MultipartIncompleteError();
    }
    const body = Buffer.concat(
      [...s.parts.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b),
    );
    this.objects.set(s.key, {
      body,
      contentType: s.contentType,
      createdAt: this.now(),
      sha256: createHash('sha256').update(body).digest('hex'),
      tags: {},
    });
    s.completed = true;
    s.parts.clear();
    return { bytes: body.length };
  }

  async abortMultipart(l: StorageLocation, h: MultipartHandle): Promise<void> {
    const s = this.session(l, h);
    if (s !== undefined && !s.completed) this.multiparts.delete(h.uploadId);
  }

  /** Số phiên nhiều phần còn mở của tài khoản trong ngữ cảnh (kiểm thử `deleteAllForCurrentAccount`). */
  openMultipartCount(): number {
    const p = accountPrefix();
    return [...this.multiparts.values()].filter((s) => s.key.startsWith(p) && !s.completed).length;
  }

  async deleteAllForCurrentAccount(): Promise<{ deleted: number }> {
    const p = accountPrefix();
    for (const [id, s] of [...this.multiparts]) {
      if (s.key.startsWith(p)) this.multiparts.delete(id);
    }
    let deleted = 0;
    for (const k of [...this.objects.keys()]) {
      if (k.startsWith(p)) {
        this.objects.delete(k);
        deleted++;
      }
    }
    return { deleted };
  }

  /** Luật vòng đời giả: xóa đối tượng nhãn `lifecycle=tmp` cũ hơn 1 ngày (đồng hồ tiêm được). */
  sweepExpired(): number {
    let n = 0;
    for (const [k, o] of this.objects) {
      if (
        o.tags[TMP_TAG.key] === TMP_TAG.value &&
        this.now().getTime() - o.createdAt.getTime() > DAY_MS
      ) {
        this.objects.delete(k);
        n++;
      }
    }
    return n;
  }

  /** Nhãn của đối tượng (kiểm thử). */
  tagsOf(l: StorageLocation): Record<string, string> | undefined {
    return this.objects.get(this.key(l))?.tags;
  }

  /** Khóa thật của vị trí (kiểm thử khẳng định bố cục). */
  keyOf(l: StorageLocation): string {
    return this.key(l);
  }
}
