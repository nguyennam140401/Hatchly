---

description: "Danh sách việc – Lớp CSDL, ngữ cảnh tenant trong giao dịch, RLS mẫu (002)"
---

# Tasks: Lớp CSDL – schema theo module, ngữ cảnh tenant trong giao dịch, RLS mẫu

**Input**: `specs/002-db-layer-tenant-rls/` – plan.md, spec.md, research.md (R1–R17), data-model.md,
contracts/ (db-layer-api.md, db-conventions.md, db-commands.md), quickstart.md

**Tests**: BẮT BUỘC – spec FR-025 yêu cầu kiểm thử tích hợp trên PostgreSQL thật; hiến pháp yêu cầu
kiểm thử truy cập chéo. Kiểm thử CSDL là `apps/server/test/db/**/*.db.spec.ts`, chạy bằng `pnpm test:db`.
Viết kiểm thử trước, xác nhận chúng thất bại rồi mới cài đặt.

**Organization**: theo user story của spec. US1–US3 đều P1 nhưng phụ thuộc thực tế: phần dựng chung
(bể kết nối, vai trò, migrator, schema, `accounts`, hàm dựng bảng, bảng mẫu) nằm ở Phase 2; mỗi story
sau đó kiểm chứng độc lập được.

**Quy ước**: đường dẫn tính từ gốc kho. Bình luận mã, tài liệu, thông điệp lỗi bằng tiếng Việt; định
danh tiếng Anh theo bảng thuật ngữ trong research.md. Mọi chuỗi kết nối là bí mật – không bao giờ in.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: chạy song song được (khác tệp, không phụ thuộc việc chưa xong)
- **[Story]**: US1…US4 theo spec.md

---

## Phase 1: Setup (hạ tầng dùng chung)

**Purpose**: thư viện, cấu hình, CSDL cục bộ, chỗ đặt tệp

- [X] T001 Thêm phụ thuộc khóa phiên bản chính xác vào `apps/server/package.json`: `pg`, `drizzle-orm` (dependencies); `drizzle-kit`, `@types/pg` (devDependencies) – dòng ổn định hiện hành có `pgPolicy`/`pgRole` (research R1); chạy `pnpm install`, cập nhật `pnpm-lock.yaml`
- [X] T002 Thêm script vào `apps/server/package.json`: `db:bootstrap` (`tsx --env-file-if-exists=.env src/db/bootstrap.ts`), `db:migrate`, `db:setup` (`src/db/setup-dev.ts`), `db:check` (`src/db/check-conventions.ts`), `db:lint-migrations`, `db:generate` (`drizzle-kit generate --config drizzle.config.ts`), `db:generate:custom` (`drizzle-kit generate --custom --config drizzle.config.ts`), `db:generate:dev` (`drizzle-kit generate --config drizzle.dev.config.ts`), `test:db` (`vitest run --config vitest.db.config.mts`); và script chuyển tiếp ở `package.json` gốc: `db:up` (`docker compose up -d postgres`), `db:setup`, `db:migrate`, `db:check`, `db:lint-migrations`, `db:generate`, `test:db` (`pnpm --filter @app/server <tên>`) – theo contracts/db-commands.md mục 1
- [X] T003 [P] Sửa `docker-compose.yml`: bỏ `profiles: ['db']` của `postgres`, ảnh `${POSTGRES_IMAGE:-postgres:17-alpine}`; thêm dịch vụ `migrate` (`image: app-server:local`, `command: ['node','dist/db/setup-dev.js']`, `depends_on: postgres: service_healthy`, `restart: 'no'`, biến `APP_ENV=development`, `DATABASE_ADMIN_URL`, `DATABASE_OWNER_URL`, `DB_ROLE_PASSWORD_*` giá trị `*_dev_only`); thêm `DATABASE_APP_URL`, `DATABASE_SYSTEM_URL`, `DATABASE_SUPPORT_URL` vào `x-server-env`; `api`, `worker` thêm `depends_on: migrate: service_completed_successfully`; cập nhật chú thích đầu tệp (contracts/db-commands.md mục 3)
- [X] T004 [P] Bổ sung `apps/server/.env.example`: các biến ở contracts/db-commands.md mục 2 (API/Worker + script + `TEST_DATABASE_ADMIN_URL`) với giá trị mẫu trỏ `localhost:5432`, mật khẩu `*_dev_only`, ghi chú tiếng Việt "chỉ dùng cục bộ, không dùng ở môi trường thật"
- [X] T005 [P] Tạo tệp giữ chỗ `apps/server/src/modules/<m>/internal/db/.gitkeep` cho cả 11 module trong `modules.manifest.json` (nơi đặt `schema.ts` của từng module)
- [X] T006 [P] Tạo `apps/server/drizzle.config.ts` (dialect `postgresql`, `schema: ['./src/core/db/tenant-root.ts', './src/modules/*/internal/db/schema.ts']`, `out: './drizzle/migrations'`, `entities: { roles: true }`, `migrations: { schema: 'infra', table: 'schema_migrations' }`, `schemaFilter` = schema của tệp kê khai) và `apps/server/drizzle.dev.config.ts` (`schema: './test/db/sandbox/schema.ts'`, `out: './drizzle/migrations-dev'`, `migrations: { schema: 'infra', table: 'schema_migrations_dev' }`, `schemaFilter: ['sandbox']`) – research R10; tệp `*.log-table.ts` KHÔNG nằm trong glob
- [X] T007 [P] Thêm `VERSION_CONFLICT: 'VERSION_CONFLICT'` vào `ERROR_CODES` trong `packages/shared/src/core/error-response.ts`; cập nhật `packages/shared/test/core.spec.ts` khẳng định mã có mặt

---

## Phase 2: Foundational (điều kiện tiên quyết)

**Purpose**: cấu hình, vai trò, bể kết nối, migrator, schema, bảng gốc, hàm dựng bảng, bảng mẫu,
khung kiểm thử CSDL. **Không story nào bắt đầu được trước khi xong phase này.**

### Cấu hình & lỗi

- [X] T008 Mở rộng `AppConfigSchema` trong `apps/server/src/core/config/config.schema.ts`: `DATABASE_APP_URL` (bắt buộc, `secret()`, URL `postgres://`/`postgresql://`), `DATABASE_SYSTEM_URL` (tùy chọn ở lược đồ, `secret()`), `DATABASE_SUPPORT_URL` (tùy chọn, `secret()`), `DATABASE_POOL_MAX` (int 1–100, mặc định 10), `DATABASE_STATEMENT_TIMEOUT_MS` (int ≥ 1000, mặc định 15000), `DATABASE_IDLE_IN_TX_TIMEOUT_MS` (int ≥ 1000, mặc định 30000); thêm hàm `assertWorkerDatabaseConfig(config)` ném `ConfigError` `DATABASE_SYSTEM_URL: bắt buộc` khi thiếu (Worker gọi lúc khởi động)
- [X] T009 Cập nhật `apps/server/test/config.spec.ts`: thiếu `DATABASE_APP_URL` → `ConfigError` nêu tên biến; URL sai định dạng → lý do "giá trị chưa hợp lệ" và thông điệp KHÔNG chứa giá trị/mật khẩu; Worker thiếu `DATABASE_SYSTEM_URL` → lỗi nêu tên biến; giá trị mặc định của pool/timeout
- [X] T010 Cập nhật các kiểm thử 001 cần cấu hình CSDL: `apps/server/test/health.e2e.spec.ts`, `validation.e2e.spec.ts`, `shutdown.spec.ts`, `multi-worker.spec.ts` – thêm `DATABASE_APP_URL=postgres://app:x@127.0.0.1:1/app` (cổng không mở) và `DATABASE_SYSTEM_URL` tương tự cho Worker; đổi kỳ vọng `/readyz` trong `health.e2e.spec.ts` thành 503 với `checks` chứa `{ name: 'database', status: 'fail' }` (trường hợp CSDL sẵn sàng được kiểm ở T030); `pnpm test` (không CSDL) phải vẫn đạt
- [X] T011 [P] Tạo `apps/server/src/core/db/errors.ts`: `TenantContextError` (mã `TENANT_CONTEXT_MISSING` | `TENANT_CONTEXT_INVALID` | `TENANT_CONTEXT_CONFLICT` | `TENANT_NOT_FOUND`, kèm `table?`), `DbPolicyViolationError` (`DB_POLICY_VIOLATION`), hàm `normalizePgError(err)` ánh xạ `42501` + "row-level security" → `DbPolicyViolationError`, lỗi kết nối → lỗi mới chỉ giữ `code` (`ECONNREFUSED`, `28P01`, …) và thông điệp tiếng Việt không có chuỗi kết nối (research R15); sửa `apps/server/src/core/errors/error.filter.ts` để hai lớp lỗi này trả `INTERNAL_ERROR` 500 với mã gốc ở `support.detail`, lỗi kết nối trả `SERVICE_UNAVAILABLE` 503 (contracts/db-layer-api.md mục 6)

