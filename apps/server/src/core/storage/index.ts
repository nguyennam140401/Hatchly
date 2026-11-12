// Lối vào kho tệp (005, contracts/storage.md mục 1). Chỉ modules/media, modules/context, modules/account
// và tầng ghép (app/, dev/) được nhập (quy tắc ranh giới `storage-restricted`). KHÔNG xuất qua core/index.ts.
export {
  InvalidRequestError,
  loc,
  StorageAccessDenied,
  type StorageKind,
  type StorageLocation,
  type StoragePrefix,
} from './location';
export {
  ALLOWED_CONTENT_TYPES,
  OBJECT_STORAGE,
  type AllowedContentType,
  type ObjectInfo,
  type ObjectStorage,
  type PresignedUpload,
  type SignedUrl,
} from './storage';
export { StorageModule } from './storage.module';
