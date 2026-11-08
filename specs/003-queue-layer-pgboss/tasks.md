---

description: "Danh sách việc – Lớp hàng chờ nội bộ bọc pg-boss (003)"
---

# Tasks: Lớp hàng chờ nội bộ – 6 hàng chờ, giới hạn theo tenant, việc hỏng, việc định kỳ

**Input**: `specs/003-queue-layer-pgboss/` – plan.md, spec.md (Clarifications Q1–Q3), research.md (R1–R17),
data-model.md, contracts/ (queue-api.md, queue-observability.md, queue-commands.md), quickstart.md

**Tests**: BẮT BUỘC – spec FR-034/FR-035 yêu cầu kiểm thử tích hợp trên PostgreSQL thật và khuôn kiểm thử
dùng lại; hiến pháp yêu cầu kiểm thử truy cập chéo, "chạy lại hai lần cho cùng kết quả", quét bí mật nhật
ký. Kiểm thử tích hợp: `apps/server/test/queue/**/*.queue.spec.ts` (`pnpm test:queue`); đơn vị:
`apps/server/test/unit/queue/**/*.spec.ts` (`pnpm test`). Viết kiểm thử trước, xác nhận thất bại rồi mới
cài đặt.

**Organization**: theo user story. US1–US3 là P1 nhưng phụ thuộc thực tế: US2 (bộ chạy) cần US1 (tạo
việc); US3 mở rộng vòng lấy việc của US2; US4, US5 cần đường chôn việc/bộ chạy của US2; US6 độc lập với
US3–US5.

**Quy ước**: đường dẫn tính từ gốc kho; `S` = `apps/server`, `Q` = `apps/server/src/modules/queue`.
Bình luận, tài liệu, thông điệp lỗi bằng tiếng Việt; định danh tiếng Anh theo bảng thuật ngữ cuối
research.md. Chỉ `Q/internal/**` và `S/src/db/**` được nhập `pg-boss`. Không in chuỗi kết nối.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: chạy song song được (khác tệp, không phụ thuộc việc chưa xong)
- **[Story]**: US1…US6 theo spec.md

---

## Phase 1: Setup (hạ tầng dùng chung)

**Purpose**: thư viện, cấu hình kiểm thử, quy tắc ranh giới

- [ ] T001 Thêm phụ thuộc phiên bản CHÍNH XÁC vào `apps/server/package.json`: `pg-boss` `12.38.0`, `cron-parser` (đúng bản mà `pg-boss@12.38.0` khai báo trong `dependencies`, bỏ `^`), `@opentelemetry/api` `1.9.0`; dev: `@opentelemetry/sdk-metrics` và `yaml` (bản phát hành ≥ 2 tuần, ghi chính xác); chạy `pnpm install` và commit `pnpm-lock.yaml`
- [ ] T002 [P] Thêm script vào `apps/server/package.json` (`test:queue` = `vitest run --config vitest.queue.config.mts`, `test:queue-soak` = `vitest run --config vitest.queue.config.mts --dir test/queue/soak`, `queue:sql` = `tsx src/db/queue-sql.ts`) và lệnh chuyển tiếp cùng tên ở `package.json` gốc (contracts/queue-commands.md §1)
- [ ] T003 [P] Tạo `apps/server/vitest.queue.config.mts`: giống `vitest.db.config.mts` (swc, `globalSetup: ['./test/db/global-setup.ts']`, `fileParallelism: false`, `env: { APP_ENV: 'test' }`), `include: ['test/queue/**/*.queue.spec.ts']`, loại `test/queue/soak/**` khi không truyền `--dir`, `testTimeout: 120_000`
- [ ] T004 [P] Thêm quy tắc vào `.dependency-cruiser.cjs`: `pgboss-only-in-queue` (chỉ `apps/server/src/modules/queue/internal/**` và `apps/server/src/db/**` được phụ thuộc `pg-boss`) và `cron-parser-only-in-queue` (chỉ `apps/server/src/modules/queue/internal/**`); thêm mẫu vi phạm vào bộ kiểm thử ranh giới có sẵn (thư mục fixtures của 001) để chứng minh quy tắc bắt được (FR-001)
- [ ] T005 [P] Thêm biến `QUEUE_ENABLED` (mặc định `true`), `QUEUE_CONTROL_POOL_MAX` (6, 2–20), `QUEUE_API_POOL_MAX` (2, 1–5), `QUEUE_SETTINGS_REFRESH_MS` (60000, 10000–300000), `QUEUE_SCHEDULER_TICK_MS` (10000, 1000–30000) vào `S/src/core/config/config.schema.ts`, `S/.env.example` và kiểm thử `S/test/config.spec.ts` (contracts/queue-commands.md §2)

---

## Phase 2: Foundational (điều kiện tiên quyết cho mọi story)

**Purpose**: schema pgboss, bảng infra, sổ đăng ký loại việc, bộ nối pg-boss, khuôn kiểm thử

**⚠️ CRITICAL**: Không story nào bắt đầu trước khi phase này xong

