---

description: "Danh sách việc – 005 Khung giao diện công khai + bản giả lập"
---

# Tasks: Khung giao diện công khai + bản giả lập – Cổng nền tảng, Cổng AI, Thông báo, Kho tệp

**Input**: Tài liệu thiết kế trong `specs/005-gateway-contracts-fakes/` – [plan.md](plan.md), [spec.md](spec.md),
[research.md](research.md) (R1–R18), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (đủ)

**Tests**: **BẮT BUỘC**. Bộ kiểm thử hợp đồng là sản phẩm của tính năng (FR-004, FR-037, SC-001…SC-009) và hiến pháp
yêu cầu kiểm thử theo vùng rủi ro (Cổng AI đồng thời/ngưỡng/chặn/trả lại; kiểm thử hợp đồng cho mọi bộ chuyển đổi;
bộ xử lý chạy lại hai lần; truy cập chéo). Viết kiểm thử hợp đồng **trước** bản cài đặt trong mỗi câu chuyện, chạy
thấy đỏ rồi mới cài đặt.

**Organization**: Theo câu chuyện người dùng (US1…US6) để làm và kiểm độc lập.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: chạy song song được (khác tệp, không phụ thuộc việc chưa xong)
- **[Story]**: US1…US6 theo spec.md
- Đường dẫn tính từ gốc repo; `S/` = `apps/server/src/`, `T/` = `apps/server/test/`

## Quy ước chung cho mọi việc

- Ghi chú mã bằng tiếng Việt; định danh tiếng Anh theo bảng thuật ngữ data-model.md mục 0.
- Kết quả nghiệp vụ là hợp đóng có `kind`; chỉ lỗi lập trình/hạ tầng mới ném (R1).
- Không thao tác nào nhận `accountId`; lấy `currentAccountId()` từ ngữ cảnh 002.
- Tiền là số nguyên micro-USD (`number` trên hợp đồng, `microUsd()`/`bigint` trong CSDL); không số thực.
- Mọi thao tác của 4 hợp đồng đi qua `withGatewayOp` (T017): nhật ký pino `<component>.<op>` + span OTel; không ghi
  mã quyền, lời nhắc, văn bản AI, nội dung bài.
- Bản giả lập và mọi thứ trong `S/dev/` chỉ được ghép khi `APP_ENV ∈ {development, test}`.

---

## Phase 1: Setup (khởi tạo chung)

**Purpose**: Đưa nhánh lên nền 003 + 004, thêm phụ thuộc và hạ tầng dev.

- [X] T001 Hợp nhất `dev` vào `impl/005-gateway-contracts-fakes` (`git merge dev`, giải xung đột nếu có – nhánh tách từ `f60cc56` trước khi 003/004 vào `dev`, research.md "Điều kiện tiên quyết"); chạy `pnpm install` và `pnpm verify` để có mốc sạch trước khi sửa
- [X] T002 Thêm `@aws-sdk/client-s3`, `@aws-sdk/s3-presigned-post`, `@aws-sdk/s3-request-presigner` với **phiên bản chính xác, cùng một dòng phát hành** (không `^`/`~`) vào `apps/server/package.json`; `pnpm install` cập nhật `pnpm-lock.yaml`
- [X] T003 [P] Tạo `apps/server/vitest.infra.config.mts` (chỉ gồm `test/contracts/**/*.infra.contract.spec.ts`, tuần tự, timeout 30 s) và script `test:infra` trong `apps/server/package.json` + `test:infra` ở `package.json` gốc (`pnpm --filter @app/server test:infra`)
- [X] T004 [P] Sửa `docker-compose.yml`: thêm dịch vụ `minio` (khóa tag phát hành cụ thể, cổng `9000`/`9001`, người dùng/mật khẩu `*_dev_only`) và `minio-init` (ảnh `minio/mc` khóa tag; tạo bucket `app-dev`, CORS cho `http://localhost:8080,http://localhost:5173`, luật vòng đời lọc theo **nhãn đối tượng** `lifecycle=tmp` hết hạn 1 ngày – tệp tạm nằm ở `tenants/{acc}/tmp/{jobId}/…` nên không lọc được theo tiền tố); `x-server-env` thêm `PLATFORM_GATEWAY_DRIVER=fake`, `AI_GATEWAY_DRIVER=fake`, `NOTIFICATIONS_DRIVER=fake`, `STORAGE_DRIVER=s3`, `FAKE_STATE_STORE=sandbox`, `S3_*` trỏ `http://minio:9000`, `S3_PUBLIC_ENDPOINT=http://localhost:9000`, `S3_FORCE_PATH_STYLE=true`; worker `depends_on: mailpit, minio-init`; ghi chú đầu tệp "MinIO và Mailpit chỉ dùng ở dev" (contracts/runtime-config.md mục 4)
- [X] T005 [P] Cập nhật `apps/server/.env.example` với toàn bộ biến ở contracts/runtime-config.md mục 1 (giá trị dev, bí mật S3 để giá trị `*_dev_only`)
- [X] T006 [P] Tạo `T/helpers/deny-egress.cjs`: vá `net.Socket.prototype.connect`/`tls.connect`/`dns.lookup` để ném khi đích không phải `localhost`, `127.0.0.1`, `::1` hoặc tên dịch vụ compose (`postgres`, `mailpit`, `minio`, `api`, `worker`); có thông điệp nêu rõ máy đích (SC-007)

---

## Phase 2: Foundational (nền chặn mọi câu chuyện)

**Purpose**: Cấu hình chọn bản cài đặt, schema `sandbox`, quy tắc ranh giới, khả năng mới của `queue`/`account`,
bộ ghi nhật ký thao tác cổng.

**⚠️ CRITICAL**: Chưa xong phase này thì chưa bắt đầu câu chuyện nào.

