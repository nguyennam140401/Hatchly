---

description: "Danh sách việc – Đăng bài 5 bước (013)"
---

# Tasks: Đăng bài 5 bước – lượt đăng duy nhất, bộ hẹn giờ, thử lại, đối soát, "Cần kiểm tra", bộ chuyển đổi FB/IG, màn hình Tiến trình đăng

**Input**: `specs/013-publish-five-steps/` (plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md)

**Prerequisites**: plan.md, spec.md (đã có). Tài liệu thiết kế: research.md (R1–R18), data-model.md, contracts/ ×5.

**Tests**: **Có.** Hiến pháp (mục "Kiểm thử bắt buộc theo vùng rủi ro") đòi kiểm thử cho đăng bài (3 loại lỗi, đối soát, hai Worker, Worker chết),
bộ xử lý việc nền chạy lại hai lần, kiểm thử hợp đồng bộ chuyển đổi và kiểm thử truy cập chéo mọi bảng mới. Các kiểm thử đặt trong từng câu chuyện.

**Organization**: nhóm theo câu chuyện người dùng (US1–US7) để làm và kiểm thử độc lập.

## Format: `[ID] [P?] [Story] Mô tả kèm đường dẫn tệp`

- **[P]**: chạy song song được (khác tệp, không phụ thuộc việc chưa xong)
- **[Story]**: US1…US7 (chỉ ở phase câu chuyện)
- Đường dẫn gốc: `apps/server/src/modules/publishing` = `PUB/`; `apps/server/test/publishing` = `PUBTEST/`;
  `apps/server/src/modules/platform_gateway/internal` = `GW/`; `packages/shared/src/modules` = `SHARED/`; `apps/web/src/features/publish-progress` = `WEB/`

## Path Conventions

Monorepo `apps/server` + `apps/web` + `packages/shared` (xem plan.md "Source Code"). Định danh bằng tiếng Anh; chú thích mã và thông điệp người dùng bằng tiếng Việt.

---

## Phase 1: Setup (hạ tầng dùng chung)

**Purpose**: kê khai phụ thuộc, tài liệu quyết định, kiểu dùng chung. Chưa có logic.

- [X] T001 Viết ADR-12 "Đăng bài phụ thuộc module Tài khoản (kiểm tra gói) và ranh giới 012↔013" ở `docs/adr/ADR-12-publishing-depends-on-account.md` (bối cảnh, phương án, tiêu chí có trọng số, quyết định, hệ quả, điều kiện xem lại; ghi cả làm rõ ADR-04: HTTP 5xx chung chung khi `submit` là `unknown`, chỉ mã quá tải được ghi rõ là `transient`)
- [X] T002 Thêm `account` vào `allowedDeps` của `publishing` trong `apps/server/src/modules/modules.manifest.json` và chạy `pnpm check:boundaries` + `pnpm test -- manifest` để chắc chắn đạt
- [X] T003 [P] Thêm các dòng thuật ngữ Việt→Anh (`publish_attempt`, `publish_step`, `error_mapping`, `phase`, `run_no`, `needs_reason`, 8 trạng thái, 5 bước) vào bảng thuật ngữ mục 11 của `.specify/memory/architecture.md` (theo data-model.md mục 1)
- [X] T004 [P] Tạo kiểu dùng chung cho web↔API ở `SHARED/publishing/index.ts`, `SHARED/publishing/attempt.ts` (`DisplayStatus`, `PublishAttemptView`, `StepState` = `not_run|running|succeeded|failed|skipped|not_applicable`, hàm ánh xạ 8 trạng thái nội bộ → 5 trạng thái hiển thị: `retry_wait/unknown/processing → publishing`, `needs_user/needs_check → needs_action`) và `SHARED/publishing/internal-support.ts` (kiểu cho đường hỗ trợ: đủ trạng thái nội bộ, mã lỗi gốc)
- [X] T005 [P] Mở rộng `refs` của sự kiện `publish_needs_action` với hai trường **tùy chọn** `channelType` và `reason` ở `SHARED/notifications/events.ts` (sự kiện cũ vẫn hợp lệ) và thêm mẫu nội dung email/thông báo tiếng Việt cho các lý do (`needs_user`, `needs_check`, `overdue`, `retries_exhausted`) ở module `notifications`; thông điệp nêu tên bài + kênh, **không** có số tiền chi phí AI
- [X] T006 [P] Thêm 4 mã lỗi nghiệp vụ `PUBLISH_NOT_REPUBLISHABLE`, `PUBLISH_NOT_CHECKABLE`, `PUBLISH_VERSION_CONFLICT`, `PUBLISH_ATTEMPT_NOT_FOUND` (HTTP 409/409/409/404, thông điệp theo `contracts/publishing-http-api.md` mục 5) vào tệp `vi-error-messages.ts` hiện có của dự án

**Checkpoint**: manifest + ADR + kiểu dùng chung sẵn sàng.

---

## Phase 2: Foundational (chặn mọi câu chuyện)

**Purpose**: bảng dữ liệu, máy trạng thái, nhật ký bước, ánh xạ lỗi, cổng phụ thuộc, khai báo việc. **Chưa câu chuyện nào làm được trước khi xong phase này.**

### Dữ liệu

- [X] T007 Viết migration `apps/server/drizzle/migrations/NNNN_publishing_tables.sql` (+ khai báo Drizzle) tạo schema `publishing` với bảng `publish_attempts` theo data-model.md mục 2: cột `id` (uuid v7), `account_id uuid NOT NULL FK → account.accounts`, `post_id`, `variant_id`, `variant_version int NOT NULL`, `connection_id`, `channel_type text NOT NULL` (`facebook_page|instagram|zalo_oa|test_channel`), `status text NOT NULL` (CHECK 8 giá trị), `phase text NOT NULL DEFAULT 'none'` (CHECK `none|submitted_awaiting_response|awaiting_processing|finished`), `scheduled_at timestamptz NOT NULL`, `run_no int NOT NULL DEFAULT 0`, `transient_attempts int NOT NULL DEFAULT 0 CHECK (0..5)`, `transient_window_started_at timestamptz NULL`, `reconcile_retry_used boolean NOT NULL DEFAULT false`, `content_hash text NULL`, `submitted_at timestamptz NULL`, `processing_id text NULL`, `platform_post_id text NULL`, `permalink text NULL (≤ 2048)`, `confirmed_by text NULL (platform|reconciliation|user)`, `needs_reason text NULL`, `last_error_category text NULL (transient|user_action|unknown)`, `last_raw_code text NULL` (lọc `[A-Za-z0-9_.:-]{1,64}`), `trace_id text NOT NULL`, `version int NOT NULL DEFAULT 1`, `created_at`, `updated_at`; khai báo bằng `tenantTable` ở `PUB/internal/db/publish-attempts.table.ts` (RLS `tenant_isolation`)
- [X] T008 Cùng migration T007: chỉ mục và CHECK của `publish_attempts` — `UNIQUE (account_id, post_id, connection_id) WHERE status <> 'cancelled'` tên `ux_publish_attempts_active_pair`; `INDEX (account_id, status, scheduled_at)`; `INDEX (account_id, post_id)`; CHECK `(status IN ('needs_user','needs_check')) = (needs_reason IS NOT NULL)`; CHECK `phase = 'finished'` chỉ khi `status IN ('succeeded','cancelled')`; CHECK `status = 'succeeded' ⇒ platform_post_id IS NOT NULL OR confirmed_by = 'user'`; CHECK `phase = 'submitted_awaiting_response' ⇒ content_hash IS NOT NULL AND submitted_at IS NOT NULL`. Mọi chỉ mục bắt đầu bằng `account_id`
- [X] T009 [P] Tạo bảng nhật ký phân vùng tháng `publish_steps` ở `PUB/internal/db/publish-steps.log-table.ts` bằng `partitionedLogTable` (migration cùng T007 hoặc tệp kế tiếp): `id`, `account_id NOT NULL`, `attempt_id NOT NULL`, `run_no int NOT NULL`, `step_no smallint NOT NULL (1..5)`, `step_key` (`precheck|prepare_media|submit|await_processing|confirm`), `event` (`started|finished`), `outcome NULL` (`succeeded|failed|skipped|not_applicable`), `error_category`, `raw_code`, `message_vi text ≤ 500`, `remedies jsonb` (≥ 1 phần tử khi `failed`), `note text ≤ 200`, `occurred_at timestamptz NOT NULL`, `trace_id NOT NULL`; PK `(occurred_at, id)`; chỉ mục `(account_id, attempt_id, run_no, step_no, occurred_at)`; đăng ký `registerPartitionedLog` với `retentionMonths: 12`; **chỉ thêm, không UPDATE/DELETE** (đạt `pnpm db:immutable`)
- [X] T010 [P] Tạo bảng dùng chung `error_mappings` ở `PUB/internal/db/error-mappings.table.ts` bằng `sharedTable`: `id`, `channel_type`, `raw_code`, `category` (`transient|user_action|unknown`), `message_vi ≤ 500`, `remedies jsonb NOT NULL` với CHECK `jsonb_array_length >= 1`, `needs_reason NULL`, `retry_after_sec int NULL` (chỉ khi `transient`), `enabled boolean NOT NULL DEFAULT true`, `updated_at`, `updated_by` (nhãn nhân viên, không email); `UNIQUE (channel_type, raw_code)`; vai trò `app` chỉ SELECT
- [X] T011 Áp dụng migration và chạy `pnpm db:migrate`, `pnpm db:check`, `pnpm db:immutable`, `pnpm db:lint-migrations`, `pnpm db:compat` để bảo đảm RLS, phân vùng, bất biến nhật ký và tương thích ngược đạt (sửa migration nếu không đạt)
- [X] T012 [P] Viết kiểm thử truy cập chéo `PUBTEST/publishing.cross-tenant.spec.ts` (vitest.db): tài khoản A thử `SELECT/UPDATE/DELETE` trên `publish_attempts` và `publish_steps` của B → 0 dòng/lỗi; thiếu biến phiên tenant → không thấy dòng nào; `error_mappings` không có cột tài khoản và `app` không `INSERT/UPDATE`