### Vai trò & bootstrap

- [X] T012 Viết `apps/server/drizzle/bootstrap/roles.sql` (idempotent, `DO $$ … IF NOT EXISTS … $$`): tạo hoặc `ALTER` 4 vai trò `"owner"`, `"app"`, `"system"`, `"support"` với `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT` và mật khẩu từ biến psql/tham số; thu hồi mọi thành viên vai trò giữa chúng; `ALTER DATABASE <db> OWNER TO "owner"`; `REVOKE ALL ON DATABASE <db> FROM PUBLIC`; `GRANT CONNECT, TEMPORARY ON DATABASE <db> TO "owner","app","system","support"`; `REVOKE CREATE ON SCHEMA public FROM PUBLIC` (research R6, data-model mục 2)
- [X] T013 Tạo `apps/server/src/db/script-config.ts` (lược đồ Zod riêng cho script: `APP_ENV`, `DATABASE_ADMIN_URL`, `DATABASE_OWNER_URL`, `DB_ROLE_PASSWORD_OWNER/_APP/_SYSTEM/_SUPPORT`, `DATABASE_NAME` tùy chọn – tất cả URL/mật khẩu `secret()`, dùng `loadConfigFrom`) và `apps/server/src/db/bootstrap.ts`: kết nối bằng `DATABASE_ADMIN_URL`, tạo CSDL nếu chưa có, chạy `roles.sql` với mật khẩu truyền bằng `format('%L')` phía máy chủ (không nối chuỗi ở JS), in "Đã khởi tạo 4 vai trò" – không in mật khẩu; lỗi → mã thoát 1, thông điệp qua `normalizePgError`; cờ `--keep-existing-passwords` (kiểm thử dùng): vai trò đã có thì chỉ chuẩn hóa thuộc tính (`NOSUPERUSER NOBYPASSRLS …`, thu hồi thành viên), KHÔNG `ALTER ROLE … PASSWORD`

### Bể kết nối & module NestJS

- [X] T014 Tạo `apps/server/src/core/db/pools.ts`: `createPool(role, url, config)` dùng `pg.Pool` với `max = DATABASE_POOL_MAX`, `options: '-c TimeZone=UTC -c statement_timeout=<ms> -c idle_in_transaction_session_timeout=<ms>'`, `application_name = <unit>-<role>`; bắt sự kiện `error` của bể và ghi nhật ký chỉ có `code`; hàm `assertRuntimeRole(pool, expectedRole)` chạy `SELECT current_user, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user` – sai vai trò, `rolsuper` hoặc `rolbypassrls` = true → ném lỗi "Vai trò CSDL không hợp lệ cho ứng dụng: <tên vai trò>" (research R7); bể tạo lười, tự kiểm vai trò ở lần lấy kết nối đầu tiên
- [X] T015 Tạo `apps/server/src/core/db/database.module.ts`: `DatabaseModule.forRoot(unit, config)` cung cấp `DatabaseService` (bể `app` cho cả hai đơn vị; bể `system` chỉ khi `unit === 'worker'`; bể `support` chỉ khi `unit === 'api'` và có `DATABASE_SUPPORT_URL`); đăng ký `ReadinessCheck` tên `database` (`SELECT 1` trên bể `app`, hết hạn 2 s, gồm tự kiểm vai trò); vai trò sai → ghi `fatal` `db.role_invalid` và `process.exit(1)`; đóng mọi bể trong `onApplicationShutdown` sau khi `ShutdownCoordinator` xong việc đang chạy; gắn vào `apps/server/src/app/api-app.module.ts` và `apps/server/src/app/worker-app.module.ts`; Worker gọi `assertWorkerDatabaseConfig` trong `apps/server/src/worker.ts`

### Migrator & schema

- [X] T016 Tạo `apps/server/src/db/migrate.ts`: kết nối bằng `DATABASE_OWNER_URL`, `SELECT pg_advisory_lock(<hằng số>)`, kiểm `current_user = 'owner'` (sai → thoát 1), tạo schema `infra` nếu chưa có, chạy `migrate()` của `drizzle-orm/node-postgres/migrator` với `migrationsFolder: drizzle/migrations`, `migrationsSchema: 'infra'`, `migrationsTable: 'schema_migrations'`; nếu `APP_ENV ∈ {development, test}` chạy tiếp `drizzle/migrations-dev` với bảng `schema_migrations_dev`; in số migration mới đã áp ("0 migration mới" khi không có); nhả khóa; xuất hàm `runMigrations(opts)` để kiểm thử gọi; đường dẫn thư mục migration tính từ `__dirname` để chạy được cả `tsx` lẫn `dist/db/migrate.js`
- [X] T017 Tạo `apps/server/src/db/setup-dev.ts` (gọi bootstrap rồi `runMigrations`; từ chối chạy khi `APP_ENV` là `staging`/`production`) và đảm bảo `apps/server/tsconfig.build.json` biên dịch `src/db/**` ra `dist/db/*.js`; sao chép thư mục `apps/server/drizzle/` vào ảnh trong `Dockerfile` (cạnh `dist/`)
- [X] T018 Viết migration tay đầu tiên `apps/server/drizzle/migrations/0000_schemas_grants.sql` (tạo bằng `pnpm db:generate:custom -- --name schemas_grants`): `CREATE SCHEMA IF NOT EXISTS` cho đủ 11 schema của `modules.manifest.json` (`account, context, media, trends, content, approval, publishing, platform_gateway, ai_gateway, notifications, infra`) `AUTHORIZATION "owner"`; `GRANT USAGE` trên mọi schema trừ `approval` cho `"app","system"`; `GRANT USAGE ON SCHEMA infra TO "support"`; `ALTER DEFAULT PRIVILEGES FOR ROLE "owner" IN SCHEMA <s> GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "app","system"` và `GRANT USAGE, SELECT ON SEQUENCES` cho mọi schema nghiệp vụ/cổng (KHÔNG cho `infra`, `approval`); `ALTER DEFAULT PRIVILEGES FOR ROLE "owner" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`; tạo hàm `account.current_account_id()` ngay trong tệp này – hàm phải có trước mọi chính sách dùng nó: `CREATE OR REPLACE FUNCTION account.current_account_id() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT nullif(current_setting('app.account_id', true), '')::uuid $$`, `REVOKE ALL ON FUNCTION … FROM PUBLIC`, `GRANT EXECUTE … TO "app","system","support"` (data-model mục 2, 3; research R2)
- [X] T019 Tạo `apps/server/src/core/db/module-schema.ts`: `moduleSchema(name)` đọc `modules.manifest.json` (dùng lại trình đọc tệp kê khai của `apps/server/src/app/manifest.ts` hoặc đọc JSON trực tiếp – lõi không nhập `modules/**` mã TS), trả `pgSchema(name)`; tên không có trong tệp kê khai → ném lỗi; cho phép `'sandbox'` chỉ khi `process.env.APP_ENV ∈ {development, test}`
- [X] T020 [P] Tạo `apps/server/src/core/db/roles.ts`: `appRole = pgRole('app').existing()`, `systemRole`, `supportRole`, `ownerRole` tương tự (research R6)