- [X] T007 Mở rộng `S/core/config/config.schema.ts` (`AppConfigSchema`, Zod): `PLATFORM_GATEWAY_DRIVER: 'fake'`, `AI_GATEWAY_DRIVER: 'fake'`, `NOTIFICATIONS_DRIVER: 'fake'`, `STORAGE_DRIVER: 'memory' | 's3'`, `FAKE_STATE_STORE: 'memory' | 'sandbox'` (bắt buộc khi có driver `fake`), `S3_ENDPOINT` (URL, bắt buộc khi `s3`), `S3_PUBLIC_ENDPOINT` (URL, mặc định = `S3_ENDPOINT`), `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` (bọc `secret()`), `S3_FORCE_PATH_STYLE` (bool), `AI_SYSTEM_WEEKLY_CAP_MICRO_USD` (int ≥ 0, mặc định 2 000 000), `PLATFORM_SUBMIT_TIMEOUT_MS` (5 000–120 000, mặc định 30 000), `AI_PROVIDER_TIMEOUT_MS` (mặc định 40 000), `AI_FIRST_TOKEN_TIMEOUT_MS` (mặc định 5 000); chuyển `MAIL_*` (gồm `MAIL_TRANSPORT: 'memory' | 'smtp'`) từ `S/core/config/auth-config.ts` sang cấu hình chung để Worker đọc được, giữ tương thích chỗ gọi của 004
- [X] T008 Tạo `S/core/config/assert-no-fakes.ts` – `assertNoFakesInProduction(config)` gọi trong `S/core/config/load-config.ts`: khi `APP_ENV ∈ {staging, production}` mà có `*_DRIVER=fake`, `STORAGE_DRIVER=memory`, `MAIL_TRANSPORT=memory` hoặc `FAKE_STATE_STORE` được đặt → `ConfigError` liệt kê **đủ** biến vi phạm, dạng `Môi trường production không được dùng bản giả lập: PLATFORM_GATEWAY_DRIVER=fake, AI_GATEWAY_DRIVER=fake`; tiến trình thoát mã 1 ở cả API và Worker
- [X] T009 Tạo `S/core/gateways/selection.ts`: `readGatewaySelection(config)` trả `{ platform, ai, notifications, storage, mail, fakeState }`; `logGatewaySelection(logger, sel)` ghi một dòng `gateways.selected`; `assertSandboxSchemaReady(db)` – `FAKE_STATE_STORE=sandbox` mà chưa có schema `sandbox` → dừng với "Chưa có schema sandbox – chạy `pnpm db:setup`"; gọi cả ba trong `S/api.ts` và `S/worker.ts` lúc khởi động (US6-AS1)
- [X] T010 [P] Viết `T/unit/gateway-selection.spec.ts`: mọi tổ hợp có ≥ 1 thành phần giả với `APP_ENV=production` và `staging` → `ConfigError` nêu đúng tên biến (SC-006); dev/test cho qua; `readGatewaySelection` cho API và Worker cùng kết quả từ cùng biến môi trường
- [X] T011 Tạo `S/core/gateways/op-log.ts` – `withGatewayOp(component, op, attrs, fn)`: mở span OTel `<component>.<op>` (`@opentelemetry/api`), ghi một dòng pino `{ msg: '<component>.<op>', trace_id, account_id | scope:'system', outcome, duration_ms, ...attrs }`; `attrs` chỉ nhận khóa trong danh sách an toàn (`connection_id`, `channel_type`, `task`, `model_tier`, `input_tokens`, `output_tokens`, `kind`…) – khóa lạ bị bỏ (FR-007, R16); thêm thiết lập Vitest chung (`apps/server/test/setup/log-capture.ts`, khai báo trong mọi cấu hình vitest của server) đặt `logDestination` ghi nhật ký ra `apps/server/test-logs/<tên-tệp-kiểm-thử>.ndjson`, thêm `apps/server/test-logs/` vào `.gitignore`
- [X] T012 Sửa `S/modules/modules.manifest.json`: `ai_gateway.allowedDeps += "notifications"`, `content.allowedDeps += "notifications"`, `approval.allowedDeps += "notifications"`; `notifications.allowedDeps` giữ `account, queue`; `account` **không** thêm `notifications` (FR-046, R17)
- [X] T013 Thêm 4 quy tắc vào `tooling/boundaries/build-rules.cjs` (R17): (1) `S/core/storage` chỉ được nhập từ `modules/media`, `modules/context`, `modules/account`, `S/app/**`, `S/dev/**`; (2) `enqueueRegistered` của `queue` chỉ được nhập từ `modules/account`; (3) `S/dev/**` không được nhập từ `modules/*` ngoài `modules/*/internal/fake/**`, và mã ngoài `S/dev`/`internal/fake` không nhập `S/dev/sandbox`; (4) `@aws-sdk/*` chỉ trong `S/core/storage/s3/`
- [X] T014 [P] Tạo fixture vi phạm `tooling/boundaries/fixtures/{n-storage-outside-allowed, o-enqueue-registered-outside-account, p-dev-imported-by-module, q-aws-sdk-outside-storage}/` (mỗi fixture có `modules.manifest.json` + `expected.json` theo khuôn fixture `a-internal-import`) và thêm ca vào `tooling/boundaries/boundaries.spec.ts`; fixture `clean` vẫn sạch
- [X] T015 Thêm `enqueueRegistered(tx, typeName, payload, options?)` vào `S/modules/queue/internal/producer.ts` cạnh `enqueue` (tra `getJobType(typeName)` của `S/modules/queue/job-types.ts`, chưa đăng ký → ném `queueError('QUEUE_JOB_TYPE_UNKNOWN')`; kiểm payload bằng `validatePayload` như `enqueue`), xuất qua `S/modules/queue/public-api.ts` và `S/modules/queue/index.ts`; kiểm thử `T/queue/enqueue-registered.spec.ts` (đã đăng ký → tạo việc trong `tx`; chưa đăng ký → ném; payload sai khuôn → ném)
- [X] T016 Thêm `listActiveMembers(): Promise<{ userId, role: 'owner' | 'collaborator', email, displayName }[]>` vào `S/modules/account/public-api.ts` + cài đặt trong `S/modules/account/` (đọc qua `tenantTx`, chỉ thành viên đang hoạt động của tài khoản trong ngữ cảnh); kiểm thử `T/db/account-list-members.db.spec.ts` (A không thấy thành viên của B; thành viên đã gỡ không xuất hiện)
- [X] T017 Tạo `S/dev/sandbox/schema.ts` với 13 bảng của data-model.md mục 5 (dùng `tenantTable` cho bảng tenant – `account_id NOT NULL`, RLS `tenant_isolation`, chỉ mục bắt đầu bằng `account_id`; `sharedTable` cho bảng hệ thống), đúng ràng buộc: `fake_scenarios` idx `(account_id, component, target)`, `component` ∈ `platform|ai|notifications|mail`, `remaining_uses int null`; `pg_fake_oauth_states` unique `state_hash` (bytea); `pg_fake_connections` unique `(account_id, channel_type, external_id) WHERE status <> 'disconnected'`; `pg_fake_posts` idx `(account_id, connection_id, content_hash)` **không unique – cố ý để lộ đăng trùng**, `state` ∈ `processing|published|failed`; `ai_fake_budgets` PK `(account_id, cycle_start)` + `CHECK (used >= 0 AND reserved >= 0 AND used + reserved <= cap)`; `ai_fake_reservations` có `state` ∈ `held|calling|settled|released`, `called_at timestamptz null`, idx `(account_id, state, reserved_at)`; `ai_fake_cost_ledger.anomaly` ∈ `over_estimate|unsettled|null`; `ai_fake_cost_ledger` idx `(account_id, cycle_start)`; `ai_fake_system_budgets` PK `week_start` + cùng `CHECK`; `ai_fake_system_reservations`, `ai_fake_system_cost_ledger` (+ `industry_id`); `ntf_fake_events` unique `(account_id, dedupe_key)`; `ntf_fake_notifications` unique `(account_id, dedupe_key, recipient_user_id, channel)`; không khóa ngoại ra ngoài `sandbox` trừ `account_id → account.accounts`; tiền dùng `microUsd()`
- [X] T018 Thêm `S/dev/sandbox/schema.ts` vào `apps/server/drizzle.dev.config.ts` (cùng `T/db/sandbox/schema.ts`), chạy `pnpm --filter @app/server db:generate:dev` sinh migration vào `apps/server/drizzle/migrations-dev/`; kiểm `pnpm db:setup` áp được và `pnpm db:check` không báo bảng có `account_id` thiếu RLS
- [X] T019 [P] Viết `T/db/sandbox-fakes-isolation.db.spec.ts`: với **mọi** bảng tenant `sandbox.*fake*` – đăng nhập A thử đọc/sửa/xóa dòng của B → thất bại; bảng `ai_fake_system_*` không ghi được từ vai trò tenant; migration dev không áp khi `APP_ENV=production` (khuôn kiểm thử của 002)
- [X] T020 Tạo `S/dev/sandbox/scenario-store.ts` – `ScenarioStore` ×2 (`memory`, `sandbox` trên `fake_scenarios`): `put({ component, target, spec, remainingUses? })`, `list()`, `delete(id)`, `clear()`, `take(component, target)` lấy kịch bản khớp `target` rồi `*`, giảm `remaining_uses` bằng cập nhật có điều kiện (`remaining_uses > 0`), hết thì tự xóa; luôn trong ngữ cảnh tenant. Cùng việc này tạo `S/dev/memory-tx.ts` – `memoryTx(): Db` (vật thế chỗ giao dịch cho chế độ `memory`, đúng kiểu `Db` để truyền vào `emit`/`onCrossed`, mọi lời gọi chạy SQL ném lỗi "memoryTx không chạy được SQL – sai chế độ FAKE_STATE_STORE") và `isMemoryTx(tx)` (**chỉ** dùng trong `modules/*/internal/fake/**` – quy tắc ranh giới T013 chặn mã thật nhập `S/dev`); kiểm thử `T/unit/dev/memory-tx.spec.ts` (research R9b)
- [X] T021 Thêm mẫu canary `fake_tok_`, `PROMPT_CANARY_`, `POST_CANARY_` vào `tooling/scan-secrets.mjs`, cho công cụ quét thư mục `apps/server/test-logs/` (do T011 ghi ra), và nối bước quét này vào `tooling/verify.mjs` sau bước chạy kiểm thử (CI chặn hợp nhất khi thấy canary – SC-009); thêm ca kiểm thử tương ứng của công cụ

**Checkpoint**: `pnpm verify` + `pnpm test:db` xanh; cấu hình chặn production; schema `sandbox` sẵn sàng.

---

## Phase 3: User Story 1 – Luồng đăng trên hợp đồng bộ chuyển đổi, kiểm mọi loại lỗi không cần Meta (Priority: P1) 🎯 MVP

**Goal**: Cổng nền tảng có giao diện công khai 7 thao tác theo `connectionId` + luồng kết nối kênh; bản giả lập dàn
được mọi kịch bản US1, đếm số lần một dấu nội dung thực sự lên.

**Independent Test**: `pnpm --filter @app/server test -- test/contracts/platform` qua (bộ nhớ) và `pnpm test:db -- test/contracts/platform` qua (`sandbox`); 8 kịch bản US1 cho đúng kết quả/loại lỗi; `publishedCount` đúng.

### Tests for User Story 1 (viết trước, phải đỏ) ⚠️

- [X] T022 [P] [US1] Viết `T/contracts/platform/adapter.contract.ts` – `describePlatformAdapterContract(adapter, harness)`: đủ 7 thao tác; kết quả thuộc khuôn hợp đóng; `contentHash` có tiền tố `ch1:`, "đổi nhẹ" (rút gọn liên kết, NFD, khoảng trắng, ZWSP/NBSP) → cùng dấu, khác thật (kể cả khác hoa/thường) → khác dấu; `classifyError` mã lạ → `unknown` với ≥ 1 `remedies`; `rawCode` khớp `[A-Za-z0-9_.:-]{1,64}`; `capabilities.reconcile=false` → `reconcile` = `unsupported`
- [X] T023 [P] [US1] Viết `T/contracts/platform/gateway.contract.ts` – `describePlatformGatewayContract(makeGateway, harness)`: 8 kịch bản US1-AS1…AS8 (timeout sau khi lên → `failed/unknown` rồi `reconcile` `found` + `publishedCount = 1`; timeout chưa lên → `not_found`, gửi lại 1 lần → `publishedCount = 1`; Zalo `unsupported`; phân loại 3 loại + mã lạ `unknown`; Instagram `processing` → `checkStatus` `processing` → `done`/`failed`; `mediaRules` + `validateMedia` có vi phạm `messageVi`; `refreshToken` ok/`user_action` `reconnect`; `checkAccount` eligible/ineligible `user_action`); `alterStoredText` vẫn `found`; khoảng đối soát > `maxReconcileWindowHours` → `unsupported/window_too_large`; `contentHash` không khớp → `InvalidRequestError`; kết nối của tài khoản khác/không tồn tại → `ConnectionNotFoundError` (không phân biệt); kết nối `disconnected` → `failed/user_action` `reconnect`; hai `submit` cùng dấu → `publishedCount = 2` (không che đăng trùng); quét kết quả + nhật ký không có `fake_tok_`/`POST_CANARY_`; luồng kết nối: `state` sai/hết hạn/đã dùng/khác tài khoản → `STATE_INVALID`, hủy → `CONNECT_CANCELLED`, chọn Page đã kết nối → trả kết nối có sẵn, ứng viên `ineligible` → không lưu được
- [X] T024 [P] [US1] Tạo `T/contracts/platform/platform.fake.contract.spec.ts` (kho `memory`, chạy cả hai hàm trên cho mọi `listRegisteredAdapters()`) và `T/contracts/platform/platform.sandbox.contract.spec.ts` (kho `sandbox`, cấu hình `vitest.db.config.mts`)
- [X] T025 [P] [US1] Viết kiểm thử đơn vị `T/unit/platform/content-hash.spec.ts`, `T/unit/platform/classify.spec.ts` (`applyErrorMapping`: có dòng khớp `channelType/rawCode` → thay `category/messageVi/remedies`, giữ `rawCode`, `channelType`; không khớp/không có dòng → giữ nguyên), `T/unit/platform/media-rules.spec.ts` (`validateMedia` cho mỗi `rule`: `format`, `size`, `duration`, `aspect`, `count`, `mixed`)
- [X] T026 [P] [US1] Viết `T/e2e/channels-connect.e2e.spec.ts` (supertest, bản giả lập): 6 điểm cuối contracts/platform-gateway.md mục 3 – CTV gọi `POST /api/channels/connect`/`POST /api/channels`/`DELETE` → 403, `GET /api/channels` → 200; phản hồi không có trường mã quyền; gọi lại thiếu phiên/sai `state` → `302 …?error=STATE_INVALID`; `error=access_denied` → `?error=CONNECT_CANCELLED`; ứng viên ineligible → `422 CHANNEL_INELIGIBLE`; đã có → `200` thay vì `201`

### Implementation for User Story 1