### Máy trạng thái, nhật ký, cấu hình

- [X] T013 Hiện thực `PUB/internal/state-machine.ts`: bảng chuyển hợp lệ (scheduled→processing|cancelled; processing→succeeded|retry_wait|needs_user|unknown; retry_wait→processing; unknown→succeeded|retry_wait|needs_check; needs_check→succeeded|scheduled; needs_user→scheduled) và hàm duy nhất `transition(tx, id, from, to, patch)` thực hiện `UPDATE … WHERE status = :expected` và kiểm tra số dòng ảnh hưởng (trả `{ok:false}` khi mất cuộc đua); chuyển không hợp lệ ném lỗi lập trình. Thêm quy tắc lint `publishing-no-raw-status-update` cấm `UPDATE … SET status` ngoài tệp này (xem data-model.md bất biến 3)
- [X] T014 [P] Kiểm thử đơn vị `PUBTEST/state-machine.spec.ts`: mọi cặp (from,to) hợp lệ chạy được, mọi cặp không hợp lệ bị từ chối; hai `transition` đồng thời từ cùng trạng thái → đúng một thắng (vitest.db); bất biến `content_hash`/`submitted_at` chỉ ghi một lần cho mỗi lượt gửi
- [X] T015 [P] Hiện thực `PUB/internal/step-log.ts`: `startStep`, `finishStep` ghi **hai dòng** (`started`/`finished`) bằng giao dịch riêng ngắn đã commit, có `trace_id`; `finishStep` nhận `outcome`, `rawCode` (lọc `[A-Za-z0-9_.:-]{1,64}`), `messageVi ≤ 500`, `remedies`; ghi cả bước `skipped`/`not_applicable` cho các bước chưa chạy để đủ 5 bước (SC-005); tuyệt đối không nhận mã quyền, nội dung bài, phản hồi thô
- [X] T016 [P] Hiện thực `PUB/internal/retry-policy.ts` đọc cấu hình `publish.max_late_sec=3600`, `publish.transient_delays_sec=[60,180,360,600,600]`, `publish.transient_window_sec=1800`, `publish.reconcile_first_delay_sec=120`, `publish.reconcile_poll_sec=120`, `publish.reconcile_give_up_after_sec=600`, `publish.await_processing_max_sec.image/.video=600/1800`, `publish.min_schedule_lead_sec=300` (không hằng số rải trong luồng; đọc lại mỗi 60 giây cùng cơ chế cấu hình hàng chờ); hàm thuần `nextTransientDelay(attempts, windowStartedAt, now)` và `nextReconcileAction(submittedAt, now, retryUsed)` + kiểm thử đơn vị `PUBTEST/retry-policy.spec.ts`
- [X] T017 [P] Hiện thực `PUB/internal/error-mapping.service.ts`: nạp `error_mappings` (chỉ dòng `enabled`), cache 5 phút theo `(channel_type, raw_code)`, đưa vào `applyErrorMapping` sẵn có của `platform_gateway`; mã không có trong bảng → `unknown` với thông điệp chung "Có sự cố khi đăng, chúng tôi đang kiểm tra"; không bao giờ trả `transient` cho mã lạ (FR-017); kiểm thử đơn vị `PUBTEST/error-mapping.spec.ts`
- [X] T018 [P] Seed dữ liệu ban đầu cho `error_mappings` bằng migration dữ liệu `NNNN_publishing_error_mappings_seed.sql`: tối thiểu các dòng ADD mục 7 cho mỗi kênh `facebook_page`, `instagram` (quyền hết hạn, thiếu quyền, không phải tài khoản chuyên nghiệp, ảnh sai định dạng, hạn mức bài/24 giờ, giới hạn tốc độ, quá tải nền tảng có mã rõ ràng, hết thời gian chờ); mỗi dòng có thông điệp tiếng Việt + ≥ 1 cách khắc phục; ghi nhật ký kiểm toán `error_mapping.updated` cho thay đổi sau này

### Cổng phụ thuộc và khai báo việc

- [X] T019 Định nghĩa `PublishingPublicApi` (`schedule`, `cancel`, `reschedule`, `getStatuses`, `cancelAllForConnection`) và các kiểu `ScheduleRequest/ScheduleResult/CancelResult/RescheduleResult/PostPublishStatus` ở `PUB/public-api.ts` theo `contracts/publishing-public-api.md` mục 1 (không có tham số `accountId`; kết quả nghiệp vụ là hợp đóng có `kind`); xuất `PUBLISHING` ở `PUB/index.ts`
- [X] T020 [P] Định nghĩa cổng đọc phụ thuộc còn thiếu và bản giả cho kiểm thử: `getVariantForPublish` (module `content`), `getPublishableMedia` (module `media`, đường dẫn ký sẵn đúng tiền tố `tenants/{accountId}/`, hạn ≤ 24 giờ) và `getPublishingEligibility` (module `account`, `{planActive, deletionRequested}`) theo `contracts/publishing-public-api.md` mục 4; đặt kiểu ở `public-api.ts` của từng module, bản giả ở `PUBTEST/fakes/{content,media,account}.fake.ts`; bản giả `media` dùng media giả của 005
- [X] T021 Khai báo loại việc ở `PUB/jobs.ts` (không nằm trong `internal/`): `publishing.execute_attempt` (hàng chờ `publish`, scope tenant, payload `z.strictObject({ attemptId: uuid })`, khóa chống trùng `publish:{attemptId}`, `allowGenericRetry: false`, `version: 1`, phong bì ≤ 8192 byte, không chứa nội dung bài/mã quyền/`accountId` ở payload) và `publishing.sweep_overdue` (hàng chờ `scheduled`, scope system, payload `{}`, `defineSchedule` mỗi phút, khóa `scheduled:publishing.sweep_overdue`)
- [X] T022 Nối module: `PUB/publishing.module.ts` đăng ký provider (`attempts.service`, `step-log`, `error-mapping.service`, `retry-policy`), `registerJobHandler` cho hai loại việc ở cả `api` và `worker`, và `PUBLISHING` provider; `pnpm typecheck` + `pnpm check:boundaries` đạt
- [X] T023 [P] Hiện thực `PUB/internal/metrics.ts` theo `contracts/observability.md` mục 1 (`publish_attempt_transitions_total`, `publish_lag_seconds`, `publish_overdue_attempts`, `publish_step_duration_seconds`, `publish_unknown_total`, `publish_needs_check_total`, `publish_reconcile_total`, `publish_duplicate_guard_total`, `publish_notification_latency_seconds`) — nhãn **không** có `account_id`/`post_id`; nhật ký kỹ thuật có `trace_id`, `account_id`, `attempt_id`, `channel_type`, `run_no`, `status` và không có mã quyền/nội dung bài/phản hồi thô