### Bảng gốc, hàm dựng bảng, sổ đăng ký

- [X] T021 Tạo `apps/server/src/core/db/table-registry.ts`: kiểu `TableRegistration { schema; name; kind: 'tenant' | 'shared' | 'partitioned_log'; tenantColumn: 'account_id' | 'id'; indexExceptions: Record<string,string>; reason?: string }`, `registerTable()` (trùng `schema.name` → lỗi), `tableRegistry()` chỉ đọc, `isTenantTable(schema, name)` (data-model mục 6)
- [X] T022 Tạo `apps/server/src/core/db/tenant-root.ts` (đầu tệp ghi: "Module `account` sở hữu về nghiệp vụ, thêm cột tại đây theo hướng chỉ thêm – research R9"): bảng `account.accounts` với `id uuid PK` (`$defaultFn(uuidV7)`), `status text NOT NULL` + `CHECK (status IN ('active','suspended','expired','deleting'))`, `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()` (`$onUpdateFn(() => sql\`now()\`)`), `deleted_at timestamptz NULL`; chính sách `tenant_isolation` `for: 'all'`, `to: [appRole, systemRole]`, `using`/`withCheck` = `id = account.current_account_id()`; đăng ký vào sổ với `kind: 'tenant'`, `tenantColumn: 'id'` (data-model mục 4)
- [X] T023 Sinh `apps/server/drizzle/migrations/0001_accounts.sql` bằng `pnpm db:generate`; review SQL sinh ra có `ENABLE ROW LEVEL SECURITY` và `CREATE POLICY "tenant_isolation"` tham chiếu `account.current_account_id()` (hàm đã tạo ở `0000` – T018); thêm migration tay `0002_accounts_grants.sql` (`pnpm db:generate:custom -- --name accounts_grants`): `REVOKE INSERT, DELETE ON account.accounts FROM "app","system"` (research R2, R9). KHÔNG sửa tay `drizzle/migrations/meta/_journal.json`
- [X] T024 Tạo `apps/server/src/core/db/table-builders.ts`: `tenantTable(schema, name, columns, extra?, opts?)` thêm bộ cột chuẩn – `id uuid PK $defaultFn(uuidV7)`, `account_id uuid NOT NULL REFERENCES account.accounts(id) ON DELETE CASCADE`, `created_at`/`updated_at timestamptz NOT NULL DEFAULT now()` (`updated_at` có `$onUpdateFn`), `deleted_at timestamptz NULL` khi `softDelete`, `version integer NOT NULL DEFAULT 1` khi `versioned` – cộng chỉ mục `<table>_account_id_idx (account_id)` và `pgPolicy('tenant_isolation', { for: 'all', to: [appRole, systemRole], using: sql\`account_id = account.current_account_id()\`, withCheck: <cùng điều kiện> })`, đăng ký `kind: 'tenant'` kèm `indexExceptions`; `sharedTable(schema, name, columns, extra?, { reason })` (reason rỗng → lỗi); `partitionedLogTable(schema, name, columns, { partitionBy })`; `microUsd(name, { nonNegative? })` = `bigint(name, { mode: 'bigint' })` (data-model mục 5, research R8, R14)
- [X] T025 Xuất giao diện công khai trong `apps/server/src/core/db/index.ts` theo contracts/db-layer-api.md mục 1, 2, 4 (chưa có thao tác thì để xuất ở task tương ứng) và thêm `export * from './db'` có chọn lọc vào `apps/server/src/core/index.ts`; KHÔNG xuất `createPool`, bể, `tableRegistry` (mục 5)

### Bảng mẫu & khung kiểm thử CSDL

- [X] T026 Tạo `apps/server/test/db/sandbox/schema.ts`: `sandbox.tenant_notes = tenantTable(moduleSchema('sandbox'), 'tenant_notes', { title: text NOT NULL, status: text NOT NULL DEFAULT 'draft', secret_note: text NULL, cost_micro_usd: microUsd NOT NULL DEFAULT 0 nonNegative }, t => [index('tenant_notes_account_id_status_idx').on(t.account_id, t.status)], { softDelete: true, versioned: true })` (data-model mục 8); sinh `apps/server/drizzle/migrations-dev/0000_*.sql` bằng `pnpm db:generate:dev`, thêm phần tay: `CREATE SCHEMA IF NOT EXISTS sandbox AUTHORIZATION "owner"` (đầu tệp), `GRANT USAGE ON SCHEMA sandbox TO "app","system","support"`, `GRANT SELECT, INSERT, UPDATE, DELETE ON sandbox.tenant_notes TO "app","system"`
- [X] T027 Tạo `apps/server/vitest.db.config.mts` (cùng plugin swc như `vitest.config.mts`, `include: ['test/db/**/*.db.spec.ts']`, `fileParallelism: false`, `globalSetup: ['./test/db/global-setup.ts']`, `testTimeout: 60_000`) và loại `test/db/**` khỏi `include` của `apps/server/vitest.config.mts`
- [X] T028 Tạo `apps/server/test/db/global-setup.ts`: không có `TEST_DATABASE_ADMIN_URL` → in "Bỏ qua kiểm thử CSDL: chưa đặt TEST_DATABASE_ADMIN_URL" và đặt cờ để mọi tệp `*.db.spec.ts` `describe.skip`; có → tạo CSDL `app_test_<8 ký tự ngẫu nhiên>`, chạy bootstrap với cờ `--keep-existing-passwords` và mật khẩu lấy từ `DB_ROLE_PASSWORD_*` của môi trường (cùng giá trị `.env` dev – vai trò là đối tượng cấp cụm, dùng chung giữa CSDL dev và CSDL kiểm thử, KHÔNG được đổi mật khẩu) + `runMigrations({ appEnv: 'test' })`, cung cấp URL từng vai trò qua `provide()`/biến môi trường cho tệp kiểm thử; teardown: `DROP DATABASE … WITH (FORCE)`
- [X] T029 Tạo `apps/server/test/db/helpers/db.ts`: `ownerClient()`, `createAccount(status = 'active')` (chèn `account.accounts` bằng `owner`), `seedNotes(accountId, n)` (bằng `owner`), `makeDatabase({ role, poolMax, appEnv })` tạo `DatabaseService` thật, `withAccount(accountId, fn)` (dùng `runWithJobContext` – chỉ test được nhập), `captureLogs()` gom nhật ký pino vào mảng; và `apps/server/test/db/helpers/cross-tenant.ts`: khuôn kiểm thử truy cập chéo tham số hóa theo bảng (`describeCrossTenant({ table, insertRow, updateRow })` sinh 4 thao tác × 2 chiều – FR-025 "tái sử dụng được", WBS 1.4 dùng lại)
- [X] T030 [P] Kiểm thử `/readyz` có CSDL trong `apps/server/test/db/readiness.db.spec.ts`: API với `DATABASE_APP_URL` của CSDL kiểm thử → 200, `checks` có `{ name: 'database', status: 'pass' }`; `DATABASE_APP_URL` dùng vai trò `owner` → tiến trình ghi `db.role_invalid` và thoát mã 1, đầu ra không chứa mật khẩu (research R7)