- [X] T027 [US1] Định nghĩa kiểu hợp đồng trong `S/modules/platform_gateway/public-api.ts` theo data-model.md mục 1: `ChannelType = 'facebook_page' | 'instagram' | 'zalo_oa' | 'test_channel'`, `CHANNEL_TYPES`, `ChannelCapabilities` (`reconcile`, `asyncProcessing`, `tokenRefresh`, `reportsQuota`, `maxReconcileWindowHours: number | null`), `MediaRules`, `MediaDescriptor`, `MediaViolation` (`rule: 'format'|'size'|'duration'|'aspect'|'count'|'mixed'`), `SubmitRequest` (`text` ≤ 63 206 ký tự), `SubmitResult`, `CheckStatusResult`, `ReconcileRequest`/`ReconcileResult` (`unsupported.reason: 'capability' | 'window_too_large' | 'platform_unavailable'`), `ClassifiedError` (`category: 'transient' | 'user_action' | 'unknown'`, `remedies` ≥ 1, `RemedyAction: reconnect | retry_later | edit_media | edit_text | check_on_platform | contact_support`, `retryAfterSec` chỉ với `transient`), `ErrorMappingRow`, `AccountCheckResult`, `RefreshTokenResult`, `ChannelConnection` (`displayName` ≤ 120, `status: 'active' | 'expiring' | 'expired' | 'disconnected'`, `expiring` = còn < 7 ngày), interface `PlatformGatewayPublicApi` + token `PLATFORM_GATEWAY`; lỗi `ConnectionNotFoundError`, `ChannelNotSupportedError` ("Kênh này chưa được hỗ trợ"), `InvalidRequestError` trong `S/modules/platform_gateway/internal/errors.ts`
- [X] T028 [P] [US1] Tạo DTO HTTP kết nối kênh trong `packages/shared/src/modules/platform_gateway/index.ts` (Zod: `ConnectRequest { channelType }`, `SaveConnectionRequest { selectionId, externalId }`, `SelectionResponse`, `ChannelConnectionDto`, `ChannelType`) và xuất đường dẫn `@app/shared/platform_gateway` trong `packages/shared/package.json`; chỉ dùng `zod`
- [X] T029 [P] [US1] Cài đặt `S/modules/platform_gateway/internal/adapters/content-hash.ts` (R4): `normalizeText` = NFC → thay `https?://\S+` bằng `<url>` → bỏ ZWSP/ZWJ/BOM, NBSP → dấu cách → gộp khoảng trắng → trim, **không** hạ chữ thường; `contentHashOf(text, extraNormalize?)` = `"ch1:" + sha256_hex(...)`
- [X] T030 [P] [US1] Cài đặt `S/modules/platform_gateway/internal/adapters/classify.ts`: `makeClassifier(channelType, table)` (mã ngoài bảng → `unknown`, "Chưa rõ bài đã lên hay chưa…", remedy `check_on_platform`), `sanitizeRawCode` (giữ `[A-Za-z0-9_.:-]`, cắt ≤ 64), và hàm thuần `applyErrorMapping(err, row?)` (R5)
- [X] T031 [P] [US1] Cài đặt hàm thuần `validateMedia(rules, items)` trong `S/modules/platform_gateway/internal/adapters/media-rules.ts` – thông điệp vi phạm tiếng Việt đời thường kèm `limit`, `actual`
- [X] T032 [P] [US1] Tạo `S/modules/platform_gateway/internal/adapters/result-shapes.ts` – khuôn Zod cho mọi kết quả adapter; `assertResultShape(op, value)` trả kết quả hợp lệ hoặc thay bằng `failed/unknown` (submit, checkStatus), `unsupported/platform_unavailable` (reconcile) và ghi nhật ký cảnh báo `platform.unexpected_result` (không in giá trị)
- [X] T033 [US1] Tạo `S/modules/platform_gateway/internal/adapters/adapter.ts` (interface `PlatformAdapter` đúng contracts/platform-gateway.md mục 2, `AdapterSubmit`, `AdapterReconcile`, `CallbackParams`, `ConnectionCandidate`) và `S/modules/platform_gateway/internal/adapters/registry.ts` (`registerAdapter(type, make)`, `getAdapter(type)` → `ChannelNotSupportedError`, `listRegisteredAdapters()`; tệp ghép duy nhất nơi đăng ký adapter)
- [X] T034 [P] [US1] Cài đặt `S/modules/platform_gateway/internal/vault/credential-vault.ts`: kiểu có nhãn `DecryptedCredential` chỉ tạo được bởi `CredentialVault.decrypt`, `toJSON()`/`[util.inspect.custom]` trả `"[credential]"`; bản giả `FakeCredentialVault` mã hóa AES-GCM bằng khóa dev cố định (chỉ dev/test), mã quyền giả dạng `fake_tok_<ngẫu nhiên>`
- [X] T035 [P] [US1] Tạo `S/modules/platform_gateway/internal/fake/channels.ts`: năng lực **3** kênh theo bảng R3 (facebook_page/instagram `maxReconcileWindowHours = 168`; instagram `asyncProcessing`; zalo_oa `reconcile=false`, `reportsQuota=false`) – **không** khai báo `test_channel` ở đây (để T048 chứng minh SC-002), quy tắc media của 3 kênh, bảng mã lỗi giả `FAKE_RATE_LIMIT` (transient, `retryAfterSec` 60, `retry_later`), `FAKE_NETWORK_BEFORE_SEND` (transient), `FAKE_TOKEN_EXPIRED`/`FAKE_PERMISSION_MISSING` (user_action, `reconnect`), `FAKE_MEDIA_REJECTED` (`edit_media`), `FAKE_TEXT_TOO_LONG` (`edit_text`), `FAKE_SERVER_ERROR_AFTER_SEND` (unknown, `check_on_platform`); danh sách Page giả mặc định 2 đủ điều kiện + 1 không đủ ("không phải tài khoản chuyên nghiệp")
- [X] T036 [P] [US1] Tạo `S/modules/platform_gateway/internal/fake/scenarios.ts`: khuôn Zod `FakeStep` = `{ submit: 'published' | 'processing_then_done' | 'processing_then_failed' | { fail: rawCode } | 'timeout_after_publish' | 'timeout_before_publish' }` | `{ alterStoredText: 'shorten_links' | 'nfd' | 'whitespace' }` | `{ reconcile: 'unsupported' }` | `{ refresh: 'ok' | 'fail' }` | `{ check: 'eligible' | 'not_professional' | 'missing_permission' }` | `{ latencyMs }`; khuôn kịch bản `target=oauth` (danh sách Page giả); đọc qua `ScenarioStore` (T020)
- [X] T037 [US1] Tạo `FakePlatformStore` ×2: `S/modules/platform_gateway/internal/fake/store.memory.ts` và `S/modules/platform_gateway/internal/fake/store.sandbox.ts` (bảng `pg_fake_oauth_states`, `pg_fake_selections`, `pg_fake_connections`, `pg_fake_posts` qua `tenantTx`): bài giả (`content_hash`, `stored_text_hash`, `state`, `processing_id`), kết nối, `oauth_state` (lưu SHA-256, hạn 10 phút, dùng một lần), phiên chọn (hạn 10 phút); `publishedCount(contentHash)`
- [X] T038 [US1] Cài đặt `S/modules/platform_gateway/internal/fake/fake-adapter.ts` – `FakePlatformAdapter(channelType, store, scenarios)` đủ 7 thao tác + `contentHash` + `authorizeUrl` (trỏ `/dev/fake-oauth/:channelType/authorize`) + `exchangeCallback`; `timeout_after_publish` ghi bài rồi treo quá `PLATFORM_SUBMIT_TIMEOUT_MS`, `timeout_before_publish` không ghi; `alterStoredText` lưu chữ đã biến đổi để `reconcile` tính lại dấu; **không** chặn đăng trùng; xuất API lập trình `fakePlatform.script(target, steps)`, `publishedCount`, `posts`, `reset` cho kiểm thử
- [X] T039 [US1] Đăng ký 3 adapter giả `facebook_page`, `instagram`, `zalo_oa` trong `S/modules/platform_gateway/internal/adapters/registry.ts` khi `PLATFORM_GATEWAY_DRIVER=fake` (chỉ `APP_ENV ∈ {development, test}`)
- [X] T040 [US1] Cài đặt `S/modules/platform_gateway/internal/gateway.service.ts` (tầng công khai): tra kết nối theo `connectionId` trong tài khoản ngữ cảnh → `ConnectionNotFoundError`; `disconnected` → `failed/user_action`; lấy adapter từ registry; giải mã qua vault; kiểm `req.contentHash === adapter.contentHash(text)`; `from > to` → `InvalidRequestError`; cửa sổ > `maxReconcileWindowHours` → `unsupported/window_too_large`; hết `PLATFORM_SUBMIT_TIMEOUT_MS` → `failed/unknown` (không bao giờ `transient`, không tự thử lại `submit`); bọc mọi kết quả qua `assertResultShape`; mọi thao tác qua `withGatewayOp('platform_gateway', op, { connection_id, channel_type })`; `capabilities`, `contentHash`, `classifyError`, `getConnection`
- [X] T041 [US1] Cài đặt `S/modules/platform_gateway/internal/connections/oauth-state.ts` (32 byte ngẫu nhiên, lưu SHA-256 cùng `account_id`, `user_id`, `channelType`, hạn 10 phút, dùng một lần bằng cập nhật có điều kiện `used_at IS NULL`) và `S/modules/platform_gateway/internal/connections/connections.service.ts` (`startConnect`, `handleCallback` → phiên chọn có kết quả `checkAccount` cho từng ứng viên, `saveConnection(selectionId, externalId)` – trùng `(account_id, channel_type, external_id)` còn hiệu lực → trả kết nối có sẵn, ineligible → lỗi `CHANNEL_INELIGIBLE`; `listConnections` tính `status` `expiring` khi còn < 7 ngày; `disconnect`)
- [X] T042 [US1] Tạo `S/modules/platform_gateway/internal/connections/connections.controller.ts`: 6 điểm cuối contracts/platform-gateway.md mục 3 với `@CustomerAccess('channel.manage')` (connect, selections, save, delete), `@CustomerAccess('status.view')` (list), `@Public` + kiểm `state` gắn phiên cho callback (`302` → `${WEB_BASE_URL}/channels/connect?selection={id}` hoặc `?error=CONNECT_CANCELLED|STATE_INVALID`); khuôn lỗi `@app/shared` `error-response`; DTO từ T028
- [X] T043 [US1] Tạo `S/modules/platform_gateway/internal/fake/fake-oauth.controller.ts` – `GET /dev/fake-oauth/:channelType/authorize?state&redirect_uri` trả HTML tối giản 2 nút "Đồng ý"/"Hủy" (vùng chạm ≥ 44 px, tiếng Việt), chuyển về `redirect_uri` với `code` giả hoặc `error=access_denied`; chỉ đăng ký ở dev/test
- [X] T044 [US1] Nối mọi thứ trong `S/modules/platform_gateway/platform_gateway.module.ts` (provider `PLATFORM_GATEWAY`, chọn kho `memory`/`sandbox` theo `FAKE_STATE_STORE`, controller kết nối; controller giả lập có điều kiện) và xuất từ `S/modules/platform_gateway/index.ts` chỉ: kiểu hợp đồng, token, `validateMedia`, `applyErrorMapping`, `CHANNEL_TYPES`, lỗi công khai (không xuất `internal/*`)