- [ ] T006 Viết `S/src/db/queue-sql.ts` (`pnpm queue:sql --construct` in `getConstructionPlans('pgboss', { createSchema: true })`; `--migrate-from <version>` in `getMigrationPlans('pgboss', version)`; sai tham số → mã thoát 1) nạp `pg-boss` bằng `await import('pg-boss')` (R1, R2)
- [ ] T007 Tạo migration tay `S/drizzle/migrations/0005_pgboss_install.sql` bằng `pnpm db:generate:custom --name pgboss_install` rồi dán đầu ra `pnpm queue:sql --construct` (tiêu đề: "Sinh từ pg-boss 12.38.0 – không sửa tay phần sinh ra"); thêm sau phần sinh: `ALTER SCHEMA pgboss OWNER TO "owner"` (nếu cần), `GRANT USAGE ON SCHEMA pgboss TO "app", "system"`; `app`: `SELECT, INSERT, UPDATE, DELETE` trên `pgboss.job`, `pgboss.job_common`, `SELECT` trên `pgboss.queue`, `pgboss.version`, `EXECUTE` các hàm pg-boss cần cho `send/insert/cancel/update/findJobs`; `system`: quyền đọc/ghi mọi bảng/chuỗi/hàm pg-boss cần cho lấy việc, monitor, bảo trì, sổ bản; `support`: không có; `ENABLE ROW LEVEL SECURITY` trên `pgboss.job`, `pgboss.job_common` với chính sách `queue_tenant_jobs FOR ALL TO "app" USING (group_id = account.current_account_id()::text) WITH CHECK (group_id = account.current_account_id()::text)` và `queue_runtime_all FOR ALL TO "system" USING (true) WITH CHECK (true)` (R12)
- [ ] T008 Khai báo Drizzle `infra.queue_settings` trong `Q/internal/db/schema.ts` bằng `sharedTable(…, { reason: 'Thông số vận hành của 6 hàng chờ, không thuộc tài khoản nào' })` với cột và CHECK đúng data-model §4: `queue` text PK `IN ('publish','media','ai_batch','trends','notify','scheduled')`; `concurrency_per_worker` int `≥ 1 AND ≤ 50`; `max_per_tenant` int NULL `NULL OR (≥ 1 AND ≤ concurrency_per_worker × 10)`; `lock_seconds` int `≥ 30 AND ≤ 3600`; `heartbeat_seconds` int `≥ 10 AND < lock_seconds`; `retry_mode` text `IN ('schedule','handler','none')`; `max_retries` int `≥ 0 AND ≤ 20`, `retry_mode='none' ⇒ 0`; `retry_delays_seconds` int[] không rỗng, mọi phần tử `≥ 1 AND ≤ 86400`; `poll_interval_ms` int `≥ 200 AND ≤ 60000`; `updated_at` timestamptz `DEFAULT now()`; `updated_by` text NULL. Sinh `S/drizzle/migrations/0006_queue_settings.sql` (`pnpm db:generate --name queue_settings`), thêm bằng tay: seed 6 dòng theo bảng data-model §4 (publish 10/3/120/30/handler/5/`{60}`/1000; media 2/1/900/30/schedule/3/`{60,300,900}`/5000; ai_batch 5/3/180/30/schedule/2/`{30,120}`/2000; trends 2/1/600/30/schedule/3/`{3600,14400}`/5000; notify 5/NULL/60/30/schedule/5/`{30,60,120,300,600}`/2000; scheduled 2/NULL/600/30/none/0/`{60}`/2000; `updated_by='migration'`), `GRANT SELECT … TO "app"`, `GRANT SELECT, UPDATE … TO "system"` (infra không có quyền mặc định)
- [ ] T009 Viết hàm `ensureQueues(ownerUrl)` trong `S/src/db/ensure-queues.ts` (pg-boss vai trò `owner`, `migrate: false`, `supervise/schedule: false`): với 6 hàng chờ `createQueue` nếu chưa có (`policy: 'exclusive'`, `partition: false`, `deleteAfterSeconds: 2592000`), rồi `updateQueue` theo `infra.queue_settings` (`expireInSeconds = lock_seconds`, `heartbeatSeconds = heartbeat_seconds`, `retryLimit = max_retries`, `retryDelay = retry_delays_seconds[1]`); gọi sau migration trong `S/src/db/migrate.ts` (cả `db:setup`); idempotent (data-model §2, R2)
- [ ] T010 [P] Mở rộng `S/src/core/db/table-registry.ts` với `nullableTenant?: { reason: string }` và `S/src/db/check-conventions.ts`: thêm `pgboss` vào danh sách schema ngoài module (bỏ quy tắc `b`, `j` cho schema này; quy tắc `a` kiểm `pgboss.job_common` có RLS; `f` áp dụng), cho phép `account_id` NULL ở bảng `tenant` chỉ khi có `nullableTenant.reason`; thêm mẫu vi phạm `S/test/db/fixtures/conventions/l-nullable-tenant-without-reason.*` và cập nhật `S/test/db/conventions.db.spec.ts`
- [ ] T011 [P] Viết `Q/internal/pgboss/boss-loader.ts`: nơi DUY NHẤT `import('pg-boss')`; `createWorkerBoss(config)` (bể điều khiển vai trò `system` từ `DATABASE_SYSTEM_URL`, `max = QUEUE_CONTROL_POOL_MAX`, `schema: 'pgboss'`, `migrate: false`, `createSchema: false`, `supervise: true`, `schedule: false`, `registerInstance: true`, `instanceName: 'worker'`, `reindex: false`, `application_name: 'worker-queue'`) và `createApiBoss(config)` (vai trò `app`, `max = QUEUE_API_POOL_MAX`, `supervise/schedule/registerInstance: false`); hằng `EXPECTED_SCHEMA_VERSION` và `assertSchemaVersion(boss)` (lệch → lỗi `QUEUE_SCHEMA_VERSION_MISMATCH`); kiểu nhập bằng `import type … with { 'resolution-mode': 'import' }` (R1, R2)
- [ ] T012 [P] Viết `Q/internal/pgboss/tx-database.ts`: `txDatabase(db: Db): IDatabase` = `{ executeSql: (text, values) => db.$client.query(text, values) }` và `requireCurrentTx()` dùng `currentTx()` của `core/db` (thêm xuất `currentTx` cho `modules/queue` qua đường nhập trực tiếp `core/db/transaction`, ghi chú lý do, cập nhật quy tắc ranh giới nếu cần) (R4)
- [ ] T013 [P] Viết `Q/public-api.ts` + `Q/results.ts`: kiểu công khai `QueueName`, `EnqueueOptions`, `EnqueueResult`, `JobRef`, `ChangeResult`, `JobContext`, `JobHandlerResult`, `FinalFailureInfo`, `DeadJobCause` (`RETRIES_EXHAUSTED` · `PERMANENT_ERROR` · `NO_HANDLER` · `PAYLOAD_INVALID` · `EXPIRED`), `DeadJobFilter`, `DeadJobSummary`, `DeadJobDetail`; `retryAfter(seconds)` (1 … 86400, ngoài khoảng → ném), `noRetry(reason)`, `class PermanentJobError(code, message?)` – đúng contracts/queue-api.md; không kiểu pg-boss nào xuất hiện (FR-002)
- [ ] T014 [P] Viết kiểm thử đơn vị `S/test/unit/queue/job-types.spec.ts` (thất bại trước): tên `^[a-z_]+\.[a-z_]+$`, khai báo trùng → ném; khuôn không phải `z.strictObject` → ném; trường bị cấm (không phân biệt hoa thường, bỏ `_`: `content`, `body`, `caption`, `text`, `prompt`, `message`, `token`, `accesstoken`, `secret`, `password`, `accountid`, `tenantid`) ở mọi độ sâu → ném; chuỗi không có `.max()` hoặc `.max() > 2048` → ném; `maxPayloadBytes > 8192` → ném; `queue: 'publish'` với `allowGenericRetry` khác `false` → ném (Q1); `retry.maxRetries` vượt mặc định hàng chờ → ném
- [ ] T015 Viết `Q/job-types.ts` cho T014 qua: `defineJobType` (contracts/queue-api.md §1), sổ đăng ký trong tiến trình theo tên, `getJobType(name)`, `validatePayload(def, payload)` (Zod + `JSON.stringify` phong bì ≤ `maxPayloadBytes`, mặc định 8192), `migrate` theo `v` (R13)
- [ ] T016 [P] Viết kiểm thử đơn vị `S/test/unit/queue/redact.spec.ts` rồi `Q/internal/redact.ts`: `redactError(err)` → `{ name, code?, message }` ≤ 2048 byte, bỏ `postgres(ql)?://…`, `Bearer …`, `access_token=…`, giá trị khóa `password|secret|token`, chuỗi base64/hex liền ≥ 32 ký tự; `payloadRef(payload)` chỉ giữ trường tên kết thúc `Id` (R13, contracts/queue-observability.md §2)
- [ ] T017 [P] Viết `Q/internal/runtime/settings.ts`: đọc `infra.queue_settings` bằng `systemTx` (Worker) hoặc `tenantTx`-độc lập qua bể `app` (API chỉ cần `max_retries` khi kiểm `retry` của loại việc – đọc một lần lúc khởi động), kiểm thêm bằng Zod (`heartbeat_seconds × 2 ≤ lock_seconds`), dòng lỗi → giữ giá trị cũ + nhật ký `queue.settings_invalid` + bộ đếm `queue.settings.invalid`; `SettingsCache` đọc lại mỗi `QUEUE_SETTINGS_REFRESH_MS`, phát sự kiện thay đổi (R10)
- [ ] T018 Viết khuôn kiểm thử `S/test/support/queue-test-kit.ts` + `S/test/queue/helpers/queue-db.ts`: mở `DatabaseService` thử theo `dbUrls` của `global-setup`, tạo tài khoản thử A/B, `startTestWorkers(n, opts)` (n thể hiện `QueueRuntime` độc lập – bể + pg-boss riêng), `drain()`, `stop()`, đọc trạng thái việc qua vai trò `owner`; `runJobInline` và `expectIdempotent` để trống chỗ, hoàn thiện ở T036 (contracts/queue-api.md §8, R17)