**Checkpoint**: nền tảng sẵn sàng — bắt đầu các câu chuyện.

---

## Phase 3: User Story 1 – Bài đã lên lịch được đăng đúng giờ lên Facebook Page và Instagram (P1) 🎯 MVP

**Goal**: đến giờ hẹn, mỗi kênh có đúng một lượt đăng chạy đủ 5 bước với bản giả lập và kết thúc "Đã đăng" có đường dẫn.

**Independent Test**: lên lịch một bài hai kênh (giả lập) sau 5 phút → sau giờ hẹn mỗi kênh có đúng một lượt `succeeded`, có `permalink`, đủ 5 bước được ghi (quickstart S1).

### Kiểm thử cho US1 (viết trước, phải thất bại trước khi hiện thực)

- [X] T024 [P] [US1] Kiểm thử hợp đồng `PUBTEST/public-api.contract.spec.ts`: `schedule` hai lần cùng (post, connection) → cùng `attemptId`, đúng một dòng và một việc; giao dịch của bên gọi hoàn tác → không lượt, không việc, không sự kiện thông báo; tài khoản B gọi với `postId` của A → `rejected`/`nothing_to_cancel`, không lộ tồn tại
- [X] T025 [P] [US1] Kiểm thử bộ xử lý `PUBTEST/execute-attempt.happy.queue.spec.ts` (`runJobInline`): bài chữ + bài ảnh Facebook (đồng bộ: bước 4 `not_applicable`), bài ảnh Instagram (bất đồng bộ: bước 4 chờ) → `succeeded`, `permalink` và `platform_post_id` được lưu, `confirmed_by = 'platform'`, đủ 10 dòng bước (5 × started/finished); bài đã `cancelled`/`variant_version` lệch → không đăng, lượt `cancelled` (US1-6)
- [X] T026 [P] [US1] Kiểm thử `PUBTEST/status-aggregation.spec.ts`: trạng thái tổng của bài hai kênh = trạng thái "xấu nhất"; Facebook thành công + Instagram lỗi → chi tiết riêng từng kênh, lỗi Instagram không kích hoạt đăng lại Facebook (US1-3); `getStatuses` ≤ 200 bài/lần và không trả `content_hash`, mã lỗi gốc, mã quyền

### Hiện thực cho US1

- [X] T027 [US1] Hiện thực `PUB/internal/attempts.service.ts` phần tạo/hủy/đọc: `schedule(tx, req)` tạo lượt `scheduled` cho từng kênh (1..4) + `enqueue(executeAttempt, {attemptId}, {dedupeKey: 'publish:'+id, runAfter: scheduledAt})` trong **cùng giao dịch** của bên gọi; vi phạm `ux_publish_attempts_active_pair` ⇒ trả lượt hiện có (không lỗi); kiểm kênh còn kết nối + gói còn hiệu lực ở mức nhẹ (`schedule` từ chối `connection_unavailable|plan_inactive`); sinh `trace_id` cho mỗi lượt; `cancel` (UPDATE có điều kiện + `cancelJob`); `getStatuses` (gộp 8 → 5 trạng thái hiển thị bằng hàm ở T004)
- [X] T028 [P] [US1] Hiện thực bước 1 `PUB/internal/executor/precheck.ts` (FR-013): gói còn hiệu lực + tài khoản không đang bị xóa (`account.getPublishingEligibility`), kết nối kênh còn dùng được và quyền còn hạn, `checkAccount` của bộ chuyển đổi (vd Instagram chuyên nghiệp; bài Instagram **không có media bị chặn** ở đây — US6-3), hạn mức bài/24 giờ nếu nền tảng cho biết, `mediaRules()` của kênh, và `content.getVariantForPublish` (bài còn `approved`, `variant_version` khớp). Không đạt → trả lỗi đã phân loại, **không** gọi bước gửi
- [X] T029 [P] [US1] Hiện thực bước 2 `PUB/internal/executor/prepare-media.ts` (FR-014, FR-014a): gọi `media.getPublishableMedia(mediaIds, {ttlSec ≤ 86400})`, kiểm theo `mediaRules()` (không hằng số cứng 500 MB hay 1 GB), không có media → ghi `not_applicable`; không xử lý được → lỗi `user_action` kèm "vui lòng chọn ảnh khác" (chi tiết chuyển đổi tự động ở US6)
- [X] T030 [P] [US1] Hiện thực bước 3 `PUB/internal/executor/submit.ts` theo R3/FR-004: (a) giao dịch **commit** `phase = 'submitted_awaiting_response'` + `content_hash` + `submitted_at` bằng `transition()`; (b) **ngoài mọi giao dịch** gọi `platformGateway.submit` có `ctx.signal`; (c) giao dịch commit kết quả (`published` → `succeeded`/bước 5; `processing` → `phase = 'awaiting_processing'` + `processing_id`); `content_hash` tính bằng `platformGateway.contentHash` trên nội dung đã chuẩn hóa (cùng quy tắc ở gửi và đối soát). Lỗi `failed` chuyển cho bộ phân loại ở US3
- [X] T031 [P] [US1] Hiện thực bước 4 `PUB/internal/executor/await-processing.ts` (FR-015): nền tảng đồng bộ (Facebook) → ghi `not_applicable`; bất đồng bộ (Instagram) → `checkStatus` định kỳ theo `retryAfter`, trần thời gian `publish.await_processing_max_sec.image/.video`; quá trần → `unknown` (nhánh đối soát ở US4)
- [X] T032 [P] [US1] Hiện thực bước 5 `PUB/internal/executor/confirm.ts`: xác nhận bài đã xuất bản, lưu `platform_post_id` + `permalink` (≤ 2048), `confirmed_by = 'platform'`, `phase = 'finished'`, `transition(processing→succeeded)`; ghi chỉ số `publish_lag_seconds`
- [X] T033 [US1] Hiện thực `PUB/internal/executor/execute-attempt.handler.ts` theo `contracts/jobs-and-schedules.md` mục 2: đọc lượt bằng `tenantTx`; nếu `status ∈ {succeeded, cancelled, needs_user, needs_check}` hoặc `phase = finished` → return (idempotent); rẽ nhánh theo `(status, phase)`: `scheduled + none` → `transition(scheduled→processing)` rồi bước 1..3; `processing + awaiting_processing` → bước 4→5; tôn trọng `ctx.signal`; kết thúc bằng `succeeded`/`retry_wait`/`unknown`/`needs_*` (nhánh lỗi ở US3/US4). Mỗi bước gọi `step-log` (started/finished) và tăng `run_no` khi luồng chạy lại
- [X] T034 [US1] Giới hạn đồng thời theo tài khoản: xác nhận hàng chờ `publish` giữ mặc định 10/bản, tối đa 3/tenant, khóa 2 phút (heartbeat); thêm kiểm thử `PUBTEST/tenant-fairness.queue.spec.ts` — 50 lượt cùng giờ của tài khoản A không làm lệch lượt của tài khoản B quá 5 phút (SC-010)
- [X] T035 [US1] Kiểm thử đầu-cuối bản giả lập `PUBTEST/e2e-fake-publish.queue.spec.ts` (`startTestWorkers(2)`): kịch bản quickstart S1 (đăng đúng giờ hai kênh) và S19 (AI bị khóa → đăng vẫn chạy, SC-012)

