// Bọc `@aws-sdk/client-s3` cho bucket trạng thái / bản ghi (contracts/infra-cli.md). Điểm cuối và vùng đọc từ
// `infra/envs/<env>.backend.hcl`; khóa truy cập lấy từ biến môi trường của tiến trình (do credentials.mjs nạp).
// Không bao giờ đưa khóa truy cập vào thông báo lỗi.
import {
  DeleteObjectCommand,
  GetBucketEncryptionCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { loadBackendConfig } from './backend-config.mjs';

/** Mã lỗi HTTP của một ngoại lệ AWS SDK (không kèm thông điệp có thể chứa khóa). */
export function httpStatus(error) {
  return error?.$metadata?.httpStatusCode;
}

/**
 * @param {string} env
 * @param {{ client?: S3Client, backend?: ReturnType<typeof loadBackendConfig> }} [deps] tiêm vào khi kiểm thử
 */
export function createS3(env, deps = {}) {
  // `deps.credentials` = { accessKeyId, secretAccessKey } để thử bằng khóa của môi trường KHÁC (SC-005).
  const backend = deps.backend ?? loadBackendConfig(env);
  const bucket = backend.bucket;
  const client =
    deps.client ??
    new S3Client({
      region: backend.region,
      endpoint: backend.endpoints?.s3,
      forcePathStyle: backend.use_path_style === true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      ...(deps.credentials ? { credentials: deps.credentials } : {}),
    });

  async function bodyText(response) {
    return await response.Body.transformToString();
  }

  return {
    bucket,
    client,
    async getJson(key) {
      try {
        const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return JSON.parse(await bodyText(r));
      } catch (error) {
        if (httpStatus(error) === 404 || error?.name === 'NoSuchKey') return null;
        throw error;
      }
    },
    /** `onlyIfAbsent: true` → `IfNoneMatch: '*'`: ghi thất bại nếu đối tượng đã có (bản ghi chỉ-thêm, khóa). */
    async putJson(key, value, { onlyIfAbsent = false } = {}) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: JSON.stringify(value, null, 2),
          ContentType: 'application/json',
          ...(onlyIfAbsent ? { IfNoneMatch: '*' } : {}),
        }),
      );
    },
    async deleteObject(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    /** Liệt kê khóa theo tiền tố (mọi trang), kèm `LastModified`. */
    async list(prefix) {
      const out = [];
      let token;
      do {
        const r = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
        );
        for (const o of r.Contents ?? [])
          out.push({ key: o.Key, lastModified: o.LastModified, size: o.Size });
        token = r.IsTruncated === true ? r.NextContinuationToken : undefined;
      } while (token !== undefined);
      return out;
    },
    /** Ghi một đối tượng thô (dùng cho phép thử của `smoke`). */
    async putBytes(key, bytes) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes }));
    },
    /** Liệt kê mọi phiên bản của khóa/tiền tố, kèm dấu xóa. */
    async listVersions(prefix) {
      const r = await client.send(
        new ListObjectVersionsCommand({ Bucket: bucket, Prefix: prefix }),
      );
      return {
        versions: (r.Versions ?? []).map((v) => ({
          key: v.Key,
          versionId: v.VersionId,
          isLatest: v.IsLatest,
        })),
        deleteMarkers: (r.DeleteMarkers ?? []).map((v) => ({ key: v.Key, versionId: v.VersionId })),
      };
    },
    async head(key) {
      try {
        return await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      } catch (error) {
        if (httpStatus(error) === 404) return null;
        throw error;
      }
    },
    async getBucketVersioning() {
      const r = await client.send(new GetBucketVersioningCommand({ Bucket: bucket }));
      return r.Status ?? 'Disabled';
    },
    /** `null` khi chưa cấu hình mã hóa (hoặc nhà cung cấp không trả). */
    async getBucketEncryption() {
      try {
        const r = await client.send(new GetBucketEncryptionCommand({ Bucket: bucket }));
        return r.ServerSideEncryptionConfiguration ?? null;
      } catch (error) {
        if (
          httpStatus(error) === 404 ||
          error?.name === 'ServerSideEncryptionConfigurationNotFoundError'
        )
          return null;
        throw error;
      }
    },
    async getBucketLifecycle() {
      try {
        const r = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }));
        return r.Rules ?? [];
      } catch (error) {
        if (httpStatus(error) === 404 || error?.name === 'NoSuchLifecycleConfiguration') return [];
        throw error;
      }
    },
  };
}

/**
 * GET KHÔNG xác thực một đối tượng (kiểm bucket riêng tư): trả mã HTTP. Dùng `fetch` thẳng, không có khóa nào.
 * `403`/`404` = đạt (không đọc được); `200` = lộ công khai.
 */
export async function tryAnonymousGet(
  endpoint,
  bucket,
  key,
  { pathStyle = true, fetchImpl = fetch } = {},
) {
  const base = endpoint.replace(/\/$/, '');
  const url = pathStyle
    ? `${base}/${bucket}/${key}`
    : `${new URL(base).protocol}//${bucket}.${new URL(base).host}/${key}`;
  const response = await fetchImpl(url, { method: 'GET', redirect: 'manual' });
  return response.status;
}
