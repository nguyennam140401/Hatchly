import { afterAll, describe } from 'vitest';
import { S3ObjectStorage } from '../../../src/core/storage/s3/s3-storage';
import { describeMultipartContract } from './multipart.contract';

// 014 T017: tải nhiều phần – kho S3 THẬT → MinIO (pnpm test:infra, cần `docker compose up -d minio minio-init`).
// "Trình duyệt" = fetch PUT tới URL phần ký sẵn.

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

describe('Kho tệp tải nhiều phần – s3 → MinIO', () => {
  describeMultipartContract(() => ({
    storage,
    async uploadPart(url, bytes) {
      const res = await fetch(url, { method: 'PUT', body: new Uint8Array(bytes) });
      return res.ok;
    },
    expire: (seconds) => new Promise((r) => setTimeout(r, seconds * 1000)),
    runLargeScenario: true,
  }));
});