**Checkpoint**: US1 chạy độc lập — MVP đăng được với bản giả lập.

---

## Phase 4: User Story 2 – Không bao giờ đăng trùng (P1)

**Goal**: mọi tình huống đua/chết/giao lại vẫn ≤ 1 bài thật trên nền tảng giả cho mỗi (bài, kênh), trừ khi người dùng chủ động "Đăng lại".

**Independent Test**: (a) hai Worker cùng nhận một lượt, (b) Worker chết ngay sau ghi dấu, (c) chạy lại hai lần, (d) hết thời gian chờ sau khi đã gửi → số bài trên nền tảng giả ≤ 1 (quickstart S2–S4).

### Kiểm thử cho US2

- [X] T036 [P] [US2] `PUBTEST/duplicate-guard.queue.spec.ts` (`startTestWorkers(2)`, `runJobInline`, `expectIdempotent`): hai Worker cùng nhận một lượt → chỉ một chuyển được `scheduled→processing`, Worker kia thoát không gọi `submit`; Worker chết ngay sau ghi dấu (trước `submit`) → chạy lại đối soát, `submit` **không** được gọi lần hai; Worker chết sau `submit` trước ghi kết quả → đối soát → `succeeded`, bài giả = 1; chạy lại hai lần việc đã `succeeded` → snapshot bằng nhau; việc bị giao lại khi khóa hết hạn giữa `submit` → `ctx.signal` hủy, lần sau đối soát (S3, S4)
- [X] T037 [P] [US2] `PUBTEST/republish.spec.ts` (vitest.db): hai yêu cầu `republish` đồng thời trên cùng lượt → đúng một thành công, một `PUBLISH_VERSION_CONFLICT`/`NOT_REPUBLISHABLE`, chỉ một việc được tạo; lượt `processing`/`succeeded`/`retry_wait` → `PUBLISH_NOT_REPUBLISHABLE`; kiểm tra `needs_reason` bị xóa, `content_hash`/`submitted_at` bị xóa, `run_no` tăng, `phase = none`, `scheduled_at = now()`, ghi `audit_log` `publish.republish` (S12, S13)

### Hiện thực cho US2

- [X] T038 [US2] Hoàn thiện nhánh chạy lại trong `PUB/internal/executor/execute-attempt.handler.ts`: `processing|unknown + phase = submitted_awaiting_response` → **chỉ** gọi nhánh đối soát (hàm ở US4), không bao giờ gọi `submit`; khi `transition()` trả mất cuộc đua → thoát + tăng `publish_duplicate_guard_total{guard=conditional_update_lost}`; gặp `phase_resume` → tăng `guard=phase_resume`; vi phạm chỉ mục duy nhất → `guard=unique_index`
- [X] T039 [US2] Hiện thực `republish` trong `PUB/internal/attempts.service.ts` (FR-006): một giao dịch — điều kiện lượt `needs_user`/`needs_check` + `version` khớp (lệch → `PUBLISH_VERSION_CONFLICT`); `status → scheduled`, `scheduled_at = now()`, `phase = none`, xóa `content_hash`/`submitted_at`/`needs_reason`, `run_no += 1`, `reconcile_retry_used`/`transient_attempts`/`transient_window_started_at` về giá trị đầu, `enqueue(executeAttempt)` với `dedupeKey publish:{id}`; ghi `audit_log` `publish.republish` (người thao tác, trạng thái trước, lý do cũ); từ `needs_check` trả kèm `warning: 'possible_duplicate'`; kênh `succeeded` luôn bị từ chối (không có nút, không gọi được)
- [X] T040 [US2] Quét/lint để chắc chắn không còn đường ghi `status` ngoài `transition()` (quy tắc `publishing-no-raw-status-update` ở T013) và không có `submit` nào gọi được khi `phase ≠ none`; chạy `pnpm lint` + `pnpm test:queue` và sửa

**Checkpoint**: US1 + US2 độc lập; SC-001 chứng minh được bằng kiểm thử.

---

## Phase 5: User Story 3 – Lỗi tạm thời tự thử lại, lỗi cần người dùng được báo kèm cách sửa (P1)

**Goal**: ba loại lỗi xử lý đúng — chắc chắn chưa nhận → thử lại có giãn cách (≤ 5 lần/30 phút); cần người dùng → dừng + thông báo + email kèm cách sửa; không xác định → không gửi lại.

**Independent Test**: bộ chuyển đổi giả trả lần lượt ba loại lỗi (quickstart S5–S8).

### Kiểm thử cho US3

- [X] T041 [P] [US3] `PUBTEST/error-handling.queue.spec.ts`: `timeout_before_publish` ×2 rồi `published` → `retry_wait` rồi `succeeded`, **không** có thông báo, giao diện hiển thị "Đang đăng" (S5); lỗi `transient` liên tục → sau 5 lần/30 phút `needs_user` với `needs_reason = 'retries_exhausted'` + thông báo trong ứng dụng + email (S6); mã quyền hết hạn → dừng ngay `needs_user`, có hành động "Kết nối lại" (S7); mã lạ `ZZZ:1` → `unknown`, `submit` không được gọi lần hai (S8)
- [X] T042 [P] [US3] `PUBTEST/notifications.spec.ts`: sự kiện `publish_needs_action` phát **trong cùng giao dịch** chuyển trạng thái; không phát khi `transient`; refs có `channelType`, `reason`; email gộp trong 10 phút cho cùng tài khoản; mỗi thông báo có ≥ 1 hành động khắc phục; không có số tiền AI; độ trễ thông báo ≤ 5 phút trong kiểm thử với đồng hồ giả

### Hiện thực cho US3

- [X] T043 [US3] Hiện thực bộ phân loại kết quả lỗi trong `PUB/internal/executor/execute-attempt.handler.ts` (hoặc `PUB/internal/executor/error-flow.ts`): `transient` → `transition(processing→retry_wait)`, tăng `transient_attempts` (CHECK 0..5), đặt `transient_window_started_at` ở lần đầu, trả `retryAfter(delay)` theo `nextTransientDelay`; hết 5 lần hoặc quá 30 phút → `needs_user` lý do `retries_exhausted`; `user_action` → dừng ngay `needs_user` (`needs_reason` lấy từ `error_mappings`); `unknown` → `transition(processing→unknown)` (nhánh đối soát ở US4)
- [X] T044 [US3] Hiện thực phát thông báo trong `PUB/internal/executor/notify.ts`: trong **cùng giao dịch** chuyển sang `needs_user`/`needs_check` gọi `NotificationsPublicApi.emit(tx, {type: 'publish_needs_action', refs: {attemptId, postId, authorUserId, state, channelType, reason}})`; không phát khi `transient`; đặt `last_error_category`, `last_raw_code` (đã lọc), thông điệp tiếng Việt + `remedies` lấy từ `error_mappings` ghi vào bước lỗi ở `publish_steps`
- [X] T045 [US3] Ánh xạ hành động khắc phục theo vai trò: `reconnect` chỉ cho chủ tài khoản, cộng tác viên nhận `ask_owner_to_reconnect` ("Nhờ chủ tài khoản kết nối lại"); `change_time` khi lỗi hạn mức/quá giờ; hàm thuần ở `SHARED/publishing/attempt.ts` + kiểm thử đơn vị
- [X] T046 [US3] Cho phép sửa `error_mappings` mà không phát hành: vai trò `system` (quản trị nội bộ) ghi bảng, có hiệu lực ở các lượt sau trong ≤ 5 phút (cache T017), ghi `audit_log` `error_mapping.updated` (US3-6); kiểm thử `PUBTEST/error-mapping-live.spec.ts`

