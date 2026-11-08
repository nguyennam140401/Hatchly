---

description: "Danh sách nhiệm vụ triển khai – 001 Kho mã nguồn chung chia module"
---

# Tasks: Kho mã nguồn chung chia module

**Input**: Tài liệu thiết kế trong `specs/001-monorepo-module-skeleton/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R17), data-model.md, contracts/, quickstart.md

**Tests**: CÓ – spec yêu cầu kiểm thử mẫu (FR-019), bộ mẫu vi phạm ranh giới (SC-002), kiểm thử tắt
Worker 10 lần (SC-004), nhiều Worker (SC-009). Viết kiểm thử trước, xác nhận thất bại rồi mới cài đặt.

**Organization**: Nhiệm vụ nhóm theo user story để làm và kiểm thử độc lập.

**Quy ước chung cho mọi nhiệm vụ**:
- Định danh tiếng Anh; chú thích mã tiếng Việt (FR-022). Phạm vi gói `@app/*`.
- Phụ thuộc npm: cài bản ổn định mới nhất **tại thời điểm cài**, ghi **số chính xác** (không `^`/`~`)
  theo major tối thiểu trong research.md (FR-020).
- Mọi lệnh phải chạy được trên Windows và Linux – script viết bằng Node, không dùng cú pháp shell riêng.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Chạy song song được (khác tệp, không phụ thuộc nhiệm vụ chưa xong)
- **[Story]**: User story của nhiệm vụ (US1…US4)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Khởi tạo workspace và công cụ dùng chung

- [X] T001 Tạo `package.json` gốc (`"name": "app-root"`, `"private": true`, `"packageManager": "pnpm@10.<x>.<y>"` chính xác, `"engines": { "node": ">=24 <25" }`, script giữ chỗ `dev:api`, `dev:worker`, `dev:web`, `build`, `build:shared`, `start:api`, `start:worker`, `typecheck`, `lint`, `check:boundaries`, `check:web-bundle`, `test`, `verify` – nội dung điền ở các nhiệm vụ sau) và `pnpm-workspace.yaml` với `packages: ["apps/*", "packages/*", "tooling"]` ở gốc kho
- [X] T002 [P] Tạo `.npmrc` (`save-exact=true`, `engine-strict=true`, `inject-workspace-packages=true` – bắt buộc để `pnpm deploy` của pnpm 10 đóng gói `@app/shared` vào ảnh, R14), `.nvmrc` (`24`), `.gitattributes` (`* text=auto eol=lf`), `.editorconfig` (UTF-8, LF, 2 dấu cách) ở gốc kho; `.gitignore` hiện có đã đủ (node_modules, dist, .env, coverage) – không sửa
- [X] T003 [P] Tạo `tsconfig.base.json` ở gốc: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `useUnknownInCatchVariables`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`, `skipLibCheck`, `target: ES2023`, `composite: true` (R11)
- [X] T004 [P] Tạo `eslint.config.mjs` (ESLint 9 flat config, `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked`, `parserOptions.projectService: true`, khối riêng cho `apps/web/**` với `eslint-plugin-react-hooks`, bỏ qua `**/dist/**`, `tooling/boundaries/fixtures/**`), `.prettierrc.json` (`singleQuote`, `printWidth: 100`, `trailingComma: "all"`), `.prettierignore` ở gốc
- [X] T005 Tạo khung bốn gói với `package.json` (`private: true`) và `tsconfig.json` kế thừa `tsconfig.base.json`: `packages/shared` (`@app/shared`, phụ thuộc chạy thật duy nhất `zod` 4; dev: `tsup`, `vitest`), `apps/server` (`@app/server`, `@nestjs/common|core|platform-express` 11, `reflect-metadata`, `rxjs`, `pino`, `nestjs-pino`, `pino-http`, `zod`, `@app/shared: "workspace:*"`; dev: `@nestjs/testing`, `supertest`, `vitest`, `unplugin-swc`, `@swc/core`, `pino-pretty`, `tsx`; tsconfig thêm `experimentalDecorators`, `emitDecoratorMetadata`, `module: commonjs`), `apps/web` (`@app/web`, `react` 19, `react-dom`, `@app/shared: "workspace:*"`; dev: `vite`, `@vitejs/plugin-react`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`), `tooling` (`@app/tooling`; dev: `dependency-cruiser`, `vitest`); thêm ở gốc dev: `typescript` 5.9+, `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`, `prettier`; chạy `pnpm install` để sinh `pnpm-lock.yaml`
- [X] T006 [P] Tạo cấu hình Vitest cho từng gói: `packages/shared/vitest.config.ts`, `apps/server/vitest.config.ts` (plugin `unplugin-swc` để có decorator metadata, `include: ["test/**/*.spec.ts"]`), `apps/web/vitest.config.ts` (`environment: "jsdom"`, `setupFiles` nạp `@testing-library/jest-dom`), `tooling/vitest.config.ts`; script `test` trong mỗi `package.json` là `vitest run`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Hợp đồng nền trong `@app/shared/core`, lõi máy chủ và tệp kê khai module – mọi story đều dùng

