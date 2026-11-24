// Ánh xạ biến cấu hình của ứng dụng → nguồn bàn giao (contracts/handoff-outputs.md mục 2). Dùng chung cho
// `pnpm infra secrets` (Secret nào chứa khóa nào) và kiểm thử `tooling/test/infra/handoff.spec.ts` (FR-024 "MUST khớp").

/** Biến KHÔNG bí mật: đặt trong ConfigMap / kê khai của H2. `source` ghi nguồn giá trị. */
export const NON_SECRET_VARS = Object.freeze({
  APP_ENV: 'environment',
  APP_VERSION: 'H2 đặt theo ảnh',
  API_PORT: '3000',
  WORKER_HEALTH_PORT: '3001',
  SHUTDOWN_TIMEOUT_MS: '30000',
  CORS_ORIGINS: 'urls.web',
  WEB_ORIGINS: 'urls.web',
  WEB_BASE_URL: 'urls.web',
  TRUST_PROXY_HOPS: '1',
  MAIL_TRANSPORT: 'smtp',
  MAIL_FROM: 'theo môi trường',
  STORAGE_DRIVER: 's3',
  S3_ENDPOINT: 'storage.endpoint',
  S3_PUBLIC_ENDPOINT: 'storage.public_endpoint',
  S3_REGION: 'storage.region',
  S3_BUCKET: 'storage.bucket',
  S3_FORCE_PATH_STYLE: 'storage.force_path_style',
  PLATFORM_GATEWAY_DRIVER: 'fake đến khi có bản thật (thử nghiệm)',
  AI_GATEWAY_DRIVER: 'fake đến khi có bản thật (thử nghiệm)',
  NOTIFICATIONS_DRIVER: 'fake đến khi có bản thật (thử nghiệm)',
  FAKE_STATE_STORE: 'sandbox khi còn driver fake (thử nghiệm)',
  STAGING_ALLOW_FAKES: 'true ở thử nghiệm khi còn driver fake; phát hành: không đặt (R15)',
  DATABASE_POOL_MAX: 'api: 10 · worker: 20',
  KMS_KEY_ID: 'kms.key_id',
});

/** Biến chỉ tồn tại ở script migration/bootstrap (không thuộc `AppConfigSchema`) hoặc "tương lai". */
export const NOT_IN_APP_SCHEMA = Object.freeze({
  KMS_KEY_ID: 'tương lai (platform_gateway thật)',
  DATABASE_ADMIN_URL: 'script bootstrap/migration',
  DATABASE_OWNER_URL: 'script migration',
  DB_ROLE_PASSWORD_OWNER: 'script bootstrap',
  DB_ROLE_PASSWORD_APP: 'script bootstrap',
  DB_ROLE_PASSWORD_SYSTEM: 'script bootstrap',
  DB_ROLE_PASSWORD_SUPPORT: 'script bootstrap',
});

/** Biến BÍ MẬT theo từng Secret (FR-014: mỗi ServiceAccount chỉ đọc Secret của mình). */
export const SECRET_VARS = Object.freeze({
  'api-secrets': Object.freeze([
    'DATABASE_APP_URL',
    'DATABASE_SUPPORT_URL',
    'AUTH_THROTTLE_SECRET',
    'SMTP_URL',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    // 015 T049b: khóa nhà cung cấp AI – TÙY CHỌN, chỉ bắt buộc khi AI_GATEWAY_DRIVER=real (nhập tay bằng `secrets set`).
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
  ]),
  'worker-secrets': Object.freeze([
    'DATABASE_APP_URL',
    'DATABASE_SYSTEM_URL',
    'SMTP_URL',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
  ]),
  'migrate-secrets': Object.freeze([
    'DATABASE_ADMIN_URL',
    'DATABASE_OWNER_URL',
    'DB_ROLE_PASSWORD_OWNER',
    'DB_ROLE_PASSWORD_APP',
    'DB_ROLE_PASSWORD_SYSTEM',
    'DB_ROLE_PASSWORD_SUPPORT',
  ]),
});

/** Bất biến FR-014: khóa KHÔNG được xuất hiện trong Secret tương ứng. */
export const FORBIDDEN_IN = Object.freeze({
  'api-secrets': Object.freeze(['DATABASE_OWNER_URL', 'DATABASE_ADMIN_URL', 'DATABASE_SYSTEM_URL']),
  'worker-secrets': Object.freeze(['DATABASE_OWNER_URL', 'DATABASE_ADMIN_URL']),
});

/** Tên Secret ngoài ba Secret ứng dụng. */
export const OTHER_SECRETS = Object.freeze({
  'registry-pull': { namespace: 'app', keys: ['.dockerconfigjson'] },
  'pg-backup-s3': { namespace: 'database', keys: ['ACCESS_KEY_ID', 'ACCESS_SECRET_KEY'] },
});

/** Mọi tên biến mà ánh xạ đã phủ (không bí mật + bí mật). */
export function coveredVariables() {
  return new Set([...Object.keys(NON_SECRET_VARS), ...Object.values(SECRET_VARS).flat()]);
}