**Checkpoint**: US1–US3 hoạt động; luồng lỗi tạm thời/cần xử lý đầy đủ.

---

## Phase 6: User Story 4 – Đối soát trước khi gửi lại; "Cần kiểm tra" (P1)

**Goal**: kết quả không xác định được đối soát; không thấy sau 10 phút thì thử lại đúng 1 lần; kênh không đối soát được → "Cần kiểm tra" với "Đã đăng"/"Đăng lại".

**Independent Test**: hết thời gian chờ ở ba chế độ (bài đã lên / chưa lên / kênh không đối soát) → `Đã đăng` (không gửi lại) / thử lại đúng 1 lần / `Cần kiểm tra` (quickstart S9–S11).

### Kiểm thử cho US4

- [X] T047 [P] [US4] `PUBTEST/reconcile.queue.spec.ts`: `timeout_after_publish` + đối soát `found` → `succeeded` với `confirmed_by = 'reconciliation'`, 1 bài, ghi chú "Xác nhận nhờ đối soát" (S9); `timeout_before_publish` + `not_found` 10 phút → thử lại **đúng một lần** (`reconcile_retry_used`), rồi `succeeded` hoặc `needs_check` (S10); `reconcile = unsupported` + `unknown` → `needs_check` ngay + thông báo (S11); lần thử lại mà lại `unknown` → `needs_check`, không thử lần nữa; nội dung có emoji/ký tự đặc biệt → `content_hash` ổn định ở gửi và đối soát
- [X] T048 [P] [US4] `PUBTEST/mark-published.spec.ts` (vitest.db): `mark-published` chỉ từ `needs_check` (khác → `PUBLISH_NOT_CHECKABLE`); `status → succeeded`, `confirmed_by = 'user'`, `permalink` tùy chọn phải là URL `https`, `phase = finished`, không gọi nền tảng, ghi `audit_log` `publish.mark_published`; cộng tác viên được phép

### Hiện thực cho US4

- [X] T049 [US4] Hiện thực `PUB/internal/executor/reconcile.ts` theo R5: kiểm tra `capabilities.reconcile` (false → `needs_check` ngay); lần đầu sau `publish.reconcile_first_delay_sec` (120 s), sau đó mỗi `publish.reconcile_poll_sec` (120 s) trả `retryAfter`; gọi `platformGateway.reconcile` so `contentHash` trong cửa sổ `[submitted_at − 5 phút, now]`; `found` → `succeeded` + `permalink`, **không** gửi lại; `not_found` đủ 10 phút (`publish.reconcile_give_up_after_sec`) → nếu `reconcile_retry_used = false` thì đặt cờ bằng cập nhật có điều kiện, `transition(unknown→retry_wait)`, `phase = none`, xóa dấu, `retryAfter`; nếu đã dùng → `needs_check` lý do `reconcile_failed`; `unsupported` → `needs_check`; ghi chỉ số `publish_reconcile_total{result}`
- [X] T050 [US4] Hiện thực `markPublished` trong `PUB/internal/attempts.service.ts` (FR-021): một giao dịch, điều kiện `status = 'needs_check'` và `version` khớp; hiệu ứng như T048; không nhận mã quyền; thông điệp lỗi theo mã `PUBLISH_*` ở T006
- [X] T051 [US4] Kiểm soát "Đăng lại" từ `needs_check`: cảnh báo `possible_duplicate` được trả về cho UI (đã có ở T039), thông điệp "bài có thể bị đăng trùng nếu bài trước đã lên"; cộng thêm kiểm thử `PUBTEST/republish-from-needs-check.spec.ts`
- [X] T052 [P] [US4] Cảnh báo vận hành tỷ lệ "Cần kiểm tra" > 1%/kênh/ngày và `reconcile_total{result=unsupported}` > 20% ở `ops/` theo `contracts/observability.md` mục 2 (xem lại ADR-04 khi vượt ngưỡng)

**Checkpoint**: US1–US4 — không đăng trùng lẫn không mất bài khi kết quả mơ hồ.

---

## Phase 7: User Story 5 – Màn hình Tiến trình đăng (P1)

**Goal**: người dùng mở bài thấy từng kênh với dòng thời gian 5 bước, bước lỗi, lời giải thích, nút hành động; tự cập nhật; dùng được từ 360 px.

**Independent Test**: lượt đăng lỗi ở bước 2 → bước 1 hoàn tất, bước 2 lỗi, bước 3–5 chưa chạy, có giải thích + cách khắc phục + "Đăng lại"; "Chi tiết cho hỗ trợ" thu gọn (quickstart S12, S13, S17, S18).

### Kiểm thử cho US5

- [X] T053 [P] [US5] `PUBTEST/http-api.spec.ts` (e2e): `GET /api/posts/{postId}/publish-progress` (hỗ trợ `If-None-Match` → `304`), `POST …/republish`, `POST …/mark-published`, `GET …/support-details`; quyền `status.view` / `post.republish`; người dùng tài khoản khác hoặc thiếu quyền → `404`/`403` không lộ tồn tại; người dùng thường **không bao giờ** thấy `retry_wait`/`unknown`; `allowedActions` đúng (kênh `published` không có `republish`; cộng tác viên nhận `ask_owner_to_reconnect`); phản hồi không chứa mã quyền, `content_hash`, phản hồi thô, `account_id`
- [X] T054 [P] [US5] `PUBTEST/secret-scan.spec.ts` (SC-008, S18): chạy toàn bộ ca hợp đồng bộ chuyển đổi + bộ thực thi với mã quyền mẫu có tiền tố nhận diện; kiểm tiền tố **không** xuất hiện trong log thu được, `publish_steps`, thông báo, phản hồi HTTP; chạy `pnpm check:secrets`
- [X] T055 [P] [US5] Kiểm thử giao diện `apps/web/src/features/publish-progress/__tests__/PublishProgress.test.tsx` (vitest + Testing Library): lượt lỗi ở bước 2; trạng thái `needs_action` + `needsKind`; nút theo `allowedActions`; "Chi tiết cho hỗ trợ" thu gọn mặc định; trạng thái bằng chữ + biểu tượng; không phụ thuộc màu/chuyển động ("Đang thực hiện")
- [X] T056 [P] [US5] Kiểm thử trợ năng/đáp ứng `e2e/publish-progress.spec.ts` (Playwright, hoặc công cụ e2e hiện có ở `e2e/`): khung nhìn 360 px → dòng thời gian dọc, vùng chạm ≥ 44 × 44 px; kiểm tra WCAG 2.1 AA bằng bộ quét tự động của dự án (quickstart S17)

### Hiện thực cho US5

