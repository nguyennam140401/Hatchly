import { afterAll, describe, expect } from 'vitest';
import { S3ObjectStorage } from '../../../src/core/storage/s3/s3-storage';
import { describeObjectStorageContract } from './object-storage.contract';

// 005 T082: kho tệp S3 THẬT → MinIO (pnpm test:infra, cần `docker compose up -d minio minio-init`).
// "Trình duyệt" = fetch POST multipart tới đường dẫn ký sẵn.

const storage = new S3ObjectStorage({
  endpoint: process.env.TEST_S3_ENDPOINT ?? 'http://localhost:9000',
  publicEndpoint: process.env.TEST_S3_ENDPOINT ?? 'http://localhost:9000',
  region: 'us-east-1',
  bucket: process.env.TEST_S3_BUCKET ?? 'app-dev',
  accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID ?? 'minio_dev_only',
  secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY ?? 'minio_secret_dev_only',
  forcePathStyle: true,
});

afterAll(() => {
  storage.close();
});

describe('Kho tệp – s3 → MinIO', () => {
  describeObjectStorageContract(() => ({
    storage,
    now: () => Date.now(),
    async upload(p, bytes, contentType, fields) {
      const form = new FormData();
      const all = { ...p.fields, ...fields };
      for (const [k, v] of Object.entries(all)) form.append(k, v);
      form.append('file', new Blob([bytes], { type: contentType }));
      const res = await fetch(p.url, { method: 'POST', body: form });
      return res.ok;
    },
    async download(url) {
      const res = await fetch(url);
      return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    },
    expire: (seconds) => new Promise((r) => setTimeout(r, seconds * 1000)),
    async checkTmpLifecycle(l) {
      expect(await storage.tagsOf(l)).toEqual({ lifecycle: 'tmp' });
      const rules = JSON.stringify(await storage.lifecycleRules());
      expect(rules).toContain('lifecycle');
      expect(rules).toContain('tmp');
      expect(rules).toMatch(/"Days":1/);
    },
  }));
});
