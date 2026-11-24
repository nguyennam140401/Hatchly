# Tasks: Cổng AI thật

**Input**: `specs/015-real-ai-gateway/` — `plan.md`, `spec.md`, `research.md` (R-01…R-18), `data-model.md`, `contracts/*`, `quickstart.md`

**Prerequisites**: worktree `impl/015-real-ai-gateway`, `pnpm install`, `pnpm db:up && pnpm db:bootstrap && pnpm db:setup`.

**Tests**: **Có** — hiến pháp bắt buộc kiểm thử Cổng AI (đồng thời, ngưỡng 2/4 USD, trả giữ chỗ khi lỗi), truy cập chéo tài khoản, bộ xử lý nền chạy lại hai lần, ngày chu kỳ 29–31. Bộ hợp đồng 005 (14 mục) chạy lại nguyên vẹn trên kho thật, thêm mục 15–20.

**Organization**: theo user story; mọi đường dẫn tính từ gốc worktree. `S = apps/server/src/modules/ai_gateway`, `T = apps/server/test`.

## Format: `[ID] [P?] [SHARED?] [Story] @chủ-sở-hữu Mô tả + đường dẫn`

- **[P]**: chạy song song được (khác tệp, khác chủ hoặc khác thư mục, không phụ thuộc tác vụ chưa xong)
- **[SHARED]**: chạm tệp dùng chung (`shared_sequential` trong `.specify/ownership.json`), chạy tuần tự, không `[P]`
- **[USn]**: user story trong `spec.md`
- Chủ sở hữu theo `.specify/ownership.json`: `@data-dev` (`apps/server/drizzle/**`, `S/internal/db/**`, `apps/server/src/modules/queue/**`), `@backend-dev` (phần còn lại của `apps/server/src/**`, `apps/server/docs/**`, `packages/shared/src/**`), `@frontend-dev` (`apps/web/src/**`), `@devops-dev` (`infra/**`, `ops/**`, `tooling/**` trừ `tooling/test/**`), `@qa` (mọi tệp kiểm thử, `specs/*/acceptance-report.md`), `@reviewer` (`specs/*/reviews/**`), `@pm` (chuyển cho `architect` khi là `plan.md`/`research.md`/`contracts/**`).
- Mã đã có giữ nguyên số; nhiệm vụ tách theo chủ dùng hậu tố (`T001a`, `T001b`…). Kiểm thử (`@qa`) đặt trước mã tương ứng.
- Tài liệu `docs/wiki/**` **không** do nhiệm vụ nào ở đây ghi: cập nhật ở bước `wiki-ingest` sau khi merge.

## Quy ước dùng chung

- Tiền là `bigint` micro-USD (4 USD = `4_000_000`); không số thực ở bất kỳ bước nào (FR-016).
- Không nhật ký/chỉ số/thông báo chứa lời nhắc, văn bản kết quả, khóa API hoặc số tiền theo tài khoản (FR-017, FR-026).
- Mọi chuyển trạng thái giữ chỗ bằng `UPDATE … WHERE state = :expected`.
- Số migration của 015 là **0029** và **0030** (0024–0028 đã thuộc 010).
- Chạy: `pnpm test` (bộ nhớ), `pnpm test:db`, `pnpm test:queue`, `pnpm check:boundaries`, `pnpm db:check`, `pnpm db:lint-migrations`.

---

## Phase 1: Setup

**Purpose**: cấu hình, phụ thuộc.

**Thứ tự chủ**: qa (T001a, T003a) → backend-dev (T001, T003) → devops-dev (T002).