- [X] T057 [US5] Hiện thực `PUB/internal/attempts.controller.ts` với `@CustomerAccess(<quyền>)` (mặc định từ chối), `accountId` lấy từ phiên, phản hồi bằng danh sách trường cho phép (không `select *`), lỗi theo `error-response` chung bằng tiếng Việt: `GET /api/posts/{postId}/publish-progress` (ETag = băm các `version` + `updated_at`), `POST /api/publish-attempts/{attemptId}/republish` (body `{version}`), `POST …/mark-published` (body `{version, permalink?≤2048}`), `GET …/support-details` (`{attemptId, channelType, rawCode, errorCategoryLabel, traceId, runNo, updatedAt}`), theo `contracts/publishing-http-api.md`
- [X] T058 [US5] Dựng phản hồi tiến trình ở `PUB/internal/progress.query.ts`: `overall` (5 giá trị), mỗi kênh `status` hiển thị, `needsKind`, `scheduledAt` (UTC), `permalink`, `message` + `remedies`, `allowedActions` (đã lọc theo quyền và trạng thái), `steps[1..5]` ghép từ `publish_steps` của `run_no` hiện tại với `state` (`not_run|running|succeeded|failed|skipped|not_applicable`); bước chưa chạy vẫn có mục `not_run`
- [X] T059 [P] [US5] Khung giao diện `WEB/PublishProgress.tsx` (khu vực theo kênh) và `WEB/ChannelStatusBadge.tsx` (chữ + biểu tượng cho 5 trạng thái hiển thị), dùng kiểu từ `SHARED/publishing` (T004); thông điệp tiếng Việt thường, múi giờ hiển thị UTC+7
- [X] T060 [P] [US5] `WEB/StepTimeline.tsx`: dòng thời gian 5 bước (Kiểm tra → Chuẩn bị ảnh/video → Gửi lên → Nền tảng xử lý → Xác nhận), ngang ở ≥ 768 px, **dọc** ở 360 px; bước hiện tại hiện chữ "Đang thực hiện"; bước lỗi đánh dấu kèm lời giải thích + cách khắc phục
- [X] T061 [P] [US5] `WEB/SupportDetails.tsx`: vùng "Chi tiết cho hỗ trợ" thu gọn mặc định (mã lỗi gốc, mã lượt đăng); gọi `support-details` khi mở; nút "Gửi cho hỗ trợ" tự đính kèm mã lượt đăng
- [X] T062 [US5] `WEB/usePublishProgress.ts`: thăm dò có ETag, 5 giây khi còn trạng thái chưa kết thúc và giãn dần đến 30 giây, dừng khi tab ẩn/mọi kênh kết thúc; trạng thái đổi hiển thị ≤ 15 giây không cần tải lại trang (SC-011)
- [X] T063 [US5] Nút hành động ở `WEB/PublishProgress.tsx`: "Kết nối lại" (chủ → màn hình Kênh kết nối; cộng tác viên → hướng dẫn "Nhờ chủ tài khoản kết nối lại"), "Chọn giờ khác" (→ đổi giờ ở Lịch), "Đăng lại" (hỏi xác nhận, kèm cảnh báo trùng khi từ `needs_check`), "Đã đăng" (tùy chọn dán đường dẫn), "Gửi cho hỗ trợ"; xử lý `PUBLISH_VERSION_CONFLICT` bằng tải lại
- [X] T064 [US5] Tích hợp khu vực vào chi tiết bài của 012 (điểm gắn ở `apps/web/src/features/` của bài/lịch khi có) và thay trạng thái đăng giả ở Lịch/danh sách bài bằng `PublishingPublicApi.getStatuses` (FR-030); nếu 012 chưa có mã thì xuất component + hook và ghi điểm gắn vào `docs/wiki/open-questions.md`

**Checkpoint**: US1–US5 — người dùng tự tìm lỗi và sửa.

---

## Phase 8: User Story 6 – Bộ chuyển đổi Facebook Page và Instagram sau giao diện chung (P1)

**Goal**: đăng thật lên Facebook Page và Instagram qua `PlatformAdapter`; luồng đăng chính không biết nền tảng cụ thể; cùng một bộ kiểm thử hợp đồng cho mọi bộ chuyển đổi.

**Independent Test**: chạy bộ kiểm thử hợp đồng chung trên Facebook, Instagram, giả lập → cùng hành vi (quickstart mục 1 "Hợp đồng bộ chuyển đổi"; S16).

### Kiểm thử cho US6

- [X] T065 [P] [US6] Viết bộ ca hợp đồng chung `apps/server/test/platform-gateway/adapter-contract.spec.ts` (chạy cho `FakeAdapter`, `FacebookAdapter`, `InstagramAdapter` với máy chủ Graph giả `graph-stub`) gồm 10 ca của `contracts/platform-adapters.md` mục 4: `submit` thành công (FB `published`; IG `processing` rồi `checkStatus` → `done`), hết thời gian sau gửi → `unknown`, từ chối trước gửi → `transient`, giới hạn tốc độ → `transient` có `retryAfterSec`, quyền hết hạn → `user_action` + `reconnect`, mã lạ → `unknown`, `reconcile` (`found`/`not_found`/`unsupported`), `contentHash` ổn định qua chuẩn hóa Unicode/khoảng trắng, mã quyền không xuất hiện trong URL/log/thông điệp lỗi/`ClassifiedError`, `checkAccount` Instagram không chuyên nghiệp → `ineligible` + remedy
- [X] T066 [P] [US6] Dựng máy chủ Graph giả `apps/server/test/platform-gateway/graph-stub.ts` (HTTP cục bộ, kịch bản: thành công, quá tải có mã rõ, 5xx chung chung, giới hạn tốc độ 429, quyền hết hạn, cắt kết nối sau khi nhận, hạn mức 24 giờ) dùng chung cho T065 và kiểm thử bộ thực thi
- [X] T067 [P] [US6] `PUBTEST/media-rules.spec.ts`: Instagram bài không media bị chặn ở bước 1 với thông báo rõ (S16); Instagram chỉ ảnh JPEG/carousel; media không hợp được chuyển đổi tự động nếu có thể, nếu không → `user_action` "vui lòng chọn ảnh khác"; Facebook một video với `maxBytes` đọc từ `mediaRules()` (đặt 1 GB theo PO), `allowMixed = false` ở cả hai; hạn mức Instagram 24 giờ → bước 1 báo "Kênh đã hết lượt đăng hôm nay, chọn giờ đăng khác"

### Hiện thực cho US6