**Checkpoint**: US1 chạy và kiểm độc lập – đội Đăng bài viết được luồng đăng trên bản giả lập (SC-001).

---

## Phase 4: User Story 2 – Thêm nền tảng mới chỉ bằng một bộ chuyển đổi (Priority: P1)

**Goal**: Chứng minh ADR-05: kênh thứ tư `test_channel` chỉ cần adapter + một dòng đăng ký; luồng gọi rẽ nhánh theo
năng lực, không theo tên nền tảng.

**Independent Test**: Đăng ký `test_channel` → bộ hợp đồng tự chạy cho kênh mới; luồng gọi mẫu chạy đúng cho cả 4 kênh mà không có chuỗi tên kênh nào trong mã luồng; kết quả lạ của adapter "hỏng" → `unknown`.

### Tests for User Story 2 ⚠️

- [X] T045 [P] [US2] Tạo luồng gọi mẫu `T/contracts/platform/sample-publish-flow.ts` (mô phỏng phía Đăng bài: `contentHash` → `submit` → nếu `processing` thì `checkStatus` → nếu `unknown` thì `reconcile` khi `capabilities.reconcile`, ngược lại trả "Cần kiểm tra") và `T/contracts/platform/sample-flow.spec.ts` chạy luồng cho **mọi** `listRegisteredAdapters()`; thêm khẳng định tĩnh: tệp `sample-publish-flow.ts` không chứa chuỗi `facebook_page|instagram|zalo_oa|test_channel` (SC-002)
- [X] T046 [P] [US2] Viết `T/contracts/platform/unexpected-result.spec.ts`: adapter "hỏng" cố ý (thiếu thao tác / trả `kind` ngoài danh sách) → bộ `describePlatformAdapterContract` thất bại; tầng cổng biến kết quả lạ thành `failed/unknown` (submit) / `unsupported` (reconcile) và ghi `platform.unexpected_result` (US2-AS1, Edge Cases)
- [X] T047 [P] [US2] Viết `T/contracts/platform/channel-not-supported.spec.ts`: kết nối với loại kênh chưa đăng ký adapter → mọi thao tác ném `ChannelNotSupportedError`, không có hành vi mặc định ngầm (US2-AS3)

### Implementation for User Story 2

- [X] T048 [US2] Thêm kênh thứ tư `test_channel`: khai báo năng lực (tất cả `false`, `maxReconcileWindowHours = null`) và quy tắc media khác (chỉ ảnh PNG, tối đa 1) trong `S/modules/platform_gateway/internal/fake/channels.ts`, rồi thêm **một** dòng đăng ký trong `S/modules/platform_gateway/internal/adapters/registry.ts` chỉ khi `APP_ENV ∈ {development, test}`; đây là hai tệp duy nhất được đổi – ghi danh sách tệp đã đổi vào mô tả commit để chứng minh SC-002 (luồng gọi mẫu T045 và bộ hợp đồng không đổi dòng nào)
- [X] T049 [US2] Rà `S/modules/platform_gateway/public-api.ts` và `gateway.service.ts`: không có khái niệm riêng nền tảng (vd "container" của Instagram) lọt ra ngoài 7 thao tác; mọi rẽ nhánh trong `gateway.service.ts` dựa trên `capabilities`; sửa nếu có

**Checkpoint**: US1 + US2 xanh; thêm kênh = thêm adapter.

---

## Phase 5: User Story 3 – Gọi AI qua Cổng AI: giữ chỗ → gọi → quyết toán (Priority: P1)

**Goal**: Cổng AI có giao diện công khai `generate`/`generateStream`/`transcribe`/`getUsage`/`system.generate`, trình tự
bắt buộc, bất biến `used + reserved ≤ cap` dưới đồng thời ở cả 2 chế độ kho.

**Independent Test**: `pnpm --filter @app/server test -- test/contracts/ai` (bộ nhớ) và `pnpm test:db -- test/contracts/ai` (`sandbox`) qua đủ 12 mục contracts/ai-gateway.md mục 5; 100 vòng × 25 lời gọi đồng thời → 0 lần vượt trần, 0 giữ chỗ treo.

### Tests for User Story 3 ⚠️

- [X] T050 [P] [US3] Viết `T/contracts/ai/ai-gateway.contract.ts` – `describeAiGatewayContract(makeGateway, harness)` đủ 12 mục contracts/ai-gateway.md mục 5 (trình tự + ledger đủ trường; chặn trước khi gọi, nhà cung cấp nhận 0 lời gọi, thông điệp "Đã sử dụng hết giới hạn AI của chu kỳ" không số tiền; **đồng thời 100 vòng × 25 lời gọi** `Promise.all` sát trần, ước tính ngẫu nhiên có hạt giống, bộ quan sát đọc sau mỗi thao tác `used + reserved ≤ cap`, `reserved = 0` khi xong; ngưỡng mềm `< 2 000 000` → `default`, `≥` → `cheap`, gán nhãn → `cheap_vision`, xu hướng → `cheap`, STT → `stt`; dự phòng đúng 1 lần, cả hai lỗi → `AI_PROVIDER_UNAVAILABLE` + `reserved = 0`; trả dần bị hủy → quyết toán phần đã sinh; STT ước tính theo `min(durationSec, 300)`; `getUsage()` quét đệ quy: không khóa chứa `usd|micro|cost|amount|price`, không số nguyên ≥ 1 000 ngoài `percent`, `percent = floor((used+reserved)/cap×100)`; kẹp trần + `anomaly='over_estimate'` + `overCapMicroUsd` khi `actual > est`; giữ chỗ treo > 15 phút (mục 10): `held` chưa gọi → `releaseStale` trả lại, `calling` (nhà cung cấp giả đã trả lời nhưng kiểm thử không cho quyết toán – mô phỏng tiến trình chết) → `used` tăng đúng ước tính (kẹp trần), sổ có dòng `anomaly='unsettled'` token = 0, nhật ký `ai.unsettled_reservation`, chạy `releaseStale` lần hai không đổi gì; mọi lần gọi nhà cung cấp (chính và dự phòng) đều có `markCalling` trước đó (nhà cung cấp giả khẳng định giữ chỗ đang ở `calling` lúc nhận lời gọi); `system.generate` trong ngữ cảnh tài khoản → ném, trong ngữ cảnh hệ thống không đổi ngân sách/`getUsage()` của tài khoản, hết trần tuần → `AI_SYSTEM_BUDGET_EXHAUSTED` + nhật ký cảnh báo); nhật ký không chứa `PROMPT_CANARY_`. Mục 12–13 (phát 80/100% trong giao dịch quyết toán) để chờ T080; mục 14 (p95 `reserve`) chỉ chạy ở `sandbox`
- [X] T051 [P] [US3] Tạo `T/contracts/ai/ai.fake.contract.spec.ts` (kho `memory`) và `T/contracts/ai/ai.sandbox.contract.spec.ts` (kho `sandbox`, `vitest.db.config.mts`); bản `sandbox` thêm phép đo p95 của `reserve` ≤ 50 ms qua 200 lần trên CSDL cục bộ (hiến pháp III – contracts/ai-gateway.md mục 5.14)
- [X] T052 [P] [US3] Viết kiểm thử đơn vị `T/unit/ai/estimate.spec.ts` (`ceil(inTok × inPrice + maxOutTok × outPrice)` bằng `bigint`, làm tròn lên; STT `ceil(min(durationSec, 300)/60 × pricePerMin)`), `T/unit/ai/tier.spec.ts` (bảng chọn hạng), `T/unit/ai/price-book.spec.ts` (chọn dòng `effectiveFrom <= now` mới nhất; giá đổi giữa chu kỳ không tính lại quá khứ), `T/unit/ai/validate.spec.ts` (`maxOutputTokens` 1–8 192; `images` chỉ với `image_labeling`/`video_labeling`, ≤ 8 → ngoài ra `AI_INVALID_REQUEST`)

### Implementation for User Story 3

