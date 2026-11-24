# Tasks: Cổng AI thật

**Input**: `specs/015-real-ai-gateway/` — `plan.md`, `spec.md`, `research.md` (R-01…R-18), `data-model.md`, `contracts/*`, `quickstart.md`

**Prerequisites**: worktree `impl/015-real-ai-gateway`, `pnpm install`, `pnpm db:up && pnpm db:bootstrap && pnpm db:setup`.

**Tests**: **Có** — hiến pháp bắt buộc kiểm thử Cổng AI (đồng thời, ngưỡng 2/4 USD, trả giữ chỗ khi lỗi), truy cập chéo tài khoản, bộ xử lý nền chạy lại hai lần, ngày chu kỳ 29–31. Bộ hợp đồng 005 (14 mục) chạy lại nguyên vẹn trên kho thật, thêm mục 15–20.

**Organization**: theo user story; mọi đường dẫn tính từ gốc worktree. `S = apps/server/src/modules/ai_gateway`, `T = apps/server/test`.

## Format: `[ID] [P?] [Story] Mô tả + đường dẫn`

- **[P]**: chạy song song được (khác tệp, không phụ thuộc tác vụ chưa xong)
- **[USn]**: user story trong `spec.md`

## Quy ước dùng chung

- Tiền là `bigint` micro-USD (4 USD = `4_000_000`); không số thực ở bất kỳ bước nào (FR-016).
- Không nhật ký/chỉ số/thông báo chứa lời nhắc, văn bản kết quả, khóa API hoặc số tiền theo tài khoản (FR-017, FR-026).
- Mọi chuyển trạng thái giữ chỗ bằng `UPDATE … WHERE state = :expected`.
- Chạy: `pnpm test` (bộ nhớ), `pnpm test:db`, `pnpm test:queue`, `pnpm check:boundaries`, `pnpm db:check`, `pnpm db:lint-migrations`.

---

## Phase 1: Setup

**Purpose**: cấu hình, phụ thuộc, khung thư mục.

