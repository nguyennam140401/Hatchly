import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_IN,
  NON_SECRET_VARS,
  NOT_IN_APP_SCHEMA,
  SECRET_VARS,
  coveredVariables,
} from '../../infra/lib/handoff-map.mjs';

// T029 (007, FR-024 "MUST khớp"): bảng ánh xạ bàn giao phải đủ để ứng dụng khởi động ở staging, mọi biến trong bảng
// phải còn trong lược đồ (trừ biến script/tương lai), và Secret tuân bất biến FR-014.

// Nạp lược đồ của ứng dụng bằng đường dẫn động (tooling không biên dịch mã của apps/server).
interface Field {
  safeParse(value: unknown): { success: boolean };
}
const serverConfig = join(__dirname, '..', '..', '..', 'apps', 'server', 'src', 'core', 'config');
const { AppConfigSchema } = (await import(
  /* @vite-ignore */ pathToFileURL(join(serverConfig, 'config.schema.ts')).href
)) as { AppConfigSchema: { shape: Record<string, Field> } };
const { loadConfig } = (await import(
  /* @vite-ignore */ pathToFileURL(join(serverConfig, 'load-config.ts')).href
)) as { loadConfig: (env: Record<string, string | undefined>) => unknown };

const schemaKeys = new Set(Object.keys(AppConfigSchema.shape));
const covered = coveredVariables();
const nonSecret = NON_SECRET_VARS as Record<string, string>;
const secrets = SECRET_VARS as Record<string, readonly string[]>;
const forbidden = FORBIDDEN_IN as Record<string, readonly string[]>;

/** Giá trị mẫu hợp lệ cho từng biến (không phải bí mật thật). */
const SAMPLE: Record<string, string> = {
  APP_ENV: 'staging',
  APP_VERSION: '1.0.0',
  API_PORT: '3000',
  WORKER_HEALTH_PORT: '3001',
  SHUTDOWN_TIMEOUT_MS: '30000',
  CORS_ORIGINS: 'https://app.staging.example.test',
  WEB_ORIGINS: 'https://app.staging.example.test',
  WEB_BASE_URL: 'https://app.staging.example.test',
  TRUST_PROXY_HOPS: '1',
  MAIL_TRANSPORT: 'smtp',
  MAIL_FROM: 'no-reply@example.test',
  STORAGE_DRIVER: 's3',
  S3_ENDPOINT: 'https://s3.example.test',
  S3_PUBLIC_ENDPOINT: 'https://s3.example.test',
  S3_REGION: 'HCM03',
  S3_BUCKET: 'app-media-staging',
  S3_FORCE_PATH_STYLE: 'true',
  PLATFORM_GATEWAY_DRIVER: 'fake',
  AI_GATEWAY_DRIVER: 'fake',
  NOTIFICATIONS_DRIVER: 'fake',
  FAKE_STATE_STORE: 'sandbox',
  STAGING_ALLOW_FAKES: 'true',
  DATABASE_POOL_MAX: '10',
  DATABASE_APP_URL: 'postgres://app:x@pg-rw.database.svc:5432/app?sslmode=require',
  DATABASE_SUPPORT_URL: 'postgres://support:x@pg-rw.database.svc:5432/app?sslmode=require',
  DATABASE_SYSTEM_URL: 'postgres://system:x@pg-rw.database.svc:5432/app?sslmode=require',
  AUTH_THROTTLE_SECRET: 'a'.repeat(48),
  SMTP_URL: 'smtp://mailpit.mail-capture.svc:1025',
  S3_ACCESS_KEY_ID: 'AKtest',
  S3_SECRET_ACCESS_KEY: 'sktest',
};

function envFor(unit: 'api' | 'worker'): Record<string, string> {
  const secretName = unit === 'api' ? 'api-secrets' : 'worker-secrets';
  const names = [...Object.keys(nonSecret), ...(secrets[secretName] ?? [])];
  return Object.fromEntries(names.filter((n) => n in SAMPLE).map((n) => [n, SAMPLE[n] ?? '']));
}

