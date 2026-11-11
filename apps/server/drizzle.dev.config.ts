import { defineConfig } from 'drizzle-kit';

// Migration chỉ dành cho dev/test (FR-017): schema `sandbox` với bảng mẫu và khung nhìn hỗ trợ mẫu.
// moduleSchema('sandbox') chỉ hợp lệ khi APP_ENV ∈ {development, test}.
process.env.APP_ENV ??= 'development';

export default defineConfig({
  dialect: 'postgresql',
  // 005: bảng trạng thái của bản giả lập (src/dev – chạy được trong dist) + bảng mẫu của kiểm thử 002.
  schema: ['./test/db/sandbox/schema.ts', './src/dev/sandbox/schema.ts'],
  out: './drizzle/migrations-dev',
  entities: { roles: true },
  migrations: { schema: 'infra', table: 'schema_migrations_dev' },
  schemaFilter: ['sandbox'],
});