- [ ] T001 Thêm `'real'` vào `AI_GATEWAY_DRIVER` (`fake|real`), `AI_PRICE_CACHE_TTL_MS` (mặc định 60000), `AI_TOKEN_ESTIMATE_SAFETY_PERCENT` (mặc định 20), `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (bắt buộc chỉ khi `real` và tuyến bật dùng nhà cung cấp đó; không bao giờ in ra nhật ký) trong `apps/server/src/core/config/config.schema.ts`; cập nhật `apps/server/test/config.spec.ts` và `.env.example`
- [ ] T002 [P] Thêm SDK Anthropic và OpenAI vào `apps/server/package.json` — **cố định phiên bản chính xác**, bản đã phát hành ≥ 2 tuần (hiến pháp IX); kiểm `pnpm check:boundaries` cấm nhập SDK ngoài `internal/providers/`
- [ ] T003 [P] Thêm quyền `ai.pricing.manage` (chỉ `admin`) và `ai.cost.view` (`support`, `admin`) vào `packages/shared/src/auth/permissions.ts` kèm kiểm thử bảng quyền (khách/cộng tác viên đều ✗)
- [ ] T004 [P] Tạo khung thư mục rỗng: `S/internal/{budget,prices,routing,settings,admin,alerts,allocation}/` và `T/ai_gateway/`

---

## Phase 2: Foundational (chặn mọi user story)

**Purpose**: bảng, RLS, chu kỳ, bảng giá/tuyến/cấu hình đọc được, cắm driver thật. Không user story nào bắt đầu trước khi xong.

- [ ] T005 Viết migration `apps/server/drizzle/migrations/0024_ai_gateway_tables.sql` (chỉ thêm, tương thích ngược): tạo `ai_budgets`, `ai_reservations`, `ai_trend_allocations` (tenant, RLS `tenant_isolation`, `account_id` đầu mọi chỉ mục), `system_budgets`, `system_reservations`, `system_cost_ledger`, `model_prices`, `model_routes`, `task_fallback`, `ai_settings`, `provider_invoices` (shared, có `reason`); ràng buộc nguyên văn từ `data-model.md`: `UNIQUE (account_id, cycle_start)`, `CHECK (used >= 0 AND reserved >= 0 AND used + reserved <= cap)`, `CHECK (soft_limit < cap AND cap > 0)`, `estimate bigint CHECK >= 0`, `state IN ('held','calling','settled','released')`, chỉ mục duy nhất từng phần `(account_id, cycle_start, request_id) WHERE request_id IS NOT NULL AND state <> 'released'`, `model_prices` mọi giá `> 0` khớp `unit` + trigger chặn UPDATE/DELETE, `model_routes PRIMARY KEY (tier, rank) CHECK rank IN (1,2)`, `ai_settings id smallint PRIMARY KEY CHECK (id = 1)` và `CHECK (soft < cap AND per_industry_weekly > 0)`, `provider_invoices UNIQUE (provider, invoice_date) CHECK total >= 0`, `system_budgets CHECK (used + reserved <= cap)`
- [ ] T006 Trong cùng `0024_ai_gateway_tables.sql` (hoặc phần kế của tệp): tạo `ai_cost_ledger` `PARTITION BY RANGE (created_at)` theo tháng (khuôn `publish_steps`), RLS `tenant_isolation` USING/WITH CHECK `account_id = account.current_account_id()`, thu hồi `UPDATE/DELETE` của `app`/`system`, không FK (`account_id`, `reservation_id` tham chiếu nội bộ); cột đúng `data-model.md` mục 2.3 (`anomaly` ∈ `over_estimate|unsettled|missing_usage`, `over_cap_micro_usd` DEFAULT 0, `audio_seconds` NULL); đăng ký phân vùng tạo trước/bỏ > 12 tháng vào việc định kỳ đã có (kiến trúc mục 6)
- [ ] T007 Viết migration `apps/server/drizzle/migrations/0025_ai_gateway_seed_support.sql`: dòng cấu hình khởi đầu (`ai_settings` 4 000 000 / 2 000 000 / mức ngành giả định SA chốt tạm; `task_fallback` 6 dòng — chỉ `post_generation`, `topic_suggestion` bật; `model_routes` + `model_prices` giá giả định cho 4 bậc), khung nhìn `support.ai_budget_detail` (không cột bí mật), cấp quyền vai trò; chạy `pnpm db:lint-migrations` và `pnpm db:check`
- [ ] T008 Khai báo Drizzle `S/internal/db/schema.ts` (`tenantTable`/`sharedTable` cho mọi bảng ở T005, có `reason` cho bảng shared) và `S/internal/db/ai-cost-ledger.log-table.ts` (khuôn `apps/server/src/modules/publishing/internal/db/publish-steps.log-table.ts`); xóa `S/internal/db/.gitkeep`; cập nhật manifest nếu cần
- [ ] T009 [P] Thêm `AccountPublicApi.getAiCycleAnchor(): Promise<{ anchorDate: string } | null>` (`apps/server/src/modules/account/public-api.ts`, `index.ts`, hiện thực tạm: ngày tạo của tài khoản `status='active'`, trạng thái khác → `null`, không cache, chạy ở API và Worker) + cập nhật hợp đồng `account` và kiểm thử đơn vị
- [ ] T010 [P] Viết `S/internal/budget/cycle.ts`: tính `cycle_start`/`cycle_end` từ `anchorDate`, lặp hằng tháng, tháng không có ngày đó → ngày cuối tháng (29/30/31, tháng 2, năm nhuận) và `weekStart` (thứ Hai 00:00 UTC+7) cho hệ thống; thuần hàm, không đọc CSDL
- [ ] T011 [P] Viết `S/internal/settings/ai-settings.ts`: đọc `ai_settings` (không cache ngân sách, được đệm cấu hình TTL ≤ 60 s) trả `accountCap`, `softLimit`, `perIndustryWeekly`; bản ghi chụp vào dòng ngân sách lúc tạo
- [ ] T012 [P] Viết `S/internal/prices/db-price-source.ts` triển khai `PriceSource` đọc `model_prices` theo `(provider, modelId, unit)` tại thời điểm giữ chỗ, đệm TTL `AI_PRICE_CACHE_TTL_MS`, trả cả `price_id`; thiếu/hết hiệu lực → `null` (không đoán giá)
- [ ] T013 [P] Viết `S/internal/routing/route-book.ts` (`attemptsFor(task, tier)` đúng thuật toán `contracts/provider-adapter.md` mục 3: rank 1 `enabled`; rank 2 chỉ khi `enabled` **và** `task_fallback[task].enabled`; thiếu rank 1 → rỗng) đệm TTL 60 s
- [ ] T014 Thêm `'AI_DUPLICATE_REQUEST'` và `'AI_NOT_CONFIGURED'` vào `AiErrorCode` (`S/public-api.ts`, `S/internal/errors.ts`) với `messageVi` đúng `contracts/ai-gateway-delta.md` mục 2 (không số tiền; `AI_DUPLICATE_REQUEST` mang `status: 'settled' | 'in_progress'`); thêm trường tùy chọn `requestId?: string` (1–128 ký tự `[A-Za-z0-9:_.-]`, sai định dạng → `AI_INVALID_REQUEST`) cho `AiRequest` và `TranscribeRequest`
- [ ] T015 Mở rộng `S/internal/budget/budget-store.ts` cho `reserve` nhận `requestId`, trả kết quả `duplicate` (kèm `status`); giữ nguyên ngữ nghĩa các phương thức cũ. Cập nhật `S/internal/fake/store.memory.ts` và `S/internal/fake/store.sandbox.ts` để vẫn đạt hợp đồng với phần mở rộng (bản giả lập không được hồi quy)
- [ ] T016 Viết bộ ước tính token cục bộ `S/internal/providers/token-estimate.ts`: `ceil(bytes/3)` × (1 + `AI_TOKEN_ESTIMATE_SAFETY_PERCENT`/100), chặn trên, không gọi mạng, số nguyên (R-09); kiểm thử đơn vị với tiếng Việt có dấu
- [ ] T017 Cập nhật `S/ai_gateway.module.ts`: chọn driver `fake|real`; ở `real` nối `DbBudgetStore`, `DbPriceSource`, `RouteBook`, `AiSettings` (các lớp được tạo ở US1/US3); giữ `assert-no-fakes` từ chối `fake` ở production; đăng ký token cổng đảo ngược `ACTIVE_INDUSTRIES_SOURCE`/`INDUSTRY_ACCOUNTS_SOURCE` (kiểu + token khai ở `S/public-api.ts`, hiện thực do module khác cắm sau)

**Checkpoint**: bảng + chu kỳ + giá + tuyến + lỗi mới sẵn sàng; `pnpm typecheck && pnpm db:check && pnpm db:lint-migrations` đạt; bản giả lập vẫn chạy.

---

## Phase 3: User Story 1 — Chặn trước khi vượt trần 4 USD (P1) 🎯 MVP

**Goal**: ngân sách + giữ chỗ bền trong CSDL, giữ chỗ bằng một `UPDATE` có điều kiện, quyết toán/trả lại trong một giao dịch, mã yêu cầu logic chống trừ trùng.

**Independent Test**: bắn song song nhiều lời gọi sát trần; `used + reserved ≤ cap` ở mọi lần quan sát, `reserved = 0` khi xong, 0 lời gọi nhà cung cấp cho lời gọi bị từ chối (SC-001/002).

### Tests (viết trước, phải FAIL trước khi cài đặt)

- [ ] T018 [P] [US1] Chạy lại bộ hợp đồng 005 trên kho thật: `T/contracts/ai/ai.db.contract.spec.ts` dùng `ai-gateway.contract.ts` + `harness.ts` (thêm fixture `db` thay `sandbox`); kỳ vọng 14 mục của 005 đạt
- [ ] T019 [P] [US1] Mục 15 (`requestId`) trong `T/contracts/ai/ai-gateway.contract.ts`: cùng mã hai lần → lần hai `AI_DUPLICATE_REQUEST(settled)`, 0 lời gọi nhà cung cấp, đúng 1 dòng sổ; hai lần đồng thời → một chạy, một `in_progress`; lần đầu lỗi (đã `released`) → thử lại cùng mã chạy được
- [ ] T020 [P] [US1] Mục 16 (chu kỳ) trong `T/contracts/ai/ai-gateway.contract.ts` và `T/ai_gateway/cycle.spec.ts`: kích hoạt 29/30/31, tháng 2, năm nhuận; hai yêu cầu đầu chu kỳ đồng thời → đúng 1 dòng `ai_budgets`; chu kỳ mới đặt lại cờ 80/100
- [ ] T021 [P] [US1] `T/ai_gateway/concurrency.spec.ts`: 100 vòng × 25 lời gọi song song sát trần, kiểm bất biến `used + reserved ≤ cap` mỗi lần quan sát và `reserved = 0` khi xong; `reserve` p95 ≤ 50 ms (200 lần, SC-003)
- [ ] T022 [P] [US1] `T/ai_gateway/rls-cross-account.spec.ts`: tài khoản A đọc/sửa/xóa `ai_budgets`, `ai_reservations`, `ai_cost_ledger`, `ai_trend_allocations` của B → thất bại; thiếu biến phiên → không thấy dòng nào
- [ ] T023 [P] [US1] `T/queue/ai_gateway-release-stale.queue.spec.ts`: giữ chỗ `held` tuổi 16 phút → `released`; `calling` tuổi 16 phút → quyết toán theo ước tính (kẹp trần), sổ `anomaly='unsettled'`; chạy dọn hai lần như một lần
- [ ] T024 [P] [US1] `T/ai_gateway/no-account-no-budget.spec.ts`: `getAiCycleAnchor()` trả `null` → `AI_BUDGET_EXHAUSTED`, không tạo ngân sách, không gọi nhà cung cấp

### Implementation

- [ ] T025 [US1] Viết `S/internal/budget/db-budget-store.ts` (`DbBudgetStore`): chuyển nguyên logic từ `S/internal/fake/store.sandbox.ts` sang bảng thật; `reserve` = `INSERT … ON CONFLICT DO NOTHING` ngân sách chu kỳ rồi **một** `UPDATE ai_budgets SET reserved = reserved + :est WHERE account_id = … AND cycle_start = … AND used + reserved + :est <= cap` + `INSERT ai_reservations` cùng giao dịch; hẹn `ai_gateway.release_stale` +15 phút **trong giao dịch giữ chỗ**
- [ ] T026 [US1] Trong `S/internal/budget/db-budget-store.ts`: `markCalling` (`held → calling`, đặt `called_at`), `settle` (một giao dịch: `used += min(cost, cap − used)`, `reserved -= estimate`, `INSERT ai_cost_ledger` với `over_cap_micro_usd`, bật cờ 80/100 bằng cập nhật có điều kiện `= false`, gọi `onCrossed(tx, …)`), `release` (`held|calling → released`, trả `reserved`); mọi chuyển trạng thái `WHERE state = :expected`, chuyển trạng thái đã xảy ra → không đổi (idempotent)
- [ ] T027 [US1] Trong `S/internal/budget/db-budget-store.ts`: xử lý mã yêu cầu logic — khi `reserve` gặp dòng cùng `(account, cycle, request_id)` ở `settled` → `duplicate(settled)`; `held|calling` → `duplicate(in_progress)`; `released` → cho chạy; bắt vi phạm chỉ mục duy nhất từng phần khi chạy đồng thời và ánh xạ sang `in_progress`
- [ ] T028 [US1] Trong `S/internal/budget/db-budget-store.ts`: lấy mốc chu kỳ qua `AccountPublicApi.getAiCycleAnchor()` + `cycle.ts` (T010); `null` → `AI_BUDGET_EXHAUSTED`; chụp `cap`/`soft_limit` từ `AiSettings` (T011) vào dòng ngân sách lúc tạo
- [ ] T029 [US1] Cập nhật `S/internal/gateway.service.ts`: chuyển `requestId` xuống `reserve`; ném `AiError('AI_DUPLICATE_REQUEST')` đúng bảng hành vi `contracts/ai-gateway-delta.md` mục 1; thiếu giá hoặc thiếu tuyến rank 1 → `AI_NOT_CONFIGURED` + phát `ai.price_missing`/`ai.route_missing` **trước khi** gọi nhà cung cấp; không ghi lời nhắc/kết quả/tiền vào nhật ký
- [ ] T030 [US1] Cập nhật `S/jobs.ts`: nối `ai_gateway.release_stale` (khóa `ai_release_stale:{reservationId}`) vào `DbBudgetStore`; bộ xử lý nền gặp `AI_BUDGET_EXHAUSTED`, `AI_SYSTEM_BUDGET_EXHAUSTED`, `AI_DUPLICATE_REQUEST`, `AI_NOT_CONFIGURED` dùng `noRetry(...)` của 003, `AI_PROVIDER_UNAVAILABLE` thử lại theo chính sách hàng chờ (≤ 2 lần ở `ai_batch`)
- [ ] T031 [US1] Thêm retry quyết toán đúng một lần và giữ chỗ cho bộ dọn khi vẫn lỗi (Edge Case "Quyết toán lỗi"); phát `ai.settle_failed` sau lần thử lại hỏng, `ai.cost_anomaly` khi chi phí thực > ước tính, `ai.unsettled_reservation` khi dọn `calling` treo
- [ ] T032 [US1] Hủy giữa chừng khi trả dần (`generateStream`): quyết toán phần đã sinh, trả phần còn lại, đúng một dòng sổ; kiểm bằng mục hợp đồng 005 có sẵn

**Checkpoint**: US1 chạy được đầu-cuối trên CSDL thật; `pnpm test:db -- test/contracts/ai test/ai_gateway/concurrency` và `pnpm test:queue -- test/queue/ai_gateway-release-stale` đạt. Dừng và xác nhận trước khi sang US2.

---

## Phase 4: User Story 2 — Ngưỡng mềm 2 USD tự chuyển mô hình rẻ (P1)

**Goal**: bậc mô hình được chọn đúng 100% theo mức dùng và loại việc, không gián đoạn.

**Independent Test**: ngân sách 1,99 / 2,00 / 2,01 USD cho cùng loại việc; gán nhãn/xu hướng luôn bậc rẻ (SC-005).

- [ ] T033 [P] [US2] `T/ai_gateway/tier-threshold.spec.ts` (kiêm mục hợp đồng): 1,99 / 2,00 / 2,01 USD chọn đúng bậc cho `post_generation`/`topic_suggestion`; lời gọi đẩy tổng qua 2 USD vẫn chạy bậc mặc định, lời gọi sau mới rẻ (FR-012); `image_labeling`/`video_labeling` luôn `cheap_vision`; xu hướng luôn `cheap`; khi `used + reserved ≥ cap − minCallEstimate` → trạng thái `blocked`
- [ ] T034 [US2] Cập nhật `S/internal/tier.ts` và `S/internal/gateway.service.ts` để ngưỡng mềm/cứng lấy từ `AiSettings` đã chụp vào dòng ngân sách (không hằng số); `getUsage()` giữ nguyên chữ ký và không có số tiền
- [ ] T035 [US2] Mô hình rẻ cũng không đủ ngân sách còn lại → từ chối như hết hạn mức, không gọi nhà cung cấp (Edge Case); kiểm trong `T/ai_gateway/tier-threshold.spec.ts`

**Checkpoint**: US1 + US2 độc lập đều đạt.

---

## Phase 5: User Story 3 — Sổ chi phí và bảng giá cấu hình (P1)

**Goal**: mỗi lời gọi một dòng sổ chỉ-thêm; đổi giá không cần phát hành, có kiểm toán và kiểm tra bất hợp lý.

**Independent Test**: chuỗi lời gọi hỗn hợp để lại đúng sổ; đổi giá hiệu lực từ T → trước T giá cũ, sau T giá mới (SC-006/007).

### Tests

- [ ] T036 [P] [US3] Mục 18 (bảng giá) trong `T/contracts/ai/ai-gateway.contract.ts` + `T/ai_gateway/price-effective.spec.ts`: dòng giá hiệu lực từ T; quyết toán dùng `price_id` của giữ chỗ dù giá đổi giữa chừng; thiếu giá → `AI_NOT_CONFIGURED`, không gọi nhà cung cấp; trigger chặn UPDATE/DELETE `model_prices`
- [ ] T037 [P] [US3] `T/ai_gateway/ledger-reconcile.spec.ts`: với mỗi `(account, cycle)`, `used = Σcost − Σover_cap` (sai lệch 0); `anomaly` `over_estimate`/`unsettled`/`missing_usage` ghi đúng; sổ không `UPDATE`/`DELETE` được (SC-006)
- [ ] T038 [P] [US3] `T/ai_gateway/admin.spec.ts`: `POST /admin/ai/prices` bởi `admin` thành công + dòng `infra.audit_log` `ai.price.add` `{priceId,provider,modelId,unit,old,new,effectiveFrom}`; giá ≤ 0 hoặc lệch > 10× → `AI_PRICE_IMPLAUSIBLE`; `effectiveFrom < now + TTL` → `AI_PRICE_EFFECTIVE_TOO_SOON`; `support`/khách → 403; `PUT /admin/ai/settings` với `soft ≥ cap` → `AI_SETTINGS_INVALID`; `PUT /admin/ai/routes` rank ∉ {1,2} hoặc mô hình chưa có giá → `AI_ROUTE_INVALID`; ghi cấu hình + kiểm toán **cùng một giao dịch**

### Implementation

- [ ] T039 [US3] Viết `S/internal/admin/pricing.service.ts`: thêm dòng giá (giá > 0 đúng theo `unit`; lệch ≤ 10× so với dòng hiện hành cùng `(provider, modelId, unit)`, dòng đầu chỉ `> 0`; `effectiveFrom ≥ now + TTL đệm`; không sửa/xóa dòng cũ) và ghi `ai.price.add` vào `infra.audit_log` cùng giao dịch; mã lỗi tiếng Việt kèm hành động khắc phục
- [ ] T040 [P] [US3] Viết `S/internal/admin/settings.service.ts` (`PUT /admin/ai/settings`: `soft < cap`, nguyên dương, áp cho chu kỳ/tuần tạo sau; kiểm toán `ai.settings.change {field,old,new}`), `S/internal/admin/routes.service.ts` (`PUT /admin/ai/routes`, `PUT /admin/ai/task-fallback` — bật chỉ hợp lệ khi có tuyến rank 2 cho bậc của loại việc; kiểm toán `ai.route.change`/`ai.task_fallback.change`) và `S/internal/admin/invoices.service.ts` (`POST /admin/ai/provider-invoices`, `total ≥ 0`, trùng `(provider, invoiceDate)` thay thế kèm kiểm toán giá trị cũ/mới `ai.invoice.enter`)
- [ ] T041 [US3] Viết `S/internal/admin/admin.controller.ts` với đúng một `@StaffAccess(...)` mỗi điểm cuối (`ai.pricing.manage` cho 5 điểm cuối cấu hình); không nhận `accountId` từ khách; đăng ký trong `S/ai_gateway.module.ts`
- [ ] T042 [US3] Hoàn thiện đường quyết toán dùng `price_id` của giữ chỗ (không tra lại giá), sổ ghi `provider` thực sự trả kết quả; cập nhật `S/internal/estimate.ts` dùng `DbPriceSource` + `token-estimate.ts` (T016)
- [ ] T043 [P] [US3] Chỉ số OpenTelemetry (`ai_gateway_reserve_duration_ms`, `ai_gateway_calls_total{task,tier,outcome}`, `ai_gateway_fallback_total{task}`, `ai_gateway_blocked_total{reason}`, `ai_gateway_estimate_ratio{task}`, `ai_gateway_open_reservations`) trong `S/internal/metrics.ts` theo `contracts/jobs-and-alerts.md` mục 3; chỉ nhãn `account_id` là nhãn phân tán cao

**Checkpoint**: US1–US3 (ba P1) hoàn tất → đủ để bật AI thật với nhà cung cấp giả máy chủ HTTP.

---

## Phase 6: User Story 4 — Nhà cung cấp dự phòng (P2)

**Goal**: chính lỗi → trả giữ chỗ, giữ lại theo giá dự phòng, gọi dự phòng đúng một lần; loại việc chưa bật dự phòng → lỗi ngay.

**Independent Test**: chính lỗi → dự phòng gọi đúng một lần với giữ chỗ mới; cả hai lỗi → ngân sách không bị trừ (SC-008).

### Tests

- [ ] T044 [P] [US4] Mục 17 (dự phòng theo loại việc) trong `T/contracts/ai/ai-gateway.contract.ts` + `T/ai_gateway/fallback.spec.ts`: chính lỗi → `release`, giữ lại theo giá dự phòng, gọi dự phòng **đúng một lần**, sổ ghi nhà cung cấp dự phòng; cả hai lỗi → `AI_PROVIDER_UNAVAILABLE`, `reserved = 0`; `transcription` chưa bật dự phòng + lỗi → lỗi ngay, không lời gọi thứ hai; dự phòng đắt hơn và thiếu ngân sách → từ chối như hết hạn mức, không gọi
- [ ] T045 [P] [US4] `T/ai_gateway/providers.contract.spec.ts`: kiểm thử hợp đồng cho `AnthropicAdapter`/`OpenAiAdapter` trên **máy chủ HTTP giả cục bộ** (không gọi mạng ngoài ở CI): `max_tokens = maxOut`, tôn trọng `AbortSignal`, chuẩn hóa mọi lỗi mạng/5xx/429/timeout thành lỗi chung, khóa API và lời nhắc không có trong thông điệp lỗi/nhật ký

### Implementation

- [ ] T046 [P] [US4] Viết `S/internal/providers/anthropic.ts` (`AnthropicAdapter`: `countInputTokens` cục bộ, `complete`, `stream`, ảnh khung hình thu nhỏ, tiền tố lời nhắc cố định để dùng prompt cache, không đưa hồ sơ nhiều tài khoản vào cùng tiền tố); không thử lại bên trong; che thông điệp lỗi của SDK trước khi vào nhật ký; cờ không huấn luyện theo cấu hình
- [ ] T047 [P] [US4] Viết `S/internal/providers/openai.ts` (`OpenAiAdapter`: `complete`, `stream`, ảnh, `transcribe`); cùng quy tắc như T046; đo `ai_gateway_provider_calls_total{provider,outcome}` và `ai_gateway_provider_latency_ms{provider}`
- [ ] T048 [US4] Cập nhật `S/internal/gateway.service.ts` vòng lặp lượt gọi dùng `RouteBook.attemptsFor(task, tier)`: mỗi lượt tra giá → ước tính → `reserve` → `markCalling` → gọi; lượt hỏng → `release` rồi sang lượt kế; hết lượt → `AI_PROVIDER_UNAVAILABLE`; thời gian chờ 40 s / chữ đầu 5 s; bỏ hành vi "luôn thử `[primary, fallback]`" của 005 ở driver `real`
- [ ] T049 [US4] Nối driver `real` trong `S/ai_gateway.module.ts` chọn adapter theo `provider` của `model_routes`; khóa thiếu cho tuyến đã bật → lỗi khởi động rõ ràng (không in khóa); ghi nhận nhà cung cấp nước ngoài vào danh sách chuyển dữ liệu xuyên biên giới (tài liệu kiến trúc dữ liệu mục 9, R-17)
- [ ] T050 [P] [US4] Cảnh báo `ai_gateway_provider_calls_total` tỷ lệ `outcome=error` > 5%/15 phút trong cấu hình giám sát hiện có (Prometheus/Grafana), kèm bản mô phỏng cho SC-013

**Checkpoint**: dự phòng chạy đúng; bản giả vẫn là mặc định dev/test.

---

## Phase 7: User Story 5 — Chuyển giọng nói theo phút (P2)

**Goal**: ước tính `min(thời lượng, 300 s) × đơn giá/phút`, quyết toán theo thời lượng thực nhà cung cấp báo.

**Independent Test**: 90 s / 300 s / 720 s; chi phí thực ≤ ước tính; tệp trùng dấu tệp không phát sinh lời gọi mới (SC-009).

- [ ] T051 [P] [US5] Mục 19 (STT) trong `T/contracts/ai/ai-gateway.contract.ts` + `T/ai_gateway/stt.spec.ts`: 90 s, 300 s, 720 s; làm tròn lên theo `billing_granularity_sec` (1 hoặc 60); chi phí thực ≤ ước tính; thiếu `audioSeconds` → quyết toán theo ước tính + `anomaly='missing_usage'` + cảnh báo; không có giọng nói/không đọc được → không phí cho phần không chạy
- [ ] T052 [US5] Cập nhật `S/internal/estimate.ts` và `S/internal/gateway.service.ts`: `transcribe` ước tính theo `unit='audio_minute'` và `min(thời lượng, 300)`; chỉ xử lý 5 phút đầu (cắt ở phía gọi, không tải toàn tệp); quyết toán theo `audioSeconds` kẹp ≤ 300 và `billing_granularity_sec`; `requestId` bắt buộc ở bên gọi nền (`media`) theo quy ước `media:{mediaId}:label`
- [ ] T053 [US5] Bảo đảm tệp trùng dấu tệp không phát sinh lời gọi AI/STT lần nữa: kiểm test tích hợp ở `T/ai_gateway/stt.spec.ts` bằng `requestId` cùng mã → `AI_DUPLICATE_REQUEST(settled)`; ghi chú trong hợp đồng cho `media` (không sửa `media` trừ khi thiếu `requestId`)

**Checkpoint**: STT chạy theo phút, kiểm đúng ba mốc thời lượng.

---

## Phase 8: User Story 6 — % sử dụng, cảnh báo 80%/100%, không lộ tiền (P2)

**Goal**: khách chỉ thấy phần trăm làm tròn xuống + ngày chu kỳ mới; đúng một thông báo mỗi mốc mỗi chu kỳ.

**Independent Test**: đưa ngân sách qua 80% rồi 100%; mỗi mốc đúng một thông báo kể cả khi quyết toán bị thử lại; quét đệ quy không thấy tiền (SC-004/011).

- [ ] T054 [P] [US6] `T/ai_gateway/no-money.spec.ts`: quét đệ quy `getUsage()`, thông báo `ai_usage_80/100` và email mẫu → không khóa/chuỗi nào chứa số tiền, đơn giá hay chi phí; chỉ phần trăm làm tròn xuống (SC-004)
- [ ] T055 [P] [US6] `T/ai_gateway/threshold-notify.spec.ts`: mốc 80% và 100% phát đúng một thông báo mỗi `(account, cycleStart)`; thử lại quyết toán không phát trùng (cờ bật bằng cập nhật có điều kiện `= false`); chu kỳ mới phát lại được; thông báo tạo trong **cùng giao dịch** quyết toán qua `notifications.emit(tx, …)`
- [ ] T056 [US6] Rà `S/internal/gateway.service.ts` `getUsage()` và `makeOnCrossed` trong `S/ai_gateway.module.ts` để đảm bảo chỉ trả `%` + `state` + `nextCycleStartsAt` (số bài thuộc module Tài khoản & Gói — Cổng AI không đếm); chạy quét tự động ở T054
- [ ] T057 [US6] Kiểm trạng thái khóa AI có nhãn chữ + biểu tượng (FR-031) ở lớp hiển thị đã có; chỉ làm bổ sung tối thiểu nếu thiếu; xác nhận thao tác thủ công vẫn hoạt động khi bị chặn (SC-014) bằng test hiện có hoặc `T/ai_gateway/blocked-manual-ok.spec.ts`

**Checkpoint**: các bề mặt hướng khách sạch tiền.

---

## Phase 9: User Story 7 — Ngân sách hệ thống theo ngành (P3)

**Goal**: ngân sách tuần dùng chung cho xu hướng; trần = số ngành × mức/ngành; chia đều chi phí cho tài khoản cùng ngành.

**Independent Test**: hết trần tuần → chặn, khách không bị ảnh hưởng; phân bổ chia đều, tổng bằng chi phí (SC-006 phần hệ thống).

- [ ] T058 [P] [US7] Mục 20 (hệ thống) trong `T/contracts/ai/ai-gateway.contract.ts` + `T/ai_gateway/system-budget.spec.ts`: trần = `N ngành × mức/ngành`; hết trần → `AI_SYSTEM_BUDGET_EXHAUSTED` + `ai.system_budget_exhausted`; ngữ cảnh tài khoản gọi `system.generate` → từ chối; `used` của khách không đổi
- [ ] T059 [P] [US7] `T/ai_gateway/allocation.spec.ts` và `T/queue/ai_gateway-allocate.queue.spec.ts`: chia đều, tổng bằng chi phí (dư của phép chia nguyên gán xác định, ví dụ cho mã nhỏ nhất), chạy lại hai lần không nhân đôi (`UNIQUE (account_id, week_start, industry_id, shared_ledger_id)`), khóa `ai_alloc:{weekStart}:{industryId}`
- [ ] T060 [US7] Viết `S/internal/budget/system-budget.ts` bản DB (cập nhật `S/internal/budget/db-budget-store.ts` hoặc tệp riêng `S/internal/budget/db-system-budget-store.ts`): `system_budgets` theo tuần, `cap` chụp lúc tạo = `countActiveIndustries() × per_industry_weekly_micro_usd`; thiếu hiện thực cổng → dùng `AI_SYSTEM_WEEKLY_CAP_MICRO_USD` + cảnh báo `ai.industry_source_missing`; ngành chưa có tài khoản không cộng vào trần
- [ ] T061 [US7] Viết `S/internal/allocation/trend-allocation.ts` + đăng ký việc `ai_gateway.allocate_trend_cost` (hàng chờ `trends`, phạm vi system, kích hoạt khi `trends` thu thập xong; khóa `ai_alloc:{weekStart}:{industryId}`) trong `S/jobs.ts`; dùng `INDUSTRY_ACCOUNTS_SOURCE.listAccountIds` phân trang sắp theo mã tăng dần; **không** cộng vào `ai_budgets.used`
- [ ] T062 [US7] Cập nhật việc `ai_gateway.release_stale_system` (mỗi phút, `scheduled:ai_gateway.release_stale_system:{slot}`) tự khai báo lịch, hết phụ thuộc `defineStaleSystemSchedule` của sandbox; test chạy dọn hai lần như một lần
- [ ] T063 [P] [US7] Ghi chú phụ thuộc cho module `trends`/`context`: tài liệu hợp đồng `ActiveIndustriesSource`/`IndustryAccountsSource` (ở `contracts/ai-gateway-delta.md` mục 5) trỏ rõ ai đăng ký token; **không** sửa `trends`/`context` ở tính năng này; thêm việc mở (open question) trong `docs/wiki` ở bước ingest sau

**Checkpoint**: xu hướng dùng được ngân sách hệ thống với trần tạm.

---

## Phase 10: User Story 8 — Cảnh báo vận hành, đối soát, xem chi phí (P3)

**Goal**: cảnh báo > 5% chạm 2 USD, lệch hóa đơn > 5%; hỗ trợ xem chi phí một tài khoản có kiểm toán.

**Independent Test**: mô phỏng 6% tài khoản chạm 2 USD và hóa đơn lệch 6% → đúng một cảnh báo mỗi điều kiện; `support` xem chi phí ghi `support.view_account` kèm lý do.

- [ ] T064 [P] [US8] `T/ai_gateway/alerts.spec.ts` và `T/queue/ai_gateway-check-thresholds.queue.spec.ts`: 6% tài khoản chạm ≥ 2 USD → `ai.threshold_ratio_high`, 4% → không; hóa đơn lệch 6% → `ai.invoice_mismatch` nêu nhà cung cấp/ngày/mức lệch; chạy lại hai lần cùng kết quả (khóa `scheduled:…:{slot}`)
- [ ] T065 [P] [US8] `T/ai_gateway/support-view.spec.ts`: `GET /support/ai/budget/:accountId?reason=…` — thiếu/ngắn `reason` bị từ chối, ghi `support.view_account` kèm lý do, đi qua khung nhìn `support.ai_budget_detail`; khách → 403; nhật ký truy cập chung không ghi số tiền; `GET /support/ai/summary?cycle=…` chỉ số tổng hợp, không dữ liệu từng tài khoản nhận dạng được
- [ ] T066 [US8] Viết `S/internal/alerts/threshold-check.ts` + việc `ai_gateway.check_thresholds` (hàng `scheduled`, mỗi giờ, khóa `scheduled:ai_gateway.check_thresholds:{slot}`, đồng thời 1): tỷ lệ tài khoản hoạt động đạt ngưỡng mềm > 5% → `gatewayEvent('warn','ai.threshold_ratio_high')`; không chứa số tiền theo tài khoản nhận dạng được
- [ ] T067 [US8] Viết `S/internal/alerts/invoice-reconcile.ts` + việc `ai_gateway.reconcile_invoices` (hằng ngày 02:00 UTC+7, đối soát ngày hôm trước, khóa `scheduled:ai_gateway.reconcile_invoices:{slot}`): so `Σ sổ` với `provider_invoices`; lệch > 5% → `ai.invoice_mismatch`; thiếu hóa đơn → bỏ qua kèm ghi nhận, không báo giả
- [ ] T068 [US8] Viết `S/internal/admin/support.controller.ts` (`GET /support/ai/budget/:accountId`, `GET /support/ai/summary`) dùng `supportViewAccount` + `@StaffAccess('ai.cost.view')`; tổng hợp theo loại việc, mô hình, nhà cung cấp, trung bình mỗi tài khoản và mỗi bài (`post_generation` đã quyết toán) — FR-018; đăng ký trong `S/ai_gateway.module.ts`
- [ ] T069 [P] [US8] Quy tắc cảnh báo (`ai.threshold_ratio_high`, `ai.invoice_mismatch`, `ai.unsettled_reservation`, `ai.cost_anomaly`, `ai.settle_failed`, `ai.price_missing`, `ai.route_missing`, `ai.system_budget_exhausted`, `ai.industry_source_missing`) trong cấu hình giám sát hiện có; kiểm kênh nhận ≤ 15 phút cho SC-013

**Checkpoint**: vận hành quan sát và đối soát được.

---

## Phase 11: Polish & Cross-Cutting

- [ ] T070 [P] Chạy toàn bộ cổng tĩnh: `pnpm typecheck && pnpm lint && pnpm check:boundaries && pnpm db:lint-migrations && pnpm db:check && pnpm check:secrets`; xác nhận `ai_gateway` không nhập module khác ngoài `account`/`notifications`/`queue` và SDK chỉ ở `internal/providers/`
- [ ] T071 Chạy `pnpm test`, `pnpm test:db`, `pnpm test:queue`: chế độ bộ nhớ (`AI_GATEWAY_DRIVER=fake`) và `sandbox` đạt như trước 015 (hồi quy bản giả); production với `fake` vẫn bị `assert-no-fakes` từ chối khi khởi động
- [ ] T072 [P] Cập nhật tài liệu: `apps/server/docs/` cho `ai_gateway` thật (driver, cấu hình, bí mật), hợp đồng `account` (`getAiCycleAnchor`), thêm hai mã lỗi vào `specs/005-gateway-contracts-fakes/contracts/ai-gateway.md` nếu hợp đồng gốc liệt kê mã lỗi; ánh xạ thuật ngữ Việt→Anh theo `data-model.md` mục 1
- [ ] T073 Chạy từng kịch bản `specs/015-real-ai-gateway/quickstart.md` mục 1–5 và 7, ghi kết quả; mục 6 (nhà cung cấp thật, POC-1/POC-4) là thủ công, **không** chạy ở CI — ghi kết quả đo vào `research.md` mục "Kết quả đo" khi có khóa thật
- [ ] T074 [P] Rà soát hiến pháp bằng `/constitution-review` cho cả nhánh (đặc biệt I, III, IV, V, VII, VIII) và ghi kết quả vào `plan.md` (không vi phạm mới)
- [ ] T075 Hồi quy bảo mật: khóa API không xuất hiện trong nhật ký/sổ/chỉ số/thông báo lỗi (quét mẫu nhật ký, `pnpm check:secrets`); tải kiểm `reserve` p95 ≤ 50 ms trên CSDL thật 200 lần (SC-003)

---

## Dependencies & Execution Order

### Phase

- **Setup (1)** → **Foundational (2)** chặn mọi story → **US1 (3)** là MVP.
- **US2** cần `AiSettings` (T011) và `DbBudgetStore` (US1).
- **US3** cần bảng giá/tuyến (Foundational) và `DbBudgetStore` (US1); admin độc lập với US2.
- **US4** cần `RouteBook` (T013), `gateway.service.ts` (US1) và `DbPriceSource` (T012).
- **US5** cần US4 (adapter OpenAI `transcribe`) và US3 (đơn vị `audio_minute`).
- **US6** cần US1 (quyết toán + `onCrossed`).
- **US7** cần US1 (kho) và cổng đảo ngược (T017); tách riêng bảng `system_*`.
- **US8** cần US1/US3 (sổ, `provider_invoices`).
- **Polish (11)** sau các story cần giao.

### Quan hệ trong từng story

- Kiểm thử viết trước và phải **fail**; mô hình/kho → dịch vụ → điểm cuối → tích hợp.
- Cùng một tệp thì **không** gắn `[P]` (nhiều tác vụ US1 đều sửa `db-budget-store.ts` / `gateway.service.ts` nên tuần tự).

### Song song

- Setup: T002, T003, T004 cùng lúc.
- Foundational: T009, T010, T011, T012, T013 (khác tệp) cùng lúc sau T008.
- US1 test: T018–T024 cùng lúc.
- Sau Foundational: một người làm US1, người khác chuẩn bị adapter (T046, T047) và admin (T040) vì khác tệp.
- US4 adapter T046/T047; US8 test T064/T065; US6 test T054/T055.

### Ví dụ song song — US1

```text
Task: T018 hợp đồng 005 trên CSDL thật  (test/contracts/ai/ai.db.contract.spec.ts)
Task: T021 đồng thời + p95              (test/ai_gateway/concurrency.spec.ts)
Task: T022 RLS chéo tài khoản           (test/ai_gateway/rls-cross-account.spec.ts)
Task: T023 dọn giữ chỗ treo             (test/queue/ai_gateway-release-stale.queue.spec.ts)
```

---

## Implementation Strategy

### MVP trước (US1)

1. Setup → Foundational (migration `0024`/`0025`, chu kỳ, giá, tuyến).
2. US1: `DbBudgetStore` + `requestId` + dọn giữ chỗ treo; chạy hợp đồng 005 trên kho thật.
3. **Dừng và xác nhận**: `pnpm test:db -- test/contracts/ai test/ai_gateway/concurrency` đạt (SC-001/002/003).

### Giao dần

1. + US2 (ngưỡng) + US3 (sổ + bảng giá + quản trị) → ba P1 hoàn tất, bật được AI thật với nhà cung cấp giả HTTP.
2. + US4 (dự phòng + adapter thật) → thử nhà cung cấp thật thủ công (quickstart mục 6, sau POC).
3. + US5 (STT), US6 (% và thông báo).
4. + US7, US8 (hệ thống, vận hành) → Polish.

### Rủi ro cần để mắt

- Ngành/tài khoản theo ngành chưa có hiện thực (R-11): trần tạm `AI_SYSTEM_WEEKLY_CAP_MICRO_USD`.
- Chu kỳ tạm theo ngày tạo tài khoản `active` (R-05): đổi bên trong `account` khi có mô hình gói; Cổng AI không đổi.
- Giá/nhà cung cấp là giả định chờ POC-1/POC-4/POC-3: nằm ở dữ liệu (`model_prices`, `model_routes`), không ở mã.
- Hệ số an toàn ước tính token tiếng Việt (20%) chờ đo ở POC-1.
- Hai lỗi `pnpm verify` có sẵn ở `dev` (`check-wiki.spec.ts`, `tooling/infra`) không thuộc 015.

## Notes

- Commit sau mỗi nhóm tác vụ hợp lý; chỉ commit khi người dùng yêu cầu.
- Bản giả lập (`internal/fake/**`, `sandbox.ai_fake_*`) giữ nguyên làm công cụ dev/test.
- Mọi migration chỉ thêm, tương thích ngược (API và Worker cũ/mới chạy song song).
