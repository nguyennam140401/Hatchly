import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pgSchema, type PgSchema } from 'drizzle-orm/pg-core';
import { sandboxAllowed } from '../config/sandbox-allowed';

// Schema của module lấy từ modules.manifest.json (FR-009). Lõi KHÔNG nhập mã TS hay JSON của
// `modules/**` qua import (quy tắc ranh giới `core-no-modules`) – đọc tệp JSON lúc chạy.

interface ManifestEntry {
  name: string;
  schema: string;
  reservedSchema?: boolean;
}

/** Schema chỉ dành cho dev/test (bảng mẫu, khung nhìn hỗ trợ mẫu – FR-017). */
export const SANDBOX_SCHEMA = 'sandbox';

let manifestCache: ManifestEntry[] | undefined;

/** Các mục module trong tệp kê khai (đúng cả khi chạy từ `src/` lẫn `dist/`). */
export function manifestModules(): ManifestEntry[] {
  manifestCache ??= (
    JSON.parse(
      readFileSync(resolve(__dirname, '..', '..', 'modules', 'modules.manifest.json'), 'utf8'),
    ) as { modules: ManifestEntry[] }
  ).modules;
  return manifestCache;
}

/** Tên mọi schema của tệp kê khai, theo thứ tự khai báo. */
export function manifestSchemas(): string[] {
  return manifestModules().map((m) => m.schema);
}

const schemas = new Map<string, PgSchema>();

/**
 * Đối tượng `pgSchema` của một module. Tên không có trong tệp kê khai → lỗi; `sandbox` chỉ hợp lệ
 * khi `APP_ENV ∈ {development, test}` hoặc `staging` + `STAGING_ALLOW_FAKES=true` (007, R15).
 */
export function moduleSchema(name: string): PgSchema {
  if (name === SANDBOX_SCHEMA) {
    if (!sandboxAllowed(process.env.APP_ENV, process.env)) {
      throw new Error(
        'Schema sandbox chỉ dùng khi APP_ENV là development/test, hoặc staging có STAGING_ALLOW_FAKES=true',
      );
    }
  } else if (!manifestSchemas().includes(name)) {
    throw new Error(`Schema "${name}" không có trong modules.manifest.json`);
  }
  let schema = schemas.get(name);
  if (schema === undefined) {
    schema = pgSchema(name);
    schemas.set(name, schema);
  }
  return schema;
}
