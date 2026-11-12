import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.schema';
import { MemoryObjectStorage } from './memory/memory-storage';
import { OBJECT_STORAGE, type ObjectStorage } from './storage';

// Kho tệp ở API và Worker (005, T087): `STORAGE_DRIVER=s3` → S3ObjectStorage (MinIO ở dev, S3 trong
// nước ở môi trường thật); `memory` → kho trong bộ nhớ (chỉ kiểm thử – bị từ chối ở staging/production).
// Global ở tầng ghép; chỉ media/context/account được nhập core/storage (quy tắc `storage-restricted`).

export async function createObjectStorage(config: AppConfig): Promise<ObjectStorage | null> {
  if (config.STORAGE_DRIVER === 'memory') return new MemoryObjectStorage();
  if (config.STORAGE_DRIVER !== 's3') return null;
  const { S3ObjectStorage } = await import('./s3/s3-storage.js');
  return new S3ObjectStorage({
    endpoint: config.S3_ENDPOINT ?? '',
    publicEndpoint: config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT ?? '',
    region: config.S3_REGION ?? '',
    bucket: config.S3_BUCKET ?? '',
    accessKeyId: config.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: config.S3_SECRET_ACCESS_KEY ?? '',
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
  });
}

@Global()
@Module({
  providers: [{ provide: OBJECT_STORAGE, inject: [APP_CONFIG], useFactory: createObjectStorage }],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