- [X] T053 [US3] Định nghĩa kiểu trong `S/modules/ai_gateway/public-api.ts` theo data-model.md mục 2: `AiTask` (`post_generation`, `topic_suggestion`, `image_labeling`, `video_labeling`, `transcription`, `trend_summary`), `AI_TASKS`, `ModelTier` (`default`, `cheap`, `cheap_vision`, `stt`), `AiRequest` (`prompt: { system; businessProfile?: { versionId, text }; weeklyTrends?: { weekStart, text }; delta }` theo thứ tự cố định, `maxOutputTokens` int 1–8 192, `images` `{ url, bytes }[]` ≤ 8), `TranscribeRequest { audioUrl, durationSec, language: 'vi' }`, `AiResult` (không số tiền), `AiStream`, `AiUsage { percent 0..100 floor, state: 'normal' | 'cheap_model' | 'blocked', nextCycleStartsAt }`, interface `AiGatewayPublicApi` + token `AI_GATEWAY`
- [X] T054 [P] [US3] Cài đặt `S/modules/ai_gateway/internal/errors.ts` – `AiError` với `code` ∈ `AI_BUDGET_EXHAUSTED` ("Đã sử dụng hết giới hạn AI của chu kỳ", `retryable=false`), `AI_PROVIDER_UNAVAILABLE` ("Dịch vụ AI tạm thời không phản hồi, vui lòng thử lại sau", `retryable=true`), `AI_INVALID_REQUEST` ("Yêu cầu không hợp lệ", `false`), `AI_SYSTEM_BUDGET_EXHAUSTED` (nội bộ, `false`); `SystemContextRequiredError`
- [X] T055 [P] [US3] Cài đặt `S/modules/ai_gateway/internal/prices/price-book.ts` (`PriceSource { load() }` được tiêm vào; `PriceBook.priceFor(tier, at)` đọc từ nguồn đó – bản thật WBS 3.1 chỉ thay `PriceSource` bằng bảng `model_prices`, đổi giá không cần phát hành) và nguồn giả `JsonPriceSource` đọc `S/modules/ai_gateway/internal/fake/prices.fake.json` (`default` 3/15, `cheap` 0,25/1,25, `cheap_vision` 0,25/1,25 USD mỗi triệu token lưu micro-USD; `stt` 6 000 micro-USD/phút; `effectiveFrom`)
- [X] T056 [P] [US3] Cài đặt `S/modules/ai_gateway/internal/estimate.ts` và `S/modules/ai_gateway/internal/tier.ts` (R7; quyết định hạng dựa trên `used + reserved` của snapshot đọc khi giữ chỗ; lời gọi đẩy qua ngưỡng mềm vẫn dùng `default`)
- [X] T057 [P] [US3] Tạo `S/modules/ai_gateway/internal/providers/provider.ts` – interface `AiProviderAdapter` (`countInputTokens`, `complete`, `stream`, `transcribe`), `OrderedPrompt`, `ProviderResult { text, inputTokens, outputTokens, cachedInputTokens, modelId }`, `ProviderStream`; kiểu SDK không ra khỏi `internal/providers/`
- [X] T058 [P] [US3] Cài đặt `S/modules/ai_gateway/internal/fake/fake-provider.ts` – `FakeAiProvider` (`primary`, `fallback`): văn bản tất định `"[fake:{task}] " + sha256(prompt).slice(0,8)` lặp tới số token đầu ra cấu hình, trả dần theo đoạn 8 token, đếm token = ký tự ÷ 4 làm tròn lên; kịch bản `{ latencyMs, firstTokenMs, fail: 'error' | 'timeout', outputTokens, actualCostMultiplier }`; ghi lại mọi lời gọi
- [X] T059 [US3] Tạo `S/modules/ai_gateway/internal/budget/budget-store.ts` (interface `BudgetStore`: `reserve`, `settle(reservationId, actual, ledger, hooks?: { onCrossed?: (tx: Db, crossed: (80|100)[]) => Promise<void> })` – mọi bước quyết toán + `onCrossed` trong **một** giao dịch, `onCrossed` ném → hủy cả giao dịch (nguyên tắc IV, research R7), `markCalling(reservationId)` – `held → calling` + `calledAt`, `release` – từ `held` hoặc `calling`, gọi lại không làm gì, `usage`, `releaseStale(olderThanMs, hooks?)` – `held` quá hạn → `released`, `calling` quá hạn → quyết toán theo ước tính (kẹp trần) + sổ `anomaly='unsettled'` + `onCrossed` nếu vượt mốc, trả `{ released, settledAtEstimate }`; `BudgetKey` theo `scope: 'account' | 'system'`; `Reservation.state: 'held' | 'calling' | 'settled' | 'released'`; `CostLedgerEntry.anomaly: 'over_estimate' | 'unsettled' | null`; `CostLedgerEntry` đúng data-model.md mục 2) và `S/modules/ai_gateway/internal/budget/system-budget.ts` (khóa `week_start` = thứ Hai 00:00 UTC+7, `cap = AI_SYSTEM_WEEKLY_CAP_MICRO_USD`, `soft_limit = cap`)
- [X] T060 [US3] Cài đặt `S/modules/ai_gateway/internal/fake/store.memory.ts` – `MemoryBudgetStore` + bản hệ thống: `Map` theo `(scope, key)`; `reserve`, `markCalling`, `release` đọc-ghi trong một lượt đồng bộ (không `await` giữa đọc và ghi); `settle` và `releaseStale` chạy **tuần tự theo khóa ngân sách** bằng khóa tuần tự trong bộ nhớ (`Map<key, Promise>`, tương đương khóa dòng CSDL – research R8); `cycle_start` mặc định ngày 1 tháng hiện tại UTC+7 hoặc do kịch bản; `settle`: `reserved -= est`, `used = min(used + actual, cap)`, ledger ghi `actual` thật + `anomaly`, `overCapMicroUsd`; trả `crossed: (80|100)[]` theo cờ `notified80/100` một lần mỗi chu kỳ; trong khóa: đọc trạng thái **hiện tại**, tính `crossed` → `await onCrossed(memoryTx(), crossed)` (`S/dev/memory-tx.ts` – T020; ném → chưa ghi gì, ném tiếp) → ghi **đồng bộ** lên giá trị hiện tại (không dùng bản sao): `reserved -= est`, `used = min(used + actual, cap)`, bật cờ, thêm dòng sổ, đổi trạng thái giữ chỗ; **không** dùng cách "ghi trước, lỗi thì bù ngược" (bù ngược có thể làm `used + reserved` vượt trần)
- [X] T061 [US3] Cài đặt `S/modules/ai_gateway/internal/fake/store.sandbox.ts` – `SandboxBudgetStore` trên `ai_fake_*`: giữ chỗ bằng **một** câu lệnh `UPDATE … SET reserved = reserved + $est WHERE account_id = account.current_account_id() AND cycle_start = $c AND used + reserved + $est <= cap RETURNING used, reserved, cap, soft_limit` + chèn `ai_fake_reservations` trong cùng `tenantTx`; chuyển trạng thái giữ chỗ bằng cập nhật có điều kiện theo trạng thái hiện tại (`markCalling`: `WHERE state = 'held'` đặt `called_at = now()`; `settle`/`release`: `WHERE state IN ('held','calling')`); `releaseStale` trong `tenantTx`/`systemTx` theo từng giữ chỗ: `held` quá 15 phút → `released`, `calling` quá 15 phút → cùng các bước của `settle` với `actual = estimate`, dòng sổ `anomaly='unsettled'`, nhật ký `ai.unsettled_reservation`; `settle` trong **một** `tenantTx`: trừ giữ chỗ + `used = LEAST(used + actual, cap)` → bật `notified_80`/`notified_100` bằng `UPDATE … SET notified_80 = true WHERE … AND notified_80 = false RETURNING` (chỉ cờ thực sự đổi vào `crossed`) → chèn sổ chi phí → `held → settled` → `onCrossed(tx, crossed)` nếu không rỗng; bản hệ thống dùng `systemTx`; `CHECK` là chốt cuối
- [X] T062 [US3] Cài đặt `S/modules/ai_gateway/internal/gateway.service.ts` theo trình tự contracts/ai-gateway.md mục 2: validate → pickTier → estimate → reserve (không đủ → `AI_BUDGET_EXHAUSTED`, không gọi NCC) → `markCalling` → primary (timeout `AI_PROVIDER_TIMEOUT_MS`) → lỗi/timeout: release → reserve lại → `markCalling` → fallback đúng 1 lần → lỗi: release → `AI_PROVIDER_UNAVAILABLE`; settle + ledger (giao dịch quyết toán lỗi → thử `settle` lại 1 lần → vẫn lỗi: nhật ký cảnh báo `ai.settle_failed`, giữ chỗ còn `calling` nên `releaseStale` sẽ quyết toán theo ước tính – không mất sổ; vẫn trả kết quả cho bên gọi vì nhà cung cấp đã trả lời); `generateStream` (chữ đầu ≤ `AI_FIRST_TOKEN_TIMEOUT_MS`, `cancel()`/`signal` → settle phần đã sinh hoặc release nếu chưa có đầu ra); `transcribe`; `getUsage()` chỉ `percent`/`state`/`nextCycleStartsAt` (`blocked` khi `used + reserved >= cap` hoặc `cap - used - reserved < minCallEstimate` – ước tính `image_labeling` với 0 token vào, `maxOutputTokens = 1`, giá `cheap_vision` hiện hành, tính trong `estimate.ts`; `cheap_model` khi `used + reserved >= soft_limit`; còn lại `normal`); `system.generate` ném `SystemContextRequiredError` nếu ngữ cảnh có `accountId`, giữ chỗ vào ngân sách hệ thống, ledger có `industry_id`, hết trần → `AI_SYSTEM_BUDGET_EXHAUSTED` + nhật ký cảnh báo; `actual > est` → nhật ký cảnh báo `ai.cost_anomaly`; mọi thao tác qua `withGatewayOp('ai_gateway', …)` (không lời nhắc, văn bản, số tiền)
- [X] T063 [US3] Tạo `S/modules/ai_gateway/jobs.ts` – việc định kỳ `ai_gateway.release_stale` trên hàng chờ `scheduled` mỗi phút bằng `defineSchedule` (003), gọi `releaseStale(15 phút, { onCrossed })` cho kho `sandbox` (cùng `onCrossed` phát `ai_usage_80/100` như T080; idempotent – chạy lại hai lần cho cùng kết quả); xuất API lập trình `fakeAi.setBudget({ used, reserved, cap?, cycleStart? })`, `fakeAi.script(steps)`, `fakeAi.ledger()`, `fakeAi.reservations()`, `fakeAi.reset()` từ `S/modules/ai_gateway/internal/fake/index.ts`
- [X] T064 [US3] Nối `S/modules/ai_gateway/ai_gateway.module.ts` (provider `AI_GATEWAY`, chọn kho theo `FAKE_STATE_STORE`, đăng ký việc ở Worker) và `S/modules/ai_gateway/index.ts` chỉ xuất kiểu, token, `AiError`, `AI_TASKS`; `AI_GATEWAY_SUPPORT` **chỉ khai báo kiểu** trong `S/modules/ai_gateway/internal/support.ts` (không cài đặt, không xuất cho module khác – cài đặt kèm nhật ký kiểm toán là WBS 4.7)
- [X] T065 [P] [US3] Viết `T/queue/ai-release-stale.queue.spec.ts`: giữ chỗ `held` treo > 15 phút được trả lại, giữ chỗ `calling` treo > 15 phút được quyết toán theo ước tính (sổ `unsettled`) khi việc chạy; chạy lại hai lần cùng kết quả; giữ chỗ < 15 phút không bị đụng

**Checkpoint**: US3 xanh ở cả `memory` và `sandbox`; SC-003, SC-004 (phần AI) đạt.

---

## Phase 6: User Story 4 – Phát thông báo theo danh mục, đúng người nhận, không gửi lặp (Priority: P2)

**Goal**: Danh mục đóng ở `@app/shared/notifications`, `emit(tx, event)` qua hàng chờ `notify`, bộ xử lý dựng khóa
chống trùng + người nhận + kênh; `core/mail` có `deliver()` phân loại `sent/transient/permanent`.

**Independent Test**: `pnpm --filter @app/server test -- test/contracts/notifications test/contracts/mail` (bộ nhớ), `pnpm test:db -- test/contracts/notifications` (gồm giao dịch hủy), `pnpm test:infra` (SMTP → Mailpit).

### Tests for User Story 4 ⚠️