**⚠️ CRITICAL**: Chưa xong phase này thì chưa bắt đầu story nào

### Kiểm thử nền (viết trước, phải thất bại)

- [X] T007 [P] Viết kiểm thử lược đồ nền trong `packages/shared/test/core.spec.ts`: `Id` nhận UUID v7, từ chối v4 và chuỗi rỗng; `UtcDateTime` nhận `2026-11-08T03:00:00Z`, từ chối `2026-11-08T10:00:00+07:00`; `MicroUsd` từ chối `1.5`, `-1`; `UsagePercent` chỉ nhận số nguyên 0–100; `ErrorResponse` từ chối `actions: []`; thông điệp lỗi Zod ra tiếng Việt (vd thiếu trường → `"Vui lòng nhập nội dung."`)
- [X] T008 [P] Viết kiểm thử cấu hình trong `apps/server/test/config.spec.ts`: thiếu `APP_ENV` → `loadConfig()` ném lỗi liệt kê `APP_ENV`; giá trị sai `API_PORT=abc` → nêu `API_PORT`; biến đánh dấu `secret: true` không xuất hiện giá trị trong thông điệp lỗi; mặc định đúng bảng data-model.md mục 3
- [X] T009 [P] Viết kiểm thử `ShutdownCoordinator` trong `apps/server/test/lifecycle.spec.ts`: `trackInFlight()` trì hoãn dừng tới khi xong; quá `SHUTDOWN_TIMEOUT_MS` gọi hàm thoát cưỡng bức với mã 1; trạng thái đi `starting → ready → stopping → stopped`

### Hợp đồng nền `@app/shared`

- [X] T010 Cấu hình build `packages/shared/tsup.config.ts` (entry `src/index.ts`, `src/core/index.ts`, `src/modules/*/index.ts`; format `esm` + `cjs`; `dts: true`; `clean: true`) và `exports` trong `packages/shared/package.json`: `"."`, `"./core"`, `"./*"` → `./dist/modules/*/index.{js,cjs,d.ts}`; `"sideEffects": false`; `"files": ["dist"]` (để `pnpm deploy` tiêm đủ mã đã build – R14); script `build`, `dev` (`tsup --watch`) (R9)
- [X] T011 [P] Viết kiểu nền trong `packages/shared/src/core/primitives.ts`: `Id` = `z.uuid({ version: "v7" })`; `UtcDateTime` = `z.iso.datetime()` (chỉ hậu tố `Z`, không offset); `MicroUsd` = số nguyên an toàn ≥ 0, chú thích "Không dùng trong hợp đồng cho khách hàng"; `UsagePercent` = số nguyên 0–100; `UnitName` = `"api" | "worker"`; export kiểu bằng `z.infer` (R16)
- [X] T012 [P] Viết hàm thuần `toFieldErrors(zodError)` → `{ path: string[], message: string }[]` trong `packages/shared/src/core/vi-error-messages.ts`: dịch từng issue sang tiếng Việt theo `code`/`expected`/`minimum`/`maximum`/`format` (thiếu trường, sai kiểu, chuỗi quá ngắn/dài, định dạng UUID/ngày giờ sai, số ngoài khoảng; mã lạ → "Giá trị chưa hợp lệ."); **MUST NOT** dùng `z.config()` hay bất kỳ đăng ký toàn cục nào (gói đặt `sideEffects: false`, bundler có thể loại tác dụng phụ – R8); thêm vào T007 ca kiểm thử: cùng một lỗi cho cùng mảng thông điệp khi gọi từ bản ESM và bản CJS của gói
- [X] T013 [P] Viết `packages/shared/src/core/error-response.ts`: `ErrorAction` = `{ kind: "retry" | "fix_input" | "contact_support" | "navigate", label: string, href?: string }`; `ErrorResponse` = `{ error: { code: UPPER_SNAKE_CASE, message: string, actions: ErrorAction[] (≥ 1), fieldErrors?: { path: string[], message: string }[], support: { traceId: string, detail?: string } } }`; hằng `ERROR_CODES` = `VALIDATION_FAILED`, `NOT_FOUND`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR` (data-model.md mục 2.2)
- [X] T014 [P] Viết `packages/shared/src/core/health.ts`: `HealthResponse` = `{ status: "ok", unit: UnitName, version: string, time: UtcDateTime }`; `ReadinessResponse` = `{ status: "ready" | "not_ready", checks: { name: string, status: "pass" | "fail" }[] }` (data-model.md mục 2.3)
- [X] T015 Gom export trong `packages/shared/src/core/index.ts` và `packages/shared/src/index.ts`; chạy `pnpm --filter @app/shared build` và `pnpm --filter @app/shared test` – T007 phải đạt

### Lõi máy chủ `apps/server/src/core`

- [X] T016 [P] Viết `apps/server/src/core/config/config.schema.ts` + `load-config.ts`: lược đồ Zod cho `APP_ENV` (bắt buộc, `development|test|staging|production`), `APP_VERSION` (`0.0.0-dev`), `API_PORT` (1–65535, `3000`), `WORKER_HEALTH_PORT` (1–65535, `3001`), `SHUTDOWN_TIMEOUT_MS` (1000–60000, `30000`), `LOG_LEVEL` (`fatal…trace`, `info`), `CORS_ORIGINS` (danh sách URL, `http://localhost:5173`); hỗ trợ đánh dấu `secret: true`; lỗi → `ConfigError` chỉ chứa tên biến + lý do; `ConfigModule` NestJS cung cấp token `APP_CONFIG` (R6) – T008 phải đạt
- [X] T017 [P] Viết `apps/server/src/core/logging/logging.module.ts`: `nestjs-pino` JSON ra stdout, trường cố định `unit`, `version`, `trace_id`, `account_id` (rỗng tới WBS 2.1); `redact`: `*.password`, `*.token`, `*.accessToken`, `*.refreshToken`, `*.secret`, `req.headers.authorization`, `req.headers.cookie`; `pino-pretty` chỉ khi `APP_ENV=development` (R7)
- [X] T018 [P] Viết `apps/server/src/core/context/request-context.ts`: middleware sinh `traceId` (UUID v7 hoặc lấy tiêu đề `x-trace-id` hợp lệ từ ingress), gắn vào `AsyncLocalStorage` và tiêu đề phản hồi `x-trace-id`; kiểu `ApiRequestContext` có `traceId` và `accountId?` với chú thích "chỉ lấy từ phiên đăng nhập – không bao giờ từ param/body/path" (nguyên tắc I)
- [X] T019 [P] Viết `apps/server/src/core/errors/app-error.ts` (lớp `AppError` mang `code`, `httpStatus`, `message` tiếng Việt, `actions`, `detail`) và `apps/server/src/core/errors/error.filter.ts` (bộ lọc ngoại lệ toàn cục → `ErrorResponse` theo bảng contracts/http-api.md: 400/404/503/500; 500 không chứa stack trace, SQL hay giá trị cấu hình; `support.traceId` lấy từ T018)
- [X] T020 [P] Viết `apps/server/src/core/lifecycle/shutdown-coordinator.ts`: trạng thái `starting|ready|stopping|stopped`, `trackInFlight(promise)`, `onStopping(listener)` (điểm móc cho pg-boss WBS 1.3), `beforeApplicationShutdown` chờ việc đang chạy tối đa `SHUTDOWN_TIMEOUT_MS` rồi ghi cảnh báo và gọi `process.exit(1)` (hàm thoát tiêm được để kiểm thử) (R5) – T009 phải đạt
- [X] T021 Viết `apps/server/src/core/core.module.ts` gom Config, Logging, RequestContext, ErrorFilter, Lifecycle (đánh dấu `@Global`); `apps/server/src/core/index.ts` export công khai của lõi