**Checkpoint**: `pnpm db:setup` chạy được trên compose; `pnpm test` (không CSDL) đạt; `pnpm test:db` chạy được khung rỗng.

---

## Phase 3: User Story 1 – Đọc/ghi dữ liệu khách hàng chỉ trong ngữ cảnh tenant (Priority: P1) 🎯 MVP

**Goal**: `tenantTx` đặt `app.account_id` phạm vi giao dịch; truy vấn không lọc vẫn chỉ thấy/ghi dòng
của tenant; kết nối trả bể sạch; ngoài ngữ cảnh → lỗi (dev/test) hoặc 0 dòng + cảnh báo (production).

**Independent Test**: tài khoản A, B có dòng trong `sandbox.tenant_notes`; ngữ cảnh A đọc không lọc →
chỉ dòng A; dùng lại cùng kết nối (bể 1) không ngữ cảnh → 0 dòng.

### Tests for User Story 1 ⚠️ (viết trước, phải thất bại)

- [X] T031 [P] [US1] `apps/server/test/db/tenant-isolation.db.spec.ts` – dùng `describeCrossTenant` trên `sandbox.tenant_notes`: đọc/sửa/xóa toàn bảng không lọc trong ngữ cảnh A chỉ chạm dòng A, dòng B nguyên vẹn (US1-AS1, AS2); chèn và sửa thành `account_id = B` → `DbPolicyViolationError` và giao dịch hoàn tác (AS3); mỗi thao tác cả hai chiều A→B, B→A (SC-001)
- [X] T032 [P] [US1] `apps/server/test/db/context-leak.db.spec.ts` – bể `max: 1`: giao dịch A thành công rồi truy vấn thô trên cùng kết nối không ngữ cảnh → 0 dòng và `current_setting('app.account_id', true)` là `''` hoặc NULL; giao dịch A ném lỗi giữa chừng → tương tự (AS4); hai giao dịch A, B song song trên bể `max: 2` với `pg_sleep` xen kẽ → mỗi bên chỉ thấy dòng mình (AS5); vòng lặp 1.000 giao dịch xen kẽ A/B trên bể 2 kết nối, mỗi vòng thứ 10 cố ý ném lỗi, đếm số lần thấy dòng sai tenant = 0 (SC-002)
- [X] T033 [P] [US1] `apps/server/test/db/tenant-context-errors.db.spec.ts` – `tenantTx` không có `accountId` trong ngữ cảnh → `TENANT_CONTEXT_MISSING`; `accountId` rỗng/`'abc'` → `TENANT_CONTEXT_INVALID` và không có câu lệnh nào gửi tới CSDL; UUID không tồn tại → `TENANT_NOT_FOUND`; lồng cùng tài khoản → dùng chung giao dịch (thay đổi của hàm trong thấy được ở hàm ngoài, hoàn tác cùng nhau); lồng khác tài khoản → `TENANT_CONTEXT_CONFLICT`; hủy kết nối giữa giao dịch (`pg_terminate_backend` bằng `owner`) → lỗi trả cho người gọi, lần gọi sau chạy bình thường trên kết nối mới không có ngữ cảnh cũ (edge cases)
- [X] T034 [P] [US1] `apps/server/test/db/out-of-context.db.spec.ts` – giao dịch không tenant (`systemTx({ tenant: 'none' })`) đọc `sandbox.tenant_notes`: `APP_ENV=test` → `TenantContextError` `TENANT_CONTEXT_MISSING` với thông điệp nêu `sandbox.tenant_notes`; `APP_ENV=production` → trả 0 dòng và `captureLogs()` có đúng một bản ghi `warn` `event: 'db.tenant_context_missing'`, `table: 'sandbox.tenant_notes'`, không chứa tham số/dữ liệu (US1-AS6, FR-008); truy vấn tự xác nhận trực tiếp trên bể `app` (đường thô chỉ có trong kiểm thử) → 0 dòng
- [X] T035 [P] [US1] `apps/server/test/db/logging-context.db.spec.ts` – nhật ký ghi bên trong `tenantTx` của A có `account_id = A`; ngoài giao dịch có `account_id` theo `ExecutionContext` hoặc `null` (FR-007)

### Implementation for User Story 1

- [X] T036 [US1] Đổi `apps/server/src/core/context/request-context.ts` thành `ExecutionContext { traceId; accountId?; source: 'request' | 'job' | 'system' }` (giữ `getRequestContext` làm bí danh tương thích cho mã 001), thêm `getExecutionContext()`; tạo `apps/server/src/core/context/bind-account.ts` với `bindAccountToRequest(accountId)` (ghi vào store hiện tại của yêu cầu; ném lỗi khi ngoài yêu cầu hoặc đã có `accountId` khác) và `runWithJobContext({ traceId, accountId? }, fn)` (contracts/db-layer-api.md mục 3)
- [X] T037 [US1] Thêm quy tắc ranh giới `bind-account-restricted` vào `tooling/boundaries/build-rules.cjs`: chỉ `apps/server/src/core/auth/**`, `apps/server/src/modules/queue/**`, `apps/server/src/core/db/**` và `apps/server/test/**` được nhập `core/context/bind-account`; không xuất `bind-account` qua `apps/server/src/core/index.ts`; thêm mẫu vi phạm `tooling/boundaries/fixtures/i-bind-account-outside-queue/` (module `content` nhập `bind-account`) với `expected.json`, cập nhật `tooling/boundaries/boundaries.spec.ts`
- [X] T038 [US1] Tạo `apps/server/src/core/db/transaction.ts`: ALS `TxContext { role; accountId | null; db; client }`; hàm nội bộ `runTx(pool, role, accountId | null, fn)` – kiểm định dạng UUID trước khi lấy kết nối (`TENANT_CONTEXT_INVALID`); `client = await pool.connect()`; `BEGIN`; nếu có tenant: `SELECT set_config('app.account_id', $1, true)` rồi `SELECT 1 FROM account.accounts WHERE id = account.current_account_id()` (không dòng → `TENANT_NOT_FOUND`); `db = drizzle(client, { schema })`; chạy `fn(db)` trong ALS; `COMMIT`; lỗi → `ROLLBACK`, lỗi khi `ROLLBACK` hoặc lỗi kết nối → `client.release(err)` (hủy), ngược lại `client.release()`; chuẩn hóa lỗi qua `normalizePgError` (research R3, R4; trạng thái ở data-model mục 9)
- [X] T039 [US1] Trong `apps/server/src/core/db/transaction.ts` cài `tenantTx(fn)`: lấy `accountId` từ `getExecutionContext()` (thiếu → `TENANT_CONTEXT_MISSING`); nếu đang trong `TxContext`: cùng `role` + cùng `accountId` → gọi `fn(current.db)`, khác → `TENANT_CONTEXT_CONFLICT`; ngược lại `runTx(appPool, 'app', accountId, fn)`; thêm `currentAccountId()` trả `TxContext.accountId ?? getExecutionContext()?.accountId ?? null`
- [X] T040 [US1] Tạo `apps/server/src/core/db/query-guard.ts`: `guardClient(client, env, logger)` bọc `client.query` khi giao dịch không tenant – quét chuỗi SQL bằng `/"([a-z_][a-z0-9_]*)"\."([a-z_][a-z0-9_]*)"/g`, trúng bảng `isTenantTable` → `development`/`test`: ném `TenantContextError('TENANT_CONTEXT_MISSING', { table: 'schema.table' })`; `staging`/`production`: `logger.warn({ event: 'db.tenant_context_missing', table, trace_id })` rồi chạy tiếp (research R5); gắn vào `runTx` khi `accountId === null`
- [X] T041 [US1] Sửa `apps/server/src/core/logging/logging.module.ts`: `mixin` lấy `account_id` từ `currentAccountId()` và `trace_id` từ `getExecutionContext()` (FR-007); giữ nguyên `REDACT_PATHS` và thêm `'connectionString'`, `'*.connectionString'`, `'databaseUrl'`
- [X] T042 [US1] Xuất `tenantTx`, `currentAccountId`, `TenantContextError`, `DbPolicyViolationError`, kiểu `Db` từ `apps/server/src/core/db/index.ts`; chạy `pnpm test:db` – T031–T035 đạt