**Checkpoint**: `pnpm db:setup` + `pnpm db:check` ĐẠT; schema `pgboss` có 6 hàng chờ; sổ đăng ký loại việc chạy được

---

## Phase 3: User Story 1 – Tạo việc nền trong cùng giao dịch (Priority: P1) 🎯 MVP

**Goal**: module tạo/hủy/đổi giờ việc trên kết nối của `tenantTx`/`systemTx`; mã tài khoản, mã theo dõi lấy từ ngữ cảnh

**Independent Test**: trong `tenantTx` của A chèn dòng `sandbox.tenant_notes` + `enqueue` việc thử; hoàn tác → không dòng, không việc; xác nhận → có cả hai, việc mang `accountId` A và `traceId`

### Tests for User Story 1 ⚠️

- [ ] T019 [P] [US1] `S/test/queue/enqueue-tx.queue.spec.ts`: hoàn tác (ném lỗi trong `fn`) → 0 việc, lặp 200 lần (SC-005); xác nhận → việc ở đúng hàng chờ, `data.accountId` = A = `group_id`, `data.traceId` = mã của ngữ cảnh; gọi ngoài giao dịch → `QUEUE_TX_REQUIRED`; loại `tenant` trong `systemTx` không tenant → `QUEUE_TENANT_CONTEXT_REQUIRED`; loại `system` trong `tenantTx` → `QUEUE_SYSTEM_CONTEXT_REQUIRED`; `enqueueMany` 10 việc rồi hoàn tác → 0, trùng khóa trong lô → `QUEUE_DUPLICATE_IN_BATCH` và 0 việc (FR-007/008/009/013)
- [ ] T020 [P] [US1] `S/test/queue/dedupe-reschedule.queue.spec.ts`: hai lần `enqueue` cùng `dedupeKey: 'publish:{id}'` → lần 2 `{ status: 'exists', jobId (của lần 1), state: 'pending' }`; khóa trùng với việc đã `completed` → tạo mới được; `runAfter` +1 giờ → `startTestWorkers(1)` không lấy trong 5 giây; `rescheduleJob`/`cancelJob` theo `jobId` và theo `{ queue, dedupeKey }` khi `created`/`retry` → thành công, cùng giao dịch hoàn tác → không đổi; việc đã `active`/`completed` → `not_pending` + `state`; việc của B nhìn từ ngữ cảnh A → `not_found` (US1 AS3–5, FR-010/011)
- [ ] T021 [P] [US1] `S/test/queue/payload-rules.queue.spec.ts`: dữ liệu sai khuôn → `QUEUE_PAYLOAD_INVALID`, > 8 192 byte → `QUEUE_PAYLOAD_TOO_LARGE`, loại chưa khai báo → `QUEUE_JOB_TYPE_UNKNOWN`; trong cả ba trường hợp giao dịch bị hoàn tác (dòng nghiệp vụ không còn) (US1 AS6, FR-012)
- [ ] T022 [P] [US1] `S/test/queue/queue-privileges.queue.spec.ts`: bằng vai trò `app` trong ngữ cảnh A không `SELECT/UPDATE/DELETE` được việc của B hay việc hệ thống trên `pgboss.job_common`, không chèn được việc `group_id` = B (`DbPolicyViolationError`); `support` không có quyền trên schema `pgboss`; `system` đọc được mọi việc (R12, nguyên tắc I)

### Implementation for User Story 1

- [ ] T023 [US1] Viết `Q/internal/producer.ts`: `enqueue(def, payload, opts)` – `requireCurrentTx()`, kiểm `scope` với `accountId` của giao dịch, `validatePayload`, phong bì `{ type, v, accountId, traceId, payload }`, `id = uuidV7()`, `singletonKey = opts.dedupeKey ?? \`${type}:${id}\`` (≤ 200 ký tự), `group: { id: accountId }` khi tenant, `priority: 10` cho `publish`, `startAfter = opts.runAfter`, `send(..., { db: txDatabase(db) })`; `null` → `findJobs({ key, queued: true, db })` → `exists` + ánh xạ `created→pending`, `retry→retry_wait`, `active→running` (R3, R4)
- [ ] T024 [US1] Thêm `enqueueMany` vào `Q/internal/producer.ts`: ≤ 100 việc, kiểm khóa trùng trong lô, một truy vấn tìm khóa đã có việc hiệu lực (cùng `db`) → `QUEUE_DUPLICATE_IN_BATCH`, rồi `insert()` một câu lệnh (FR-013)
- [ ] T025 [US1] Thêm `cancelJob`/`rescheduleJob` vào `Q/internal/producer.ts`: tìm việc theo `jobId` (`getJobById`) hoặc `{ queue, dedupeKey }` (`findJobs`) trên `db` của giao dịch, chỉ `created`/`retry` mới `cancel`/`update({ startAfter })`, còn lại `not_pending` + trạng thái; không thấy → `not_found` (FR-011)
- [ ] T026 [US1] Viết `Q/queue.module.ts` dạng `QueueModule.forRoot(unit)`: ở `api` khởi tạo `createApiBoss`, `assertSchemaVersion` (đăng ký kiểm tra sẵn sàng `queue`), dừng khi tắt; xuất hàm module-cấp (không phải provider) `enqueue`, `enqueueMany`, `cancelJob`, `rescheduleJob` dùng thể hiện đã khởi tạo; lỗi trước khi khởi tạo → `QUEUE_NOT_STARTED`. Cập nhật `S/src/app/module-registry.ts` nếu cần truyền `unit`
- [ ] T027 [US1] Xuất qua `Q/index.ts` đúng danh sách contracts/queue-api.md §1–3 + kiểu ở T013; xóa giao diện giữ chỗ `QueuePublicApi` rỗng (cập nhật nơi tham chiếu)
- [ ] T028 [US1] Chạy `pnpm test:queue -- enqueue-tx dedupe-reschedule payload-rules queue-privileges` → ĐẠT; nếu RLS trên bảng pg-boss xung đột với lệnh nội bộ của thư viện thì áp phương án lùi R12 (bỏ RLS bảng pg-boss, ngoại lệ trong `db:check`, kiểm thử T022 chuyển sang kiểm `app` không có `DELETE` trên việc hệ thống) và ghi vào "Complexity Tracking" của `specs/003-queue-layer-pgboss/plan.md`

**Checkpoint**: module nghiệp vụ tạo việc được trong giao dịch – MVP của lớp hàng chờ

---

## Phase 4: User Story 2 – Worker xử lý an toàn, không mất việc, không chạy trùng (Priority: P1)

**Goal**: bộ chạy tự quản 6 vòng lấy việc, đặt lại ngữ cảnh, heartbeat, ánh xạ kết quả, chôn việc, tắt có kiểm soát, `/readyz`

**Independent Test**: 2 bản Worker, 500 việc ở nhiều hàng chờ, cưỡng bức dừng một bản → sau heartbeat mọi việc xong đúng một lần, không chồng lấn

### Tests for User Story 2 ⚠️