### Tệp kê khai module

- [X] T022 [P] Viết `apps/server/src/modules/modules.manifest.schema.json` (JSON Schema theo contracts/module-manifest.md: `name` snake_case, `title`, `kind` ∈ `business|gateway|infra`, `schema` chuỗi `snake_case` bắt buộc, `reservedSchema` boolean tùy chọn, `runsIn` mảng con không rỗng của `["api","worker"]`, `allowedDeps` mảng chuỗi; gốc có `sharedAllowedPackages`, `aiProviderPackagePatterns`, `modules`)
- [X] T023 Viết `apps/server/src/modules/modules.manifest.json` với đúng 11 mục và giá trị theo bảng data-model.md mục 1 (`account`…`queue`; `approval.schema = "approval"`, `approval.reservedSchema = true`, `approval.runsIn = ["api"]`; `platform_gateway.schema = "platform_gateway"`; `queue.schema = "infra"`, `queue.allowedDeps = []`), `sharedAllowedPackages: ["zod"]`, `aiProviderPackagePatterns: ["^@anthropic-ai/", "^openai$", "^@google/genai$", "^@mistralai/"]`
- [X] T024 Viết `apps/server/src/app/manifest.ts`: đọc + kiểm tra tệp kê khai bằng Zod, export `getManifest()`, `modulesFor(unit: "api" | "worker")`

**Checkpoint**: `pnpm --filter @app/shared test` và `pnpm --filter @app/server test` (config, lifecycle) đạt

---

## Phase 3: User Story 1 – Khởi chạy API và Worker từ cùng mã nguồn (Priority: P1) 🎯 MVP

**Goal**: Hai điểm khởi động `api` / `worker` từ cùng mã, một ảnh container, hai đơn vị triển khai độc lập; Worker tắt có kiểm soát ≤ 30 giây

**Independent Test**: quickstart.md mục 2, 3, 5 – `/healthz`, `/readyz` của API; `worker.ready` + `/healthz` của Worker; Ctrl+C thoát ≤ 30 giây; một ảnh chạy được cả hai và nhiều Worker song song

### Tests for User Story 1 ⚠️

