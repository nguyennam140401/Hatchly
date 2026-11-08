# Implementation Plan: Lớp CSDL – schema theo module, ngữ cảnh tenant trong giao dịch, RLS mẫu

**Branch**: `002-db-layer-tenant-rls` | **Date**: 2026-11-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-db-layer-tenant-rls/spec.md`

## Summary

Thêm lớp CSDL vào `apps/server` (WBS 1.2): **Drizzle trên `pg`**, mỗi module một `pgSchema` lấy từ
`modules.manifest.json` (11 schema), migration do `drizzle-kit` sinh + SQL viết tay, chạy bằng vai trò
`owner` tách khỏi tiến trình ứng dụng. Lõi `core/db` cung cấp **ba hàm dựng bảng** (`tenantTable`,
`sharedTable`, `partitionedLogTable`) kèm bộ cột chuẩn và chính sách `tenant_isolation`
(`account_id = account.current_account_id()`, hàm dùng `nullif(current_setting('app.account_id', true),
'')` để mặc định an toàn); **giao dịch tự quản** trên `PoolClient` đặt biến phiên **phạm vi giao dịch**,
kiểm tra tài khoản, chặn lồng khác tenant và hủy kết nối lỗi; module chỉ có `tenantTx` / `systemTx` /
`supportSearch` / `supportViewAccount`, không có thể hiện CSDL "trần". `accountId` chỉ đến từ
`ExecutionContext` (phiên đăng nhập hoặc dữ liệu việc). Bốn vai trò `owner`/`app`/`system`/`support`
tạo bằng bước bootstrap; `infra.audit_log` phân vùng theo tháng; schema `sandbox` (chỉ dev/test) chứa
bảng mẫu và khung nhìn hỗ trợ mẫu. Lệnh `pnpm db:check` kiểm 11 quy tắc quy ước trên danh mục hệ thống;
kiểm thử tích hợp chạy trên PostgreSQL thật.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict) trên Node.js 24 LTS – như 001

**Primary Dependencies**: `drizzle-orm` + `drizzle-kit` (dev), `pg` + `@types/pg` – khóa phiên bản chính
xác (R1). Dùng lại NestJS 11, Zod 4, pino của 001. Không thêm thư viện UUID (dùng `core/ids/uuid-v7`).

**Storage**: PostgreSQL 17 cục bộ (`postgres:17-alpine`, đổi được bằng `POSTGRES_IMAGE`); mã chỉ dùng
tính năng có từ PostgreSQL 13 (hiến pháp: ≥ 13)

**Testing**: Vitest. Kiểm thử đơn vị trong `pnpm test` như cũ; kiểm thử tích hợp CSDL
`test/db/**/*.db.spec.ts` chạy bằng `pnpm test:db` trên CSDL tạm tạo từ `TEST_DATABASE_ADMIN_URL`, tuần
tự (R16). Mẫu vi phạm quy ước dạng tệp SQL.

**Target Platform**: Container Linux trên Kubernetes; máy phát triển Windows 10/11 và Linux

**Project Type**: Web application – monorepo (thay đổi chỉ ở `apps/server`, `packages/shared` (mã lỗi),
`tooling/verify.mjs`, `docker-compose.yml`)

**Performance Goals**: đặt ngữ cảnh tenant thêm ≤ 5 ms p95 (SC-006, dự kiến 2 câu lệnh < 1 ms mỗi câu
cục bộ); migration từ trống ≤ 1 phút (SC-004)

**Constraints**: biến phiên phạm vi giao dịch (hiến pháp I); API/Worker không bao giờ có chuỗi kết nối
`owner`; không cache gì liên quan quyền/tenant; migration tương thích ngược; không in chuỗi kết nối/mật
khẩu; lõi không nhập module (`core-no-modules`)

**Scale/Scope**: 11 schema, 1 bảng gốc, 1 bảng nhật ký phân vùng, 1 bảng mẫu + 2 khung nhìn, 2 hàm
SQL, 4 vai trò, 11 quy tắc kiểm tra, ~8 lệnh `db:*`

Không còn mục NEEDS CLARIFICATION – các điểm spec để cho plan (trình điều khiển, UUID v7, phát hiện
truy vấn ngoài ngữ cảnh) đã chốt ở `research.md` R1, R14, R5.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Nguyên tắc | Áp dụng vào tính năng | Đánh giá |
|---|---|---|
| I. Cô lập tenant | `account_id NOT NULL` + FK cascade + chỉ mục đầu `account_id` qua `tenantTable`; RLS `tenant_isolation` cho `app`, `system`; biến `app.account_id` **phạm vi giao dịch**; thiếu biến → `nullif` → NULL → 0 dòng; `app` không có `BYPASSRLS`, không sở hữu bảng, không `SET ROLE` được; `accountId` chỉ từ `ExecutionContext` (phiên/việc), không có tham số `accountId` trên `tenantTx`; tự kiểm vai trò khi khởi động; `support` chỉ đọc khung nhìn, mỗi lần xem ghi `infra.audit_log`; kiểm thử truy cập chéo + `db:check` (cổng CI số 1, 2 – lệnh sẵn, gắn CI ở WBS 1.4) | ✅ Đạt |
| II. Đăng bài tin cậy | Không chạm luồng đăng. Cung cấp nền cho nó: cập nhật có điều kiện (`updateVersioned`), giao dịch có ngữ cảnh mà pg-boss dùng chung được (R1) | ✅ Không áp dụng trực tiếp |
| III. Cổng AI & ngân sách | Kiểu `microUsd` = `bigint`; quy tắc `e-money-float` chặn số thực; không cache ngân sách. Hàm giữ chỗ thuộc `ai_gateway` | ✅ Đạt |
| IV. Modular monolith | Schema lấy từ tệp kê khai; bảng của module nằm trong `modules/<m>/internal/db` (ranh giới 001 chặn nhập chéo); FK chỉ nội bộ schema hoặc tới `account.accounts` (quy tắc `c`, `h`); `approval` để trống (quy tắc `k`). `account.accounts` đặt ở lõi (R9) – xem Theo dõi độ phức tạp | ✅ Đạt (có ghi chú) |
| V. Việc nền bền vững | `ExecutionContext` + `runWithJobContext` là điểm móc để Worker đặt lại ngữ cảnh (WBS 1.3); `systemTx` cho việc dùng chung; bể đóng sau khi việc đang chạy xong | ✅ Đạt |
| VI. AI đề xuất, con người quyết định | `VERSION_CONFLICT` có thông điệp tiếng Việt + hành động "Tải lại"; lỗi tenant chỉ lộ mã ở `support.detail` | ✅ Đạt |
| VII. Bí mật & dữ liệu cá nhân | URL CSDL đánh dấu `secret()`; lỗi kết nối chỉ ghi mã (R15); mật khẩu vai trò không nằm trong migration; xóa tài khoản → xóa dây chuyền; `audit_log` không lưu giá trị từ khóa tìm kiếm, cho phép ẩn danh hóa; dữ liệu ở PostgreSQL trong nước (không thêm bên nhận) | ✅ Đạt |
| VIII. Quan sát được | `account_id` trong nhật ký đọc từ ngữ cảnh giao dịch/`ExecutionContext` (FR-007); sự kiện `db.tenant_context_missing` có cấu trúc; `/readyz` có kiểm tra `database`; thao tác hỗ trợ ghi kiểm toán | ✅ Đạt |
| IX. Đơn giản, chuẩn mở | Chỉ PostgreSQL + Drizzle (đã chốt); không thêm công cụ migration/Testcontainers/cache; thư viện khóa phiên bản, bọc sau `core/db` | ✅ Đạt |

**Quy ước dữ liệu**: UUID v7 sinh ở ứng dụng ✅ · `timestamptz` UTC (`TimeZone=UTC` trên bể) ✅ · tiền
`bigint` micro-USD ✅ · `deleted_at` / `version` tùy chọn trong bộ cột chuẩn ✅ · nhật ký xóa theo phân
vùng ✅ · không cache quyền/hạn mức ✅.

**Quy trình**: migration tương thích ngược – hướng dẫn + `db:lint-migrations` (R17) ✅.

**Kiểm tra lại sau Phase 1** (`data-model.md`, `contracts/`): không thêm hạ tầng; mọi đối tượng thuộc
`owner`; `support` không có quyền trên bảng gốc; khung nhìn hỗ trợ (vượt RLS vì do `owner` sở hữu) chỉ
cấp cho `support` và có quy tắc `i-support-view-leak` canh; mọi bảng có `account_id` đều bật RLS, kể cả
`infra.audit_log` (chính sách `audit_insert` chỉ cho INSERT) – cổng CI số 2 không có ngoại lệ. **Đạt.**

**Checklist kiến trúc** (`architecture.md` mục 13): module & giao diện công khai ✅ (lõi `core/db`,
bảng trong `internal/`) · bảng mới có `account_id` + RLS + kiểm thử truy cập chéo ✅ · việc nền – điểm
móc `runWithJobContext` ✅ · AI – không có · bộ đếm/chuyển trạng thái – `updateVersioned` có điều kiện ✅
· không thêm hạ tầng ✅ · không log bí mật ✅ · migration tương thích ngược ✅.

## Project Structure

### Documentation (this feature)

```text
specs/002-db-layer-tenant-rls/
├── plan.md              # Tệp này
├── research.md          # Phase 0 – quyết định R1–R17 + thuật ngữ mới
├── data-model.md        # Phase 1 – schema, vai trò/quyền, bảng, sổ đăng ký, trạng thái giao dịch
├── quickstart.md        # Phase 1 – kịch bản kiểm chứng
├── contracts/
│   ├── db-layer-api.md      # Giao diện core/db cho module
│   ├── db-conventions.md    # Quy tắc db:check (a–k), đầu ra, mã thoát
│   └── db-commands.md       # Lệnh db:*, biến môi trường, compose, /readyz
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks – chưa tạo)
```

### Source Code (repository root)

```text
apps/server/
├── package.json                 # + pg, drizzle-orm; dev: drizzle-kit, @types/pg; scripts db:*, test:db
├── drizzle.config.ts            # schema: src/core/db/tenant-root.ts + src/modules/*/internal/db/schema.ts
├── drizzle.dev.config.ts        # schema: test/db/sandbox/schema.ts → drizzle/migrations-dev
├── drizzle/
│   ├── bootstrap/roles.sql      # vai trò + quyền CSDL (R6) – dùng chung cho dev và hạ tầng WBS 1.5
│   ├── migrations/              # 0000_schemas_grants.sql (tay, gồm current_account_id) · 0001_accounts.sql (sinh)
│   │                            # 0002_accounts_grants.sql · 0003_audit_log.sql · 0004_account_exists.sql (tay) · meta/_journal.json
│   └── migrations-dev/          # sandbox: tenant_notes + 2 khung nhìn + quyền
├── docs/database.md             # Hướng dẫn tiếng Việt (FR-026)
├── vitest.db.config.mts         # kiểm thử CSDL, tuần tự, globalSetup tạo CSDL tạm
├── .env.example                 # + DATABASE_* , DB_ROLE_PASSWORD_* (giá trị *_dev_only)
├── src/
│   ├── core/
│   │   ├── config/config.schema.ts      # + DATABASE_APP_URL, _SYSTEM_URL, _SUPPORT_URL, pool/timeout
│   │   ├── context/
│   │   │   ├── request-context.ts       # → ExecutionContext (traceId, accountId?, source)
│   │   │   └── bind-account.ts          # bindAccountToRequest, runWithJobContext (ranh giới hạn chế)
│   │   ├── logging/logging.module.ts    # mixin account_id ← currentAccountId()
│   │   ├── db/
│   │   │   ├── index.ts                 # giao diện công khai của lớp CSDL (contracts/db-layer-api.md)
│   │   │   ├── roles.ts                 # pgRole(...).existing()
│   │   │   ├── module-schema.ts         # moduleSchema() đối chiếu tệp kê khai
│   │   │   ├── tenant-root.ts           # account.accounts + current_account_id (R9)
│   │   │   ├── table-builders.ts        # tenantTable, sharedTable, partitionedLogTable, microUsd
│   │   │   ├── table-registry.ts        # sổ đăng ký bảng
│   │   │   ├── pools.ts                 # bể theo vai trò, TimeZone=UTC, timeout, tự kiểm vai trò (R7)
│   │   │   ├── transaction.ts           # tenantTx, systemTx, ALS TxContext, lồng, hủy kết nối (R4)
│   │   │   ├── query-guard.ts           # bộ gác bảng tenant trong giao dịch không tenant (R5)
│   │   │   ├── support.ts               # supportSearch, supportViewAccount + audit (R11)
│   │   │   ├── versioned.ts             # updateVersioned → VERSION_CONFLICT (R13)
│   │   │   ├── errors.ts                # TenantContextError, DbPolicyViolationError, chuẩn hóa lỗi pg
│   │   │   ├── database.module.ts       # NestJS: tạo DatabaseService, /readyz, đóng khi shutdown
│   │   │   └── audit-log.log-table.ts   # định nghĩa truy vấn infra.audit_log (ngoài glob drizzle-kit)
│   │   └── index.ts                     # + xuất core/db công khai
│   ├── db/                              # script chạy riêng (biên dịch vào dist/db/*)
│   │   ├── script-config.ts             # lược đồ biến cho script (DATABASE_OWNER_URL, ...)
│   │   ├── bootstrap.ts
│   │   ├── migrate.ts                   # migrator + pg_advisory_lock, migrations-dev theo APP_ENV
│   │   ├── setup-dev.ts                 # bootstrap + migrate
│   │   ├── check-conventions.ts         # db:check (contracts/db-conventions.md)
│   │   └── lint-migrations.ts           # db:lint-migrations (R17)
│   ├── app/api-app.module.ts, worker-app.module.ts   # + DatabaseModule.forRoot(unit)
│   └── modules/<m>/internal/db/.gitkeep # chỗ đặt schema.ts của từng module (chưa có bảng)
└── test/
    ├── config.spec.ts                   # + biến DATABASE_* (bí mật không bị in)
    └── db/
        ├── global-setup.ts              # tạo/xóa app_test_<ngẫu nhiên>, bootstrap + migrate
        ├── helpers/                     # tạo tài khoản bằng owner, khuôn kiểm thử truy cập chéo dùng lại (FR-025)
        ├── sandbox/schema.ts            # định nghĩa sandbox.tenant_notes bằng tenantTable
        ├── fixtures/conventions/*.sql   # một vi phạm mỗi quy tắc a–k
        ├── migrate.db.spec.ts           # US2
        ├── tenant-isolation.db.spec.ts  # US1, SC-001, SC-002
        ├── table-template.db.spec.ts    # US3 (cột chuẩn, UUID v7, version)
        ├── system-support.db.spec.ts    # US4, SC-007
        ├── privileges.db.spec.ts        # US4-AS6, quy tắc g
        ├── conventions.db.spec.ts       # SC-003
        ├── performance.db.spec.ts       # SC-006
        └── secrets-in-logs.db.spec.ts   # SC-008

packages/shared/src/core/error-response.ts   # + VERSION_CONFLICT trong ERROR_CODES
tooling/verify.mjs                           # + bước db:lint-migrations, test:db (trạng thái "bỏ qua")
tooling/boundaries/build-rules.cjs           # + quy tắc: chỉ modules/queue, core/auth, test nhập bind-account
package.json (gốc)                           # + db:up, db:setup, db:migrate, db:check, ... (chuyển tiếp @app/server)
docker-compose.yml                           # postgres luôn bật, dịch vụ migrate, DATABASE_* cho api/worker
.specify/memory/architecture.md              # v1.2: mục 5 vai trò system, mục 11 thuật ngữ mới
TaiLieuDacTa/ADR_App_AI_Content_MXH.md       # ADR-02: "mỗi giao dịch" thay "mỗi kết nối" (sửa câu chữ)
```

**Structure Decision**: giữ monorepo của 001. Toàn bộ lớp CSDL nằm trong lõi `apps/server/src/core/db`
(module dùng qua `core/index.ts`), script vận hành ở `apps/server/src/db` để biên dịch vào cùng ảnh
container và chạy như Job riêng. Định nghĩa bảng của từng module nằm trong `internal/db/` của module –
quy tắc ranh giới sẵn có của 001 bảo đảm FR-003 mà không cần quy tắc mới. Schema `sandbox` và định nghĩa
của nó nằm dưới `test/` để không bao giờ lọt vào migration chính.

## Phạm vi giao cho đầu việc sau

| Nội dung | Đầu việc |
|---|---|
| Worker gọi `runWithJobContext` khi lấy việc; việc định kỳ gọi `infra.ensure_audit_log_partitions` và bỏ phân vùng > 12 tháng; pg-boss dùng chung giao dịch | WBS 1.3 |
| Gắn `db:check`, `db:lint-migrations`, `test:db` vào CI; mở rộng khuôn kiểm thử truy cập chéo cho mọi bảng | WBS 1.4 |
| Tạo vai trò/mật khẩu ở môi trường thật bằng `drizzle/bootstrap/roles.sql`; Job migrate trước Deployment | WBS 1.5 |
| Guard xác thực gọi `bindAccountToRequest`; đường đăng ký tài khoản; hàm `SECURITY DEFINER` cho bộ đếm và ẩn danh hóa | WBS 2.1 / module `account` |
| Khung nhìn hỗ trợ thật, mã nhân viên, màn hình hỗ trợ | FR-10 của đặc tả gốc |

## Complexity Tracking

| Điểm lệch / đánh đổi | Vì sao cần | Phương án đơn giản hơn bị loại vì |
|---|---|---|
| Vai trò `system` đặt được ngữ cảnh tenant và khi đó đọc/ghi dữ liệu của đúng tài khoản ấy – khác Kiến trúc dữ liệu mục 6 và `architecture.md` mục 5 ("không đọc nội dung bài", "ghi bộ đếm qua hàm riêng") | Clarifications 2026-11-07: việc dùng chung như chia chi phí xu hướng cần ghi vào từng tài khoản; nguyên tắc I vẫn giữ vì `system` chịu cùng chính sách `tenant_isolation`, mỗi giao dịch một tài khoản | Chỉ cho `system` dùng hàm `SECURITY DEFINER` cho mọi thao tác theo tài khoản – mỗi thao tác một hàm SQL, nhiều mã SQL ngoài Drizzle, khó kiểm thử; dùng `app` cho việc hệ thống – mất ranh giới quyền ghi schema dùng chung. **Việc kèm theo**: sửa Kiến trúc dữ liệu mục 6 và `architecture.md` mục 5 cho khớp (tasks) |
| `account.accounts` định nghĩa ở lõi `core/db` chứ không ở `modules/account` | `tenantTable` (ở lõi) phải tham chiếu bảng này để sinh FK; lõi không được nhập module (quy tắc `core-no-modules` của 001) | FK bằng SQL thô – drizzle-kit không biết, sinh migration sai; ngoại lệ ranh giới cho lõi – phá quy tắc tự động của 001 |
| Vai trò tạo bằng bước bootstrap riêng, không bằng migration (US2 viết "sau lệnh migration có đủ 4 vai trò") | Vai trò cấp cụm cần `CREATEROLE`; cho `owner` quyền đó thì `owner` tạo được vai trò vượt RLS; mật khẩu không được nằm trong kho | Migration tạo vai trò – xem R6. `pnpm db:setup` gộp hai bước nên kịch bản US2 vẫn kiểm bằng một lệnh |
| Không bật `FORCE ROW LEVEL SECURITY` | Migration dữ liệu của `owner` không phải đặt ngữ cảnh từng tenant; drizzle-kit không sinh `FORCE` | Thay bằng: API/Worker không có chuỗi kết nối `owner`, tự kiểm vai trò khi khởi động, quy tắc `f`, `g` (R7) |
| Spec FR-009/US2-AS1 ghi 9 schema, không có `approval` | Đã cập nhật spec theo tệp kê khai và `architecture.md` v1.1 (11 schema) – spec đã dự liệu thay đổi này | — |
