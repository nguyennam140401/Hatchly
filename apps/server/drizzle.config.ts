import { defineConfig } from 'drizzle-kit';
import manifest from './src/modules/modules.manifest.json';

// Migration chính (research R10): bảng gốc account.accounts ở lõi + bảng của từng module.
// Tệp *.log-table.ts (bảng nhật ký phân vùng – DDL viết tay) KHÔNG nằm trong glob.
// Không dùng `drizzle-kit push`; migration được chạy bằng `pnpm db:migrate` (src/db/migrate.ts).
export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/core/db/tenant-root.ts', './src/modules/*/internal/db/schema.ts'],
  out: './drizzle/migrations',
  // Vai trò khai báo `.existing()` – drizzle-kit không tạo/xóa vai trò (R6).
  entities: { roles: true },
  migrations: { schema: 'infra', table: 'schema_migrations' },
  schemaFilter: manifest.modules.map((m) => m.schema),
});