**Checkpoint**: US1 kiểm chứng độc lập được – nguyên tắc I có lớp chặn CSDL + ứng dụng.

---

## Phase 4: User Story 2 – Schema theo module, migration có quản lý (Priority: P1)

**Goal**: một lệnh dựng đủ schema theo tệp kê khai, vai trò, bảng gốc; chạy lại không đổi gì; mọi đối
tượng thuộc `owner`; `app` không đổi cấu trúc được; API/Worker luôn dùng `app`.

**Independent Test**: CSDL trống → `pnpm db:setup` → đủ 11 schema + 4 vai trò + `account.accounts`;
chạy lại → không lỗi, không thay đổi.

### Tests for User Story 2 ⚠️

- [X] T043 [P] [US2] `apps/server/test/db/migrate.db.spec.ts` – trên CSDL tạm mới riêng của tệp: `runMigrations` lần 1 hoàn tất ≤ 60 s (SC-004), tập schema (trừ `public`, `pg_*`, `information_schema`, `sandbox`) **bằng đúng** tập `schema` trong `modules.manifest.json` (US2-AS1); `approval` không có bảng; lần 2 báo 0 migration mới và ảnh chụp `pg_class`/`pg_policy`/`pg_namespace` không đổi (AS2); hai `runMigrations` song song không lỗi (khóa tư vấn); `APP_ENV=production` → không có schema `sandbox` (FR-017)
- [X] T044 [P] [US2] `apps/server/test/db/ownership.db.spec.ts` – mọi schema/bảng/hàm/khung nhìn trong 11 schema + `sandbox` có chủ `owner` (US2-AS3); `app` thử `CREATE TABLE content.x(...)`, `ALTER TABLE sandbox.tenant_notes ADD COLUMN y int`, `DROP TABLE sandbox.tenant_notes` → đều bị từ chối `42501`; bootstrap chạy lại 2 lần không lỗi và 4 vai trò có `rolbypassrls = false`, `rolsuper = false`
- [X] T045 [P] [US2] Bổ sung `apps/server/test/shutdown.spec.ts` (không cần CSDL): khởi động API với `DATABASE_APP_URL` thiếu → thoát mã 1, đầu ra chứa `DATABASE_APP_URL: bắt buộc`; với URL chứa mật khẩu `S3cr3t_marker` nhưng sai định dạng → đầu ra không chứa `S3cr3t_marker` (US2-AS5)

### Implementation for User Story 2

- [X] T046 [US2] Hoàn thiện `apps/server/src/db/migrate.ts` cho các kịch bản T043: in bảng tóm tắt ("Đã áp N migration chính, M migration dev"), thời gian chạy; từ chối chạy migration dev khi `APP_ENV ∉ {development, test}` kể cả khi thư mục tồn tại; xác nhận `pnpm db:setup` từ gốc kho chạy được trên Windows (PowerShell) và Linux
- [X] T047 [US2] Viết hướng dẫn migration tương thích ngược trong `apps/server/docs/database.md` mục "Migration tương thích ngược": quy trình mở rộng → chuyển → thu gọn (thêm cột NULL/có mặc định; đổi tên = thêm cột mới + ghi cả hai + bỏ cột cũ ở lần phát hành sau; không `SET NOT NULL` trên cột cũ khi chưa backfill), chú thích `-- breaking-ok: <lý do + lần phát hành thứ hai>` (FR-012, research R17)
- [X] T048 [US2] Tạo `apps/server/src/db/lint-migrations.ts`: lấy danh sách tệp SQL mới (`git diff --name-only --diff-filter=A <merge-base> -- apps/server/drizzle/migrations` khi có git, ngược lại mọi tệp), tìm `DROP COLUMN`, `DROP TABLE`, `DROP SCHEMA`, `RENAME`, `ALTER COLUMN … TYPE`, `ALTER COLUMN … SET NOT NULL` không ở trong câu `CREATE TABLE` mới, mà không có chú thích `-- breaking-ok:` ngay dòng trên → in `tệp:dòng  câu lệnh  lý do`, mã thoát 1; kiểm thử `apps/server/test/lint-migrations.spec.ts` với 3 tệp mẫu trong `apps/server/test/fixtures/migrations/` (vi phạm, có `breaking-ok`, sạch)

**Checkpoint**: US2 kiểm chứng độc lập được.

---

## Phase 5: User Story 3 – Chính sách mẫu, bộ cột chuẩn, kiểm tra quy ước (Priority: P1)

**Goal**: khuôn `tenantTable` dùng lại được; `pnpm db:check` phát hiện mọi vi phạm (a)–(h) (+ i, j, k);
khóa lạc quan trả `VERSION_CONFLICT`.

**Independent Test**: thêm bảng thử có `account_id` không áp khuôn → `db:check` thất bại nêu bảng; áp
khuôn → đạt và kịch bản US1 đúng với bảng thử.

### Tests for User Story 3 ⚠️