- [X] T025 [P] [US1] Viết `apps/server/test/health.e2e.spec.ts` (Nest testing + supertest): `GET /healthz` → 200 khớp `HealthResponse` với `unit: "api"`; `GET /readyz` → 200 `{ status: "ready", checks: [] }`; sau khi coordinator chuyển `stopping` → `/readyz` 503 `ErrorResponse` mã `SERVICE_UNAVAILABLE`; đường dẫn lạ → 404 `NOT_FOUND` có `actions` ≥ 1; mọi phản hồi có `x-trace-id` trùng `support.traceId`; không trường nào chứa dữ liệu tenant
- [X] T026 [P] [US1] Viết `apps/server/test/shutdown.spec.ts`: sinh tiến trình con thật `node dist/worker.js` (build trước trong `globalSetup`), chờ dòng nhật ký `worker.ready`, gửi SIGTERM rồi (lượt khác) SIGINT, khẳng định thoát mã 0 trong ≤ 30 giây và có nhật ký `worker.stopped`; lặp 10 lần (SC-004); các ca dùng tín hiệu đặt `it.skipIf(process.platform === "win32")` vì trên Windows `child.kill()` giết tiến trình ngay, không chạy hook tắt (R5); thêm script `test:linux` ở `apps/server/package.json` chạy kiểm thử này trong container `node:24-bookworm-slim` (gắn thư mục kho) cho máy Windows; thêm ca có tác vụ treo → thoát mã 1 sau `SHUTDOWN_TIMEOUT_MS` (đặt 2000 trong kiểm thử)
- [X] T027 [P] [US1] Viết `apps/server/test/multi-worker.spec.ts`: khởi chạy 1 API + 2 Worker (cổng `WORKER_HEALTH_PORT` khác nhau) song song; cả ba `/healthz` trả 200 đúng `unit`; dừng một Worker không ảnh hưởng Worker còn lại và API (SC-009); Worker không mở cổng nào khác ngoài cổng kiểm tra sống (`/api/v1/diagnostics/echo` trên cổng Worker → 404)

### Implementation for User Story 1

- [X] T028 [P] [US1] Viết `apps/server/src/core/health/health.controller.ts`: `GET /healthz` → `HealthResponse` (`unit: "api"`, `version` từ `APP_VERSION`, `time` UTC); `GET /readyz` → `ReadinessResponse` từ danh sách `ReadinessCheck` đăng ký được (ban đầu rỗng) và trả 503 khi coordinator ở `stopping`; không cần đăng nhập
- [X] T029 [P] [US1] Viết `apps/server/src/core/health/worker-health-server.ts`: máy chủ `node:http` thuần chỉ phục vụ `GET /healthz` trên `WORKER_HEALTH_PORT` (200 `HealthResponse` `unit: "worker"`, 503 khi `stopping`, mọi đường dẫn khác 404), đóng khi dừng – **không** dùng NestJS router (FR-004)
- [X] T030 [US1] Viết `apps/server/src/app/api-app.module.ts` (import `CoreModule`, `HealthController`) và `apps/server/src/api.ts`: `NestFactory.create` trên Express, `bufferLogs` + logger pino, `setGlobalPrefix("api/v1", { exclude: ["healthz", "readyz"] })`, CORS theo `CORS_ORIGINS`, `enableShutdownHooks(["SIGTERM", "SIGINT"])`, lắng nghe `API_PORT`, ghi nhật ký `api.ready`; lỗi cấu hình → in tên biến, thoát mã 1
- [X] T031 [US1] Viết `apps/server/src/app/worker-app.module.ts` (import `CoreModule`, không controller) và `apps/server/src/worker.ts`: `NestFactory.createApplicationContext`, khởi động `worker-health-server`, `enableShutdownHooks`, ghi `worker.ready` với `queues: []`, ghi `worker.stopping` / `worker.stopped`; Worker không giữ trạng thái nghiệp vụ trong tiến trình, không ghi tệp cục bộ (FR-002)
- [X] T032 [P] [US1] Tạo `apps/server/.env.example` (mọi biến của data-model.md mục 3 kèm chú thích tiếng Việt, `APP_ENV=development`) và `apps/server/tsconfig.build.json` (`outDir: dist`, `rootDir: src`, loại `test`); script trong `apps/server/package.json`: `build` (`tsc -p tsconfig.build.json`), `dev:api` (`tsx watch --env-file=.env src/api.ts`), `dev:worker` (`tsx watch --env-file=.env src/worker.ts`), `start:api` (`node dist/api.js`), `start:worker` (`node dist/worker.js`)
- [X] T033 [US1] Điền script gốc trong `package.json`: `build:shared`, `dev:api` / `dev:worker` (chạy song song `tsup --watch` của shared và dev của server bằng `pnpm --parallel --filter`), `build` (shared → server → web), `start:api`, `start:worker`
- [X] T034 [P] [US1] Viết `Dockerfile` nhiều tầng ở gốc: tầng build `node:24-bookworm-slim` (ghi digest), `corepack enable`, `pnpm install --frozen-lockfile`, build `@app/shared` + `@app/server`, `pnpm deploy --filter @app/server --prod /out`; tầng chạy chỉ chép `/out`, người dùng không phải root, `NODE_ENV=production`, `EXPOSE 3000 3001`, `CMD ["node", "dist/api.js"]`; không chứa mã web (R14); và `.dockerignore` (node_modules, dist, .env, specs, TaiLieuDacTa, .specify, .claude)
- [X] T035 [US1] Chạy kiểm thử T025–T027 (trên Windows thêm `pnpm --filter @app/server test:linux`) và quickstart.md mục 2, 3, 5 (build ảnh, chạy API, Worker, hai Worker song song); kiểm tra trong ảnh có `node_modules/@app/shared/dist/core/index.cjs` (`docker run --rm app:local ls node_modules/@app/shared/dist/core`) – xác nhận đạt