- [X] T068 [P] [US6] `GW/adapters/facebook/graph-client.ts`: máy khách `fetch` bọc Graph API với phiên bản **cố định** (cấu hình), thời gian chờ, trích `rawCode` dạng `<NỀN TẢNG>:<mã>[:<mã phụ>]` lọc `[A-Za-z0-9_.:-]{1,64}`; mã quyền chỉ giải mã tại lúc gọi (qua vault của `platform_gateway`), không nằm trong URL ghi log, header ghi log hay thông điệp lỗi
- [X] T069 [P] [US6] `GW/adapters/facebook/facebook.adapter.ts` + `facebook.errors.ts`: `capabilities` (`reconcile` theo cấu hình, mặc định `false` đến khi POC-2; `asyncProcessing=false`; `maxReconcileWindowHours=24`), `mediaRules()` (chữ ≤ `MAX_POST_TEXT_LENGTH`, nhiều ảnh ≤ `maxItems`, **một** video với `maxBytes` từ cấu hình, `allowMixed=false`), `submit` (chữ/ảnh/video → `published` + mã bài + đường dẫn), `reconcile`, `classifyError` theo bảng R11: lỗi mạng **trước** gửi → `transient`; hết thời gian **sau** gửi → `unknown`; 5xx chung chung khi `submit` → `unknown`; mã quá tải được ghi rõ + đã kiểm thử → `transient`; 429 → `transient` + `retryAfterSec`; quyền → `user_action`; mã chưa biết → `unknown` (không bao giờ đoán `transient`)
- [X] T070 [P] [US6] `GW/adapters/instagram/instagram.adapter.ts` + `instagram.errors.ts`: quy trình hai giai đoạn (tạo container media → `processing` + `processing_id` → `checkStatus` → xuất bản), `capabilities` (`reconcile` cấu hình mặc định `false`, `asyncProcessing=true`, `reportsQuota=true` hạn mức 24 giờ), `mediaRules()` (bài **phải có media**, ảnh JPEG tỉ lệ cho phép, carousel khi nhiều ảnh, một video theo giới hạn thời lượng/dung lượng), `checkAccount` (không chuyên nghiệp → `ineligible` + remedy), `classifyError` cùng quy tắc R11
- [X] T071 [US6] Đăng ký hai bộ chuyển đổi ở `GW/adapters/registry.ts` với cờ `PLATFORM_ADAPTER_MODE=real|fake` (mặc định `fake` ở dev/test; kênh chưa có bộ chuyển đổi thật vẫn dùng bản giả, không chặn luồng); OAuth/`refreshToken` thuộc 010 — nếu 010 chưa merge giữ bản giả cho các thao tác đó; chạy T065 để bảo đảm cả ba đạt
- [X] T072 [US6] Chứng minh SC-009: thêm một bộ chuyển đổi giả thứ hai (`test_channel_2`) chỉ bằng bộ chuyển đổi + dòng `error_mappings`, **không sửa** `PUB/internal/executor/*`, `step-log`, `reconcile`, `notify` (kiểm thử `PUBTEST/new-adapter-no-core-change.spec.ts`)
- [X] T073 [US6] Nạp quy tắc media + chuyển đổi tự động ở bước 2 (`PUB/internal/executor/prepare-media.ts`): ảnh sai định dạng → gọi `media` chuyển đổi nếu có; ghi `conversion_failed` → `user_action` `edit_media`; kiểm lại giới hạn 1 GB video từ `mediaRules()` (tham số, không hằng số); ghi lệch FR-03 (500 MB) vào `docs/wiki/open-questions.md`

**Checkpoint**: US1–US6 — đăng thật FB/IG sau cờ cấu hình, cùng một bộ kiểm thử hợp đồng.

---

## Phase 9: User Story 7 – Hẹn giờ, đổi giờ, hủy khớp với lượt đăng đang chờ (P2)

**Goal**: giờ ở Lịch (012) và lịch thực thi luôn khớp; đổi giờ/hủy trong cùng giao dịch; không đổi được khi Worker đã nhận; việc trễ > 60 phút không tự đăng.

**Independent Test**: đổi giờ → giờ lượt và `runAfter` của việc đổi cùng lúc; đổi đúng lúc Worker nhận → từ chối, giờ cũ giữ nguyên; sửa nội dung → lượt `scheduled` thành `cancelled` (S14, S15).

### Kiểm thử cho US7

- [X] T074 [P] [US7] `PUBTEST/reschedule-cancel.spec.ts` (vitest.db): `reschedule` mọi lượt `scheduled` → cập nhật cùng giao dịch `scheduled_at` + `rescheduleJob`; khi một lượt `processing` → `already_processing`, **không** lượt nào đổi giờ (S15); `cancel` khi một lượt đã `processing` → lượt đó không bị hủy, trả `already_started`; sửa nội dung → lượt `scheduled` thành `cancelled`, lượt đã bắt đầu không bị ảnh hưởng; hạn mức kênh kiểm lại ở giờ mới (`quota_exceeded_at_new_time`)
- [X] T075 [P] [US7] `PUBTEST/lateness.queue.spec.ts`: việc nhận khi trễ ≤ 60 phút → đăng muộn đúng một lần; trễ > 60 phút ở lần bắt đầu đầu tiên → không đăng, `needs_user` lý do `overdue` ("Bài đã quá giờ hẹn, chưa đăng") + thông báo + email, nút "Đăng lại" (S14); ngưỡng **không** áp dụng cho lượt thử lại đã bắt đầu trước đó; gói hết hạn sau khi lên lịch → bước 1 `needs_user` "Gói dịch vụ đã hết hạn…" rồi "Đăng lại" sau khi gia hạn; kênh bị ngắt → "Kết nối lại"
- [X] T076 [P] [US7] `PUBTEST/account-deletion.spec.ts`: `cancelAllForConnection` hủy mọi lượt `scheduled|retry_wait`, lượt `processing` chờ xong rồi dừng, không gửi thêm bài nào; `purgeAccountJobs()` được gọi; dữ liệu xóa theo vòng đời (FR-033)

### Hiện thực cho US7

- [X] T077 [US7] Hiện thực `reschedule` và `cancelAllForConnection` trong `PUB/internal/attempts.service.ts` (FR-010, FR-033): `UPDATE publish_attempts SET scheduled_at = :t WHERE post_id = :p AND status = 'scheduled'` rồi so số dòng với số lượt của bài, thiếu → hoàn tác + `already_processing`; cùng giao dịch `rescheduleJob` từng việc; kiểm lại hạn mức kênh ở giờ mới; ghi `audit_log` `publish.rescheduled`/`publish.cancelled` (người thao tác)
- [X] T078 [US7] Hiện thực kiểm tra quá giờ ở `PUB/internal/executor/precheck.ts` (R7): chỉ khi bắt đầu lần đầu (`run_no` mới, `scheduled → processing`), nếu `now() − scheduled_at > publish.max_late_sec` (dùng giờ máy chủ CSDL) → `needs_user` lý do `overdue`, không gọi bước gửi; không áp dụng cho `retry_wait`
- [X] T079 [US7] Hiện thực `PUB/internal/overdue.sweeper.ts` (việc `publishing.sweep_overdue`, mỗi phút, idempotent): chỉ **phát hiện và cảnh báo** — đếm lượt `scheduled` quá `scheduled_at + 5 phút` chưa vào `processing`, phát `publish_overdue_attempts`, `publish_unknown_total`, tỷ lệ "Cần kiểm tra"; **không** đổi trạng thái, **không** gửi bài (R14); đọc theo từng tài khoản bằng `systemTx` `tenant: 'from-context'`
- [X] T080 [P] [US7] Cảnh báo vận hành ở `ops/` theo `contracts/observability.md` mục 2: tỷ lệ lỗi một kênh > 5%/15 phút, việc quá hạn > 5 phút, `dead_jobs{queue=publish} > 0` → **ngay**, chặn trùng bị kích hoạt bất thường
- [X] T081 [US7] Tắt Worker có kiểm soát (FR-011): kiểm thử `PUBTEST/graceful-shutdown.queue.spec.ts` — ngừng nhận việc `publish`, chờ tối đa 30 giây, việc đang `submit` bị hủy bằng `signal` và lần sau đối soát, **không bao giờ** gửi lại; việc `publish` hết số lần thử chung bị chôn → chỉ xử lý qua quy trình có đối soát

**Checkpoint**: cả 7 câu chuyện hoạt động.

---

## Phase 10: Polish & cross-cutting

- [X] T082 [P] Cập nhật `docs/wiki/` (features/013, glossary, decisions/ADR-12, open-questions: POC-2 reconcile, chi tiết Graph API, giới hạn video 1 GB vs FR-03) và chạy `pnpm wiki:check`
- [X] T083 [P] Chạy toàn bộ cổng chất lượng ở quickstart mục 1: `pnpm typecheck`, `pnpm lint`, `pnpm check:boundaries`, `pnpm db:check`, `pnpm db:immutable`, `pnpm db:lint-migrations`, `pnpm db:compat`, `pnpm test`, `pnpm test:db`, `pnpm test:queue`, `pnpm test -- adapter-contract`, `pnpm test:db -- publishing.cross-tenant`, `pnpm check:secrets`, `pnpm wiki:check` (hoặc `pnpm verify`); sửa mọi lỗi
- [X] T084 Chạy lần lượt kịch bản quickstart S1–S19 với bản giả lập (`PLATFORM_ADAPTER_MODE=fake`) và ghi kết quả; lỗi nào → mở việc sửa
- [ ] T085 Kiểm chứng với nền tảng thật theo quickstart mục 3 khi 010 đã merge và có tài khoản thử của Meta (`PLATFORM_ADAPTER_MODE=real` ở staging): ghi lại có đọc được bài đã đăng không (đầu vào POC-2), thời gian xử lý Instagram, hạn mức 24 giờ, giới hạn video; cập nhật `error_mappings`, năng lực `reconcile` và giới hạn 1 GB theo kết quả
- [X] T086 Rà soát hiến pháp bằng skill `constitution-review` cho toàn bộ thay đổi (đặc biệt I, II, VII) và cập nhật mục "Kiểm tra hiến pháp sau thiết kế" của plan.md nếu có điều chỉnh