- [ ] T029 [P] [US2] `S/test/queue/worker-context.queue.spec.ts`: bộ xử lý việc tenant A đọc `sandbox.tenant_notes` qua `tenantTx` chỉ thấy dòng của A, `getExecutionContext()` có `accountId` A + `traceId` của việc; việc hệ thống: `accountId` không có, `tenantTx` → `TENANT_CONTEXT_MISSING`; nhật ký `queue.job_finished` có `trace_id`, `account_id`, `queue`, `job_type`, `attempt`, `duration_ms`, `outcome` (US2 AS1–2, FR-014, FR-033)
- [ ] T030 [P] [US2] `S/test/queue/retry-dead.queue.spec.ts` (dùng `media` với thông số thu nhỏ trong CSDL thử: `retry_delays_seconds = {1,2,3}`): lỗi tạm → `retry` với `start_after` trong `[delay × 0.8, delay × 1.2]`; `retryAfter(2)` → đúng 2 giây; hết lượt → 1 dòng `infra.dead_jobs` `cause = RETRIES_EXHAUSTED` + việc pg-boss bị xóa + `onFinalFailure` được gọi đúng 1 lần trong ngữ cảnh tenant; `PermanentJobError` → chôn ngay `PERMANENT_ERROR`; `noRetry('x')` → `completed`, `output.outcome = 'no_retry'`, không có việc hỏng; hàng chờ `retry_mode = 'handler'` ném lỗi thường → dùng `retry_delays_seconds[1]`, không áp mảng; loại việc không có bộ xử lý → tính lượt, hết lượt → `NO_HANDLER` (Q2); payload sai khuôn lúc xử lý → `PAYLOAD_INVALID` sau hết lượt (US2 AS3–5, FR-015/016/020)
- [ ] T031 [P] [US2] `S/test/queue/no-double-run.queue.spec.ts`: 2 bản, 500 việc chia 4 hàng chờ, bộ xử lý ghi vào bảng đo (bắt đầu/kết thúc, `jobId`) → mỗi việc đúng 1 lượt thành công, 0 khoảng chồng cho cùng `jobId` (SC-002)
- [ ] T032 [P] [US2] `S/test/queue/crash-recovery.queue.spec.ts`: tiến trình con (`child_process.fork` + `tsx`, kịch bản `S/test/queue/helpers/worker-child.ts`) chạy việc dài rồi bị `SIGKILL` → sau ≤ `heartbeat_seconds` + 60 giây việc được bản trong tiến trình chính chạy lại, `retry_count` tăng 1; lượt cũ không ghi được kết quả (`JobAttempt`) (US2 AS6, FR-017, SC-001 dạng thu nhỏ)
- [ ] T033 [P] [US2] `S/test/queue/shutdown.queue.spec.ts`: tiến trình con nhận SIGTERM khi đang chạy việc 5 giây → ngừng lấy việc mới ngay, thoát mã 0 sau khi việc xong; việc 60 giây → thoát mã 1 trong ≤ 35 giây, `AbortSignal` bị hủy, việc chưa bị đánh dấu `completed` và được trả lại sau heartbeat (US2 AS7, FR-018, SC-008)
- [ ] T034 [P] [US2] `S/test/queue/priority.queue.spec.ts`: `media` đầy (2 việc × 2 bản chạy 60 giây + 20 việc chờ), tạo việc `publish` đến giờ → bắt đầu ≤ 30 giây (thực tế ≤ 2 giây với chu kỳ 1 giây) (US2 AS8, FR-004/005, SC-003)
- [ ] T035 [P] [US2] `S/test/queue/readiness.queue.spec.ts`: Worker thử có `GET /readyz` 200 khi bình thường; chặn kết nối bể điều khiển (đóng bể/đổi URL thử) → 503 trong ≤ 30 giây, tiến trình không thoát, nhật ký `queue.fetch_failed`; khôi phục → 200; `schemaVersion` lệch (sửa bảng `pgboss.version` bằng `owner`) → 503 + `queue.schema_version_mismatch` (FR-019, R16)

### Implementation for User Story 2

- [ ] T036 [US2] Viết `Q/internal/runtime/job-runner.ts`: `runJob(job, def, settings)` – giải phong bì, `getJobType` (không có bộ xử lý → lỗi tạm `NO_HANDLER`), `validatePayload` + `migrate`, `runWithJobContext({ traceId, accountId })` (nhập `core/context/bind-account` – được phép cho `modules/queue`), `AbortController` (hủy khi còn 5 giây tới `lock_seconds`, khi `touch` báo 0 dòng, khi tắt quá hạn), heartbeat `touch(attempt)` mỗi 10 giây trên bể điều khiển, đo thời gian; hoàn thiện `runJobInline`, `expectIdempotent` trong `S/test/support/queue-test-kit.ts` dùng cùng hàm (R5, FR-014, FR-035)
- [ ] T037 [US2] Thêm ánh xạ kết quả vào `Q/internal/runtime/job-runner.ts` theo bảng research R7 (một giao dịch trên bể điều khiển cho `fail` + `update(startAfter)`; ngẫu nhiên ≤ 20%; lần thử lại thứ k dùng `retry_delays_seconds[k]`, quá mảng dùng phần tử cuối; `retry_mode = 'handler'` chỉ theo `retryAfter`; `max_retries` của loại việc ≤ hàng chờ); hủy rồi → không ghi kết quả; nhật ký `queue.job_finished` + `queue.job_aborted` theo contracts/queue-observability.md §2 (FR-015, FR-033)
- [ ] T038 [US2] Viết `Q/internal/runtime/bury.ts`: `buryJob(job, cause, error)` – giao dịch `system` tenant from-context (bọc `runWithJobContext`): chèn `infra.dead_jobs` (`ON CONFLICT (original_job_id) DO NOTHING`) + `deleteJob(attempt, { db })`; sau đó gọi `onFinalFailure` trong ngữ cảnh của việc, thành công → `final_failure_notified = true`, lỗi → nhật ký `queue.final_failure_callback_failed` và tăng `final_failure_attempts` (R8, FR-016). Phụ thuộc T041
- [ ] T039 [US2] Viết `Q/internal/runtime/consumer-loop.ts`: một vòng/hàng chờ – `free = concurrency_per_worker − đang chạy`; giao dịch trên bể điều khiển `SELECT pg_advisory_xact_lock(hashtext('queue_fetch:' || $queue))` (bỏ khi `max_per_tenant` NULL) rồi `fetch(queue, { batchSize: free, groupConcurrency: max_per_tenant ?? undefined, includeMetadata: true, db })`; mỗi việc `coordinator.trackInFlight(runJob(...))`; rỗng → chờ `poll_interval_ms`; `DbConnectionError` → giãn cách 1→2→4…≤ 30 giây, nhật ký `queue.fetch_failed`; dừng khi `coordinator.onStopping` (R6, R16, FR-004/005/019)
- [ ] T040 [US2] Viết `Q/internal/runtime/queue-runtime.ts` + nối vào `Q/queue.module.ts` (unit `worker`) và `S/src/worker.ts`: khởi tạo `createWorkerBoss`, `assertSchemaVersion`, `SettingsCache` (đổi `lock/heartbeat/retry` → `updateQueue`, đổi đồng thời → vòng dùng ở lần lấy kế tiếp, nhật ký `queue.settings_applied`), 6 vòng khi `QUEUE_ENABLED`, `registerJobHandler` (ném `QUEUE_HANDLER_ON_API` ở API, ném khi đăng ký trùng), `coordinator.onStopping` → dừng vòng → sau xả `boss.stop({ graceful: false, close: true })`; `worker.ready` ghi đủ 6 hàng chờ (FR-003/004/006/018)
- [ ] T041 [US2] Khai báo `infra.dead_jobs` trong `Q/internal/db/schema.ts` và migration tay `S/drizzle/migrations/0007_dead_jobs.sql` đúng data-model §5: cột `id` uuid PK; `account_id` uuid NULL FK `account.accounts(id) ON DELETE CASCADE`; `original_job_id` uuid NOT NULL UNIQUE; `queue` text NOT NULL; `job_type` text NOT NULL; `payload_version` int NOT NULL; `payload` jsonb NOT NULL; `dedupe_key` text NOT NULL; `cause` text NOT NULL `IN ('RETRIES_EXHAUSTED','PERMANENT_ERROR','NO_HANDLER','PAYLOAD_INVALID','EXPIRED')`; `last_error` jsonb NOT NULL (≤ 2 KB); `attempts` int NOT NULL; `job_created_at` timestamptz NOT NULL; `failed_at` timestamptz NOT NULL DEFAULT now(); `trace_id` text NOT NULL; `generic_retry_allowed` boolean NOT NULL; `final_failure_notified` boolean NOT NULL DEFAULT false; `final_failure_attempts` int NOT NULL DEFAULT 0; `retry_status` text NOT NULL DEFAULT 'none' `IN ('none','requested','retried','rejected_already_active')`; `retry_requested_by` text NULL; `retry_requested_at` timestamptz NULL; `retried_at` timestamptz NULL; `new_job_id` uuid NULL; chỉ mục `(account_id, failed_at)`, `(queue, failed_at)` và `(retry_status) WHERE retry_status = 'requested'` (khai báo `indexExceptions` có lý do); RLS + chính sách `tenant_isolation` TO `app` và `system_scoped` TO `system` (`account_id = account.current_account_id() OR (account_id IS NULL AND account.current_account_id() IS NULL)`); `GRANT SELECT, INSERT, UPDATE, DELETE` cho `app`, `system`; đăng ký bảng `kind: 'tenant'`, `nullableTenant: { reason: 'Việc hệ thống không thuộc tài khoản nào' }`. Thêm `describeCrossTenant` cho `infra.dead_jobs` trong `S/test/db/dead-jobs-isolation.db.spec.ts`
- [ ] T042 [US2] Viết `Q/internal/readiness.ts` (kiểm tra `queue`: phiên bản schema đúng, lần lấy việc/heartbeat thành công gần nhất < 30 giây, không đang tắt) và thêm `GET /readyz` vào `S/src/core/health/worker-health-server.ts` dùng `ReadinessRegistry` (200 `{ status: 'ready', checks }` / 503); giữ `/healthz`; cập nhật `S/test/health.e2e.spec.ts` (FR-019, contracts/queue-commands.md §3)
- [ ] T043 [US2] Chạy `pnpm test:queue -- worker-context retry-dead no-double-run crash-recovery shutdown priority readiness` và `pnpm test:db` → ĐẠT