- [ ] T066 [P] [US4] Viết `T/contracts/notifications/notifications.contract.ts` – `describeNotificationsContract(make, harness)` với `harness = { tx(), flush(), setMembers(members), removeMember(userId), hasRealTx }` (mỗi ca: phát → `flush()` → khẳng định; giống nhau ở `memory` và `sandbox` – research R9b), đủ 7 mục contracts/notifications.md mục 7 (mục 4 "giao dịch hủy" chỉ chạy khi harness báo có giao dịch thật): bảng lặp qua `NOTIFICATION_TYPES` khóa đúng người nhận/kênh/`emailBatch` của data-model.md mục 3 (thiếu dòng kiểm → thất bại); quy tắc khóa của **mọi** loại (cùng tham chiếu → 1, khác → 2; `ai_usage_80` chu kỳ mới phát lại được); trường bị cấm (`amountMicroUsd`, `accessToken`, `password`, `content`, chuỗi `"$1.20"` trong `params`) → `NotificationEventInvalidError`, không tạo việc; CTV đã gỡ → bỏ qua, người khác vẫn nhận; mọi thông báo có ≥ 1 hành động; quét nội dung đã ghi không số tiền/mã quyền (SC-004); chạy bộ xử lý hai lần cùng việc → cùng kết quả
- [ ] T067 [P] [US4] Tạo `T/contracts/notifications/notifications.fake.contract.spec.ts` (kho `memory`: `tx()` = `memoryTx()`, `flush()` chạy `deliver.handler` trên hàng chờ trong bộ nhớ, `setMembers`/`removeMember` thao tác `FakeAccountMembers` – bản cài `AccountPublicApi.listActiveMembers` trong `S/modules/notifications/internal/fake/fake-members.ts`; mục "giao dịch hủy" bỏ qua có ghi lý do) và `T/contracts/notifications/notifications.sandbox.contract.spec.ts` (kho `sandbox`: `tx()` = giao dịch `tenantTx` thật, `flush()` viết trong `T/contracts/notifications/harness.sandbox.ts`: khởi động **runtime Worker thật trong tiến trình kiểm thử** một lần (chỉ hàng chờ `notify`, theo cách kiểm thử 003 khởi động Worker – `T/queue/helpers/worker-child.ts`) rồi `waitFor` tới khi không còn việc `notifications.deliver` ở `created`/`retry`/`active` (`jobs()`, `waitFor()` của `T/queue/helpers/queue-db.ts`) – không gọi thẳng bộ xử lý để vẫn kiểm bước Worker dựng lại ngữ cảnh tenant; `setMembers` tạo chủ + CTV thật bằng `T/auth/helpers/actors.ts` (004), `removeMember` gỡ CTV bằng thao tác của `account`; thêm: giao dịch nghiệp vụ hủy sau `emit` → 0 việc, 0 thông báo – US4-AS4; lối phát của `account` qua `enqueueRegistered(tx, NOTIFY_DELIVER_JOB, …)` được xử lý như `emit`)
- [ ] T068 [P] [US4] Viết `T/contracts/mail/mailer.contract.ts` – `describeMailerContract(make, inbox)`: `sent` đọc lại được trong hộp thư (`inbox`), `transient`/`permanent` phân biệt đúng; `send()` của 004 vẫn ném khi không `sent`; tạo `T/contracts/mail/mail.fake.contract.spec.ts` (`memory`, `failFor`) và `T/contracts/mail/mail.infra.contract.spec.ts` (`smtp` → Mailpit, đọc qua `http://localhost:8025/api/v1/messages`, thư phải đọc lại được trong ≤ 10 giây – SC-011; kịch bản lỗi vĩnh viễn dùng tính năng từ chối người nhận/chaos của tag Mailpit đã khóa nếu có, nếu không ghi `it.skip` kèm lý do và dựa vào T069)
- [ ] T069 [P] [US4] Viết `T/unit/mail/smtp-classify.spec.ts`: `responseCode` `550`, `551`, `552`, `553`, `554` → `permanent`; 4xx, `ECONNECTION`, `ETIMEDOUT`, `ESOCKET` → `transient`; lỗi khác → `transient`
- [ ] T070 [P] [US4] Thêm kiểm thử kiểu `T/contracts/notifications/emit-types.typecheck.ts` (dùng `// @ts-expect-error`): loại ngoài danh mục, thiếu `tx`, truyền `dedupeKey`/kênh/người nhận → không biên dịch (US4-AS3, FR-041, FR-043); đưa tệp vào `tsconfig` kiểm tra của `pnpm verify`

### Implementation for User Story 4

- [ ] T071 [US4] Tạo `packages/shared/src/modules/notifications/events.ts` + `index.ts`: `NOTIFICATION_TYPES` (10 loại đúng thứ tự contracts/notifications.md mục 1), `NotificationEventSchema` (Zod `discriminatedUnion` theo `type`, mỗi nhánh `strictObject`; `refs` theo bảng data-model.md mục 3 – vd `post_pending_review.postIds` ≤ 50, `publish_needs_action.state: 'needs_user' | 'needs_check'`, `approved_post_rescheduled { postId, postVersion: int ≥ 1, byUserId }`, `batch_generation_done { planId, batchId: uuid, requestedByUserId }` – mọi trường dùng trong `dedupeKey` MUST có trong `refs`; `params: { postTitle?: string ≤ 60, channelDisplayName?: string ≤ 120, percent?: 80|100 }`; `actions?: { kind: 'open_post' | 'open_attempt' | 'reconnect_channel' | 'open_usage' | 'open_plan', targetId? }[]`), `NOTIFICATION_RULES` (`recipients`, `channels`, `emailBatch: 'batch_10m' | 'immediate'` – `batch_10m` chỉ ở `publish_needs_action`, `defaultActions` ≥ 1), `NOTIFY_DELIVER_JOB = 'notifications.deliver'`; xuất `@app/shared/notifications` trong `packages/shared/package.json`; chỉ dùng `zod`; **không** xuất `dedupeKey`
- [ ] T072 [P] [US4] Cài đặt `S/modules/notifications/internal/dedupe-keys.ts` – khóa theo bảng data-model.md mục 3 (vd `ai_usage_80:{cycleStart}`, `publish_needs_action:{attemptId}:{state}`, `channel_token_expiring:{connectionId}:{expiresOn}`, `post_pending_review:{submissionId}`, `approved_post_rescheduled:{postId}:{postVersion}`, `batch_generation_done:{planId}:{batchId}`…), kiểu `Record<NotificationType, (refs: RefsOf<T>) => string>` để thiếu loại hoặc dùng trường ngoài `refs` là lỗi biên dịch
- [ ] T073 [P] [US4] Cài đặt `S/modules/notifications/internal/forbidden.ts` – kiểm hai lớp (R9): tên trường chứa `amount|usd|cost|price|token|password|secret|content|caption|body` → từ chối; chuỗi trong `params` khớp `\$|USD|micro` → từ chối; ném `NotificationEventInvalidError` (không in giá trị)
- [ ] T074 [P] [US4] Cài đặt `S/modules/notifications/internal/recipients.ts` (`owner`, `post_author` ← `refs.authorUserId`, `actor_target` ← `refs.requestedByUserId`, qua `AccountPublicApi.listActiveMembers()` **tiêm vào** (token của `account`) để kiểm thử thay bằng `FakeAccountMembers`; người không còn hoạt động → bỏ qua) và `S/modules/notifications/internal/templates/` (mẫu tiếng Việt đời thường cho 10 loại: `titleVi`, `bodyVi`, liên kết hành động `WEB_BASE_URL/...`; chỉ `postTitle` ngắn, không nội dung bài, không số tiền)
- [ ] T075 [US4] Mở rộng `S/core/mail/mailer.ts`: `MailDeliveryResult = { kind: 'sent', messageId } | { kind: 'transient', code } | { kind: 'permanent', code }`, `deliver(message)`; `send()` giữ nguyên hành vi 004 (gọi `deliver`, ném khi không `sent`); `S/core/mail/smtp.transport.ts` phân loại theo T069; `S/core/mail/memory.transport.ts` thêm `outbox()`, `failFor(address, 'transient' | 'permanent', times?)`, `clear()`; `S/core/mail/mail.module.ts` cung cấp ở cả API và Worker
- [ ] T076 [US4] Cài đặt `S/modules/notifications/jobs.ts` (`defineJobType` cho `notifications.deliver` trên hàng chờ `notify`, scope `tenant`, payload `{ event }` theo khuôn shared – qua 3 lớp kiểm của 003) và `S/modules/notifications/internal/emit.ts` (`emit(tx: Db, event)`: parse Zod + `forbidden` → `enqueue(tx, notifyDeliverJob, { event }, { dedupeKey: 'notify:' + dedupeKey(event) })` → `{ status: 'queued' | 'duplicate_pending' }`); tách bước kiểm (Zod + `forbidden` + dựng khóa) thành hàm dùng chung `prepareEvent(event)`. Chế độ `memory` là một cài đặt riêng `S/modules/notifications/internal/fake/memory-emitter.ts` (được nhập `S/dev/memory-tx.ts` theo quy tắc R17.3): nhận `memoryTx()` (tx khác → ném), gọi `prepareEvent` rồi đưa vào hàng chờ trong bộ nhớ (khóa `notify:` đang chờ → `duplicate_pending`); `emit.ts` không biết gì về chế độ `memory`
- [ ] T077 [US4] Tạo kho `S/modules/notifications/internal/fake/store.memory.ts` và `S/modules/notifications/internal/fake/store.sandbox.ts` (bảng `ntf_fake_events` – `INSERT … ON CONFLICT (account_id, dedupe_key) DO NOTHING` quyết định chống trùng; `ntf_fake_notifications` – `DeliveredNotification` với `emailResult`, trạng thái gửi email theo từng người nhận); API lập trình `fakeNotify.delivered(filter?)`, `fakeNotify.events()`, `fakeNotify.flush()` (chạy `deliver.handler` cho sự kiện đang chờ ở hàng chờ trong bộ nhớ), `fakeNotify.reset()`
- [ ] T078 [US4] Cài đặt `S/modules/notifications/internal/deliver.handler.ts` theo contracts/notifications.md mục 4: kiểm lại khuôn + trường bị cấm → dựng khóa → chèn sự kiện (trùng → kết thúc) → người nhận × kênh: `in_app` ghi bản ghi, `email` gửi `Mailer.deliver` (giữ trường `emailBatch`); `transient` → ném để 003 thử lại **chỉ phần email chưa gửi**; `permanent` → đánh dấu `email_failed_permanent`, không thử lại; idempotent; qua `withGatewayOp('notifications', 'deliver', { kind: type })`
- [ ] T079 [US4] Nối `S/modules/notifications/notifications.module.ts` (provider `NOTIFICATIONS` = `emit.ts` khi `FAKE_STATE_STORE=sandbox`, = `memory-emitter.ts` khi `memory`; kho theo `FAKE_STATE_STORE`, bộ xử lý ở Worker) và `S/modules/notifications/index.ts` chỉ xuất `NotificationsPublicApi`, token `NOTIFICATIONS`, `NotificationEventInvalidError`
- [ ] T080 [US4] Nối Cổng AI phát `ai_usage_80`/`ai_usage_100` **trong giao dịch quyết toán**: trong `S/modules/ai_gateway/internal/gateway.service.ts` truyền `settle(…, { onCrossed: (tx, crossed) => Promise.all(crossed.map(p => notifications.emit(tx, { type: p === 80 ? 'ai_usage_80' : 'ai_usage_100', refs: { cycleStart }, params: { percent: p } }))) })` – không bao giờ `emit` sau khi `settle` đã trả (nguyên tắc IV, research R7); tiêm `NOTIFICATIONS` vào `S/modules/ai_gateway/ai_gateway.module.ts`. Bổ sung vào `T/contracts/ai/ai-gateway.contract.ts`: mục 12 (vượt 80% rồi 100% → mỗi mốc đúng 1 sự kiện trong chu kỳ; chu kỳ mới phát lại được – US4-AS2, chạy cả `memory` + `sandbox` qua `flush()`) và mục 13 (chỉ `sandbox`: cho `emit` ném lỗi → 0 cờ bật, 0 dòng sổ, 0 sự kiện, giữ chỗ vẫn `held`, nhật ký `ai.settle_failed` sau lần thử lại; gỡ lỗi rồi `settle` lại → đúng 1 sự kiện)