---

## Dependencies & Execution Order

### Phase

- **Phase 1 Setup** → không phụ thuộc. **Phase 2 Foundational** phụ thuộc Phase 1 (T002 trước T022; T004/T006 trước T057/T059). **Chặn mọi câu chuyện.**
- **US1 (P1, MVP)** sau Phase 2. **US2** sau US1 (cần handler T033 và `submit` T030 để thêm nhánh chạy lại). **US3** sau US1 (cần handler). **US4** sau US1 + US3 (dùng `unknown` và thông báo T044). **US5** sau US1 (hợp đồng HTTP cần `republish` của US2 và `markPublished` của US4 để dùng đủ nút; có thể làm song song giao diện với dữ liệu mẫu). **US6** độc lập với US2–US5 về mã (chỉ cần giao diện `PlatformAdapter` của 005); tích hợp ở T071. **US7** sau US1 (cần `attempts.service`).
- **Polish** sau mọi câu chuyện mong muốn.

### Trong từng câu chuyện

Kiểm thử viết trước và **phải thất bại**; rồi máy trạng thái/dịch vụ → bước thực thi → điểm cuối → giao diện.

### Phụ thuộc đáng chú ý

- T013 (`transition`) chặn T027, T030, T033, T039, T043, T049, T050, T077.
- T015 (`step-log`) chặn T028–T033.
- T017/T018 (ánh xạ lỗi) chặn T043–T044, T046.
- T020 (cổng/bản giả content-media-account) chặn T028–T029 và mọi kiểm thử của bộ thực thi.
- T033 (handler) chặn T036, T038, T043, T049.

### Cơ hội chạy song song

- Phase 1: T003, T004, T005, T006 song song (sau T001–T002 nếu cần).
- Phase 2: T009, T010 song song với T007–T008; T012, T014–T018, T020, T023 song song khi cùng điều kiện.
- US1: T024–T026 (kiểm thử) song song; T028–T032 (năm bước, khác tệp) song song.
- US5: T053–T056 song song; T059–T061 song song (khác tệp).
- US6: T065–T067 và T068–T070 song song (hai bộ chuyển đổi khác thư mục).

---

## Parallel Example: User Story 1

```text
Song song (khác tệp):
  T024 PUBTEST/public-api.contract.spec.ts
  T025 PUBTEST/execute-attempt.happy.queue.spec.ts
  T026 PUBTEST/status-aggregation.spec.ts
Sau đó song song:
  T028 PUB/internal/executor/precheck.ts
  T029 PUB/internal/executor/prepare-media.ts
  T030 PUB/internal/executor/submit.ts
  T031 PUB/internal/executor/await-processing.ts
  T032 PUB/internal/executor/confirm.ts
Rồi nối lại: T033 execute-attempt.handler.ts → T035 e2e giả lập
```

---

## Implementation Strategy

### MVP đầu tiên (US1 + US2)

1. Phase 1 → Phase 2 (xong nền tảng).
2. US1: đăng đúng giờ bằng bản giả lập, đủ 5 bước.
3. US2: bằng chứng 0 trùng (**dừng và kiểm chứng** — đây là cam kết khó nhất, Hiến pháp II). **Chưa** bật `PLATFORM_ADAPTER_MODE=real`.

### Giao tăng dần

4. US3 → US4 (hoàn tất ba loại lỗi + đối soát + "Cần kiểm tra"): đủ an toàn để thử với kênh thật.
5. US5 (màn hình) → người dùng tự xử lý lỗi.
6. US6 (bộ chuyển đổi thật) sau cờ cấu hình; chỉ bật ở staging khi 010 xong và có tài khoản thử của Meta.
7. US7 (đổi giờ/hủy/quá giờ/bộ quét) → hoàn thiện; rồi Polish.

### Ghi chú

- Mỗi câu chuyện kết thúc bằng một Checkpoint chạy được độc lập; commit sau mỗi nhóm việc logic (chỉ khi người dùng yêu cầu commit).
- ADR-12 (T001–T002) cần SA duyệt trước khi merge; nếu chưa duyệt thì dừng ở T002 và không merge nhánh.
- 010, 012, `content`, `media` chưa có mã: dùng cổng + bản giả (T020); nối thật khi các module đó xong.
- Không tự quyết "Đã đăng/Đăng lại" thay người dùng; không có đường ghi `status` ngoài `transition()`; không giữ giao dịch CSDL trong lúc gọi nền tảng.

## Ghi chú thi công (2026-11-16)

Tasks.md soạn trước khi 012 merge nên một số tên khác mã thật; thi công **giữ nguyên tên của 012** (ADR-12 mục 3):

- Loại việc `publishing.run_attempt` (không phải `execute_attempt`); cột `channel_connection_id`, `content_version` (không phải `connection_id`/`variant_version`); giao diện công khai `schedule/cancelByPost/reschedule/statusesByPosts/precheckChannels` của 012 giữ nguyên, **thêm** `cancelAllForConnection`.
- Migration chỉ thêm: `0019` (cột mới + `error_mappings`, ràng buộc `NOT VALID` rồi `VALIDATE`), `0020` (`publish_steps` phân vùng, seed ánh xạ lỗi, nâng `max_retries` hàng chờ `publish` 5 → 20 vì mỗi `retryAfter` tính một lượt), `0021` (hàm tổng hợp cho bộ quét).
- `content.getVariantForPublish` không thêm: dùng `ContentPublicApi.getPost` + `channelRules` có sẵn. Cổng media là bản giữ chỗ (`MEDIA_PUBLIC_API`); cổng gói là `account.getPublishingEligibility` (từ `accounts.status`).
- Cấu hình thời gian (T016) là mặc định trong mã (`DEFAULT_PUBLISH_SETTINGS`) tiêm được; chưa đọc lại từ `infra.queue_settings` (chỉ đổi giá trị hàng chờ publish ở đó).
- `PUBLISH_EXECUTOR` thêm giá trị `run` (đăng thật); `fake` là bí danh cũ; bộ chuyển đổi Meta thật bật bằng `PLATFORM_ADAPTER_MODE=real`.
- T073 (2026-11-19, sau khi 014 merge): 014 chuẩn hóa ảnh → JPEG ngay lúc tải lên và không có chuyển đổi theo yêu cầu, nên bước 2 không tự gọi chuyển đổi mà đọc lý do từ `getPublishableMedia` (`unavailable.reasons`, thêm mới, tương thích ngược): `conversion_failed` (media `unprocessable`) và `not_ready` → `needs_user` `media_invalid` + `edit_media`. Giới hạn video vẫn từ `mediaRules()`. T085 cần tài khoản thử Meta + staging, chưa làm được.
- Kiểm thử đặt ở `apps/server/test/queue/publishing/`, `test/publishing/`, `test/platform-gateway/`, `test/e2e/publish-progress.e2e.spec.ts`, `test/unit/publishing/`, `apps/web/test/publish-progress/`, `e2e/tests/publish-progress.e2e.ts` (khớp cấu hình vitest sẵn có).