**Checkpoint**: Worker xử lý việc an toàn trên 2 bản; module nghiệp vụ viết được bộ xử lý

---

## Phase 5: User Story 3 – Giới hạn đồng thời theo tenant (Priority: P1)

**Goal**: số việc đang chạy của một tài khoản trên một hàng chờ ≤ N tính trên mọi bản Worker

**Independent Test**: 2 bản, `media` (1/tenant): A 20 việc, B 2 việc → A ≤ 1 tại mọi lần lấy mẫu; việc của B bắt đầu không chờ hết A

### Tests for User Story 3 ⚠️

- [ ] T044 [P] [US3] `S/test/queue/tenant-limit.queue.spec.ts`: 2 bản, `media` `max_per_tenant = 1`, `concurrency_per_worker = 2`, bộ xử lý 500 ms ghi bảng đo; lấy mẫu `SELECT group_id, count(*) FROM pgboss.job_common WHERE name='media' AND state='active' GROUP BY 1` mỗi 50 ms → A luôn ≤ 1; việc đầu của B bắt đầu trước khi A xong việc thứ 3; `ai_batch` (3/tenant) A ≤ 3; `notify` (không giới hạn) A chạy được 10 đồng thời trên 2 bản; việc hệ thống trên `media` không bị chặn khi A đạt giới hạn (US3 AS1–4, FR-021/022)

### Implementation for User Story 3

- [ ] T045 [US3] Kiểm lại `Q/internal/runtime/consumer-loop.ts` để T044 qua: khóa tư vấn bao đúng câu lệnh `fetch`, giao dịch xác nhận trước khi chạy việc, `groupConcurrency` đọc từ `SettingsCache` ở mỗi lần lấy; thêm chú thích giải thích vì sao cần khóa (R6) – sửa nếu kiểm thử phát hiện vượt giới hạn
- [ ] T046 [US3] Chạy `pnpm test:queue -- tenant-limit` 5 lần liên tiếp → ĐẠT cả 5 (phát hiện đua không ổn định)

**Checkpoint**: chống "hàng xóm ồn ào" trên 2 bản Worker

---

## Phase 6: User Story 4 – Việc hỏng: tra cứu và chạy lại bằng một thao tác (Priority: P2)

**Goal**: tra cứu việc hỏng qua ngữ cảnh hỗ trợ có kiểm toán; yêu cầu chạy lại một thao tác; `publish` bị từ chối (Q1); xóa mọi việc của tài khoản (FR-037)

**Independent Test**: việc luôn lỗi → đúng 1 dòng việc hỏng; `requestDeadJobRetry` → trong ≤ 1 phút có việc mới cùng loại/dữ liệu/khóa, dòng ghi `retried`, có kiểm toán

### Tests for User Story 4 ⚠️

- [ ] T047 [P] [US4] `S/test/queue/dead-jobs-support.queue.spec.ts`: `searchDeadJobs` lọc theo hàng chờ/loại/tài khoản/khoảng thời gian/trạng thái chạy lại, không trả `payload`/`last_error`, ghi `support.search` với `keyword_type = 'dead_job_filter'`; `getDeadJob` với tài khoản A + lý do < 5 ký tự → lỗi, đủ → chi tiết của A, ghi `support.view_account`; `requestDeadJobRetry` → `requested` + kiểm toán `dead_job.retry_requested`; sau khi `queue.dead_job_retries` chạy: việc mới cùng `type`/`payload`/`dedupe_key`, `retry_count = 0`, `data.retriedFrom.traceId` = mã cũ, dòng `retried` + `new_job_id`, kiểm toán `dead_job.retried`; yêu cầu lần 2 khi việc mới còn hiệu lực → `rejected_already_active`, không thêm việc; việc hỏng loại `publish` → `rejected_not_allowed` + kiểm toán `dead_job.retry_rejected`; `tenantTx` của A không thấy việc hỏng của B (US4 AS1–4, AS6, FR-023…025, SC-009)
- [ ] T048 [P] [US4] `S/test/queue/purge-account.queue.spec.ts`: A có việc chờ/chờ thử lại/đang chạy/đã xong + việc hỏng, B cũng vậy; `purgeAccountJobs()` trong `systemTx({ tenant: 'from-context' })` của A → mọi việc và việc hỏng của A mất, của B còn nguyên; bộ xử lý đang chạy của A bị hủy ở nhịp heartbeat kế tiếp, không thử lại, không vào việc hỏng; gọi lại → 0, 0; kiểm toán `queue.account_jobs_purged` chỉ có số lượng; gọi ngoài ngữ cảnh đó → `QUEUE_SYSTEM_TENANT_CONTEXT_REQUIRED` (FR-037)