**Checkpoint**: US4 xanh ở `memory`, `sandbox`, `infra`; email ở dev đi vào Mailpit.

---

## Phase 7: User Story 5 – Kho tệp chỉ cấp đường dẫn trong đúng tiền tố của tài khoản (Priority: P2)

**Goal**: `core/storage` với vị trí hợp kiểu dựng từ ngữ cảnh, bản bộ nhớ + bản S3 thật (presigned POST), qua cùng bộ
hợp đồng, ma trận truy cập chéo 0 lần thành công.

**Independent Test**: `pnpm --filter @app/server test -- test/contracts/storage` (bộ nhớ) và `pnpm test:infra` (MinIO) qua 7 mục contracts/storage.md mục 4.

### Tests for User Story 5 ⚠️

- [ ] T081 [P] [US5] Viết `T/contracts/storage/object-storage.contract.ts` – `describeObjectStorageContract(make, uploader)` đủ 7 mục contracts/storage.md mục 4: tải lên đúng → `stat` đúng `bytes`/`contentType`, `stat({hash:true})` = SHA-256 nội dung; quá `maxBytes`/sai `Content-Type`/đổi `key`/sau hạn → bị từ chối; dùng lại trong hạn → ghi đè đúng vị trí; **ma trận truy cập chéo** mọi thao tác (`presignUpload`, `stat`, `read`, `write`, `copy`, `delete`, `list`, `signedUrl`, `deleteAllForCurrentAccount`) × mọi `kind` (`media_original`, `media_normalized`, `media_thumb`, `context_file`, `job_tmp`), trừ tổ hợp bị cấm `presignUpload` × `job_tmp` và `signedUrl('preview')` × `job_tmp` – ngữ cảnh A không chạm được gì của B, lỗi không chứa khóa của B (SC-005); `job_tmp`: khóa là `tenants/{acc}/tmp/{jobId}/{name}`, `presignUpload` và `signedUrl('preview')` → `InvalidRequestError`, `write` gắn nhãn `lifecycle=tmp`, `signedUrl('public')` được phép; `signedUrl` preview ≤ 3600 s, public ≤ 86400 s, vượt → `InvalidRequestError`, hết hạn không tải được; `presignUpload.ttlSec` > 900 → `InvalidRequestError`; `job_tmp` ngoài ngữ cảnh việc → `TenantContextError`, luật hết hạn 1 ngày theo nhãn; `deleteAllForCurrentAccount` của A → mọi tệp của A (kể cả tệp tạm) bị xóa, B còn nguyên; tên tệp chứa `../` không ảnh hưởng khóa; (`infra`) tải lên rồi `stat` thấy tệp đúng vị trí trong ≤ 10 giây (SC-011)
- [ ] T082 [P] [US5] Tạo `T/contracts/storage/storage.memory.contract.spec.ts` (`simulateBrowserUpload`) và `T/contracts/storage/storage.infra.contract.spec.ts` (`S3ObjectStorage` → MinIO, `uploader` = `fetch` POST multipart; luật vòng đời theo nhãn `lifecycle=tmp` kiểm qua cấu hình bucket; ca SC-011 ≤ 10 giây)
- [ ] T083 [P] [US5] Viết `T/unit/storage/location.spec.ts`: 5 khuôn khóa đúng bảng data-model.md mục 4; mã đối tượng không phải UUID → từ chối; `name`/`variant` phải khớp `^[a-z0-9_-]{1,40}(\.[a-z0-9]{1,8})?$`; thiếu ngữ cảnh → `TenantContextError`; mọi khóa (kể cả `job_tmp`) bắt đầu `tenants/{acc}/`; kiểm lần hai tiền tố sai → `StorageAccessDenied` + nhật ký `storage.access_denied` chỉ có `kind`

### Implementation for User Story 5

- [ ] T084 [US5] Tạo `S/core/storage/location.ts` (kiểu `StorageLocation` 5 `kind`, `loc.mediaOriginal/mediaNormalized/mediaThumb/contextFile/jobTmp` – `jobTmp(name)` lấy `jobId` từ ngữ cảnh việc; `resolveKey(loc)` dựng từ `currentAccountId()`, `job_tmp` → `tenants/{acc}/tmp/{jobId}/{name}`; `assertKeyInScope(key)` kiểm lần hai: khóa phải bắt đầu `tenants/{currentAccountId()}/`, không ngoại lệ) và `S/core/storage/storage.ts` (interface `ObjectStorage` đúng contracts/storage.md mục 1, `StoragePrefix`, `PresignedUpload { url, fields, expiresAt, maxBytes, contentType }`, `SignedUrl { url, expiresAt, purpose: 'preview' | 'public' }`, `ObjectInfo`, `AllowedContentType` = `image/jpeg|png|webp|heic`, `video/mp4|quicktime`, `application/pdf` (chỉ cho `context_file`), `StorageAccessDenied`, token `OBJECT_STORAGE`) và `S/core/storage/index.ts`
- [ ] T085 [US5] Cài đặt `S/core/storage/memory/memory-storage.ts` – `MemoryObjectStorage`: `Map` trong bộ nhớ; `presignUpload` trả URL `memory://…` kèm chữ ký HMAC + hạn; `simulateBrowserUpload(upload, bytes, contentType)` kiểm đủ điều kiện như POST policy (khóa chính xác, `Content-Type` chính xác, `content-length-range [1, maxBytes]`, hạn); `presignUpload` và `signedUrl('preview')` với `job_tmp` → `InvalidRequestError`; `write` với `job_tmp` lưu nhãn `lifecycle=tmp`; đồng hồ tiêm được để dọn đối tượng có nhãn `lifecycle=tmp` theo `createdAt` > 1 ngày
- [ ] T086 [US5] Cài đặt `S/core/storage/s3/s3-storage.ts` – `S3ObjectStorage` (`@aws-sdk/*` chỉ ở đây): presigned POST với điều kiện `key` chính xác, `Content-Type` chính xác, `content-length-range [1, maxBytes]`, hạn ≤ 900 s (từ chối `job_tmp`; `signedUrl('preview')` với `job_tmp` cũng từ chối); `write` với `job_tmp` đặt `Tagging: lifecycle=tmp` để luật vòng đời của bucket xóa sau 1 ngày; presigned GET preview/public (public ký bằng `S3_PUBLIC_ENDPOINT`); `stat({hash:true})` tính SHA-256 bằng luồng rồi lưu `x-amz-meta-sha256` bằng copy-in-place; `deleteAllForCurrentAccount` liệt kê + `DeleteObjects` lô 1 000; kiểu SDK không ra khỏi thư mục
- [ ] T087 [US5] Tạo `S/core/storage/storage.module.ts` (chọn `memory`/`s3` theo `STORAGE_DRIVER`, cung cấp `OBJECT_STORAGE` ở API và Worker) và ghép vào `S/app/api-app.module.ts`, `S/app/worker-app.module.ts`

**Checkpoint**: US5 xanh ở `memory` và MinIO; SC-005 đạt.

---

## Phase 8: User Story 6 – Chạy cục bộ bằng bản giả lập, không lỡ bật ở môi trường thật (Priority: P3)

**Goal**: Endpoint quản trị giả lập chỉ dev/test, compose chạy toàn luồng SC-007 không kết nối ra ngoài, production 404.

**Independent Test**: `pnpm --filter @app/server test:e2e-fakes` qua với `deny-egress`; app dựng với `APP_ENV=production` → `GET /dev/fakes/scenarios` = 404; `docker compose logs api worker | grep gateways.selected` cho cùng lựa chọn.

### Tests for User Story 6 ⚠️

- [ ] T088 [P] [US6] Viết `T/e2e/fakes-flow.e2e.spec.ts` (luồng quickstart.md mục 4, chạy với `NODE_OPTIONS=--require ./test/helpers/deny-egress.cjs`): kết nối kênh giả qua trang ủy quyền giả → `GET /api/channels` không mã quyền; kịch bản `timeout_after_publish` qua `PUT /dev/fakes/scenarios` → luồng gửi mẫu `unknown` → `reconcile` `found` → `GET /dev/fakes/platform/posts` `publishedCount = 1`; `POST /dev/fakes/ai/generate` làm `used` tăng; `PUT /dev/fakes/ai/budget {used:3999000}` → lời gọi tiếp bị chặn "Đã sử dụng hết giới hạn AI của chu kỳ"; vượt 80% → `GET /dev/fakes/notifications` có `ai_usage_80`, hộp thư có thư không số tiền; `POST /dev/fakes/storage/upload-url` → tải lên → `stat` thấy `tenants/<accountId>/media/<mediaId>/original`; thêm script `test:e2e-fakes` vào `apps/server/package.json`
- [ ] T089 [P] [US6] Viết `T/e2e/dev-fakes-production-404.e2e.spec.ts`: (1) kiểm hàm thuần `shouldRegisterDevRoutes(appEnv)` (T091): `production`, `staging` → `false`, `development`, `test` → `true`; (2) dựng `ApiAppModule` bằng cấu hình tiêm trực tiếp `appEnv='production'` (bỏ qua `loadConfig`/`assertNoFakesInProduction`, thay provider cổng bằng bản rỗng của kiểm thử vì chưa có bản thật) → mọi route `/dev/fakes/*` và `/dev/fake-oauth/*` = 404; dev/test → route có; route luôn gắn tài khoản trong phiên, không nhận mã tài khoản (thử truyền `accountId` trong thân/đường dẫn → bị bỏ qua/400)