**Checkpoint**: US1 chạy độc lập được – đây là MVP

---

## Phase 4: User Story 2 – Module có chỗ riêng, ranh giới kiểm tra tự động (Priority: P1)

**Goal**: 11 module theo tệp kê khai, mỗi module chỉ lộ `index.ts`; lệnh `pnpm check:boundaries` bắt các vi phạm (a)–(f) và SDK AI ngoài `ai_gateway`

**Independent Test**: quickstart.md mục 6 – `pnpm check:boundaries` sạch; bộ mẫu a–f bị bắt 100%; thêm nhập nội bộ vào `content` → thất bại có gợi ý

### Tests for User Story 2 ⚠️

- [X] T036 [P] [US2] Viết `apps/server/test/manifest.spec.ts` kiểm 5 bất biến của data-model.md mục 1: đúng 11 module, mỗi `name` có thư mục + `index.ts` và không có thư mục module ngoài tệp kê khai; mọi module có `schema` khác rỗng và không trùng, `approval.schema === "approval"` với `reservedSchema === true`, `platform_gateway.schema === "platform_gateway"`, `queue.schema === "infra"`; đồ thị `allowedDeps` không vòng và `queue.allowedDeps` rỗng; chỉ `publishing` có `platform_gateway` trong `allowedDeps`; registry của API/Worker khớp `runsIn`
- [X] T037 [P] [US2] Tạo bộ mẫu `tooling/boundaries/fixtures/` gồm 8 cây mã nhỏ (mỗi cây có tệp kê khai thu gọn riêng): `a-internal-import`, `b-cycle`, `c-core-imports-module`, `d-web-imports-server`, `e-shared-imports-node` (shared nhập `node:fs`), `f-not-in-allowed-deps`, `g-ai-sdk-outside-gateway`, `clean`; mỗi cây có `expected.json` liệt kê mã quy tắc mong đợi
- [X] T038 [US2] Viết `tooling/boundaries/boundaries.spec.ts`: chạy dependency-cruiser (API lập trình `cruise`) với quy tắc sinh từ `build-rules.cjs` trên từng fixture; khẳng định đúng mã quy tắc trong `expected.json`, `clean` không có vi phạm (SC-002)

### Implementation for User Story 2

- [X] T039 [P] [US2] Tạo khuôn 11 module theo contracts/module-manifest.md – mỗi `apps/server/src/modules/<name>/` có `index.ts` (export `<Name>Module` và kiểu công khai), `<name>.module.ts` (`@Module({})` rỗng), `public-api.ts` (interface `<Name>PublicApi` giữ chỗ, chú thích trách nhiệm theo ADD mục 6 bằng tiếng Việt), `internal/.gitkeep`; ví dụ `apps/server/src/modules/publishing/`, `apps/server/src/modules/platform_gateway/`, `apps/server/src/modules/approval/` (chú thích: schema `approval` dành sẵn, để trống – trạng thái duyệt trên `content`, giờ đăng trên `publishing`; thêm bảng cần đặc tả mới), `apps/server/src/modules/queue/` (chú thích: hạ tầng, không phụ thuộc module nghiệp vụ)
- [X] T040 [US2] Viết `apps/server/src/app/module-registry.ts`: bảng `name → NestModule` cho 11 module (tầng ghép duy nhất được nhập `index.ts` của mọi module), hàm `buildModules(unit)` lọc theo `runsIn` qua `modulesFor()` (T024); ném lỗi khi khởi động nếu registry thiếu/thừa so với tệp kê khai; gắn vào `imports` của `apps/server/src/app/api-app.module.ts` và `apps/server/src/app/worker-app.module.ts` (FR-012)
- [X] T041 [US2] Viết `tooling/boundaries/build-rules.cjs`: đọc tệp kê khai, sinh quy tắc `forbidden` của dependency-cruiser theo bảng contracts/module-manifest.md – `no-internal-cross-module`, `no-circular`, `core-no-modules`, `infra-no-business`, `web-only-shared`, `shared-pure` (npm ngoài `sharedAllowedPackages`, module lõi Node, `apps/**`), `allowed-deps-<name>` cho từng module, `ai-sdk-only-in-ai-gateway`, `no-unresolvable`; mỗi quy tắc có `comment` tiếng Việt là gợi ý sửa (vd "thêm vào allowedDeps (cần review) hoặc đi qua giao diện công khai của publishing"); miễn trừ tầng ghép `apps/server/src/{api,worker}.ts`, `apps/server/src/app/**`
- [X] T042 [US2] Tạo `.dependency-cruiser.cjs` ở gốc dùng `build-rules.cjs`, `options`: `tsConfig` theo từng gói, `doNotFollow: node_modules`, loại `**/dist/**`, `**/test/**`, `tooling/boundaries/fixtures/**`; reporter `err-long` in tệp nguồn → đích + gợi ý; script gốc `check:boundaries` = `depcruise apps packages --config .dependency-cruiser.cjs` (mã thoát 1 khi vi phạm)
- [X] T043 [US2] Chạy T036, T038 và `pnpm check:boundaries` trên khung sạch (0 vi phạm); thử tay quickstart.md mục 6 (nhập `../platform_gateway/internal/x` trong `content` → bắt được `no-internal-cross-module` + `allowed-deps-content`), hoàn tác