### Implementation for User Story 4

- [ ] T049 [US4] Bổ sung `S/drizzle/migrations/0007_dead_jobs.sql` (hoặc migration tay mới `0008_dead_jobs_support.sql` nếu 0007 đã chạy ở môi trường dùng chung): hàm `SECURITY DEFINER` chủ `owner`, `SET search_path = pg_catalog, infra`: `infra.cleanup_dead_jobs(older_than_days int) → int`, `infra.claim_dead_job_retries(max int) → setof (id uuid, account_id uuid)` (`FOR UPDATE SKIP LOCKED` trên dòng `requested`), `infra.count_dead_jobs_since(since timestamptz) → setof (queue text, n bigint)` – `EXECUTE` chỉ cho `system`; `infra.request_dead_job_retry(id uuid, staff text, reason text) → text` – `EXECUTE` chỉ cho `support`: một câu lệnh kiểm `generic_retry_allowed`, kiểm không `requested` và việc `new_job_id` không còn `created/retry/active` trong `pgboss.job_common`, đặt `retry_status='requested'`, `retry_requested_by/at`, ghi `infra.audit_log` (`dead_job.retry_requested` | `dead_job.retry_rejected` với `metadata.why`), trả `requested | rejected_not_allowed | rejected_already_active | not_found`; khung nhìn `infra.support_dead_jobs_search` (`id, account_id, queue, job_type, cause, attempts, failed_at, retry_status, retried_at`) và `infra.support_dead_jobs_detail` (mọi cột trừ `final_failure_*`, `WHERE account_id = account.current_account_id()`), `GRANT SELECT` chỉ cho `support` (quy tắc `i`) (R14, data-model §5)
- [ ] T050 [US4] Viết `Q/internal/dead-jobs.ts`: `searchDeadJobs` (`supportSearch(actor, 'dead_job_filter', …)`, `limit ≤ 100`, phân trang `after`), `getDeadJob` (`accountId` → `supportViewAccount`; `null` → khung nhìn tìm kiếm qua `supportSearch`), `requestDeadJobRetry` (gọi hàm `infra.request_dead_job_retry` qua bể `support`) và bộ thực hiện `processDeadJobRetries()` (Worker: `claim_dead_job_retries(20)`, mỗi dòng trong `runWithJobContext` + `systemTx` from-context/none: tạo việc cùng loại/dữ liệu/khóa, `retriedFrom`, cập nhật `retried` + kiểm toán `dead_job.retried`, khóa trùng → `rejected_already_active`) (R14, FR-025)
- [ ] T051 [US4] Viết `Q/internal/purge.ts` `purgeAccountJobs()` theo research R15 (xóa `pgboss.job_common WHERE group_id = account.current_account_id()::text` qua `txDatabase`, xóa `infra.dead_jobs`, kiểm toán `{ jobs, dead_jobs }`); xuất `searchDeadJobs`, `getDeadJob`, `requestDeadJobRetry`, `purgeAccountJobs` qua `Q/index.ts` (FR-037)
- [ ] T052 [US4] Khai báo loại việc nội bộ + lịch `queue.sweep_failed` (`* * * * *`: chôn mọi việc `failed` của 6 hàng chờ với `cause = EXPIRED` nếu lần cuối do hết khóa, ngược lại `RETRIES_EXHAUSTED`; gọi lại `onFinalFailure` cho dòng `final_failure_notified = false AND final_failure_attempts < 5`) và `queue.dead_job_retries` (`* * * * *`, gọi `processDeadJobRetries`) trong `Q/jobs.ts` (cần bộ hẹn giờ của US5 – trước khi có, kiểm thử T047 gọi `processDeadJobRetries()` trực tiếp) (R8, R14)
- [ ] T053 [US4] Chạy `pnpm test:queue -- dead-jobs-support purge-account` và `pnpm db:check` (khung nhìn chỉ cấp `support`) → ĐẠT

**Checkpoint**: hỗ trợ tra cứu/chạy lại việc hỏng qua thao tác máy chủ; luồng xóa tài khoản dọn được hàng chờ

---

## Phase 7: User Story 5 – Việc định kỳ đúng một lần mỗi khung trên nhiều bản (Priority: P2)

**Goal**: `defineSchedule` + bộ hẹn giờ trên mọi bản, khóa khung `infra.schedule_slots`, chống chồng, việc định kỳ nội bộ (dọn dẹp, phân vùng)

**Independent Test**: 2 bản, lịch "mỗi 2 giây" (6 trường, chỉ test) × 15 khung → đúng 15 lần chạy, 0 trùng; tắt 1 bản giữa chừng → 0 bỏ khung

### Tests for User Story 5 ⚠️

- [ ] T054 [P] [US5] Kiểm thử đơn vị `S/test/unit/queue/slots.spec.ts`: `currentSlot(cron, tz, dbNow)` – thứ Hai 05:00 `Asia/Ho_Chi_Minh` → `slot_at` = 22:00 UTC Chủ nhật, `slot` = `…T05:00+07:00`; `0 0 1 * *` tháng có 30/31 ngày và tháng 2; lịch phút/giờ dùng UTC; cron 6 trường bị từ chối khi `APP_ENV ≠ test`; tính giãn cách thử lại (`retry_delays_seconds[k]`, quá mảng dùng phần tử cuối, ngẫu nhiên ≤ 20%)
- [ ] T055 [P] [US5] `S/test/queue/schedule.queue.spec.ts`: 2 bản, lịch `*/2 * * * * *` × 15 khung → bảng đo có đúng 1 lần/khung, `infra.schedule_slots` 15 dòng `enqueued`; bộ xử lý chạy 5 giây với lịch mỗi 2 giây → khung chồng ghi `skipped_overlap`, không hai lượt cùng tên chồng nhau; dừng 1 bản giữa chừng → không khung nào thiếu; dừng cả 2 qua ≥ 3 khung rồi bật lại → chỉ khung hiện tại chạy (không bù hàng loạt), `late_seconds` ghi đúng; giờ máy Worker lệch (giả lập `Date.now` +5 phút) không đổi khung – khung tính bằng giờ CSDL (US5 AS1–4, FR-026…028, edge case đồng hồ lệch)
- [ ] T056 [P] [US5] `S/test/queue/maintenance.queue.spec.ts`: chạy bộ xử lý `queue.cleanup` → xóa `infra.dead_jobs` có `failed_at` > 90 ngày (giữ dòng 89 ngày) và `schedule_slots` > 90 ngày; `queue.partitions` → phân vùng `audit_log` tháng kế tiếp và tháng sau đó tồn tại, chạy lại không lỗi; phân vùng > 12 tháng bị bỏ, 12 tháng giữ lại; xác nhận hàng chờ có `deleteAfterSeconds = 2592000` (việc xong > 30 ngày do pg-boss dọn) (US5 AS5–6, FR-029)

### Implementation for User Story 5