- [X] T001a @qa Mở rộng kiểm thử cấu hình cho `AI_GATEWAY_DRIVER=real`, `AI_PRICE_CACHE_TTL_MS`, `AI_TOKEN_ESTIMATE_SAFETY_PERCENT`, khóa nhà cung cấp bắt buộc chỉ khi `real` và tuyến bật, khóa không bao giờ in ra lỗi, trong `apps/server/test/config.spec.ts`
- [X] T001 @backend-dev Thêm `'real'` vào `AI_GATEWAY_DRIVER` (`fake|real`), `AI_PRICE_CACHE_TTL_MS` (mặc định 60000), `AI_TOKEN_ESTIMATE_SAFETY_PERCENT` (mặc định 20), `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (bắt buộc chỉ khi `real` và tuyến bật dùng nhà cung cấp đó; không bao giờ in ra nhật ký) trong `apps/server/src/core/config/config.schema.ts` và `.env.example`
- [X] T002 [SHARED] @devops-dev Thêm SDK Anthropic và OpenAI vào `apps/server/package.json` và cập nhật `pnpm-lock.yaml` — **cố định phiên bản chính xác**, bản đã phát hành ≥ 2 tuần (hiến pháp IX); kiểm `pnpm check:boundaries` cấm nhập SDK ngoài `S/internal/providers/`
- [X] T003a [P] @qa Thêm kiểm thử bảng quyền cho `ai.pricing.manage` (chỉ `admin`) và `ai.cost.view` (`support`, `admin`); khách/cộng tác viên đều ✗, trong `apps/server/test/auth/permissions.spec.ts`
- [X] T003 @backend-dev Thêm quyền `ai.pricing.manage` và `ai.cost.view` vào `packages/shared/src/auth/permissions.ts` (không đổi `packages/shared/src/index.ts` nếu đã xuất qua `auth`; nếu phải đổi thì tách nhiệm vụ `[SHARED]` riêng)
- [ ] T004 ~~Tạo khung thư mục rỗng~~ **Bỏ**: git không theo dõi thư mục rỗng; thư mục `S/internal/{budget,prices,routing,settings,admin,alerts,allocation}/` và `T/ai_gateway/` được tạo cùng tệp đầu tiên của chúng

---

## Phase 2: Foundational (chặn mọi user story)

**Purpose**: bảng, RLS, chu kỳ, bảng giá/tuyến/cấu hình đọc được, cắm driver thật. Không user story nào bắt đầu trước khi xong.

**Thứ tự chủ**: qa (T006c, T009a, T016a) → data-dev (T005 → T006 → T007 → T008) → backend-dev (T006b, T008a, T009–T017).

- [X] T006c @qa Kiểm thử phân vùng `ai_cost_ledger`: hàm tạo trước phân vùng tháng và hàm bỏ phân vùng > 12 tháng chạy hai lần cho cùng kết quả; thu hồi `UPDATE/DELETE` của `app`/`system`, trong `apps/server/test/ai_gateway/ledger-partitions.spec.ts` (khuôn kiểm thử `publish_steps`)
- [X] T009a [P] @qa Kiểm thử đơn vị `AccountPublicApi.getAiCycleAnchor()` (tài khoản `active` → ngày tạo; trạng thái khác/không có → `null`; không cache) trong `apps/server/test/account/ai-cycle-anchor.spec.ts`
- [X] T016a [P] @qa Kiểm thử đơn vị bộ ước tính token (tiếng Việt có dấu, `ceil(bytes/3)` × hệ số an toàn, số nguyên, chặn trên) trong `apps/server/test/ai_gateway/token-estimate.spec.ts`
- [X] T005 [SHARED] @data-dev Viết migration `apps/server/drizzle/migrations/0029_ai_gateway_tables.sql` (chỉ thêm, tương thích ngược) và thêm mục tương ứng vào `apps/server/drizzle/migrations/meta/_journal.json`: tạo `ai_budgets`, `ai_reservations`, `ai_trend_allocations` (tenant, RLS `tenant_isolation`, `account_id` đầu mọi chỉ mục), `system_budgets`, `system_reservations`, `system_cost_ledger`, `model_prices`, `model_routes`, `task_fallback`, `ai_settings`, `provider_invoices` (shared, có `reason`); ràng buộc nguyên văn từ `data-model.md`: `UNIQUE (account_id, cycle_start)`, `CHECK (used >= 0 AND reserved >= 0 AND used + reserved <= cap)`, `CHECK (soft_limit < cap AND cap > 0)`, `estimate bigint CHECK >= 0`, `state IN ('held','calling','settled','released')`, chỉ mục duy nhất từng phần `(account_id, cycle_start, request_id) WHERE request_id IS NOT NULL AND state <> 'released'`, `model_prices` mọi giá `> 0` khớp `unit` + trigger chặn UPDATE/DELETE, `model_routes PRIMARY KEY (tier, rank) CHECK rank IN (1,2)`, `ai_settings id smallint PRIMARY KEY CHECK (id = 1)` và `CHECK (soft < cap AND per_industry_weekly > 0)`, `provider_invoices UNIQUE (provider, invoice_date) CHECK total >= 0`, `system_budgets CHECK (used + reserved <= cap)`
- [X] T006 @data-dev Trong cùng `apps/server/drizzle/migrations/0029_ai_gateway_tables.sql` (sau T005, cùng tệp nên không `[P]`): tạo `ai_cost_ledger` `PARTITION BY RANGE (created_at)` theo tháng (khuôn `0020_publishing_013_steps_log.sql`), RLS `tenant_isolation` USING/WITH CHECK `account_id = account.current_account_id()`, thu hồi `UPDATE/DELETE` của `app`/`system`, không FK; cột đúng `data-model.md` mục 2.3 (`anomaly` ∈ `over_estimate|unsettled|missing_usage`, `over_cap_micro_usd` DEFAULT 0, `audio_seconds` NULL); tạo hàm `ai_gateway.ensure_ai_cost_ledger_partitions` và `ai_gateway.drop_ai_cost_ledger_partitions_before` theo mẫu `publishing.ensure_publish_steps_partitions`/`publishing.drop_publish_steps_partitions_before`
- [X] T006b @backend-dev Đăng ký phân vùng định kỳ bằng `registerPartitionedLog({... ensureFunction: 'ai_gateway.ensure_ai_cost_ledger_partitions', dropFunction: 'ai_gateway.drop_ai_cost_ledger_partitions_before' ...})` (nhập từ `../queue`, đúng khuôn `apps/server/src/modules/publishing/jobs.ts` dòng 7–12) trong `S/jobs.ts`
- [X] T007 [SHARED] @data-dev Viết migration `apps/server/drizzle/migrations/0030_ai_gateway_seed_support.sql` và thêm mục vào `apps/server/drizzle/migrations/meta/_journal.json`: dòng cấu hình khởi đầu (`ai_settings` 4 000 000 / 2 000 000 / mức ngành giả định SA chốt tạm; `task_fallback` 6 dòng — chỉ `post_generation`, `topic_suggestion` bật; `model_routes` + `model_prices` giá giả định cho 4 bậc), khung nhìn `support.ai_budget_detail` (không cột bí mật), cấp quyền vai trò; chạy `pnpm db:lint-migrations` và `pnpm db:check`
- [X] T039a [SHARED] @data-dev (bổ sung sau khi T039–T041 bị chặn) Viết migration `apps/server/drizzle/migrations/0031_ai_gateway_admin_functions.sql` + mục `_journal.json` + snapshot, theo mẫu `0028_platform_gateway_010_feature_admin_functions.sql`: các hàm `SECURITY DEFINER` trong schema `ai_gateway`, `EXECUTE` chỉ cho vai trò `support`: ghi `admin_add_price`, `admin_set_settings` (kiểm toán từng trường đổi), `admin_set_route`, `admin_set_task_fallback`, `admin_enter_invoice`, mỗi hàm chèn `infra.audit_log` cùng giao dịch (`actor_type='admin'`, `actor_id` = mã nhân viên); hàm đọc cho phần kiểm tra ở TS: giá hiện hành theo `(provider, model, unit)`, cấu hình hiện tại, mô hình đã có giá, tuyến rank 2 của bậc; kèm bọc kiểu `S/internal/db/admin-functions.ts`
- [X] T008 @data-dev Khai báo Drizzle `S/internal/db/schema.ts` (`tenantTable`/`sharedTable` cho mọi bảng ở T005, có `reason` cho bảng shared) và `S/internal/db/ai-cost-ledger.log-table.ts` (khuôn `apps/server/src/modules/publishing/internal/db/publish-steps.log-table.ts`)
- [X] T008a [SHARED] @backend-dev Cập nhật `apps/server/src/modules/modules.manifest.json` (khai báo schema/bảng mới của `ai_gateway` nếu manifest hiện tại yêu cầu; bỏ qua nếu `pnpm check:boundaries` đã đạt mà không cần đổi)
- [X] T009 [P] @backend-dev Thêm `AccountPublicApi.getAiCycleAnchor(): Promise<{ anchorDate: string } | null>` (`apps/server/src/modules/account/public-api.ts`, `index.ts`, hiện thực tạm: ngày tạo của tài khoản `status='active'`, trạng thái khác → `null`, không cache, chạy ở API và Worker)
- [X] T010 [P] @backend-dev Viết `S/internal/budget/cycle.ts`: tính `cycle_start`/`cycle_end` từ `anchorDate`, lặp hằng tháng, tháng không có ngày đó → ngày cuối tháng (29/30/31, tháng 2, năm nhuận) và `weekStart` (thứ Hai 00:00 UTC+7) cho hệ thống; thuần hàm, không đọc CSDL
- [X] T011 [P] @backend-dev Viết `S/internal/settings/ai-settings.ts`: đọc `ai_settings` (không cache ngân sách, được đệm cấu hình TTL ≤ 60 s) trả `accountCap`, `softLimit`, `perIndustryWeekly`; bản ghi chụp vào dòng ngân sách lúc tạo
- [X] T012 [P] @backend-dev Viết `S/internal/prices/db-price-source.ts` triển khai `PriceSource` đọc `model_prices` theo `(provider, modelId, unit)` tại thời điểm giữ chỗ, đệm TTL `AI_PRICE_CACHE_TTL_MS`, trả cả `price_id`; thiếu/hết hiệu lực → `null` (không đoán giá)
- [X] T013 [P] @backend-dev Viết `S/internal/routing/route-book.ts` (`attemptsFor(task, tier)` đúng thuật toán `contracts/provider-adapter.md` mục 3: rank 1 `enabled`; rank 2 chỉ khi `enabled` **và** `task_fallback[task].enabled`; thiếu rank 1 → rỗng) đệm TTL 60 s
- [X] T014 @backend-dev Thêm `'AI_DUPLICATE_REQUEST'` và `'AI_NOT_CONFIGURED'` vào `AiErrorCode` (`S/public-api.ts`, `S/internal/errors.ts`) với `messageVi` đúng `contracts/ai-gateway-delta.md` mục 2 (không số tiền; `AI_DUPLICATE_REQUEST` mang `status: 'settled' | 'in_progress'`); thêm `requestId?: string` (1–128 ký tự `[A-Za-z0-9:_.-]`, sai định dạng → `AI_INVALID_REQUEST`) cho `AiRequest` và `TranscribeRequest`; tạo `S/internal/events.ts` với hàm phát sự kiện vận hành `gatewayEvent(level, name, fields)` (không nhận lời nhắc/kết quả/tiền theo tài khoản) dùng cho các cảnh báo `ai.*` về sau
- [X] T015 @backend-dev Mở rộng `S/internal/budget/budget-store.ts` cho `reserve` nhận `requestId`, trả kết quả `duplicate` (kèm `status`); giữ nguyên ngữ nghĩa các phương thức cũ. Cập nhật `S/internal/fake/store.memory.ts`, `S/internal/fake/store.sandbox.ts` **và** nhánh xử lý kết quả `duplicate` trong `S/internal/gateway.service.ts` (ném `AiError('AI_DUPLICATE_REQUEST')`) để `pnpm typecheck` không vỡ giữa chừng và bản giả lập không hồi quy
- [X] T016 @backend-dev Viết bộ ước tính token cục bộ `S/internal/providers/token-estimate.ts`: `ceil(bytes/3)` × (1 + `AI_TOKEN_ESTIMATE_SAFETY_PERCENT`/100), chặn trên, không gọi mạng, số nguyên (R-09)
- [X] T017 @backend-dev Cập nhật `S/ai_gateway.module.ts`: chọn driver `fake|real`; ở `real` nối `DbPriceSource` (T012), `RouteBook` (T013), `AiSettings` (T011) — **không** nối `DbBudgetStore` (chưa tồn tại; nối ở T025) và nhánh `real` tạm ném lỗi khởi động rõ ràng "chưa đủ thành phần" cho tới T025/T049; giữ `assert-no-fakes` từ chối `fake` ở production; đăng ký token cổng đảo ngược `ACTIVE_INDUSTRIES_SOURCE`/`INDUSTRY_ACCOUNTS_SOURCE` (kiểu + token khai ở `S/public-api.ts`, hiện thực do module khác cắm sau)

**Checkpoint**: bảng + chu kỳ + giá + tuyến + lỗi mới sẵn sàng; `pnpm typecheck && pnpm db:check && pnpm db:lint-migrations` đạt; bản giả lập vẫn chạy.

---

## Phase 3: User Story 1 — Chặn trước khi vượt trần 4 USD (P1) 🎯 MVP

**Goal**: ngân sách + giữ chỗ bền trong CSDL, giữ chỗ bằng một `UPDATE` có điều kiện, quyết toán/trả lại trong một giao dịch, mã yêu cầu logic chống trừ trùng.

**Independent Test**: bắn song song nhiều lời gọi sát trần; `used + reserved ≤ cap` ở mọi lần quan sát, `reserved = 0` khi xong, 0 lời gọi nhà cung cấp cho lời gọi bị từ chối (SC-001/002).

**Thứ tự chủ**: qa (T018–T024) → backend-dev (T025–T032). Không có việc `data-dev` mới (schema đã xong ở Phase 2).

### Tests (viết trước, phải FAIL trước khi cài đặt)

- [X] T018 [US1] @qa Chạy lại bộ hợp đồng 005 trên kho thật: `T/contracts/ai/ai.db.contract.spec.ts` dùng `T/contracts/ai/ai-gateway.contract.ts`; sửa `T/contracts/ai/harness.ts` thêm fixture `db` thay `sandbox` (chạy **trước** T019/T020 vì sửa `harness.ts`); kỳ vọng 14 mục của 005 đạt
- [X] T019 [US1] @qa Mục 15 (`requestId`) trong `T/contracts/ai/ai-gateway.contract.ts`: cùng mã hai lần → lần hai `AI_DUPLICATE_REQUEST(settled)`, 0 lời gọi nhà cung cấp, đúng 1 dòng sổ; hai lần đồng thời → một chạy, một `in_progress`; lần đầu lỗi (đã `released`) → thử lại cùng mã chạy được
- [X] T020 [US1] @qa Mục 16 (chu kỳ) trong `T/contracts/ai/ai-gateway.contract.ts` (sau T019, cùng tệp) và `T/ai_gateway/cycle.spec.ts`: kích hoạt 29/30/31, tháng 2, năm nhuận; hai yêu cầu đầu chu kỳ đồng thời → đúng 1 dòng `ai_budgets`; chu kỳ mới đặt lại cờ 80/100
- [X] T021 [P] [US1] @qa `T/ai_gateway/concurrency.spec.ts`: 100 vòng × 25 lời gọi song song sát trần, kiểm bất biến `used + reserved ≤ cap` mỗi lần quan sát và `reserved = 0` khi xong; `reserve` p95 ≤ 50 ms (200 lần, SC-003)
- [X] T022 [P] [US1] @qa `T/ai_gateway/rls-cross-account.spec.ts`: tài khoản A đọc/sửa/xóa `ai_budgets`, `ai_reservations`, `ai_cost_ledger`, `ai_trend_allocations` của B → thất bại; thiếu biến phiên → không thấy dòng nào
- [X] T023 [P] [US1] @qa `T/queue/ai_gateway-release-stale.queue.spec.ts` (tệp mới cho kho thật; `ai-release-stale.queue.spec.ts` hiện có là của bản sandbox): giữ chỗ `held` tuổi 16 phút → `released`; `calling` tuổi 16 phút → quyết toán theo ước tính (kẹp trần), sổ `anomaly='unsettled'`; chạy dọn hai lần như một lần
- [X] T024 [P] [US1] @qa `T/ai_gateway/no-account-no-budget.spec.ts`: `getAiCycleAnchor()` trả `null` → `AI_BUDGET_EXHAUSTED`, không tạo ngân sách, không gọi nhà cung cấp

### Implementation

- [X] T025 [US1] @backend-dev Viết `S/internal/budget/db-budget-store.ts` (`DbBudgetStore`): chuyển nguyên logic từ `S/internal/fake/store.sandbox.ts` sang bảng thật; `reserve` = `INSERT … ON CONFLICT DO NOTHING` ngân sách chu kỳ rồi **một** `UPDATE ai_budgets SET reserved = reserved + :est WHERE account_id = … AND cycle_start = … AND used + reserved + :est <= cap` + `INSERT ai_reservations` cùng giao dịch; hẹn `ai_gateway.release_stale` +15 phút **trong giao dịch giữ chỗ**. Nối `DbBudgetStore` vào `S/ai_gateway.module.ts` cho driver `real` (phần nối bị hoãn từ T017) để `pnpm typecheck` đạt
- [X] T026 [US1] @backend-dev Trong `S/internal/budget/db-budget-store.ts`: `markCalling` (`held → calling`, đặt `called_at`), `settle` (một giao dịch: `used += min(cost, cap − used)`, `reserved -= estimate`, `INSERT ai_cost_ledger` với `over_cap_micro_usd`, bật cờ 80/100 bằng cập nhật có điều kiện `= false`, gọi `onCrossed(tx, …)`), `release` (`held|calling → released`, trả `reserved`); mọi chuyển trạng thái `WHERE state = :expected`, chuyển trạng thái đã xảy ra → không đổi (idempotent)
- [X] T027 [US1] @backend-dev Trong `S/internal/budget/db-budget-store.ts`: xử lý mã yêu cầu logic — khi `reserve` gặp dòng cùng `(account, cycle, request_id)` ở `settled` → `duplicate(settled)`; `held|calling` → `duplicate(in_progress)`; `released` → cho chạy; bắt vi phạm chỉ mục duy nhất từng phần khi chạy đồng thời và ánh xạ sang `in_progress`
- [X] T028 [US1] @backend-dev Trong `S/internal/budget/db-budget-store.ts`: lấy mốc chu kỳ qua `AccountPublicApi.getAiCycleAnchor()` + `S/internal/budget/cycle.ts` (T010); `null` → `AI_BUDGET_EXHAUSTED`; chụp `cap`/`soft_limit` từ `AiSettings` (T011) vào dòng ngân sách lúc tạo
- [X] T029 [US1] @backend-dev Cập nhật `S/internal/gateway.service.ts` (ngay sau T015/T028): chuyển `requestId` xuống `reserve`; bảng hành vi `contracts/ai-gateway-delta.md` mục 1 cho `AI_DUPLICATE_REQUEST(settled|in_progress)`; thiếu giá hoặc thiếu tuyến rank 1 → `AI_NOT_CONFIGURED` + `gatewayEvent('ai.price_missing'|'ai.route_missing')` **trước khi** gọi nhà cung cấp; không ghi lời nhắc/kết quả/tiền vào nhật ký
- [X] T030 [US1] @backend-dev Cập nhật `S/jobs.ts`: nối `ai_gateway.release_stale` (khóa `ai_release_stale:{reservationId}`) vào `DbBudgetStore`; bộ xử lý nền gặp `AI_BUDGET_EXHAUSTED`, `AI_SYSTEM_BUDGET_EXHAUSTED`, `AI_DUPLICATE_REQUEST`, `AI_NOT_CONFIGURED` dùng `noRetry(...)` của 003, `AI_PROVIDER_UNAVAILABLE` thử lại theo chính sách hàng chờ (≤ 2 lần ở `ai_batch`)
- [X] T031 [US1] @backend-dev Retry quyết toán đúng một lần trong `S/internal/budget/db-budget-store.ts` và `S/internal/gateway.service.ts`, giữ chỗ cho bộ dọn khi vẫn lỗi (Edge Case "Quyết toán lỗi"); phát qua `gatewayEvent` (`S/internal/events.ts`) các sự kiện `ai.settle_failed` sau lần thử lại hỏng, `ai.cost_anomaly` khi chi phí thực > ước tính, `ai.unsettled_reservation` khi dọn `calling` treo
- [X] T032 [US1] @backend-dev Hủy giữa chừng khi trả dần (`generateStream`) trong `S/internal/gateway.service.ts`: quyết toán phần đã sinh, trả phần còn lại, đúng một dòng sổ; được kiểm bởi mục hợp đồng 005 có sẵn ở `T/contracts/ai/ai-gateway.contract.ts` (T018)

**Checkpoint**: US1 chạy được đầu-cuối trên CSDL thật; `pnpm test:db -- test/contracts/ai test/ai_gateway/concurrency` và `pnpm test:queue -- test/queue/ai_gateway-release-stale` đạt. Dừng và xác nhận trước khi sang US2.

---

## Phase 4: User Story 2 — Ngưỡng mềm 2 USD tự chuyển mô hình rẻ (P1)

**Goal**: bậc mô hình được chọn đúng 100% theo mức dùng và loại việc, không gián đoạn.

**Independent Test**: ngân sách 1,99 / 2,00 / 2,01 USD cho cùng loại việc; gán nhãn/xu hướng luôn bậc rẻ (SC-005).

**Thứ tự chủ**: qa (T033) → backend-dev (T034, T035).

- [X] T033 [US2] @qa `T/ai_gateway/tier-threshold.spec.ts` (kiêm mục hợp đồng): 1,99 / 2,00 / 2,01 USD chọn đúng bậc cho `post_generation`/`topic_suggestion`; lời gọi đẩy tổng qua 2 USD vẫn chạy bậc mặc định, lời gọi sau mới rẻ (FR-012); `image_labeling`/`video_labeling` luôn `cheap_vision`; xu hướng luôn `cheap`; khi `used + reserved ≥ cap − minCallEstimate` → trạng thái `blocked`; mô hình rẻ cũng không đủ ngân sách còn lại → từ chối như hết hạn mức, không gọi nhà cung cấp (Edge Case)
- [X] T034 [US2] @backend-dev Cập nhật `S/internal/tier.ts` và `S/internal/gateway.service.ts` để ngưỡng mềm/cứng lấy từ `AiSettings` đã chụp vào dòng ngân sách (không hằng số); `getUsage()` giữ nguyên chữ ký và không có số tiền
- [X] T035 [US2] @backend-dev Trong `S/internal/gateway.service.ts`: mô hình rẻ cũng không đủ ngân sách còn lại → từ chối như hết hạn mức, không gọi nhà cung cấp; được kiểm bởi `T/ai_gateway/tier-threshold.spec.ts` (T033)

**Checkpoint**: US1 + US2 độc lập đều đạt.

---

## Phase 5: User Story 3 — Sổ chi phí và bảng giá cấu hình (P1)

**Goal**: mỗi lời gọi một dòng sổ chỉ-thêm; đổi giá không cần phát hành, có kiểm toán và kiểm tra bất hợp lý.

**Independent Test**: chuỗi lời gọi hỗn hợp để lại đúng sổ; đổi giá hiệu lực từ T → trước T giá cũ, sau T giá mới (SC-006/007).

**Thứ tự chủ**: qa (T036–T038) → backend-dev (T039–T043).

### Tests

- [X] T036 [P] [US3] @qa Mục 18 (bảng giá) trong `T/contracts/ai/ai-gateway.contract.ts` + `T/ai_gateway/price-effective.spec.ts`: dòng giá hiệu lực từ T; quyết toán dùng `price_id` của giữ chỗ dù giá đổi giữa chừng; thiếu giá → `AI_NOT_CONFIGURED`, không gọi nhà cung cấp; trigger chặn UPDATE/DELETE `model_prices`
- [X] T037 [P] [US3] @qa `T/ai_gateway/ledger-reconcile.spec.ts`: với mỗi `(account, cycle)`, `used = Σcost − Σover_cap` (sai lệch 0); `anomaly` `over_estimate`/`unsettled`/`missing_usage` ghi đúng; sổ không `UPDATE`/`DELETE` được (SC-006)
- [X] T038 [P] [US3] @qa `T/ai_gateway/admin.spec.ts`: `POST /admin/ai/prices` bởi `admin` thành công + dòng `infra.audit_log` `ai.price.add` `{priceId,provider,modelId,unit,old,new,effectiveFrom}`; giá ≤ 0 hoặc lệch > 10× → `AI_PRICE_IMPLAUSIBLE`; `effectiveFrom < now + TTL` → `AI_PRICE_EFFECTIVE_TOO_SOON`; `support`/khách → 403; `PUT /admin/ai/settings` với `soft ≥ cap` → `AI_SETTINGS_INVALID`; `PUT /admin/ai/routes` rank ∉ {1,2} hoặc mô hình chưa có giá → `AI_ROUTE_INVALID`; ghi cấu hình + kiểm toán **cùng một giao dịch**

### Implementation

- [X] T039 [US3] @backend-dev Viết `S/internal/admin/pricing.service.ts` (kèm hàm ghi kiểm toán dùng chung `S/internal/admin/audit.ts`): thêm dòng giá (giá > 0 đúng theo `unit`; lệch ≤ 10× so với dòng hiện hành cùng `(provider, modelId, unit)`, dòng đầu chỉ `> 0`; `effectiveFrom ≥ now + TTL đệm`; không sửa/xóa dòng cũ) và ghi `ai.price.add` vào `infra.audit_log` cùng giao dịch; mã lỗi tiếng Việt kèm hành động khắc phục
- [X] T040 [US3] @backend-dev Viết `S/internal/admin/settings.service.ts` (`PUT /admin/ai/settings`: `soft < cap`, nguyên dương, áp cho chu kỳ/tuần tạo sau; kiểm toán `ai.settings.change {field,old,new}`), `S/internal/admin/routes.service.ts` (`PUT /admin/ai/routes`, `PUT /admin/ai/task-fallback` — bật chỉ hợp lệ khi có tuyến rank 2 cho bậc của loại việc; kiểm toán `ai.route.change`/`ai.task_fallback.change`) và `S/internal/admin/invoices.service.ts` (`POST /admin/ai/provider-invoices`, `total ≥ 0`, trùng `(provider, invoiceDate)` thay thế kèm kiểm toán `ai.invoice.enter`); dùng chung `audit.ts` với T039 nên **không** `[P]`, chạy sau T039
- [X] T041 [US3] @backend-dev Viết `S/internal/admin/admin.controller.ts` với đúng một `@StaffAccess(...)` mỗi điểm cuối (`ai.pricing.manage` cho 5 điểm cuối cấu hình); không nhận `accountId` từ khách; đăng ký trong `S/ai_gateway.module.ts`
- [X] T042 [US3] @backend-dev Hoàn thiện đường quyết toán dùng `price_id` của giữ chỗ (không tra lại giá) trong `S/internal/gateway.service.ts`, sổ ghi `provider` thực sự trả kết quả; cập nhật `S/internal/estimate.ts` dùng `DbPriceSource` + `S/internal/providers/token-estimate.ts` (T016)
- [X] T043 [P] [US3] @backend-dev Chỉ số OpenTelemetry trong `S/internal/metrics.ts` theo `contracts/jobs-and-alerts.md` mục 3, **gồm cả chỉ số nhà cung cấp** để T047 không phải sửa lại tệp: `ai_gateway_reserve_duration_ms`, `ai_gateway_calls_total{task,tier,outcome}`, `ai_gateway_fallback_total{task}`, `ai_gateway_blocked_total{reason}`, `ai_gateway_estimate_ratio{task}`, `ai_gateway_open_reservations`, `ai_gateway_provider_calls_total{provider,outcome}`, `ai_gateway_provider_latency_ms{provider}`; chỉ nhãn `account_id` là nhãn phân tán cao

**Checkpoint**: US1–US3 (ba P1) hoàn tất → đủ để bật AI thật với nhà cung cấp giả máy chủ HTTP.

---

## Phase 6: User Story 4 — Nhà cung cấp dự phòng (P2)

**Goal**: chính lỗi → trả giữ chỗ, giữ lại theo giá dự phòng, gọi dự phòng đúng một lần; loại việc chưa bật dự phòng → lỗi ngay.

**Independent Test**: chính lỗi → dự phòng gọi đúng một lần với giữ chỗ mới; cả hai lỗi → ngân sách không bị trừ (SC-008).

**Thứ tự chủ**: qa (T044, T045, T045a, T049c) → backend-dev (T045b → T046/T047 → T048 → T048a → T049) → devops-dev (T049b, T050); `@pm` T049a song song.

### Tests

- [X] T044 [P] [US4] @qa Mục 17 (dự phòng theo loại việc) trong `T/contracts/ai/ai-gateway.contract.ts` + `T/ai_gateway/fallback.spec.ts`: chính lỗi → `release`, giữ lại theo giá dự phòng, gọi dự phòng **đúng một lần**, sổ ghi nhà cung cấp dự phòng; cả hai lỗi → `AI_PROVIDER_UNAVAILABLE`, `reserved = 0`; `transcription` chưa bật dự phòng + lỗi → lỗi ngay, không lời gọi thứ hai; dự phòng đắt hơn và thiếu ngân sách → từ chối như hết hạn mức, không gọi
- [X] T045 [P] [US4] @qa `T/ai_gateway/providers.contract.spec.ts`: kiểm thử hợp đồng cho `AnthropicAdapter`/`OpenAiAdapter` trên **máy chủ HTTP giả cục bộ** (không gọi mạng ngoài ở CI): `max_tokens = maxOut`, tôn trọng `AbortSignal`, chuẩn hóa mọi lỗi mạng/5xx/429/timeout thành lỗi chung, khóa API và lời nhắc không có trong thông điệp lỗi/nhật ký
- [X] T045a [US4] @qa Bổ sung vào `T/ai_gateway/providers.contract.spec.ts` (sau T045, cùng tệp): (FR-036) mã theo dõi của lượt gọi được truyền xuống yêu cầu gửi nhà cung cấp (siêu dữ liệu/tiêu đề, không chứa lời nhắc); (FR-025) cờ không-huấn-luyện/không-lưu được đặt trong yêu cầu của **cả hai** adapter Anthropic và OpenAI

### Implementation

- [X] T045b [US4] @backend-dev Mở rộng giao diện `S/internal/providers/provider.ts`: thêm `traceId` và tùy chọn không-huấn-luyện vào tham số lời gọi (FR-036, FR-025) trước khi viết adapter
- [X] T046 [P] [US4] @backend-dev Viết `S/internal/providers/anthropic.ts` (`AnthropicAdapter`: `countInputTokens` cục bộ, `complete`, `stream`, ảnh khung hình thu nhỏ, tiền tố lời nhắc cố định để dùng prompt cache, không đưa hồ sơ nhiều tài khoản vào cùng tiền tố); không thử lại bên trong; che thông điệp lỗi của SDK trước khi vào nhật ký; truyền `traceId` (FR-036) và cờ không huấn luyện theo cấu hình (FR-025)
- [X] T047 [P] [US4] @backend-dev Viết `S/internal/providers/openai.ts` (`OpenAiAdapter`: `complete`, `stream`, ảnh, `transcribe`); cùng quy tắc như T046, **gồm truyền `traceId` (FR-036) và cờ không huấn luyện/không lưu cho OpenAI (FR-025)**; ghi chỉ số `ai_gateway_provider_calls_total`/`ai_gateway_provider_latency_ms` đã khai ở T043 (không sửa `metrics.ts`)
- [X] T048 [US4] @backend-dev Cập nhật `S/internal/gateway.service.ts` vòng lặp lượt gọi dùng `RouteBook.attemptsFor(task, tier)`: mỗi lượt tra giá → ước tính → `reserve` → `markCalling` → gọi; lượt hỏng → `release` rồi sang lượt kế; hết lượt → `AI_PROVIDER_UNAVAILABLE`; thời gian chờ 40 s / chữ đầu 5 s; bỏ hành vi "luôn thử `[primary, fallback]`" của 005 ở driver `real`
- [X] T048a [US4] @backend-dev Trong `S/internal/gateway.service.ts` (sau T048): sinh/nhận mã theo dõi xuyên suốt API → hàng chờ → Worker và truyền xuống mọi lượt gọi adapter (FR-036, hiến pháp VIII); không đưa mã theo dõi vào nội dung lời nhắc
- [X] T049 [US4] @backend-dev Nối driver `real` hoàn chỉnh trong `S/ai_gateway.module.ts`: chọn adapter theo `provider` của `model_routes`; khóa thiếu cho tuyến đã bật → lỗi khởi động rõ ràng (không in khóa); thay nhánh "chưa đủ thành phần" tạm ở T017
- [ ] T049a [US4] @pm (chuyển `architect`) Ghi nhận nhà cung cấp nước ngoài vào danh sách chuyển dữ liệu xuyên biên giới (tài liệu kiến trúc dữ liệu mục 9, R-17) trong `specs/015-real-ai-gateway/research.md`/`.specify/memory/architecture.md`; không phải việc của dev
- [X] T049c [US4] @qa Cập nhật kiểm thử bí mật hạ tầng để bao gồm `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` (có trong Secret `api-secrets`/`worker-secrets`, không có trong ConfigMap/`config.env`) tại `tooling/test/infra/secrets.spec.ts`
- [X] T049b [US4] @devops-dev Đưa `ANTHROPIC_API_KEY` và `OPENAI_API_KEY` vào Kubernetes Secret `api-secrets`/`worker-secrets` (đã được `infra/smoke-deploy/base/api.yaml` dòng 36 và `worker.yaml` dòng 36 nạp qua `secretRef`): thêm khóa vào bộ tạo bí mật `tooling/infra/commands/secrets.mjs` và `tooling/infra/lib/handoff-map.mjs`, mô tả quy trình đặt khóa trong `infra/docs/06-bi-mat-va-khoa.md`; giữ `AI_GATEWAY_DRIVER=fake` trong `infra/smoke-deploy/overlays/staging/config.env` và ghi chú chuyển `real` khi có khóa trong `infra/smoke-deploy/overlays/production/config.env`; không đọc/ghi `.env`, `infra/.credentials/**`, `*.tfvars`
- [X] T050 [US4] @devops-dev Tạo `ops/alerts/ai_gateway.rules.yml` (khuôn `ops/alerts/publishing.rules.yml`, nhóm `ai_gateway`) với cảnh báo `ai_gateway_provider_calls_total` tỷ lệ `outcome=error` > 5%/15 phút, kèm ví dụ mô phỏng cho SC-013; kiểm bằng `promtool check rules` nếu có

**Checkpoint**: dự phòng chạy đúng; bản giả vẫn là mặc định dev/test.

---

## Phase 7: User Story 5 — Chuyển giọng nói theo phút (P2)

**Goal**: ước tính `min(thời lượng, 300 s) × đơn giá/phút`, quyết toán theo thời lượng thực nhà cung cấp báo.

**Independent Test**: 90 s / 300 s / 720 s; chi phí thực ≤ ước tính; tệp trùng dấu tệp không phát sinh lời gọi mới (SC-009).

**Thứ tự chủ**: qa (T051, T053) → backend-dev (T052); `@pm` T053a.

- [X] T051 [US5] @qa Mục 19 (STT) trong `T/contracts/ai/ai-gateway.contract.ts` + `T/ai_gateway/stt.spec.ts`: 90 s, 300 s, 720 s; làm tròn lên theo `billing_granularity_sec` (1 hoặc 60); chi phí thực ≤ ước tính; thiếu `audioSeconds` → quyết toán theo ước tính + `anomaly='missing_usage'` + cảnh báo; không có giọng nói/không đọc được → không phí cho phần không chạy
- [X] T053 [US5] @qa Trong `T/ai_gateway/stt.spec.ts` (sau T051, cùng tệp): tệp trùng dấu tệp không phát sinh lời gọi AI/STT lần nữa — `requestId` cùng mã (`media:{mediaId}:label`) → `AI_DUPLICATE_REQUEST(settled)`
- [X] T052 [US5] @backend-dev Cập nhật `S/internal/estimate.ts` và `S/internal/gateway.service.ts`: `transcribe` ước tính theo `unit='audio_minute'` và `min(thời lượng, 300)`; chỉ xử lý 5 phút đầu (cắt ở phía gọi, không tải toàn tệp); quyết toán theo `audioSeconds` kẹp ≤ 300 và `billing_granularity_sec`; không sửa module `media` (nếu `media` thiếu `requestId` thì ghi vào danh sách rủi ro, tách tính năng khác)
- [X] T053a [US5] @pm (chuyển `architect`) Ghi chú trong `specs/015-real-ai-gateway/contracts/ai-gateway-delta.md` quy ước `requestId` bắt buộc cho bên gọi nền (`media:{mediaId}:label`)

**Checkpoint**: STT chạy theo phút, kiểm đúng ba mốc thời lượng.

---

## Phase 8: User Story 6 — % sử dụng, cảnh báo 80%/100%, không lộ tiền (P2)

**Goal**: khách chỉ thấy phần trăm làm tròn xuống + ngày chu kỳ mới; đúng một thông báo mỗi mốc mỗi chu kỳ.

**Independent Test**: đưa ngân sách qua 80% rồi 100%; mỗi mốc đúng một thông báo kể cả khi quyết toán bị thử lại; quét đệ quy không thấy tiền (SC-004/011).

**Thứ tự chủ**: qa (T054, T055, T057) → backend-dev (T056) → frontend-dev (T057a, chỉ khi thiếu).

- [X] T054 [P] [US6] @qa `T/ai_gateway/no-money.spec.ts`: quét đệ quy `getUsage()`, thông báo `ai_usage_80/100` và email mẫu → không khóa/chuỗi nào chứa số tiền, đơn giá hay chi phí; chỉ phần trăm làm tròn xuống (SC-004)
- [X] T055 [P] [US6] @qa `T/ai_gateway/threshold-notify.spec.ts`: mốc 80% và 100% phát đúng một thông báo mỗi `(account, cycleStart)`; thử lại quyết toán không phát trùng (cờ bật bằng cập nhật có điều kiện `= false`); chu kỳ mới phát lại được; thông báo tạo trong **cùng giao dịch** quyết toán qua `notifications.emit(tx, …)`
- [X] T057 [P] [US6] @qa Kiểm trạng thái khóa AI có nhãn chữ + biểu tượng (FR-031) cho `apps/web/src/ui/cards/UsageMeter.tsx` bằng bổ sung vào `apps/web/src/ui/cards/cards.spec.tsx`; xác nhận thao tác thủ công (soạn/sửa, duyệt, lên lịch, đăng, tải media, gắn nhãn tay) vẫn hoạt động khi bị chặn (SC-014) trong `T/ai_gateway/blocked-manual-ok.spec.ts`
- [X] T056 [US6] @backend-dev Rà `S/internal/gateway.service.ts` `getUsage()` và `makeOnCrossed` trong `S/ai_gateway.module.ts` để đảm bảo chỉ trả `%` + `state` + `nextCycleStartsAt` (số bài thuộc module Tài khoản & Gói — Cổng AI không đếm); chạy quét tự động ở T054
- [ ] T057a [US6] @frontend-dev Chỉ khi T057 thất bại: bổ sung tối thiểu nhãn chữ + biểu tượng cho trạng thái khóa AI trong `apps/web/src/ui/cards/UsageMeter.tsx` (và `apps/web/src/lib/limits/useUsage.ts` nếu cần); không hiển thị số tiền

**Checkpoint**: các bề mặt hướng khách sạch tiền.

---

## Phase 9: User Story 7 — Ngân sách hệ thống theo ngành (P3)

**Goal**: ngân sách tuần dùng chung cho xu hướng; trần = số ngành × mức/ngành; chia đều chi phí cho tài khoản cùng ngành.

**Independent Test**: hết trần tuần → chặn, khách không bị ảnh hưởng; phân bổ chia đều, tổng bằng chi phí (SC-006 phần hệ thống).

**Thứ tự chủ**: qa (T058, T059, T062a) → backend-dev (T060 → T061 → T062); `@pm` T063.

- [X] T058 [P] [US7] @qa Mục 20 (hệ thống) trong `T/contracts/ai/ai-gateway.contract.ts` + `T/ai_gateway/system-budget.spec.ts`: trần = `N ngành × mức/ngành`; hết trần → `AI_SYSTEM_BUDGET_EXHAUSTED` + `ai.system_budget_exhausted`; ngữ cảnh tài khoản gọi `system.generate` → từ chối; `used` của khách không đổi
- [X] T059 [P] [US7] @qa `T/ai_gateway/allocation.spec.ts` và `T/queue/ai_gateway-allocate.queue.spec.ts`: chia đều, tổng bằng chi phí (dư của phép chia nguyên gán xác định, ví dụ cho mã nhỏ nhất), chạy lại hai lần không nhân đôi (`UNIQUE (account_id, week_start, industry_id, shared_ledger_id)`), khóa `ai_alloc:{weekStart}:{industryId}`
- [X] T062a [P] [US7] @qa Kiểm thử việc `ai_gateway.release_stale_system` tự khai báo lịch (không phụ thuộc `defineStaleSystemSchedule` của sandbox) và chạy dọn hai lần như một lần, trong `T/queue/ai_gateway-release-stale-system.queue.spec.ts`
- [X] T060 [US7] @backend-dev Viết tệp riêng `S/internal/budget/db-budget-store (logic ngân sách hệ thống nằm trong tệp này, không tách `db-system-budget-store`).ts` (bản DB của `S/internal/budget/system-budget.ts`): `system_budgets` theo tuần, `cap` chụp lúc tạo = `countActiveIndustries() × per_industry_weekly_micro_usd`; thiếu hiện thực cổng → dùng `AI_SYSTEM_WEEKLY_CAP_MICRO_USD` + `gatewayEvent('warn','ai.industry_source_missing')`; ngành chưa có tài khoản không cộng vào trần; nối vào `S/ai_gateway.module.ts`
- [X] T061 [US7] @backend-dev Viết `S/internal/allocation/trend-allocation.ts` + đăng ký việc `ai_gateway.allocate_trend_cost` (hàng chờ `trends`, phạm vi system, kích hoạt khi `trends` thu thập xong; khóa `ai_alloc:{weekStart}:{industryId}`) trong `S/jobs.ts`; dùng `INDUSTRY_ACCOUNTS_SOURCE.listAccountIds` phân trang sắp theo mã tăng dần; **không** cộng vào `ai_budgets.used`
- [X] T062 [US7] @backend-dev Trong `S/jobs.ts` (sau T061, cùng tệp): việc `ai_gateway.release_stale_system` (mỗi phút, `scheduled:ai_gateway.release_stale_system:{slot}`) tự khai báo lịch bằng `defineSchedule` (nhập từ `../queue`, khuôn `apps/server/src/modules/publishing/jobs.ts`), hết phụ thuộc `defineStaleSystemSchedule` của sandbox
- [X] T063 [US7] @pm (chuyển `architect`) Ghi chú phụ thuộc cho module `trends`/`context` vào `specs/015-real-ai-gateway/contracts/ai-gateway-delta.md` mục 5: hợp đồng `ActiveIndustriesSource`/`IndustryAccountsSource` trỏ rõ ai đăng ký token; **không** sửa `trends`/`context` ở tính năng này. Việc mở (open question) trong `docs/wiki` **thực hiện ở bước wiki-ingest**, không do dev ghi

**Checkpoint**: xu hướng dùng được ngân sách hệ thống với trần tạm.

---

## Phase 10: User Story 8 — Cảnh báo vận hành, đối soát, xem chi phí (P3)

**Goal**: cảnh báo > 5% chạm 2 USD, lệch hóa đơn > 5%; hỗ trợ xem chi phí một tài khoản có kiểm toán.

**Independent Test**: mô phỏng 6% tài khoản chạm 2 USD và hóa đơn lệch 6% → đúng một cảnh báo mỗi điều kiện; `support` xem chi phí ghi `support.view_account` kèm lý do.

**Thứ tự chủ**: qa (T064, T065) → backend-dev (T066–T068) → devops-dev (T069).

- [X] T064 [P] [US8] @qa `T/ai_gateway/alerts.spec.ts` và `T/queue/ai_gateway-check-thresholds.queue.spec.ts`: 6% tài khoản chạm ≥ 2 USD → `ai.threshold_ratio_high`, 4% → không; hóa đơn lệch 6% → `ai.invoice_mismatch` nêu nhà cung cấp/ngày/mức lệch; chạy lại hai lần cùng kết quả (khóa `scheduled:…:{slot}`)
- [X] T065 [P] [US8] @qa `T/ai_gateway/support-view.spec.ts`: `GET /support/ai/budget/:accountId?reason=…` — thiếu/ngắn `reason` bị từ chối, ghi `support.view_account` kèm lý do, đi qua khung nhìn `support.ai_budget_detail`; khách → 403; nhật ký truy cập chung không ghi số tiền; `GET /support/ai/summary?cycle=…` chỉ số tổng hợp, không dữ liệu từng tài khoản nhận dạng được
- [X] T068a [US8] [SHARED] @data-dev (bổ sung: điểm cuối `GET /support/ai/summary` cần tổng hợp xuyên tài khoản mà `support` không đọc được bảng gốc) Viết migration `apps/server/drizzle/migrations/0032_ai_gateway_summary_functions.sql` + `_journal.json` + snapshot: hàm `SECURITY DEFINER` hẹp trong `ai_gateway` (EXECUTE chỉ `support`) trả chỉ số tổng hợp theo chu kỳ (tổng, số tài khoản, trung bình mỗi tài khoản và mỗi bài `post_generation` đã quyết toán, theo loại việc/mô hình/nhà cung cấp), không trả dữ liệu từng tài khoản nhận dạng được; kèm hàm đếm tỷ lệ tài khoản hoạt động chạm ngưỡng mềm cho T066 (`system`); cập nhật bọc kiểu `S/internal/db/admin-functions.ts` (hoặc tệp mới cùng thư mục)
- [X] T066 [US8] @backend-dev Viết `S/internal/alerts/threshold-check.ts` + việc `ai_gateway.check_thresholds` trong `S/jobs.ts` (hàng `scheduled`, mỗi 5 phút (`*/5 * * * *`, theo hội tụ SC-013), khóa `scheduled:ai_gateway.check_thresholds:{slot}`, đồng thời 1): tỷ lệ tài khoản hoạt động đạt ngưỡng mềm > 5% → `gatewayEvent('warn','ai.threshold_ratio_high')`; không chứa số tiền theo tài khoản nhận dạng được
- [X] T067 [US8] @backend-dev Viết `S/internal/alerts/invoice-reconcile.ts` + việc `ai_gateway.reconcile_invoices` trong `S/jobs.ts` (sau T066, cùng tệp; hằng ngày 02:00 UTC+7, đối soát ngày hôm trước, khóa `scheduled:ai_gateway.reconcile_invoices:{slot}`): so `Σ sổ` với `provider_invoices`; lệch > 5% → `ai.invoice_mismatch`; thiếu hóa đơn → bỏ qua kèm ghi nhận, không báo giả
- [X] T068 [US8] @backend-dev Viết `S/internal/admin/support.controller.ts` (`GET /support/ai/budget/:accountId`, `GET /support/ai/summary`) dùng `supportViewAccount` + `@StaffAccess('ai.cost.view')`; tổng hợp theo loại việc, mô hình, nhà cung cấp, trung bình mỗi tài khoản và mỗi bài (`post_generation` đã quyết toán) — FR-018; đăng ký trong `S/ai_gateway.module.ts`
- [X] T069 [US8] @devops-dev Bổ sung vào `ops/alerts/ai_gateway.rules.yml` (sau T050, cùng tệp nên không `[P]`) quy tắc cảnh báo cho `ai.threshold_ratio_high`, `ai.invoice_mismatch`, `ai.unsettled_reservation`, `ai.cost_anomaly`, `ai.settle_failed`, `ai.price_missing`, `ai.route_missing`, `ai.system_budget_exhausted`, `ai.industry_source_missing`; kiểm kênh nhận ≤ 15 phút cho SC-013 (`promtool check rules` nếu có); không đưa số tiền theo tài khoản vào nhãn/chú thích

**Checkpoint**: vận hành quan sát và đối soát được.

---

## Phase 11: Polish & Cross-Cutting

**Thứ tự chủ**: qa (T070, T071, T075, T076) → backend-dev (T072) → `@pm`/`@reviewer` (T072a, T073a, T074).

- [X] T070 [P] @qa Chạy toàn bộ cổng tĩnh: `pnpm typecheck && pnpm lint && pnpm check:boundaries && pnpm db:lint-migrations && pnpm db:check && pnpm check:secrets`; xác nhận `ai_gateway` không nhập module khác ngoài `account`/`notifications`/`queue` và SDK chỉ ở `S/internal/providers/`
- [X] T071 @qa Chạy `pnpm test`, `pnpm test:db`, `pnpm test:queue`: chế độ bộ nhớ (`AI_GATEWAY_DRIVER=fake`) và `sandbox` đạt như trước 015 (hồi quy bản giả); production với `fake` vẫn bị `assert-no-fakes` từ chối khi khởi động; chạy hai lần cho cùng kết quả với các bộ xử lý nền mới
- [X] T072 [P] @backend-dev Cập nhật tài liệu mã trong `apps/server/docs/` (ví dụ `apps/server/docs/ai-gateway.md`): `ai_gateway` thật (driver, cấu hình, bí mật, `requestId`, chu kỳ), hợp đồng `account.getAiCycleAnchor`; ánh xạ thuật ngữ Việt→Anh theo `data-model.md` mục 1
- [X] T072a [P] @pm (chuyển `architect`) Thêm hai mã lỗi mới vào `specs/005-gateway-contracts-fakes/contracts/ai-gateway.md` nếu hợp đồng gốc liệt kê mã lỗi; bổ sung thuật ngữ mới vào `specs/015-real-ai-gateway/data-model.md`. `docs/wiki/glossary.md` cập nhật ở bước wiki-ingest
- [X] T073 @qa Chạy từng kịch bản `specs/015-real-ai-gateway/quickstart.md` mục 1–5 và 7, ghi kết quả vào `specs/015-real-ai-gateway/acceptance-report.md`; mục 6 (nhà cung cấp thật, POC-1/POC-4) là thủ công, **không** chạy ở CI
- [ ] T073a @pm (chuyển `architect`) Khi có khóa thật, ghi kết quả đo POC vào `specs/015-real-ai-gateway/research.md` mục "Kết quả đo"
- [X] T074 @reviewer Rà soát hiến pháp bằng `/constitution-review` cho cả nhánh (đặc biệt I, III, IV, V, VII, VIII) và ghi kết quả vào `specs/015-real-ai-gateway/reviews/constitution-review.md` (không ghi vào `plan.md`)
- [X] T075 @qa Hồi quy bảo mật và hiệu năng: khóa API không xuất hiện trong nhật ký/sổ/chỉ số/thông báo lỗi (quét mẫu nhật ký, `pnpm check:secrets`) và tải kiểm `reserve` p95 ≤ 50 ms trên CSDL thật 200 lần (SC-003) trong `T/ai_gateway/security-perf-regression.spec.ts`
- [X] T077 @data-dev (hậu kiểm, ghi nhận mã phát sinh ngoài danh sách ban đầu) Migration `0031_ai_gateway_admin_functions.sql`, `0032_ai_gateway_summary_functions.sql`, `0033_ai_gateway_worker_helpers.sql` (+ `_journal.json`, snapshot); `S/internal/db/{admin-functions.ts,summary-functions.ts}`; `apps/server/src/modules/queue/run-for-account.ts` (chỉ việc nền)
- [X] T078 @backend-dev (hậu kiểm) `apps/server/src/modules/account/internal/count-active-accounts.ts` + `AccountPublicApi.countActiveAccounts`; `S/internal/event-names.ts`, `core/gateways/{op-log.ts,selection.ts}`, `core/db/errors.ts`; `apps/server/docs/ai-gateway.md`
- [X] T079 @devops-dev (hậu kiểm) `tooling/boundaries/*` (quy tắc SDK chỉ ở `providers/` + bộ mẫu), `ops/alerts/ai_gateway.rules.yml` (10 quy tắc), `.dependency-cruiser.cjs`, `tooling/infra/lib/handoff-map.mjs`, `infra/docs/06-bi-mat-va-khoa.md`
- [X] T080 @pm (hậu kiểm) Mở rộng `.specify/ownership.json`: `vitest*.mts` cho qa, `.dependency-cruiser.cjs` cho devops-dev, `apps/server/drizzle/migrations/meta/_journal.json` vào tệp dùng chung (người dùng xem lại khi commit)
- [X] T081 @qa Kiểm thử còn thiếu theo hội tụ: SC-014 `test/ai_gateway/blocked-manual-ok.spec.ts` (T057 đánh lại chưa xong), FR-036 đầu-cuối ở tầng Cổng (stub-adapter ghi `opts.traceId` so với `ai_cost_ledger.trace_id` và `AiResult.traceId`), `noRetryOnAiError`, outcome `aborted` không phát `ai.provider_error`; sửa 6 ca đỏ do kỳ vọng cũ (`ai_gateway-check-thresholds.queue.spec.ts` cron `*/5 * * * *`; 5 ca `alert-rules.spec.ts` theo quy tắc mới); cập nhật `acceptance-report.md`
- [X] T076 @qa Chạy `pnpm verify` cuối tính năng; hai lỗi có sẵn ở `dev` (`check-wiki.spec.ts`, `tooling/infra`) không thuộc 015

---

## Dependencies & Execution Order

### Phase

- **Setup (1)** → **Foundational (2)** chặn mọi story → **US1 (3)** là MVP.
- **US2** cần `AiSettings` (T011) và `DbBudgetStore` (US1).
- **US3** cần bảng giá/tuyến (Foundational) và `DbBudgetStore` (US1); admin độc lập với US2.
- **US4** cần `RouteBook` (T013), `gateway.service.ts` (US1), `DbPriceSource` (T012), chỉ số ở T043.
- **US5** cần US4 (adapter OpenAI `transcribe`) và US3 (đơn vị `audio_minute`).
- **US6** cần US1 (quyết toán + `onCrossed`).
- **US7** cần US1 (kho) và cổng đảo ngược (T017); tách riêng bảng `system_*`.
- **US8** cần US1/US3 (sổ, `provider_invoices`) và `ops/alerts/ai_gateway.rules.yml` từ T050.
- **Polish (11)** sau các story cần giao.

### Quan hệ trong từng story

- Thứ tự chủ: **data-dev (schema/migration) → backend-dev → frontend-dev**; `qa` viết kiểm thử trước mã và phải **fail** trước.
- Cùng một tệp thì **không** gắn `[P]` (nhiều tác vụ US1 đều sửa `db-budget-store.ts` / `gateway.service.ts`; T018→T019→T020 cùng `harness.ts`/`ai-gateway.contract.ts`; T039→T040 dùng chung `audit.ts`; T050→T069 cùng `ai_gateway.rules.yml`; T061→T062→T066→T067 cùng `S/jobs.ts`).
- Tệp dùng chung tuần tự: `apps/server/package.json` + `pnpm-lock.yaml` (T002), `apps/server/drizzle/migrations/meta/_journal.json` (T005, T007), `apps/server/src/modules/modules.manifest.json` (T008a).

### Song song

- Setup: T003a song song với T001a/T001 (khác gói); T002 tuần tự (`[SHARED]`).
- Foundational: T009, T010, T011, T012, T013 (khác tệp/khác thư mục) cùng lúc sau T008; T009a, T016a cùng lúc đầu phase.
- US1 test: T021–T024 cùng lúc, sau T018→T019→T020.
- Sau Foundational: một người làm US1, người khác chuẩn bị adapter (T046, T047), admin (T039→T040) và việc `@devops-dev` (T049b, T050) vì khác tệp/khác chủ.
- US6 test T054/T055/T057; US8 test T064/T065; US7 test T058/T059/T062a.

### Ví dụ song song — US1

```text
Task: T021 đồng thời + p95              (test/ai_gateway/concurrency.spec.ts)
Task: T022 RLS chéo tài khoản           (test/ai_gateway/rls-cross-account.spec.ts)
Task: T023 dọn giữ chỗ treo             (test/queue/ai_gateway-release-stale.queue.spec.ts)
Task: T024 không tài khoản không ngân sách (test/ai_gateway/no-account-no-budget.spec.ts)
```

---

## Implementation Strategy

### MVP trước (US1)

1. Setup → Foundational (migration `0029`/`0030`, chu kỳ, giá, tuyến).
2. US1: `DbBudgetStore` + `requestId` + dọn giữ chỗ treo; chạy hợp đồng 005 trên kho thật.
3. **Dừng và xác nhận**: `pnpm test:db -- test/contracts/ai test/ai_gateway/concurrency` đạt (SC-001/002/003).

### Giao dần

1. + US2 (ngưỡng) + US3 (sổ + bảng giá + quản trị) → ba P1 hoàn tất, bật được AI thật với nhà cung cấp giả HTTP.
2. + US4 (dự phòng + adapter thật + khóa bí mật + cảnh báo) → thử nhà cung cấp thật thủ công (quickstart mục 6, sau POC).
3. + US5 (STT), US6 (% và thông báo).
4. + US7, US8 (hệ thống, vận hành) → Polish.

### Rủi ro cần để mắt

- Ngành/tài khoản theo ngành chưa có hiện thực (R-11): trần tạm `AI_SYSTEM_WEEKLY_CAP_MICRO_USD`.
- Chu kỳ tạm theo ngày tạo tài khoản `active` (R-05): đổi bên trong `account` khi có mô hình gói; Cổng AI không đổi.
- Giá/nhà cung cấp là giả định chờ POC-1/POC-4/POC-3: nằm ở dữ liệu (`model_prices`, `model_routes`), không ở mã.
- Hệ số an toàn ước tính token tiếng Việt (20%) chờ đo ở POC-1.
- Hai lỗi `pnpm verify` có sẵn ở `dev` (`check-wiki.spec.ts`, `tooling/infra`) không thuộc 015.
- `plan.md`/`research.md`/`contracts/**` do architect sửa đồng thời: các việc `@pm` ở trên chỉ thực hiện sau khi architect xong.

## Notes

- Commit sau mỗi nhóm tác vụ hợp lý; chỉ commit khi người dùng yêu cầu.
- Bản giả lập (`S/internal/fake/**`, `sandbox.ai_fake_*`) giữ nguyên làm công cụ dev/test.
- Mọi migration chỉ thêm, tương thích ngược (API và Worker cũ/mới chạy song song).
