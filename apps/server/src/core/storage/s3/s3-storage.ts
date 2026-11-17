import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  ListMultipartUploadsCommand,
  ListPartsCommand,
  UploadPartCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  accountPrefix,
  assertKeyInScope,
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
  MAX_PART_NUMBER,
  MultipartIncompleteError,
  TMP_TAG,
  type AllowedContentType,
  type MultipartHandle,
  type PartInfo,
  type ObjectInfo,
  type ObjectStorage,
  type PresignedUpload,
  type SignedUrl,
} from '../storage';

// Kho tệp S3 THẬT (005, research R13) – `@aws-sdk/*` CHỈ ở thư mục này (quy tắc ranh giới), kiểu SDK không
// ra ngoài. Tải lên: presigned POST (khóa chính xác, Content-Type chính xác, content-length-range, hạn
// ≤ 900 s). Xem/công khai: presigned GET ký bằng địa chỉ công khai. Môi trường thật: S3 của nhà cung cấp
// trong nước; dev: MinIO.

export interface S3StorageConfig {
  endpoint: string;
  publicEndpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

const SHA_META = 'sha256';

async function toBuffer(body: Readable | Buffer | Uint8Array): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  const chunks: Buffer[] = [];
  for await (const c of body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as string));
  return Buffer.concat(chunks);
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404;
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  /** Ký đường dẫn bằng địa chỉ trình duyệt/nền tảng truy cập được. */
  private readonly publicClient: S3Client;

  constructor(private readonly cfg: S3StorageConfig) {
    const base = {
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    };
    this.client = new S3Client({ ...base, endpoint: cfg.endpoint });
    this.publicClient = new S3Client({ ...base, endpoint: cfg.publicEndpoint });
  }

  private key(l: StorageLocation): string {
    const key = resolveKey(l);
    assertKeyInScope(key, l.kind);
    return key;
  }

  async presignUpload(
    l: StorageLocation,
    opts: { contentType: AllowedContentType; maxBytes: number; ttlSec?: number },
  ): Promise<PresignedUpload> {
    const ttl = checkPresign(l, opts);
    const key = this.key(l);
    const { url, fields } = await createPresignedPost(this.publicClient, {
      Bucket: this.cfg.bucket,
      Key: key,
      Fields: { 'Content-Type': opts.contentType },
      Conditions: [
        ['eq', '$key', key],
        ['eq', '$Content-Type', opts.contentType],
        ['content-length-range', 1, opts.maxBytes],
      ],
      Expires: ttl,
    });
    return {
      url,
      fields,
      expiresAt: new Date(Date.now() + ttl * 1000),
      maxBytes: opts.maxBytes,
      contentType: opts.contentType,
    };
  }

  async stat(l: StorageLocation, opts?: { hash?: boolean }): Promise<ObjectInfo> {
    const key = this.key(l);
    let head;
    try {
      head = await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    } catch (err) {
      if (isNotFound(err)) return { exists: false };
      throw err;
    }
    const info: ObjectInfo = {
      exists: true,
      bytes: head.ContentLength ?? 0,
      contentType: head.ContentType ?? 'application/octet-stream',
      lastModified: head.LastModified ?? new Date(0),
    };
    if (opts?.hash !== true) return info;
    let sha256 = head.Metadata?.[SHA_META];
    if (sha256 === undefined) {
      // Tính bằng luồng phía máy chủ (không tin dấu của trình duyệt), lưu lại bằng copy-in-place.
      const got = await this.client.send(
        new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }),
      );
      const hash = createHash('sha256');
      for await (const chunk of got.Body as Readable) hash.update(chunk as Buffer);
      sha256 = hash.digest('hex');
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.cfg.bucket,
          Key: key,
          CopySource: `${this.cfg.bucket}/${encodeURIComponent(key)}`,
          MetadataDirective: 'REPLACE',
          ContentType: info.contentType,
          Metadata: { ...(head.Metadata ?? {}), [SHA_META]: sha256 },
        }),
      );
    }
    return { ...info, sha256 };
  }

  async read(l: StorageLocation): Promise<Readable> {
    const got = await this.client.send(
      new GetObjectCommand({ Bucket: this.cfg.bucket, Key: this.key(l) }),
    );
    return got.Body as Readable;
  }

  async write(
    l: StorageLocation,
    body: Readable | Buffer,
    opts: { contentType: string },
  ): Promise<{ bytes: number; sha256: string }> {
    const key = this.key(l);
    const buf = await toBuffer(body);
    const sha256 = createHash('sha256').update(buf).digest('hex');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: buf,
        ContentType: opts.contentType,
        Metadata: { [SHA_META]: sha256 },
        // Tệp tạm: nhãn để luật vòng đời của bucket xóa sau 1 ngày.
        ...(l.kind === 'job_tmp' ? { Tagging: `${TMP_TAG.key}=${TMP_TAG.value}` } : {}),
      }),
    );
    return { bytes: buf.length, sha256 };
  }

  async copy(from: StorageLocation, to: StorageLocation): Promise<void> {
    const src = this.key(from);
    const dst = this.key(to);
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.cfg.bucket,
        Key: dst,
        CopySource: `${this.cfg.bucket}/${encodeURIComponent(src)}`,
        ...(to.kind === 'job_tmp'
          ? { TaggingDirective: 'REPLACE', Tagging: `${TMP_TAG.key}=${TMP_TAG.value}` }
          : {}),
      }),
    );
  }

  async delete(l: StorageLocation): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: this.key(l) }));
  }

  async list(
    prefix: StoragePrefix,
    opts?: { after?: string; limit?: number },
  ): Promise<{ items: { loc: StorageLocation; bytes: number }[]; next?: string }> {
    const p = resolvePrefix(prefix);
    if (opts?.after !== undefined) assertKeyInScope(opts.after, 'list');
    const r = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.cfg.bucket,
        Prefix: p,
        MaxKeys: Math.min(Math.max(opts?.limit ?? 1000, 1), 1000),
        ...(opts?.after !== undefined ? { StartAfter: opts.after } : {}),
      }),
    );
    const contents = r.Contents ?? [];
    const items = contents.flatMap((c) => {
      const l = c.Key === undefined ? null : locationFromKey(c.Key);
      return l === null ? [] : [{ loc: l, bytes: c.Size ?? 0 }];
    });
    const last = contents[contents.length - 1]?.Key;
    return { items, ...(r.IsTruncated === true && last !== undefined ? { next: last } : {}) };
  }

  async signedUrl(
    l: StorageLocation,
    purpose: 'preview' | 'public',
    ttlSec?: number,
  ): Promise<SignedUrl> {
    const ttl = checkSignedUrl(l, purpose, ttlSec);
    const url = await getSignedUrl(
      this.publicClient,
      new GetObjectCommand({ Bucket: this.cfg.bucket, Key: this.key(l) }),
      { expiresIn: ttl },
    );
    return { url, expiresAt: new Date(Date.now() + ttl * 1000), purpose };
  }

  // ---------- Tải nhiều phần (014, contracts/storage-multipart.md) ----------

  async createMultipart(
    l: StorageLocation,
    opts: { contentType: AllowedContentType; bytes: number; partSizeBytes: number },
  ): Promise<MultipartHandle> {
    checkCreateMultipart(l, opts);
    const r = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.cfg.bucket,
        Key: this.key(l),
        ContentType: opts.contentType,
      }),
    );
    if (r.UploadId === undefined) throw new Error('CreateMultipartUpload không trả UploadId');
    return { uploadId: r.UploadId };
  }

  async presignPart(
    l: StorageLocation,
    h: MultipartHandle,
    part: { partNumber: number; contentLength: number; ttlSec?: number },
  ): Promise<{ url: string; expiresAt: Date; headers: Record<string, string> }> {
    const ttl = checkPresignPart(l, part);
    const url = await getSignedUrl(
      this.publicClient,
      new UploadPartCommand({
        Bucket: this.cfg.bucket,
        Key: this.key(l),
        UploadId: h.uploadId,
        PartNumber: part.partNumber,
        ContentLength: part.contentLength,
      }),
      // Ký `content-length` vào URL: phần sai cỡ bị kho từ chối (R1; không ký được ⇒ bác ở `complete` theo tổng).
      { expiresIn: ttl, signableHeaders: new Set(['content-length']) },
    );
    return { url, expiresAt: new Date(Date.now() + ttl * 1000), headers: {} };
  }

  async listParts(l: StorageLocation, h: MultipartHandle): Promise<PartInfo[]> {
    const key = this.key(l);
    const out: PartInfo[] = [];
    let marker: string | undefined;
    try {
      do {
        const r = await this.client.send(
          new ListPartsCommand({
            Bucket: this.cfg.bucket,
            Key: key,
            UploadId: h.uploadId,
            PartNumberMarker: marker,
            MaxParts: 1000,
          }),
        );
        for (const p of r.Parts ?? []) {
          if (p.PartNumber !== undefined && p.ETag !== undefined) {
            out.push({ partNumber: p.PartNumber, bytes: p.Size ?? 0, etag: p.ETag });
          }
        }
        marker = r.IsTruncated === true ? r.NextPartNumberMarker : undefined;
      } while (marker !== undefined && out.length <= MAX_PART_NUMBER);
    } catch (err) {
      if ((err as { name?: string }).name === 'NoSuchUpload' || isNotFound(err)) return [];
      throw err;
    }
    return out.sort((a, b) => a.partNumber - b.partNumber);
  }

  async completeMultipart(
    l: StorageLocation,
    h: MultipartHandle,
    expect: { bytes: number },
  ): Promise<{ bytes: number }> {
    const key = this.key(l);
    const parts = await this.listParts(l, h);
    if (parts.length === 0) {
      // Đã ghép trước đó (gọi lặp) hoặc phiên không còn: kiểm đối tượng thật.
      const info = await this.stat(l);
      if (info.exists && info.bytes === expect.bytes) return { bytes: info.bytes };
      throw new MultipartIncompleteError();
    }
    // Không biết partSize ở đây ⇒ suy từ phần 1: phần liên tục 1..N, mọi phần trừ phần cuối cùng cỡ phần 1, tổng đúng.
    const first = parts[0];
    const n = parts.length;
    const partSize = first?.bytes ?? 0;
    let sum = 0;
    for (const [i, p] of parts.entries()) {
      if (p.partNumber !== i + 1) throw new MultipartIncompleteError();
      if (i < n - 1 && p.bytes !== partSize) throw new MultipartIncompleteError();
      sum += p.bytes;
    }
    if (sum !== expect.bytes) throw new MultipartIncompleteError();
    try {
      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.cfg.bucket,
          Key: key,
          UploadId: h.uploadId,
          MultipartUpload: {
            Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
          },
        }),
      );
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === 'InvalidPart' || name === 'InvalidPartOrder' || name === 'EntityTooSmall') {
        throw new MultipartIncompleteError();
      }
      throw err;
    }
    return { bytes: sum };
  }

  async abortMultipart(l: StorageLocation, h: MultipartHandle): Promise<void> {
    try {
      await this.client.send(
        new AbortMultipartUploadCommand({
          Bucket: this.cfg.bucket,
          Key: this.key(l),
          UploadId: h.uploadId,
        }),
      );
    } catch (err) {
      if ((err as { name?: string }).name === 'NoSuchUpload' || isNotFound(err)) return;
      throw err;
    }
  }

  /** Hủy mọi phiên nhiều phần còn mở dưới tiền tố của tài khoản (không để rác tính phí). */
  private async abortAllMultipartForCurrentAccount(): Promise<void> {
    const prefix = accountPrefix();
    let keyMarker: string | undefined;
    let uploadIdMarker: string | undefined;
    do {
      const r = await this.client.send(
        // Không truyền `Prefix`: MinIO chỉ khớp `Prefix` khi bằng ĐÚNG khóa đối tượng (S3 thật lọc đúng). Số phiên
        // dở rất ít (luật vòng đời hủy sau 2 ngày) và hàm chỉ chạy khi xóa tài khoản ⇒ lọc phía client an toàn.
        new ListMultipartUploadsCommand({
          Bucket: this.cfg.bucket,
          KeyMarker: keyMarker,
          UploadIdMarker: uploadIdMarker,
        }),
      );
      for (const u of r.Uploads ?? []) {
        if (u.Key === undefined || u.UploadId === undefined || !u.Key.startsWith(prefix)) continue;
        assertKeyInScope(u.Key, 'multipart');
        await this.client.send(
          new AbortMultipartUploadCommand({
            Bucket: this.cfg.bucket,
            Key: u.Key,
            UploadId: u.UploadId,
          }),
        );
      }
      keyMarker = r.IsTruncated === true ? r.NextKeyMarker : undefined;
      uploadIdMarker = r.IsTruncated === true ? r.NextUploadIdMarker : undefined;
    } while (keyMarker !== undefined);
  }

  async deleteAllForCurrentAccount(): Promise<{ deleted: number }> {
    const p = accountPrefix();
    await this.abortAllMultipartForCurrentAccount();
    let deleted = 0;
    let token: string | undefined;
    do {
      const r = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.cfg.bucket,
          Prefix: p,
          MaxKeys: 1000,
          ContinuationToken: token,
        }),
      );
      const keys = (r.Contents ?? []).flatMap((c) => (c.Key === undefined ? [] : [c.Key]));
      if (keys.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.cfg.bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        deleted += keys.length;
      }
      token = r.IsTruncated === true ? r.NextContinuationToken : undefined;
    } while (token !== undefined);
    return { deleted };
  }

  /** Nhãn của đối tượng (kiểm thử luật vòng đời). */
  async tagsOf(l: StorageLocation): Promise<Record<string, string>> {
    const r = await this.client.send(
      new GetObjectTaggingCommand({ Bucket: this.cfg.bucket, Key: this.key(l) }),
    );
    return Object.fromEntries((r.TagSet ?? []).map((t) => [t.Key ?? '', t.Value ?? '']));
  }

  /** Luật vòng đời của bucket (kiểm thử: phải có luật lọc theo nhãn `lifecycle=tmp`). */
  async lifecycleRules(): Promise<unknown> {
    const { GetBucketLifecycleConfigurationCommand } = await import('@aws-sdk/client-s3');
    return this.client.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: this.cfg.bucket }),
    );
  }

  close(): void {
    this.client.destroy();
    this.publicClient.destroy();
  }
}