- [ ] T057 [US5] Khai báo `infra.schedule_slots` trong `Q/internal/db/schema.ts` (`sharedTable(…, { reason: 'Khung chạy của việc định kỳ hệ thống' })`, PK ghép `(name, slot)` – thêm tùy chọn khóa chính ghép cho `sharedTable` trong `S/src/core/db/table-builders.ts` nếu chưa có) với cột `name` text, `slot` text (giờ địa phương ISO đầu khung), `slot_at` timestamptz, `status` text `IN ('enqueued','skipped_overlap')`, `job_id` uuid NULL, `late_seconds` int, `created_at` timestamptz; migration `S/drizzle/migrations/0008_schedule_slots_partitions.sql` (đánh số tiếp nếu T049 dùng 0008) gồm bảng, `GRANT SELECT, INSERT, UPDATE, DELETE` chỉ cho `system`, và hàm `infra.drop_audit_log_partitions_before(months int)` `SECURITY DEFINER` (`EXECUTE` cho `system`, chỉ bỏ phân vùng kết thúc trước `date_trunc('month', now()) - months`) (data-model §6, §8)
- [ ] T058 [US5] Viết `Q/schedules.ts` + `Q/internal/scheduler/slots.ts`: `defineSchedule` (tên duy nhất, `jobType` phải `scope: 'system'`, `tz` mặc định `Asia/Ho_Chi_Minh` cho lịch ngày/tuần/tháng và `UTC` cho phút/giờ, cron 6 trường chỉ khi `APP_ENV=test`), `currentSlot` dùng `cron-parser` cho T054; `registerPartitionedLog` (data-model §8) và đăng ký sẵn `infra.audit_log` (`ensure_audit_log_partitions`, `monthsAhead: 2`, `retentionMonths: 12`, `drop_audit_log_partitions_before`) (R9, FR-026)
- [ ] T059 [US5] Viết `Q/internal/scheduler/scheduler.ts` và nối vào `queue-runtime.ts`: nhịp `QUEUE_SCHEDULER_TICK_MS`, `SELECT now()` của CSDL, với mỗi lịch tính khung gần nhất; một giao dịch `systemTx`: `INSERT … ON CONFLICT DO NOTHING` vào `infra.schedule_slots`, chèn được → `enqueue` việc với `dedupeKey: 'scheduled:{name}'` → `exists` thì cập nhật `status = 'skipped_overlap'`; nhật ký `queue.schedule_slot`; dừng khi `onStopping` (R9, FR-027/028)
- [ ] T060 [US5] Viết việc định kỳ nội bộ trong `Q/jobs.ts` + bộ xử lý ở `queue-runtime.ts`: `queue.cleanup` (`30 3 * * *` UTC+7: `cleanup_dead_jobs(90)`, xóa `schedule_slots` có `slot_at` > 90 ngày), `queue.partitions` (`0 4 1 * *` UTC+7 và chạy một lần khi Worker khởi động: gọi `ensureFunction(monthsAhead)` và `dropFunction(retentionMonths)` cho mọi bảng đã đăng ký), bật lịch `queue.sweep_failed`, `queue.dead_job_retries` của T052 (FR-029)
- [ ] T061 [US5] Chạy `pnpm test` (đơn vị) và `pnpm test:queue -- schedule maintenance dead-jobs-support` → ĐẠT

**Checkpoint**: module nghiệp vụ đăng ký được việc định kỳ; dọn dẹp và phân vùng tự chạy

---

## Phase 8: User Story 6 – Quan sát hàng chờ, cấu hình không cần phát hành (Priority: P2)

**Goal**: 6 chỉ số theo hàng chờ qua OpenTelemetry API, 10 quy tắc cảnh báo trong kho mã, thông số đổi trong CSDL có hiệu lực ≤ 5 phút

**Independent Test**: gắn `MeterProvider` thử → đọc đủ chỉ số theo hàng chờ, không nhãn `account_id`; đổi `concurrency_per_worker` trong CSDL → Worker áp dụng ở lần đọc kế tiếp không khởi động lại

### Tests for User Story 6 ⚠️

- [ ] T062 [P] [US6] `S/test/queue/metrics.queue.spec.ts`: với `MeterProvider` + `InMemoryMetricExporter` của `@opentelemetry/sdk-metrics` → sau khi chạy việc thành công/lỗi/hỏng có `queue.jobs.waiting`, `queue.jobs.oldest_wait_seconds`, `queue.job.duration`, `queue.jobs.finished`, `queue.dead_jobs.created`, `queue.dead_jobs.last_24h`, `queue.workers.live` (= số bản đang chạy), mỗi chỉ số theo hàng chờ có nhãn `queue`; không điểm dữ liệu nào có nhãn `account_id`/`job_id`/`dedupe_key`; tạo việc `publish` `runAfter` quá khứ 6 phút khi không có Worker `publish` → `oldest_wait_seconds{queue="publish"} > 300` (US6 AS1, Independent Test, FR-031)
- [ ] T063 [P] [US6] `S/test/queue/settings.queue.spec.ts` (`QUEUE_SETTINGS_REFRESH_MS = 1000`): `UPDATE infra.queue_settings SET concurrency_per_worker = 1` cho `ai_batch` → sau ≤ 2 giây mỗi bản chỉ chạy 1 việc `ai_batch` cùng lúc, không khởi động lại; đổi `lock_seconds` → `pgboss.queue` có `expire_seconds` mới; ghi giá trị vi phạm CHECK → CSDL từ chối; giá trị qua được CHECK nhưng sai quy tắc Zod (`heartbeat_seconds × 2 > lock_seconds`) → giữ giá trị cũ + nhật ký `queue.settings_invalid` + bộ đếm tăng (US6 AS3, FR-006, SC-010)
- [ ] T064 [P] [US6] Kiểm thử đơn vị `S/test/unit/queue/alert-rules.spec.ts`: đọc `ops/alerts/queue.rules.yml` bằng `yaml` → có đúng 10 quy tắc tên ở contracts/queue-observability.md §3 (`QueuePublishOldestWaitHigh`, `QueueMediaOldestWaitHigh`, `QueueNotifyOldestWaitHigh`, `QueuePublishDeadJob`, `QueueDeadJobsHigh`, `QueueErrorRateHigh`, `QueueBacklogGrowing`, `QueueMediaVideoP95High`, `QueueWorkersLow`, `QueueSettingsInvalid`), ngưỡng đúng (300/600/300 giây, > 0, > 10, 5%/15 phút, 30 phút, 480 giây, < 2), mọi biểu thức chỉ tham chiếu chỉ số ở §1 (US6 AS2, FR-032)

### Implementation for User Story 6

- [ ] T065 [US6] Viết `Q/internal/observability.ts`: meter `app.queue` qua `@opentelemetry/api` với 8 công cụ đo theo contracts/queue-observability.md §1 (nhãn `queue`, `job_type`, `outcome`, `cause` – không `account_id`); gauge quan sát được cập nhật mỗi 30 giây từ một truy vấn `pgboss.job_common` theo hàng chờ (bể điều khiển), `infra.count_dead_jobs_since(now() - interval '24 hours')`, `getInstances()` đếm `live` tên `worker`; nối bộ đếm/histogram vào `job-runner.ts` và `bury.ts`, bộ đếm `settings.invalid` vào `settings.ts` (R11, FR-031)
- [ ] T066 [P] [US6] Tạo `ops/alerts/queue.rules.yml` (nhóm `queue`, 10 quy tắc, biểu thức `max by (queue)` theo contracts/queue-observability.md §3, chú thích tiếng Việt kèm cách xử lý cho từng cảnh báo) (FR-032)
- [ ] T067 [US6] Hoàn thiện áp dụng thông số động trong `Q/internal/runtime/queue-runtime.ts` cho T063 (đồng thời mới áp ở lần lấy kế tiếp; `updateQueue` idempotent khi `lock/heartbeat/retry` đổi; ghi `queue.settings_applied` với các trường đã đổi) (FR-006)
- [ ] T068 [US6] Chạy `pnpm test:queue -- metrics settings` và `pnpm test` → ĐẠT