### Implementation for User Story 6

- [ ] T090 [US6] Tạo `S/dev/fakes.controller.ts` – `DevFakesController` với 10 route contracts/runtime-config.md mục 3 (`GET/PUT/DELETE /dev/fakes/scenarios`, `DELETE /dev/fakes/scenarios/:id`, `GET /dev/fakes/platform/posts`, `GET/PUT /dev/fakes/ai/budget`, `POST /dev/fakes/ai/generate` – gọi `AiGatewayPublicApi.generate` thật, `POST /dev/fakes/storage/upload-url` – `media_original` với `mediaId` UUID v7 mới, `GET /dev/fakes/notifications`), tất cả `@CustomerAccess('status.view')`; `spec` kiểm Zod theo `component` dùng cùng khuôn `FakeStep` (T036) và kịch bản AI (T058); ghi qua `ScenarioStore` (T020)
- [ ] T091 [US6] Ghép có điều kiện trong `S/app/api-app.module.ts` qua hàm thuần xuất được `shouldRegisterDevRoutes(appEnv)` (thêm `DevFakesController` + `fake-oauth.controller` chỉ khi `APP_ENV ∈ {development, test}`, khuôn `DiagnosticsController`; module nhận cấu hình tiêm được để T089 dựng với `appEnv='production'`) và kiểm `S/app/worker-app.module.ts` dùng cùng lựa chọn bản cài đặt + cùng kho `FAKE_STATE_STORE` cho cả 4 thành phần (US6-AS1)
- [ ] T092 [US6] Chạy `docker compose up --build -d`, kiểm `gateways.selected` ở `api` và `worker` giống nhau, chạy luồng tay quickstart.md mục 4 bước 1–5 (Mailpit `http://localhost:8025`, MinIO console `http://localhost:9001`, ≤ 10 giây – SC-011); sửa `docker-compose.yml`/`apps/server/.env.example` nếu lệch

**Checkpoint**: Cả 6 câu chuyện chạy độc lập.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T093 [P] Viết `apps/server/docs/gateways.md`: cách dùng 4 hợp đồng từ module nghiệp vụ (ví dụ mã), bảng lỗi/kết quả, cách dàn kịch bản (API lập trình + `/dev/fakes`), cách thêm bộ chuyển đổi mới (chỉ adapter + dòng đăng ký), cách bản thật sau này cắm vào bộ kiểm thử hợp đồng (thêm một tệp `*.contract.spec.ts` – SC-010)
- [ ] T094 [P] Cập nhật `.specify/memory/architecture.md`: mục 7.2 thêm ngân sách hệ thống theo tuần + kẹp trần khi quyết toán + sự kiện 80/100% tạo trong cùng giao dịch quyết toán (`settle` + `onCrossed`); mục 7.3 (hoặc chỗ mô tả giữ chỗ treo) đổi "trả lại sau 15 phút" thành hai nhánh `held` → trả lại / `calling` → quyết toán theo ước tính (research R8); mục 11 thêm các thuật ngữ ở data-model.md mục 0 (gồm `markCalling`, `calling`, `unsettled`). Bố cục kho tệp `tenants/{accountId}/tmp/{jobId}/…` đã sửa sẵn ở dòng 71, 100, 151 trong lúc phân tích – chỉ cần kiểm lại
- [ ] T095 [P] Ghi danh sách sửa tài liệu theo R18/FR-038 vào `specs/005-gateway-contracts-fakes/docs-followup.md` (`TaiLieuDacTa/` bị gitignore – sửa ở repo chính khi hợp nhất): Đặc tả NFR chi phí ("chia đều" → chi phí vận hành), ADD Cổng AI (dòng chia đều sau mục 7), ADD Cổng AI + Kiến trúc dữ liệu mục 7.3 (quy tắc giữ chỗ treo "trả lại sau 15 phút" → hai nhánh `held`/`calling`), ADD Worker (bỏ việc định kỳ "Chia chi phí xu hướng dùng chung" và bước 3 luồng xu hướng), Kiến trúc dữ liệu (bố cục kho tệp `tmp/{jobId}/…` → `tenants/{accountId}/tmp/{jobId}/…`, luật hết hạn theo nhãn); nhắc trong bước `/speckit-worktree-finish`
- [ ] T096 Chạy toàn bộ bộ hợp đồng bản giả lập (`pnpm --filter @app/server test -- test/contracts`) và đo thời gian ≤ 2 phút (SC-008); nếu vượt, giảm vòng đồng thời ở chế độ `memory` nhưng giữ ≥ 100 × 20 (SC-003)
- [ ] T097 Chạy `pnpm check:secrets` trên nhật ký mẫu của bộ hợp đồng + e2e: 0 lần `fake_tok_`, `PROMPT_CANARY_`, `POST_CANARY_` (SC-009)
- [ ] T098 Chạy `pnpm verify`, `pnpm test`, `pnpm test:db`, `pnpm test:queue`, `pnpm test:infra`, `pnpm db:check` – tất cả xanh; chạy lại quickstart.md mục 1–6
- [ ] T099 Rà soát theo hiến pháp bằng skill `constitution-review` (nhất là nguyên tắc I, II, III, VII) và ghi kết quả + xác nhận thay đổi manifest (Complexity Tracking) vào `specs/005-gateway-contracts-fakes/plan.md` mục "Constitution Check"

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 trước mọi việc; T002–T006 song song sau T001.
- **Foundational (Phase 2)**: sau Setup; **chặn mọi câu chuyện**. Thứ tự trong phase: T007 → T008 → T009; T011 → T021; T012, T013 → T014; T015, T016; T017 → T018 → T019, T020 (gồm `memoryTx` dùng bởi T060, T076, T077).
- **US1 (Phase 3)**: sau Phase 2. MVP.
- **US2 (Phase 4)**: sau US1 (dùng registry, adapter giả, bộ hợp đồng adapter).
- **US3 (Phase 5)**: sau Phase 2; độc lập với US1/US2 (chạy song song được).
- **US4 (Phase 6)**: sau Phase 2 (cần T015 `enqueueRegistered`, T016 `listActiveMembers`, T020 `memoryTx`); T080 cần US3 xong (dùng `settle(…, { onCrossed })` của T059–T061).
- **US5 (Phase 7)**: sau Phase 2; độc lập với US1–US4.
- **US6 (Phase 8)**: sau US1, US3, US4, US5 (luồng e2e dùng cả bốn).
- **Polish (Phase 9)**: sau mọi câu chuyện cần có.

### User Story Dependencies

```
Phase 1 ─► Phase 2 ─┬─► US1 ─► US2 ─────────────┐
                    ├─► US3 ──────┐              │
                    ├─► US4 ◄─────┘ (T080)       ├─► US6 ─► Polish
                    └─► US5 ─────────────────────┘
```

### Within Each User Story

- Kiểm thử hợp đồng trước, chạy thấy đỏ.
- Kiểu hợp đồng (`public-api.ts`) → hàm thuần → kho ×2 → bản giả lập → dịch vụ cổng → nối module/HTTP.
- Xong câu chuyện thì chạy `pnpm test` + `pnpm test:db` cho phần của nó trước khi sang câu chuyện sau.

### Parallel Opportunities

- Phase 1: T003, T004, T005, T006.
- Phase 2: T010, T014, T019 (sau việc mà chúng kiểm).
- US1: kiểm thử T022–T026 song song; T028–T032, T034–T036 song song sau T027.
- US3: T050–T052 song song; T054–T058 song song sau T053.
- US4: T066–T070 song song; T072–T074 song song sau T071.
- US5: T081–T083 song song.
- Các câu chuyện US1, US3, US5 (và US4 trừ T080) làm song song được bởi người khác nhau sau Phase 2.

---

## Parallel Example: User Story 1

```bash
# Kiểm thử hợp đồng cùng lúc:
Task: "T022 describePlatformAdapterContract trong T/contracts/platform/adapter.contract.ts"
Task: "T023 describePlatformGatewayContract trong T/contracts/platform/gateway.contract.ts"
Task: "T025 kiểm thử đơn vị content-hash/classify/media-rules trong T/unit/platform/"
Task: "T026 e2e kết nối kênh trong T/e2e/channels-connect.e2e.spec.ts"

# Sau T027 (kiểu hợp đồng), các hàm thuần cùng lúc:
Task: "T029 content-hash.ts"  Task: "T030 classify.ts"  Task: "T031 media-rules.ts"
Task: "T032 result-shapes.ts" Task: "T034 credential-vault.ts" Task: "T035 fake/channels.ts"
```

## Parallel Example: User Story 3

```bash
Task: "T050 describeAiGatewayContract trong T/contracts/ai/ai-gateway.contract.ts"
Task: "T052 kiểm thử đơn vị estimate/tier/price-book/validate trong T/unit/ai/"
# Sau T053:
Task: "T054 errors.ts"  Task: "T055 price-book.ts + prices.fake.json"  Task: "T056 estimate.ts + tier.ts"
Task: "T057 providers/provider.ts"  Task: "T058 fake/fake-provider.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 → Phase 2 (nền: cấu hình, chặn production, `sandbox`, ranh giới).
2. Phase 3 (US1) → **DỪNG và KIỂM**: bộ hợp đồng platform xanh ở `memory` + `sandbox`; đội Đăng bài (WBS 2.4)
   bắt đầu được ngay.

### Incremental Delivery

1. Nền → US1 (MVP, mở khóa WBS 2.4) → US2 (chứng minh ADR-05).
2. US3 (mở khóa Nội dung/Media/Xu hướng – WBS 3.x).
3. US4 (thông báo + email) → nối T080.
4. US5 (kho tệp – mở khóa WBS 2.6).
5. US6 (chạy cục bộ toàn luồng, chặn production) → Polish.

### Parallel Team Strategy

Sau Phase 2: BE-2 làm US1 → US2; BE-3 làm US3 rồi US4; người thứ ba làm US5; hợp lại ở US6 và Polish.

---

## Notes

- [P] = khác tệp, không phụ thuộc việc chưa xong; [USx] = truy vết câu chuyện.
- Commit sau mỗi việc hoặc nhóm việc logic; commit theo khuôn `feat(005): …` / `test(005): …`.
- Không làm phần ngoài phạm vi: bộ chuyển đổi thật, OAuth Meta/Zalo, bảng `channel_connections`/KMS, bảng ngân sách
  thật, nhà cung cấp AI thật, gộp email 10 phút, màn hình Thông báo, bản ghi media/dung lượng, luồng đăng 5 bước.
- Mọi mã chỉ-dev nằm trong `S/dev/` hoặc `modules/*/internal/fake/`; quy tắc ranh giới T013 bắt lỗi lọt ra ngoài.