- [X] T049 [P] [US3] `apps/server/test/db/table-template.db.spec.ts` – từ danh mục hệ thống của `sandbox.tenant_notes`: `account_id` NOT NULL, FK tới `account.accounts` với `confdeltype = 'c'`, `relrowsecurity = true`, chính sách `tenant_isolation` `polcmd = '*'` có cả `polqual` và `polwithcheck`, áp cho `app` và `system` (US3-AS1); chèn không truyền `id` → `id` là UUID phiên bản 7 (ký tự thứ 15 = `7`), `created_at`/`updated_at` có múi giờ UTC (US3-AS4); sửa dòng làm `updated_at` tăng
- [X] T050 [P] [US3] `apps/server/test/db/versioned.db.spec.ts` – hai `tenantTx` song song cùng `updateVersioned(..., { expectedVersion: 1 })` → đúng một thành công (`version = 2`), một ném `AppError` `VERSION_CONFLICT` HTTP 409 với thông điệp "Bài vừa được người khác sửa. Tải lại để xem bản mới nhất." và hành động `retry` (US3-AS5, FR-019)
- [X] T051 [P] [US3] `apps/server/test/db/account-deletion.db.spec.ts` – xóa dòng `account.accounts` của A bằng `owner` → mọi dòng của A trong `sandbox.tenant_notes` biến mất trong cùng giao dịch; dòng của B và các dòng `infra.audit_log` có `account_id = A` còn nguyên (Clarifications, edge case xóa hẳn tài khoản) – phần `audit_log` chạy được sau T062
- [X] T052 [US3] Tạo mẫu vi phạm `apps/server/test/db/fixtures/conventions/*.sql`, mỗi tệp gây đúng một vi phạm trên CSDL sạch (chạy bằng `owner`): `a-rls-missing.sql` (bảng `content.fx_a` có `account_id`, không RLS), `b-tenant-column-missing.sql` (bảng `content.fx_b` không `account_id`, không đăng ký), `c-cross-schema-fk.sql` (`content.fx_c` FK tới bảng của `publishing`), `d-index-not-tenant-first.sql`, `e-money-float.sql` (cột `cost_micro_usd double precision`), `f-not-owned-by-owner.sql` (`ALTER TABLE … OWNER TO postgres`), `g-app-privileges.sql` (`GRANT CREATE ON SCHEMA content TO "app"`), `h-fk-delete-rule.sql` (FK tới `accounts` không cascade), `i-support-view-leak.sql` (`GRANT SELECT ON sandbox.support_note_search TO "app"`), `j-unregistered-table.sql`, `k-reserved-schema-not-empty.sql` (bảng trong `approval`); mỗi tệp có cặp `*.expected.json` liệt kê `rule` mong đợi (một số tệp gây thêm `j` – ghi rõ); mẫu nào cần đăng ký bảng thì kèm `*.registry.json`
- [X] T053 [US3] `apps/server/test/db/conventions.db.spec.ts` – trên CSDL sạch sau migration: `checkConventions()` trả `violations: []` (SC-003 "0 báo sai"); với mỗi tệp mẫu: tạo CSDL tạm từ mẫu sạch (`CREATE DATABASE … TEMPLATE`), áp tệp, chạy kiểm tra (`--json`), khớp đúng tập `rule` trong `*.expected.json`; kiểm `pnpm db:check` trả mã 2 và không in chuỗi kết nối khi `DATABASE_OWNER_URL` trỏ cổng đóng (US2-AS4 được kiểm qua mẫu `c`)

### Implementation for User Story 3

- [X] T054 [US3] Tạo `apps/server/src/core/db/versioned.ts`: `updateVersioned(db, table, { id, expectedVersion }, values)` → `UPDATE … SET <values>, version = version + 1, updated_at = now() WHERE id = $id AND version = $expected RETURNING *`; bảng không có cột `version` → lỗi lúc gọi; 0 dòng → `AppError({ code: 'VERSION_CONFLICT', httpStatus: 409, message: 'Bài vừa được người khác sửa. Tải lại để xem bản mới nhất.', actions: [{ kind: 'retry', label: 'Tải lại' }] })` (research R13); xuất qua `apps/server/src/core/db/index.ts`
- [X] T055 [US3] Tạo `apps/server/src/db/check-conventions.ts`: hàm `checkConventions(client, { registry, manifest })` cài 11 quy tắc của contracts/db-conventions.md (truy vấn `pg_class`, `pg_namespace`, `pg_policy`, `pg_index`, `pg_constraint`, `pg_attribute`, `pg_roles`, `pg_auth_members`, `has_schema_privilege`, `has_table_privilege`, `pg_proc`), bỏ qua bảng con phân vùng (`relispartition`) và `infra.schema_migrations*`; `d` miễn chỉ mục trong `indexExceptions` có lý do không rỗng; nạp sổ đăng ký bằng cách nhập `src/core/db/tenant-root.ts`, mọi `src/modules/*/internal/db/schema.ts`, `*.log-table.ts`, và `test/db/sandbox/schema.ts` khi có schema `sandbox`; tham số `--registry-extra <tệp.json>` cho mẫu kiểm thử
- [X] T056 [US3] Thêm CLI vào `apps/server/src/db/check-conventions.ts`: kết nối `DATABASE_OWNER_URL`, in bảng tiếng Việt `schema · bảng · quy tắc · chi tiết` và dòng kết luận (`→ ĐẠT: 0 vi phạm` / `→ THẤT BẠI: N vi phạm`), `--json` in `{ violations, checked }`, mã thoát 0/1/2 (không kết nối được/thiếu cấu hình → 2, thông báo chỉ nêu tên biến) – contracts/db-conventions.md mục "Đầu ra"
- [X] T057 [US3] Viết `apps/server/docs/database.md` mục "Thêm bảng khách hàng" (từng bước: khai báo `tenantTable` trong `modules/<m>/internal/db/schema.ts` với ví dụ đầy đủ, `pnpm db:generate`, review SQL phải có `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY "tenant_isolation"`, `pnpm db:migrate`, `pnpm db:check`, thêm `describeCrossTenant` cho bảng mới), mục "Thêm bảng dùng chung" (`sharedTable` + `reason`, `REVOKE` quyền ghi nếu chỉ đọc), mục "Bảng nhật ký phân vùng" (DDL tay, tệp `*.log-table.ts`), mục "Cột tiền" (`microUsd`), mục "Khóa lạc quan" (`updateVersioned`) – FR-026, SC-005
- [X] T058 [US3] Xác nhận SC-005 bằng diễn tập: theo đúng `apps/server/docs/database.md` thêm bảng thử `content.dryrun_items` trên nhánh tạm, đo thời gian (≤ 15 phút), `db:check` đạt, rồi xóa bảng thử và migration thử; ghi kết quả và chỗ tài liệu còn thiếu (đã sửa) vào cuối `apps/server/docs/database.md` mục "Lịch sử diễn tập"

**Checkpoint**: US3 kiểm chứng độc lập được – cổng chất lượng CI số 2 có lệnh sẵn.

---

## Phase 6: User Story 4 – Ngữ cảnh hệ thống và hỗ trợ (Priority: P2)

**Goal**: `systemTx` (vai trò `system`) chịu cùng RLS; `supportSearch`/`supportViewAccount` chỉ đọc khung
nhìn và ghi kiểm toán; `app` không tắt được chính sách hay đổi vai trò.

**Independent Test**: `systemTx` không tenant đọc bảng mẫu → 0 dòng/lỗi dev; `systemTx` + A → chỉ dòng
A; `support` đọc bảng gốc → bị từ chối; mỗi lần mở ngữ cảnh hỗ trợ = đúng một dòng `audit_log`.

### Tests for User Story 4 ⚠️

- [X] T059 [P] [US4] `apps/server/test/db/system-context.db.spec.ts` – vai trò `system` không tenant đọc `sandbox.tenant_notes` → lỗi `TENANT_CONTEXT_MISSING` (test) (US4-AS1); `runWithJobContext({ accountId: A }, () => systemTx(fn, { tenant: 'from-context' }))` chỉ thấy/ghi dòng A, ghi dòng B → `DbPolicyViolationError` (AS2); `systemTx` lồng trong `tenantTx` → `TENANT_CONTEXT_CONFLICT`; `system` gọi được `infra.ensure_audit_log_partitions(2)`
- [X] T060 [P] [US4] `apps/server/test/db/support-context.db.spec.ts` – `support` `SELECT` trực tiếp `sandbox.tenant_notes` → `42501` (AS3); `supportViewAccount(actor, A, 'Khách báo lỗi đăng bài', fn)` đọc `sandbox.support_note_detail` chỉ thấy dòng A (AS4), không có cột `secret_note`; `supportSearch(actor, 'post_id', fn)` đọc `sandbox.support_note_search` thấy dòng của A và B nhưng chỉ có cột `account_id`, `object_id`, `status` (AS5); mỗi lần gọi tạo đúng 1 dòng `infra.audit_log` (đếm bằng `owner`) với `actor_type='support'`, `action` đúng, `keyword_type`/`reason` đúng, không có giá trị từ khóa; `fn` ném lỗi → không có dòng kiểm toán và không có kết quả; lý do < 5 ký tự → lỗi trước khi chạm CSDL (SC-007)
- [X] T061 [P] [US4] `apps/server/test/db/privileges.db.spec.ts` – bằng vai trò `app`: `SET ROLE "owner"`, `SET ROLE "system"` → bị từ chối; `ALTER TABLE sandbox.tenant_notes DISABLE ROW LEVEL SECURITY` → bị từ chối; `SET row_security = off` rồi `SELECT` bảng mẫu → lỗi; `SELECT`/`UPDATE`/`DELETE` trên `infra.audit_log` → bị từ chối, `INSERT` được (US4-AS6, FR-024); `INSERT`/`DELETE` trên `account.accounts` → bị từ chối

