import { defineConfig } from 'drizzle-kit';

// Migration chỉ dành cho dev/test (FR-017): schema `sandbox` với bảng mẫu và khung nhìn hỗ trợ mẫu.
// moduleSchema('sandbox') chỉ hợp lệ khi APP_ENV ∈ {development, test}.
process.env.APP_ENV ??= 'development';

export default defineConfig({
  dialect: 'postgresql',
  schema: './test/db/sandbox/schema.ts',
  out: './drizzle/migrations-dev',
  entities: { roles: true },
  migrations: { schema: 'infra', table: 'schema_migrations_dev' },
  schemaFilter: ['sandbox'],
});