**Checkpoint**: US1 và US2 cùng đạt

---

## Phase 5: User Story 3 – Kiểu dữ liệu dùng chung web ↔ máy chủ (Priority: P2)

**Goal**: Lược đồ Zod dùng chung là nguồn duy nhất cho kiểu và kiểm tra đầu vào; API từ chối đầu vào sai bằng `ErrorResponse`; web khung gọi `/healthz` qua hợp đồng chung

**Independent Test**: quickstart.md mục 2 (echo) và 4 – đầu vào sai → 400 cùng `fieldErrors` ở web và API; đổi tên trường `unit` → `pnpm typecheck` lỗi ở cả hai phía; trang web hiển thị chữ + biểu tượng

### Tests for User Story 3 ⚠️

- [X] T044 [P] [US3] Viết `apps/server/test/validation.e2e.spec.ts`: `POST /api/v1/diagnostics/echo` với `{}` → 400, `error.code = "VALIDATION_FAILED"`, `actions[0].kind = "fix_input"`, `fieldErrors` có `["message"]` và `["sentAt"]` bằng tiếng Việt, và **bằng đúng** `toFieldErrors(EchoRequest.safeParse({}).error)` từ `@app/shared/core`; đầu vào hợp lệ → 200 `EchoResponse`; `APP_ENV=production` → 404 (controller không đăng ký)
- [X] T045 [P] [US3] Viết `packages/shared/test/customer-contracts.spec.ts`: duyệt mọi lược đồ export từ `src/modules/*/index.ts` (trừ `internal-support.ts`) và khẳng định không trường nào dùng lược đồ `MicroUsd` (nguyên tắc III, R16)
- [X] T046 [P] [US3] Viết `apps/web/test/StartPage.spec.tsx` (Testing Library, `fetch` giả): phản hồi `/healthz` hợp lệ → hiện "API đang hoạt động" kèm biểu tượng ✓ có nhãn cho trình đọc màn hình; lỗi mạng hoặc phản hồi sai lược đồ → hiện "Không kết nối được API" kèm ⚠ và nút "Thử lại" (vùng chạm ≥ 44 × 44 px), bấm "Thử lại" gọi lại API

### Implementation for User Story 3

- [X] T047 [P] [US3] Viết `packages/shared/src/core/echo.ts`: `EchoRequest` = `{ message: string (đã cắt khoảng trắng, 1–200 ký tự), sentAt: UtcDateTime }`; `EchoResponse` = `{ message: string, receivedAt: UtcDateTime }`; export qua `src/core/index.ts`
- [X] T048 [P] [US3] Tạo `packages/shared/src/modules/<name>/index.ts` cho đủ 11 module (ban đầu rỗng, chú thích tiếng Việt: "Hợp đồng web ↔ API của module <title>; hợp đồng nội bộ/hỗ trợ đặt ở internal-support.ts") – ví dụ `packages/shared/src/modules/content/index.ts`, `packages/shared/src/modules/ai_gateway/index.ts` (FR-015)
- [X] T049 [US3] Viết `apps/server/src/core/validation/zod-validation.pipe.ts` và decorator `@ValidBody(schema)`, `@ValidQuery(schema)`, `@ValidParam(schema)` trong `apps/server/src/core/validation/decorators.ts`: lỗi → `AppError` mã `VALIDATION_FAILED`, HTTP 400, thông điệp "Thông tin gửi lên chưa đúng. Vui lòng kiểm tra lại các ô được đánh dấu.", `actions: [{ kind: "fix_input", label: "Sửa thông tin" }]`, `fieldErrors` = `toFieldErrors(...)`, `support.detail` = mã issue Zod đầu tiên; đây là nơi duy nhất phía máy chủ gọi Zod cho đầu vào HTTP (FR-013a). Để **mọi** đầu vào đi qua lược đồ: thêm vào `eslint.config.mjs` quy tắc cho `apps/server/src/**` (trừ `apps/server/src/core/validation/**`) cấm nhập `Body`, `Query`, `Param` từ `@nestjs/common` (`no-restricted-imports` với `importNames`, thông điệp tiếng Việt "Dùng @ValidBody/@ValidQuery/@ValidParam để kiểm tra đầu vào bằng lược đồ dùng chung"); viết `tooling/test/eslint-validation-rule.spec.ts` chạy API `ESLint` trên đoạn mã mẫu: controller dùng `@Body()` → lỗi, dùng `@ValidBody(EchoRequest)` → sạch
- [X] T050 [US3] Viết `apps/server/src/core/diagnostics/diagnostics.controller.ts` (`POST /diagnostics/echo` dùng `@ValidBody(EchoRequest)`, trả `EchoResponse`) và đăng ký có điều kiện trong `apps/server/src/app/api-app.module.ts` chỉ khi `APP_ENV !== "production"` (R17)
- [X] T051 [P] [US3] Tạo khung web: `apps/web/index.html` (`lang="vi"`, viewport mobile), `apps/web/vite.config.ts` (plugin React, proxy `/api`, `/healthz`, `/readyz` → `http://localhost:3000`, `build.sourcemap: true` để T057 quét), `apps/web/src/main.tsx`; script `dev`, `build`, `preview` trong `apps/web/package.json`; script gốc `dev:web`
- [X] T052 [US3] Viết `apps/web/src/lib/api-client.ts`: hàm `getHealth()` dùng `fetch` + `HealthResponse.safeParse`; phản hồi lỗi parse bằng `ErrorResponse`; trả kết quả có kiểu (không `any`), không nhập gì ngoài `@app/shared`
- [X] T053 [US3] Viết `apps/web/src/app/StartPage.tsx`: gọi `getHealth()`, hiển thị trạng thái bằng chữ tiếng Việt + biểu tượng (✓ / ⚠, có `aria-label`, không chỉ dựa vào màu), nút "Thử lại" ≥ 44 × 44 px, bố cục dùng được từ 360 px (FR-016, nguyên tắc VI)
- [X] T054 [US3] Chạy T044–T046; kiểm tra lệch hợp đồng theo quickstart.md mục 4 (đổi `unit` → `unitName` trong `packages/shared/src/core/health.ts` → `pnpm typecheck` lỗi ở `apps/server` và `apps/web`), hoàn tác