### Implementation for User Story 4

- [X] T062 [US4] Viết migration tay `apps/server/drizzle/migrations/0003_audit_log.sql`: `CREATE TABLE infra.audit_log (id uuid NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(), account_id uuid NULL, actor_type text NOT NULL CHECK (actor_type IN ('support','admin','system')), actor_id text NOT NULL, action text NOT NULL, keyword_type text NULL, reason text NULL, trace_id text NULL, metadata jsonb NULL, CHECK (action <> 'support.view_account' OR reason IS NOT NULL), PRIMARY KEY (occurred_at, id)) PARTITION BY RANGE (occurred_at)`; chỉ mục `(account_id, occurred_at)`; không FK tới `accounts`; `GRANT INSERT ON infra.audit_log TO "app","system","support"`; `ALTER TABLE infra.audit_log ENABLE ROW LEVEL SECURITY`; `CREATE POLICY audit_insert ON infra.audit_log FOR INSERT TO "app","system","support" WITH CHECK (true)` (chỉ có chính sách INSERT và không cấp SELECT/UPDATE/DELETE → bảng chỉ-thêm, cổng CI số 2 không cần ngoại lệ); hàm tạo phân vùng bật RLS trên mỗi phân vùng mới; hàm `infra.ensure_audit_log_partitions(months_ahead int DEFAULT 1) RETURNS void SECURITY DEFINER SET search_path = pg_catalog, infra` tạo `infra.audit_log_yYYYYmMM` cho tháng hiện tại (UTC) → +`months_ahead` nếu chưa có; `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO "system"`; cuối tệp `SELECT infra.ensure_audit_log_partitions(1);` (data-model mục 7)
- [X] T063 [P] [US4] Tạo `apps/server/src/core/db/audit-log.log-table.ts`: định nghĩa Drizzle `infra.audit_log` bằng `partitionedLogTable(moduleSchema('infra'), 'audit_log', …, { partitionBy: 'occurred_at' })` khớp T062 (chỉ để chèn có kiểu); kiểm tra `drizzle.config.ts` không bao gồm tệp này (chạy `pnpm db:generate` → "No schema changes")
- [X] T064 [US4] Thêm migration dev tay `apps/server/drizzle/migrations-dev/0001_support_views.sql`: `CREATE VIEW sandbox.support_note_search AS SELECT account_id, id AS object_id, status FROM sandbox.tenant_notes WHERE deleted_at IS NULL`; `CREATE VIEW sandbox.support_note_detail AS SELECT account_id, id, title, status, created_at, updated_at FROM sandbox.tenant_notes WHERE account_id = account.current_account_id()`; chủ `owner`, KHÔNG `security_invoker`; `GRANT SELECT` hai khung nhìn chỉ cho `"support"` (data-model mục 8, research R11)
- [X] T065 [US4] Trong `apps/server/src/core/db/transaction.ts` cài `systemTx(fn, { tenant = 'none' })`: chỉ có khi bể `system` tồn tại (API gọi → lỗi rõ "systemTx chỉ dùng ở Worker"); `'from-context'` lấy `accountId` từ `getExecutionContext()` (thiếu → `TENANT_CONTEXT_MISSING`); `'none'` → giao dịch không tenant có bộ gác (T040); quy tắc lồng như `tenantTx` (FR-022)
- [X] T066 [US4] Viết migration tay `apps/server/drizzle/migrations/0004_account_exists.sql`: `CREATE FUNCTION account.account_exists(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, account AS $$ SELECT EXISTS (SELECT 1 FROM account.accounts WHERE id = p_id AND deleted_at IS NULL) $$`; `REVOKE ALL … FROM PUBLIC`; `GRANT EXECUTE … TO "support"` (chỉ trả đúng/sai, không lộ cột nào – data-model mục 3)
- [X] T067 [US4] Tạo `apps/server/src/core/db/support.ts`: `supportSearch(actor, keywordType, fn)` – giao dịch trên bể `support`, không tenant, bộ gác bật, chèn `infra.audit_log` (`actor_type: 'support'`, `actor_id: actor.staffId`, `action: 'support.search'`, `keyword_type`, `trace_id`) TRƯỚC khi chạy `fn`; `supportViewAccount(actor, accountId, reason, fn)` – kiểm `reason.trim().length >= 5`, mở giao dịch có tenant `accountId` trên bể `support` (`support` không có quyền trên `account.accounts`, nên `runTx` với vai trò `support` kiểm tồn tại bằng `SELECT account.account_exists(account.current_account_id())` thay cho `SELECT 1 FROM account.accounts`; sai → `TENANT_NOT_FOUND`), chèn kiểm toán `action: 'support.view_account'`, `account_id`, `reason`; không có bể `support` → `AppError` `SERVICE_UNAVAILABLE`; xuất qua `apps/server/src/core/db/index.ts` (FR-023, research R11)
- [X] T068 [US4] Viết `apps/server/docs/database.md` mục "Ngữ cảnh tenant / hệ thống / hỗ trợ": khi nào dùng `tenantTx`, `systemTx` (`'none'` vs `'from-context'`), `supportSearch`, `supportViewAccount`; cảnh báo khung nhìn do `owner` sở hữu vượt RLS – chỉ cấp cho `support` (quy tắc `i`); cách thêm khung nhìn hỗ trợ thật; nhật ký kiểm toán không lưu giá trị từ khóa (FR-026)

**Checkpoint**: cả bốn story hoạt động và kiểm chứng độc lập.

---

## Phase 7: Polish & Cross-Cutting