describe('bảng ánh xạ bàn giao khớp lược đồ cấu hình của ứng dụng', () => {
  it('biến trong bảng còn trong lược đồ, trừ biến của script migration/bootstrap và biến "tương lai"', () => {
    const missing = [...covered].filter((n) => !schemaKeys.has(n) && !(n in NOT_IN_APP_SCHEMA));
    expect(missing).toEqual([]);
  });

  it('API khởi động được ở staging chỉ với biến trong bảng (không bắt buộc biến nào ngoài bảng)', () => {
    expect(() => loadConfig(envFor('api'))).not.toThrow();
  });

  it('Worker khởi động được ở staging chỉ với biến trong bảng', () => {
    expect(() => loadConfig(envFor('worker'))).not.toThrow();
  });

  it('bỏ một biến bắt buộc của bảng thì ứng dụng báo thiếu (bảng không thừa vô nghĩa)', () => {
    const env = envFor('api');
    delete (env as Record<string, string | undefined>).DATABASE_APP_URL;
    expect(() => loadConfig(env)).toThrow(/DATABASE_APP_URL/);
  });

  it('mọi biến BẮT BUỘC theo lược đồ đều có trong bảng', () => {
    const required = Object.entries(AppConfigSchema.shape)
      .filter(([, field]) => !field.safeParse(undefined).success)
      .map(([name]) => name);
    expect(required.filter((n) => !covered.has(n))).toEqual([]);
  });
});

describe('bất biến FR-014 của Secret', () => {
  it('api-secrets không có DATABASE_OWNER_URL / DATABASE_ADMIN_URL / DATABASE_SYSTEM_URL', () => {
    for (const key of forbidden['api-secrets'] ?? [])
      expect(secrets['api-secrets']).not.toContain(key);
  });

  it('worker-secrets không có DATABASE_OWNER_URL / DATABASE_ADMIN_URL', () => {
    for (const key of forbidden['worker-secrets'] ?? [])
      expect(secrets['worker-secrets']).not.toContain(key);
  });

  it('chỉ migrate-secrets giữ chuỗi kết nối quyền chủ sở hữu/quản trị', () => {
    expect(secrets['migrate-secrets']).toEqual(
      expect.arrayContaining(['DATABASE_OWNER_URL', 'DATABASE_ADMIN_URL']),
    );
  });

  // 015 T049c: khóa nhà cung cấp AI là bí mật (Secret K8s), không bao giờ nằm trong ConfigMap/config.env.
  const AI_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];

  it('015: khóa AI nằm ở api-secrets và worker-secrets, không nằm trong danh sách không bí mật (ConfigMap)', () => {
    for (const key of AI_KEYS) {
      expect(secrets['api-secrets'], key).toContain(key);
      expect(secrets['worker-secrets'], key).toContain(key);
      expect(secrets['migrate-secrets'], key).not.toContain(key);
      expect(Object.keys(nonSecret), key).not.toContain(key);
    }
  });

  it('015: base/configmap.yaml và config.env của mọi overlay không đặt khóa AI (chú thích nhắc tên thì được)', () => {
    const root = join(__dirname, '..', '..', '..', 'infra', 'smoke-deploy');
    const files = [
      join(root, 'base', 'configmap.yaml'),
      join(root, 'overlays', 'staging', 'config.env'),
      join(root, 'overlays', 'production', 'config.env'),
    ];
    for (const file of files) {
      const active = readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith('#'))
        .join('\n');
      for (const key of AI_KEYS) expect(active, `${file}: ${key}`).not.toContain(key);
    }
  });

  it('không biến bí mật nào nằm trong danh sách không bí mật', () => {
    const secretNames = new Set(Object.values(secrets).flat());
    expect(Object.keys(nonSecret).filter((n) => secretNames.has(n))).toEqual([]);
  });
});