**Checkpoint**: US1, US2, US3 cùng đạt

---

## Phase 6: User Story 4 – Một lệnh kiểm tra chất lượng cho cả kho (Priority: P2)

**Goal**: `pnpm verify` chạy hết mọi bước, in bảng tổng kết, thất bại nếu bất kỳ bước nào lỗi

**Independent Test**: quickstart.md mục 1 – khung sạch đạt ≤ 5 phút; cố ý đưa lỗi kiểu + lỗi lint + vi phạm ranh giới → liệt kê đủ ba

### Tests for User Story 4 ⚠️

- [X] T055 [P] [US4] Viết `tooling/test/verify.spec.ts`: chạy `verify.mjs` với danh sách bước giả (một bước đạt, hai bước lỗi) → chạy **đủ** các bước, bảng tổng kết có 3 dòng, mã thoát 1, dòng cuối `→ THẤT BẠI: 2/3 bước lỗi`; tất cả đạt → mã thoát 0

### Implementation for User Story 4

- [X] T056 [US4] Viết `tooling/verify.mjs`: chạy tuần tự `build:shared` → `typecheck` → `lint` → `check:boundaries` → `test` → `check:web-bundle` bằng `child_process.spawn` (`shell: true` để chạy `pnpm` trên Windows), không dừng ở lỗi đầu, đo thời gian, in bảng theo contracts/repo-commands.md (bước, ✓ đạt / ✗ lỗi, thời gian, dòng lỗi đầu tiên), mã thoát 1 nếu có bước lỗi; nhận danh sách bước qua tham số để T055 kiểm thử
- [X] T057 [P] [US4] Viết `tooling/check-web-bundle.mjs`: build `apps/web` rồi đọc mọi `apps/web/dist/**/*.map`, thất bại nếu `sources` có đường dẫn chứa `apps/server` (SC-008); script gốc `check:web-bundle`
- [X] T058 [US4] Điền script gốc `typecheck` (`pnpm -r --workspace-concurrency=1 exec tsc --noEmit -p tsconfig.json`), `lint` (`eslint . && prettier --check .`), `test` (`pnpm -r test`), `verify` (`node tooling/verify.mjs`) trong `package.json`
- [X] T059 [US4] Chạy `pnpm verify` trên khung sạch (đạt, ghi thời gian – SC-006 ≤ 5 phút); cố ý đưa một lỗi kiểu, một lỗi lint, một vi phạm ranh giới → xác nhận cả ba được liệt kê và mã thoát 1; hoàn tác