**Checkpoint**: vận hành thấy được hàng chờ và chỉnh thông số không cần phát hành

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T069 [P] `S/test/queue/secrets-in-logs.queue.spec.ts`: thu toàn bộ nhật ký pino của các kịch bản (bộ xử lý ném lỗi chứa chuỗi kết nối `postgres://u:p@h/db`, `Bearer abc…`, `access_token=…`) + mọi `infra.dead_jobs.last_error` → 0 lần xuất hiện của mẫu bí mật, của `payload` đầy đủ, của trường bị cấm (SC-011)
- [ ] T070 [P] Viết `S/test/queue/soak/soak.queue.spec.ts` (`pnpm test:queue-soak`): SC-001 (2 bản, 1 000 việc, giết tiến trình con ngẫu nhiên 5 lần → 100% `completed` hoặc dòng `dead_jobs` có lý do, không việc nào `active` quá `lock_seconds` + 60 giây), SC-002, SC-004 (tài khoản ồn ào 50 việc `media` + 5 tài khoản × 2 → giới hạn không vượt, 5 tài khoản bắt đầu trước khi tài khoản ồn ào xong 13 việc), SC-006 (60 khung lịch `*/5 * * * * *`, 0 trùng, 0 bỏ khi còn một bản), SC-007 (đo `enqueue` 1 000 lần trong `tenantTx` → in p95, kiểm ≤ 10 ms)
- [ ] T071 [P] Viết tài liệu `S/docs/queue.md` (tiếng Việt, FR-036): khai báo loại việc (ví dụ `publishing.execute_attempt` với `allowGenericRetry: false`), tạo việc trong giao dịch, hủy/đổi giờ, viết bộ xử lý chạy lại an toàn + `expectIdempotent`, báo lỗi tạm/vĩnh viễn/`retryAfter`/`noRetry`, đăng ký việc định kỳ + `registerPartitionedLog`, tra cứu/chạy lại việc hỏng (Q1 – `publish` dùng "Đăng lại"), `purgeAccountJobs`, thông số `infra.queue_settings` và cách đổi, chỉ số/cảnh báo, nâng phiên bản pg-boss (`pnpm queue:sql --migrate-from`), bảng "Danh sách việc định kỳ chờ module đăng ký" (11 việc ở kiến trúc mục 6 trừ dọn dẹp/phân vùng – FR-030), bảng "Lịch sử diễn tập"
- [ ] T072 [P] Cập nhật `.specify/memory/architecture.md`: mục 11 thêm thuật ngữ cuối research.md; mục 4 dòng Queue ghi bảng `queue_settings`, `dead_jobs`, `schedule_slots` + schema `pgboss`; mục 6 ghi chú hiện thực (exclusive, heartbeat 30 giây, khóa lấy việc, bảng khung); tăng phiên bản lên 1.3 kèm dòng thay đổi
- [ ] T073 [P] Thêm `pnpm test:queue` vào `tooling/verify.mjs` sau `test:db` (bỏ qua có thông báo khi thiếu `TEST_DATABASE_ADMIN_URL`, như `test:db`)
- [ ] T074 Diễn tập SC-012 theo quickstart §5 (khai báo `sandbox.echo`, bộ xử lý ghi `sandbox.tenant_notes`, tạo việc trong `tenantTx`, kiểm thử `expectIdempotent`) trên nhánh, đo thời gian, ghi vào "Lịch sử diễn tập" của `S/docs/queue.md`, rồi xóa mã thử
- [ ] T075 Chạy `pnpm verify` (typecheck, lint, check:boundaries, test, test:db, test:queue) và `pnpm test:queue-soak` một lần → ĐẠT; rà `/constitution-review` cho thay đổi (nhất là nguyên tắc I, II) và sửa phát hiện

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: không phụ thuộc
- **Foundational (Phase 2)**: sau Phase 1 – CHẶN mọi story (T007 cần T006; T009 cần T007, T008)
- **US1 (Phase 3)**: sau Phase 2
- **US2 (Phase 4)**: sau US1 (kiểm thử cần `enqueue`); T038 cần T041
- **US3 (Phase 5)**: sau US2 (mở rộng vòng lấy việc)
- **US4 (Phase 6)**: sau US2 (cần `buryJob`, `infra.dead_jobs`); T052 bật lịch thật khi US5 xong
- **US5 (Phase 7)**: sau US2; song song được với US3, US4, US6
- **US6 (Phase 8)**: sau US2; song song được với US3–US5
- **Polish (Phase 9)**: sau mọi story mong muốn

### User Story Dependencies

```text
Setup → Foundational → US1 → US2 ─┬─► US3
                                  ├─► US4 ──(lịch thật)──┐
                                  ├─► US5 ───────────────┴─► Polish
                                  └─► US6
```

### Within Each User Story

- Kiểm thử viết trước, chạy thất bại, rồi mới cài đặt
- Migration/schema → bộ nối/dịch vụ nội bộ → xuất qua `index.ts` → nối vào `queue.module.ts`/`worker.ts`
- Việc "Chạy … → ĐẠT" cuối mỗi phase là điểm kiểm

### Parallel Opportunities

- Phase 1: T002–T005 song song sau T001
- Phase 2: T010–T014, T016, T017 song song (khác tệp); T015 sau T014; T018 sau T011/T012
- Kiểm thử của mỗi story ([P]) song song với nhau
- Sau US2: US3, US5, US6 làm song song bởi nhiều người; US4 song song nhưng T052 chờ US5 để bật lịch
- Phase 9: T069–T073 song song

---

## Parallel Example: User Story 2

```text
# Viết cùng lúc các kiểm thử (khác tệp):
T029 worker-context.queue.spec.ts   T030 retry-dead.queue.spec.ts
T031 no-double-run.queue.spec.ts    T032 crash-recovery.queue.spec.ts
T033 shutdown.queue.spec.ts         T034 priority.queue.spec.ts
T035 readiness.queue.spec.ts
# Rồi: T041 (dead_jobs) song song với T036 (job-runner); T037 → T038 → T039 → T040 → T042
```

## Parallel Example: sau US2

```text
Người A: US3 (T044–T046)    Người B: US5 (T054–T061)    Người C: US6 (T062–T068)
```

---

## Implementation Strategy

### MVP First (User Story 1 + 2)

1. Phase 1 + Phase 2 → `pnpm db:setup`, `pnpm db:check` ĐẠT
2. Phase 3 (US1) → module tạo việc trong giao dịch được (dừng, kiểm chứng độc lập)
3. Phase 4 (US2) → Worker chạy việc an toàn – đây là MVP có giá trị cho WBS sau (đăng bài cần cả hai)

### Incremental Delivery

1. + US3 → chống hàng xóm ồn ào (bắt buộc trước khi có module media/ai_batch)
2. + US5 → việc định kỳ (bắt buộc trước module account – mở chu kỳ, ai_gateway – trả giữ chỗ)
3. + US4 → hỗ trợ chạy lại việc hỏng (trước WBS 4.7)
4. + US6 → chỉ số/cảnh báo (trước WBS 1.5/1.6)
5. Polish → tài liệu, chịu tải, `verify`

### Notes

- Mỗi việc một commit nhỏ; migration mới không sửa migration đã chạy ở môi trường dùng chung
- Không để kiểu pg-boss lọt qua `Q/index.ts` (kiểm bằng `check:boundaries` + đọc lại `index.ts`)
- Phương án lùi R12 (RLS trên bảng pg-boss) quyết ở T028, ghi vào plan nếu dùng