- [X] T069 [P] `apps/server/test/db/performance.db.spec.ts` – đo 500 lần `SELECT 1` trong giao dịch có ngữ cảnh (`tenantTx`) và 500 lần trong giao dịch thô không ngữ cảnh trên cùng bể; in p50/p95; khẳng định chênh lệch p95 ≤ 5 ms (SC-006)
- [X] T070 [P] `apps/server/test/db/secrets-in-logs.db.spec.ts` – chạy lại các luồng chính (khởi tạo bể, lỗi kết nối tới cổng đóng, lỗi xác thực mật khẩu sai, lỗi chính sách, `db:check` mã 2) với `captureLogs()` và thu stdout/stderr tiến trình con; khẳng định không chuỗi nào chứa giá trị `DB_ROLE_PASSWORD_*` đang dùng hoặc mẫu `postgres(ql)?://[^@\s]+:[^@\s]+@` (SC-008)
- [X] T071 Sửa `tooling/verify.mjs`: thêm bước `db:lint-migrations` và `test:db`; một bước có thể trả trạng thái "bỏ qua" (vd lệnh in dòng `SKIPPED:` hoặc mã thoát đặc biệt) – `test:db` khi thiếu `TEST_DATABASE_ADMIN_URL` hiện `– bỏ qua   (chưa có CSDL kiểm thử)` và không tính vào lỗi/đạt; khi có biến thì chạy thêm `pnpm db:check` trên CSDL kiểm thử; cập nhật `tooling/test/verify.spec.ts` cho trạng thái bỏ qua (FR-021)
- [X] T072 [P] Cập nhật `.specify/memory/architecture.md` lên v1.2: mục 5 – vai trò `system` đặt được ngữ cảnh tenant và chịu RLS (bỏ "không đọc nội dung bài"; giữ "bộ đếm qua hàm `SECURITY DEFINER`" là khuyến nghị), biểu thức RLS dùng `account.current_account_id()` + `nullif`; mục 11 – thêm thuật ngữ mới từ `research.md` ("Thuật ngữ mới"); ghi dòng thay đổi ở đầu tệp
- [X] T073 [P] Sửa câu chữ `TaiLieuDacTa/ADR_App_AI_Content_MXH.md` ADR-02: "mỗi kết nối đặt biến phiên = mã tài khoản" → "mỗi giao dịch đặt biến phiên phạm vi giao dịch = mã tài khoản"; và `TaiLieuDacTa/Kien_truc_Du_lieu_Cache_App_AI_Content_MXH.md` mục 6 dòng `he_thong`: bổ sung "đặt được ngữ cảnh tenant của một tài khoản cho việc theo tài khoản; khi đó chịu cùng chính sách bảo mật mức dòng" (Complexity Tracking của plan); ghi chú lý do "theo Clarifications 2026-11-07 của đặc tả 002"
- [X] T074 [P] Cập nhật `README.md` gốc: mục "CSDL cục bộ" (`pnpm db:up`, `pnpm db:setup`, `pnpm db:check`, `pnpm test:db` với `TEST_DATABASE_ADMIN_URL`), liên kết `apps/server/docs/database.md`; cập nhật `CLAUDE.md` mục Gotchas: "Biến `app.account_id` sau giao dịch thành chuỗi rỗng – luôn dùng `account.current_account_id()`; module chỉ truy cập CSDL qua `tenantTx`/`systemTx`/`support*`"
- [X] T075 Chạy `pnpm lint`, `pnpm typecheck`, `pnpm check:boundaries`, `pnpm verify` (có và không có `TEST_DATABASE_ADMIN_URL`); sửa mọi lỗi
- [X] T076 Chạy toàn bộ `specs/002-db-layer-tenant-rls/quickstart.md` mục 1–5 trên compose (gồm `docker compose up --build -d`, dừng `postgres` → `/readyz` 503, đặt `DATABASE_APP_URL` bằng vai trò `owner` → API thoát mã 1); ghi kết quả từng bước
- [X] T077 Rà soát hiến pháp bằng skill `/constitution-review` trên toàn bộ thay đổi (đặc biệt nguyên tắc I, IV, VII) và sửa phát hiện trước khi kết thúc

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: không phụ thuộc. T001 trước T002, T006.
- **Foundational (Phase 2)**: sau Setup; CHẶN mọi story. Thứ tự lõi: T008 → T011 → T012 → T013 → T014 → T015; T016 → T017 → T018 → T019/T020 → T021 → T022 → T023 → T024 → T025 → T026 → T027 → T028 → T029 → T030. T009, T010 sau T008.
- **US1 (Phase 3)**: sau Phase 2. T036 → T037; T038 → T039 → T040 → T041 → T042.
- **US2 (Phase 4)**: sau Phase 2; độc lập với US1 (chỉ cần migrator + bootstrap). T046 sau T043.
- **US3 (Phase 5)**: sau Phase 2; kiểm thử dùng `tenantTx` (T050) → cần T039 của US1. T052 → T053 → T055 → T056.
- **US4 (Phase 6)**: sau US1 (dùng `runTx`, bộ gác, `ExecutionContext`). T062 → T063; T064 trước T060; T065, T066 sau T062; T066 trước T067.
- **Polish (Phase 7)**: sau các story mong muốn. T075 → T076 → T077 cuối cùng.

### User Story Dependencies

- **US1 (P1)**: chỉ phụ thuộc Phase 2 – MVP.
- **US2 (P1)**: chỉ phụ thuộc Phase 2.
- **US3 (P1)**: Phase 2; riêng T050 cần `tenantTx` (US1). Phần `db:check` độc lập.
- **US4 (P2)**: cần US1 (giao dịch, bộ gác). T051 (US3) phần `audit_log` cần T062.

### Within Each User Story

- Kiểm thử viết trước và phải thất bại → cài đặt → kiểm thử đạt.
- Migration trước mã dùng bảng; lõi giao dịch trước thao tác cấp cao.

### Parallel Opportunities

- Phase 1: T003, T004, T005, T006, T007 song song (sau T001).
- Phase 2: T011 ∥ T012; T020 ∥ T019; T030 sau T029.
- US1: T031–T035 song song (khác tệp).
- US2: T043, T044, T045 song song; US2 làm song song với US1 được.
- US3: T049, T050, T051 song song; `db:check` (T052–T056) song song với US1.
- US4: T059, T060, T061 song song; T063 ∥ T064.
- Polish: T069, T070, T072, T073, T074 song song.

---

## Parallel Example: User Story 1

```text
Task: "T031 tenant-isolation.db.spec.ts – truy cập chéo 4 thao tác × 2 chiều"
Task: "T032 context-leak.db.spec.ts – không rò ngữ cảnh, 1.000 vòng"
Task: "T033 tenant-context-errors.db.spec.ts – mã tài khoản sai, lồng, ngắt kết nối"
Task: "T034 out-of-context.db.spec.ts – dev/test ném lỗi, production 0 dòng + cảnh báo"
Task: "T035 logging-context.db.spec.ts – account_id trong nhật ký"
```

## Parallel Example: User Story 4

```text
Task: "T059 system-context.db.spec.ts"
Task: "T060 support-context.db.spec.ts"
Task: "T061 privileges.db.spec.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup → Phase 2 Foundational (CSDL dựng được, bảng mẫu có RLS).
2. Phase 3 US1 → `pnpm test:db` T031–T035 đạt.
3. **Dừng và kiểm chứng**: quickstart mục 1 và 3 (phần US1). Đây là lớp chặn hai tầng của nguyên tắc I.

### Incremental Delivery

1. Setup + Foundational → nền sẵn.
2. US1 → cô lập tenant (MVP).
3. US2 → migration/quyền được kiểm chứng; `db:lint-migrations`.
4. US3 → `db:check` + khóa lạc quan + tài liệu thêm bảng (mở khóa các module nghiệp vụ).
5. US4 → ngữ cảnh hệ thống/hỗ trợ + `audit_log` (mở khóa WBS 1.3 và màn hình hỗ trợ).
6. Polish → `verify`, tài liệu kiến trúc, quickstart, rà soát hiến pháp.

### Parallel Team Strategy

Sau Phase 2: người A làm US1 (rồi US4), người B làm US2 + phần `db:check` của US3.

---

## Notes

- [P] = khác tệp, không phụ thuộc việc chưa xong.
- Không commit `.env`; mọi URL/mật khẩu đánh dấu `secret()`; không bao giờ ghi `err.message` thô của `pg`
  khi lỗi kết nối.
- Không dùng `drizzle-kit push`. Mọi migration được review như mã.
- Không chạy docker compose ở cả checkout chính và worktree cùng lúc (cổng 3000/3001/8080/5432).