**Checkpoint**: Mọi user story đạt

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T060 [P] Viết `README.md` ở gốc bằng tiếng Việt (FR-021): yêu cầu môi trường (Node 24, Corepack, Docker), cài đặt, chạy API/Worker/web, bảng lệnh (trỏ contracts/repo-commands.md), sơ đồ module Mermaid sinh từ tệp kê khai, quy tắc ranh giới, mục "Hình thái triển khai" (chung ảnh ≠ chung tiến trình), hướng dẫn **Thêm module** (sửa tệp kê khai → tạo thư mục theo khuôn T039 → thêm vào `module-registry.ts` → thêm `packages/shared/src/modules/<name>/index.ts` → `pnpm verify`) và **Thêm hợp đồng**
- [X] T061 [P] Cập nhật `.specify/memory/architecture.md` (FR-023): mục 4 – tách `channel_connections` sang schema `platform_gateway`, thêm hàng module `platform_gateway` và `approval` (schema `approval` dành sẵn, để trống; sửa câu "Duyệt & lịch… không có bảng riêng" thành "có schema dành sẵn, chưa có bảng"); mục 11 – thêm thuật ngữ mới từ research.md (`approval`, `platform_gateway`, `queue`/`infra`, `core`, `modules.manifest.json`, `api`/`worker`); tăng phiên bản 1.0 → 1.1 và ngày
- [X] T062 Thử SC-007 theo README: thêm module giả `sample` (tệp kê khai + thư mục + registry + shared) và chạy `pnpm verify` – đạt, không sửa module có sẵn, ghi thời gian ≤ 15 phút; hoàn tác
- [X] T063 Chạy toàn bộ quickstart.md (mục 1–7) trên máy sạch Windows và một môi trường Linux (container `node:24`), ghi kết quả; xác nhận SC-001 (≤ 30 phút chỉ đọc README)
- [X] T064 Chạy skill `constitution-review` trên thay đổi (đặc biệt nguyên tắc I, II, III, IV, VII) và xử lý phát hiện

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: bắt đầu ngay
- **Foundational (Phase 2)**: sau Setup – chặn mọi story
- **US1 (Phase 3)**, **US2 (Phase 4)**: sau Foundational, làm song song được
- **US3 (Phase 5)**: sau Foundational; T050 sửa `api-app.module.ts` nên làm sau T030; T048 cần tên module từ T023
- **US4 (Phase 6)**: sau Foundational; bảng tổng kết đầy đủ chỉ đạt khi `check:boundaries` (T042) và `check:web-bundle` (T057 cần T051) có sẵn
- **Polish (Phase 7)**: sau mọi story

### User Story Dependencies

- **US1 (P1)**: không phụ thuộc story khác
- **US2 (P1)**: không phụ thuộc story khác; T040 sửa `api-app.module.ts` / `worker-app.module.ts` của T030/T031 – nếu làm song song với US1 thì làm T040 sau T030, T031
- **US3 (P2)**: độc lập về chức năng; dùng `api-app.module.ts` của US1
- **US4 (P2)**: gom lệnh của US2 và US3

### Within Each User Story

- Kiểm thử viết trước và phải thất bại
- Hợp đồng/lược đồ → lõi → controller/điểm khởi động → ghép → kiểm chứng

### Parallel Opportunities

- Phase 1: T002, T003, T004 song song; T006 sau T005
- Phase 2: T007–T009 song song; T011–T014 song song; T016–T020 song song; T022 song song với lõi
- US1: T025–T027 song song; T028, T029, T032, T034 song song
- US2: T036, T037 song song; T039 song song với T041
- US3: T044–T046 song song; T047, T048, T051 song song
- Hai người: một người US1 → US3, một người US2 → US4

---

## Parallel Example: User Story 1

```text
Task: "Viết apps/server/test/health.e2e.spec.ts"
Task: "Viết apps/server/test/shutdown.spec.ts"
Task: "Viết apps/server/test/multi-worker.spec.ts"

Task: "Viết apps/server/src/core/health/health.controller.ts"
Task: "Viết apps/server/src/core/health/worker-health-server.ts"
Task: "Viết Dockerfile và .dockerignore"
```

## Parallel Example: User Story 2

```text
Task: "Viết apps/server/test/manifest.spec.ts"
Task: "Tạo bộ mẫu tooling/boundaries/fixtures/"
Task: "Tạo khuôn 11 module trong apps/server/src/modules/"
Task: "Viết tooling/boundaries/build-rules.cjs"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup → Phase 2 Foundational
2. Phase 3 US1 → kiểm chứng quickstart mục 2, 3, 5
3. **DỪNG và KIỂM CHỨNG**: API + Worker chạy từ một ảnh, Worker co giãn độc lập

### Incremental Delivery

1. Setup + Foundational → nền sẵn sàng
2. US1 → MVP (WBS 1.2/1.3 có thể bắt đầu dựa trên khung này)
3. US2 → ranh giới module (nên xong trước khi đội viết mã module thật)
4. US3 → hợp đồng dùng chung + web khung (mở đường cho WBS 1.7)
5. US4 → `pnpm verify` (WBS 1.4 gắn vào CI)

---

## Notes

- [P] = khác tệp, không phụ thuộc nhiệm vụ chưa xong
- Mỗi story kiểm thử độc lập được; dừng ở mỗi checkpoint để kiểm chứng
- Commit sau mỗi nhiệm vụ hoặc nhóm hợp lý; chỉ commit khi chủ dự án yêu cầu
- `.gitignore` hiện bỏ qua `specs/`, `.specify/`, `CLAUDE.md` – tài liệu Spec Kit sẽ không vào git trừ khi chủ dự án đổi
