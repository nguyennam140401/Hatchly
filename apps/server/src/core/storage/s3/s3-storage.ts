import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
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
  checkPresign,
  checkSignedUrl,
  TMP_TAG,
  type AllowedContentType,
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
      const got = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
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
    const got = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: this.key(l) }));
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

  async signedUrl(l: StorageLocation, purpose: 'preview' | 'public', ttlSec?: number): Promise<SignedUrl> {
    const ttl = checkSignedUrl(l, purpose, ttlSec);
    const url = await getSignedUrl(
      this.publicClient,
      new GetObjectCommand({ Bucket: this.cfg.bucket, Key: this.key(l) }),
      { expiresIn: ttl },
    );
    return { url, expiresAt: new Date(Date.now() + ttl * 1000), purpose };
  }

  async deleteAllForCurrentAccount(): Promise<{ deleted: number }> {
    const p = accountPrefix();
    let deleted = 0;
    let token: string | undefined;
    do {
      const r = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.cfg.bucket, Prefix: p, MaxKeys: 1000, ContinuationToken: token }),
      );
      const keys = (r.Contents ?? []).flatMap((c) => (c.Key === undefined ? [] : [c.Key]));
      if (keys.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({ Bucket: this.cfg.bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }),
        );
        deleted += keys.length;
      }
      token = r.IsTruncated === true ? r.NextContinuationToken : undefined;
    } while (token !== undefined);
    return { deleted };
  }

  /** Nhãn của đối tượng (kiểm thử luật vòng đời). */
  async tagsOf(l: StorageLocation): Promise<Record<string, string>> {
    const r = await this.client.send(new GetObjectTaggingCommand({ Bucket: this.cfg.bucket, Key: this.key(l) }));
    return Object.fromEntries((r.TagSet ?? []).map((t) => [t.Key ?? '', t.Value ?? '']));
  }

  /** Luật vòng đời của bucket (kiểm thử: phải có luật lọc theo nhãn `lifecycle=tmp`). */
  async lifecycleRules(): Promise<unknown> {
    const { GetBucketLifecycleConfigurationCommand } = await import('@aws-sdk/client-s3');
    return this.client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: this.cfg.bucket }));
  }

  close(): void {
    this.client.destroy();
    this.publicClient.destroy();
  }
}
