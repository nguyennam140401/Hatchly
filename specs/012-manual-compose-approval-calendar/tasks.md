---

description: "Danh sách việc cho 012 – Soạn bài tay theo kênh, duyệt, lên lịch, màn hình Lịch và Chờ duyệt"
---

# Tasks: Soạn bài tay theo kênh, duyệt (từng bài / nhiều bài, trả lại kèm ghi chú), lên lịch, màn hình Lịch và Chờ duyệt

**Input**: Tài liệu thiết kế ở `specs/012-manual-compose-approval-calendar/` (plan.md, spec.md, research.md R1–R12,
data-model.md, contracts/http-api.md, contracts/module-api.md, quickstart.md)

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: **Có**. Hiến pháp bắt buộc kiểm thử truy cập chéo cho bảng tenant mới, kiểm thử "chạy lại hai lần" cho bộ xử
lý việc nền và kiểm thử đồng thời cho duyệt; spec có các SC đo được (SC-003, SC-004, SC-006, SC-009, SC-011). Kiểm thử của
mỗi câu chuyện viết **trước** và phải **đỏ** trước khi làm phần triển khai.

**Organization**: Theo câu chuyện người dùng. Hai migration, bảng, `PublishingPublicApi`, loại việc `run_attempt` và bộ thực
thi tạm là nền của mọi câu chuyện nên nằm ở Phase 2. Mỗi câu chuyện chia hai nửa: **Máy chủ** (làm được ngay, dùng bản giả
lập 005) và **Web** (chỉ làm sau khi 011 – và 010 cho danh sách kênh thật – đã merge vào `dev`, xem Rủi ro R-A của plan.md).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: chạy song song được (khác tệp, không phụ thuộc việc chưa xong)
- **[Story]**: US1…US7 theo spec.md
- Đường dẫn tính từ gốc repo (worktree `impl/012-manual-compose-approval-calendar`)

## Path Conventions

- API/Worker: `apps/server/src/modules/{content,publishing,approval}/`; kiểm thử `apps/server/test/` – đơn vị + e2e
  (`*.spec.ts`, `*.e2e.spec.ts`: `pnpm --filter @app/server test`), CSDL thật (`test/db/*.db.spec.ts`: `pnpm test:db`),
  hàng chờ (`test/queue/*.queue.spec.ts`: `pnpm test:queue`)
- Web: `apps/web/src/features/{posts,approvals,calendar}/`, kiểm thử `apps/web/test/`
- Dùng chung: `packages/shared/src/modules/{content,approval,publishing}/`, `packages/shared/src/core/`

## Quy ước chung cho mọi việc

- Định danh tiếng Anh, chú thích và thông điệp tiếng Việt. Ánh xạ thuật ngữ: research.md R12.
- Module chỉ truy cập CSDL qua `tenantTx` (ứng dụng) hoặc `systemTx` (việc hệ thống); dùng `account.current_account_id()`, không dùng
  `current_setting('app.account_id')`. Không điểm cuối nào nhận `accountId`; mã tài khoản chỉ từ phiên.
- Hàm công khai của `content`/`publishing` nhận `tx: Db` và chạy **trong giao dịch của người gọi** (như `notifications.emit`);
  chỉ `approval` mở `tenantTx`. Lỗi nghiệp vụ trả kết quả có `kind`, chỉ lỗi lập trình/hạ tầng mới ném.
- Mọi chuyển trạng thái là `UPDATE … WHERE version = :đã_xem AND status IN (…)`; 0 dòng = thất bại có chủ đích, không 500.
- Không gọi nền tảng bên ngoài khi đang giữ giao dịch (`precheckChannels` chạy **trước** `tenantTx`).
- Không ghi nội dung bài vào nhật ký kỹ thuật, `infra.audit_log.metadata`, dữ liệu việc hay tham số thông báo
  (chỉ `postId`, `postTitle ≤ 60`). Không có số tiền ở bất kỳ phản hồi nào.
- UUID v7 sinh ở ứng dụng; `timestamptz` UTC, web hiển thị UTC+7. Mọi lỗi có tiếng Việt đời thường + ≥ 1 hành động khắc phục.
- Số migration `0017`/`0018` đánh lại theo `dev` nếu trùng khi hợp nhất (plan R-B).

---

## Phase 1: Setup (hạ tầng dùng chung)

**Purpose**: cấu hình, mã lỗi, khuôn dùng chung và kê khai module.

- [X] T001 Thêm cấu hình bài viết vào `apps/server/src/core/config/post-config.ts` (đăng ký trong `config.schema.ts`) và `apps/server/.env.example`: `POST_MIN_LEAD_MINUTES` (mặc định `5`), `POST_SUGGEST_HOURS` (mặc định `09:00,12:00,19:00`, giờ UTC+7), `POST_BULK_APPROVE_LIMIT` (mặc định `100`), `POST_BULK_SUBMIT_LIMIT` (mặc định `50`), `PUBLISH_EXECUTOR` (`none` | `fake`, mặc định `none`); production từ chối `fake` trong `apps/server/src/core/config/assert-no-fakes.ts` (cùng cơ chế `STAGING_ALLOW_FAKES`)
- [X] T002 [P] Thêm 11 mã lỗi `NO_ACTIVE_CHANNEL`, `POST_NOT_EDITABLE`, `POST_ALREADY_APPROVED`, `POST_CONTENT_INVALID`, `TIME_IN_PAST`, `CHANNEL_INACTIVE`, `CHANNEL_QUOTA_EXCEEDED`, `CHANNEL_ALREADY_PUBLISHING`, `PLAN_EXPIRED`, `RETURN_NOTE_REQUIRED`, `BULK_LIMIT_EXCEEDED` vào `packages/shared/src/core/error-response.ts` (HTTP theo contracts/http-api.md mục 4) và thông điệp tiếng Việt + hành động khắc phục vào `packages/shared/src/core/vi-error-messages.ts`; `VERSION_CONFLICT` đã có – chỉ kiểm thân lỗi kèm `Post` mới nhất
- [X] T003 [P] Dựng khung `packages/shared/src/modules/content/index.ts`, `packages/shared/src/modules/approval/index.ts`, `packages/shared/src/modules/publishing/index.ts` (xuất khuôn Zod, kiểu `PostStatus`, `ChannelType`, bảng trạng thái hiển thị) và xuất ra `packages/shared/src/index.ts`
- [X] T004 Cập nhật `apps/server/src/modules/modules.manifest.json`: thêm `content → platform_gateway`; xác nhận `publishing → content, platform_gateway, queue` và `approval → content, publishing, notifications, account` đã có (giữ `approval` `reservedSchema`); cập nhật `apps/server/test/manifest.spec.ts` nếu có khẳng định số cạnh
- [X] T005 [P] Mở rộng dữ liệu mẫu dev (`pnpm dev:seed-auth`, xem `package.json` gốc) cho quickstart: tài khoản A có chủ `owner` + cộng tác viên `minh` + **2 kênh giả lập đang hoạt động** (Facebook Page, Instagram), tài khoản B có 1 kênh

---

## Phase 2: Foundational (BLOCKS mọi câu chuyện)

**Purpose**: bảng, RLS, mục lịch đăng, việc nền, bộ thực thi tạm, nền `content`/`approval`.

**⚠️ CRITICAL**: chưa câu chuyện nào làm được khi phase này chưa xong.

### Migration và bảng

- [X] T006 Viết `apps/server/drizzle/migrations/0017_content_posts.sql` theo data-model.md mục 1: `content.posts` (`status` CHECK ∈ `draft`, `pending_review`, `approved`, `cancelled`; `source text NOT NULL DEFAULT 'manual'` CHECK ∈ `manual`, `ai`; `internal_name varchar(80) NULL`; `shared_text text NOT NULL DEFAULT ''` với CHECK `char_length ≤ 63206`; `returned_note varchar(500) NULL`; `edited_after_approval boolean NOT NULL DEFAULT false`; `version integer NOT NULL DEFAULT 1`; `deleted_at timestamptz NULL`; CHECK `status = 'approved' → scheduled_at IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL`, CHECK `returned_note IS NULL OR char_length(btrim(returned_note)) BETWEEN 1 AND 500`, CHECK `status IN ('pending_review') → submitted_by IS NOT NULL`; 4 chỉ mục như mục 1.1), `content.channel_variants` (UNIQUE `(account_id, post_id, connection_id)`, FK `post_id` → `content.posts` `ON DELETE CASCADE`, `hashtags text[]` ≤ 30 phần tử mỗi phần tử không khoảng trắng ≤ 100 ký tự, `media jsonb` mảng ≤ 20 `{ mediaId, kind: 'image'|'video' }`), `content.post_events` (CHECK `type` ∈ `created`, `submitted`, `withdrawn`, `approved`, `returned`, `unscheduled`, `rescheduled`, `edited_after_approval`, `channels_changed`; chỉ thêm), `content.channel_rules` (`sharedTable`, PK `channel_type`) + RLS `tenant_isolation` cho 3 bảng tenant + quyền cho vai trò `app`/`system` + dữ liệu khởi tạo `channel_rules` (Facebook 63206, Instagram 2200/30 hashtag/`media_required = true`/`max_posts_per_24h`, Zalo OA, `test_channel`); không `SECURITY DEFINER` mới
- [X] T007 Viết `apps/server/drizzle/migrations/0018_publishing_attempts.sql` theo data-model.md mục 2.1: `publishing.publish_attempts` (`status` CHECK ∈ `scheduled`, `processing`, `retry_wait`, `needs_user`, `unknown`, `needs_check`, `succeeded`, `cancelled` – đủ bộ ADD §7.1; `content_version integer NOT NULL`; `version integer NOT NULL DEFAULT 1`), **chỉ mục duy nhất** `UNIQUE (account_id, post_id, channel_connection_id) WHERE status <> 'cancelled'`, chỉ mục `(account_id, scheduled_at) WHERE status = 'scheduled'`, `(account_id, post_id)`, `(account_id, channel_connection_id, scheduled_at) WHERE status <> 'cancelled'`, RLS + quyền
- [X] T008 [P] Khai báo bảng Drizzle bằng `tenantTable`/`sharedTable` ở `apps/server/src/modules/content/internal/db/{posts,channel-variants,post-events,channel-rules}.table.ts` và đăng ký vào sổ đăng ký bảng như các module trước (xem `apps/server/src/modules/account/internal/db`)
- [X] T009 [P] Khai báo `apps/server/src/modules/publishing/internal/db/publish-attempts.table.ts` (`tenantTable`) và đăng ký vào sổ đăng ký bảng
- [X] T010 Đăng ký `content.post_events` là bảng chỉ thêm cho `pnpm db:immutable` (xem `apps/server/test/check-immutable.spec.ts`); chạy `pnpm db:setup`, `pnpm db:check` (→ 0 vi phạm), `pnpm db:lint-migrations`
- [X] T011 [P] Viết kiểm thử truy cập chéo `apps/server/test/db/content-isolation.db.spec.ts` (3 bảng tenant: A đọc/sửa/xóa dữ liệu B → thất bại; không có biến phiên → 0 dòng; `post_events` không UPDATE/DELETE được), `apps/server/test/db/publishing-attempts-isolation.db.spec.ts`, và thêm 4 bảng mới vào `apps/server/test/db/cross-tenant-coverage.db.spec.ts` / `access-path-inventory.db.spec.ts`

### Publishing: mục lịch đăng, việc nền, bộ thực thi tạm

- [X] T012 [P] Viết kiểm thử hợp đồng `PublishingPublicApi` dùng lại được cho 013 ở `apps/server/test/contracts/publishing/publishing-api.db.spec.ts`: `schedule` idempotent theo (bài, kênh) (gọi hai lần → một mục, một việc); `cancelByPost` hủy mọi mục `scheduled` + việc, có mục đã rời `scheduled` → `already_publishing` và **không đổi gì**; `reschedule` đổi `scheduled_at` + `runAfter` trong cùng `tx`; `schedule` quá `max_posts_per_24h` → `quota_exceeded`; hai tài khoản cùng loại kênh không ảnh hưởng nhau
- [X] T013 [P] Viết kiểm thử hàng chờ `apps/server/test/queue/publish-run-attempt.queue.spec.ts`: bộ xử lý `publishing.run_attempt` chạy lại hai lần cho cùng kết quả; mục `cancelled` bị bỏ qua; `PUBLISH_EXECUTOR=none` → hoãn 15 phút, mục vẫn `scheduled`, việc không mất; `PUBLISH_EXECUTOR=fake` → `scheduled → processing → succeeded` bằng cập nhật có điều kiện; payload có trường cấm (`text`, `content`…) bị từ chối
- [X] T014 Khai báo loại việc `publishing.run_attempt` ở `apps/server/src/modules/publishing/jobs.ts` bằng `defineJobType`: `queue: 'publish'`, `scope: 'tenant'`, `version: 1`, payload `z.strictObject({ attemptId: z.uuid() })`, `allowGenericRetry: false`, `dedupeKey` = `publish:{attemptId}`; đăng ký trong `publishing.module.ts` và xuất tên qua `index.ts`
- [X] T015 Viết `apps/server/src/modules/publishing/internal/attempts.repository.ts`: `INSERT … ON CONFLICT DO NOTHING` theo chỉ mục duy nhất; `pg_advisory_xact_lock(hashtext('publish_quota:'||connectionId))` lấy theo thứ tự `connectionId` tăng dần rồi đếm mục hiệu lực trong cửa sổ 24 giờ quanh `scheduled_at` với `channel_rules.max_posts_per_24h` (đọc qua `ContentPublicApi.channelRules()`); hủy `UPDATE … WHERE status = 'scheduled'`; đổi giờ cùng điều kiện
- [X] T016 Hiện thực `PublishingPublicApi` trong `apps/server/src/modules/publishing/public-api.ts` (+ `index.ts`): `schedule`, `cancelByPost` (kèm `cancelJob` cùng `tx`), `reschedule` (kèm `rescheduleJob` cùng `tx`, kiểm lại hạn mức ở giờ mới), `statusesByPosts` (trạng thái xấu nhất + từng kênh, không cache), `precheckChannels` (gọi `PLATFORM_GATEWAY.checkAccount` **ngoài** giao dịch; trả `inactive | needs_reconnect | unavailable` kèm `remedies`)
- [X] T017 Hiện thực bộ thực thi tạm `apps/server/src/modules/publishing/internal/executor.stub.ts` + bộ xử lý đăng ký ở Worker (research R10): `PUBLISH_EXECUTOR=fake` đi `scheduled → processing → succeeded|needs_user` qua bộ chuyển đổi giả lập 005; mặc định không đổi trạng thái và trả `RetryAfter` 15 phút; mục không còn `scheduled` → bỏ qua; ghi chú rõ 013 thay thân hàm, giữ nguyên tên loại việc/payload/`dedupeKey`

### Content và Approval: nền dùng chung

- [X] T018 [P] Viết `apps/server/test/unit/content/state-transitions.spec.ts`: bảng chuyển trạng thái (`draft → pending_review → approved`, `pending_review → draft` khi trả lại/rút lại, `approved → pending_review` khi sửa, `approved → draft` khi hủy lịch; `cancelled` có trong CHECK nhưng không thao tác 012 nào đưa bài vào) và chuyển có điều kiện theo `version` (lệch → `conflict`, sai trạng thái → `wrong_state`)
- [X] T019 Viết `apps/server/src/modules/content/internal/posts.repository.ts`: đọc/ghi bài có `deleted_at IS NULL`, `loadForUpdate`, cập nhật có điều kiện `WHERE version = :expected AND status = ANY(:from)` mọi cập nhật `version = version + 1`, ghi `post_events` cùng `tx` (khuôn `data` theo `type`: `{ fromVersion, toVersion, note?, fromAt?, toAt?, submissionId? }`, **không nội dung bài**)
- [X] T020 [P] Viết kiểm tra theo kênh ở `apps/server/src/modules/content/internal/validation/` (một tệp mỗi quy tắc `text_length`, `hashtags`, `media_required`, `media_rule`, `channel_inactive`): đọc `channelRules()` (cache trong tiến trình 5 phút) + `platformGateway.mediaRules/validateMedia`; trả `issues[{ rule, messageVi, remedies[{ action, labelVi }] }]`; kết quả **không lưu**, tính khi đọc/duyệt; cổng `MEDIA_DESCRIBER` tùy chọn – thiếu thì kênh bắt buộc media báo "chưa thể lên lịch" (FR-007)
- [X] T021 Hiện thực phần dùng chung của `ContentPublicApi` ở `apps/server/src/modules/content/public-api.ts`: `getPost`, `loadForUpdate`, `validateForScheduling(tx, post, at)` → `{ ok } | { ok:false, channelIssues[], contentIssues[] }`, `transition(tx, input)` → `ok | conflict | wrong_state | not_found`, `channelRules()`
- [X] T022 Dựng `apps/server/src/modules/approval/internal/approval.service.ts` (khung): hàm trợ giúp mở một `tenantTx` mỗi bài, `precheck` ngoài giao dịch (gói còn hạn qua `AccountPublicApi`, `publishing.precheckChannels` một lần mỗi kênh cho cả lô), ánh xạ kết quả `kind` → mã lỗi, ghi `infra.audit_log` (`post.submit|withdraw|approve|return|unschedule|reschedule|edit_after_approval|delete_draft`, metadata `{ postId, fromVersion, toVersion, submissionId?, count? }`) và phát thông báo bằng `NOTIFICATIONS.emit(tx, …)`; `bulk.ts` chạy N giao dịch độc lập, trả `BulkResult`
- [X] T023 Đăng ký `ContentModule`, `PublishingModule`, `ApprovalModule` (providers, controllers) ở `apps/server/src/modules/{content,publishing,approval}/*.module.ts` và `index.ts`; chạy `pnpm check:boundaries` → xanh

**Checkpoint**: `pnpm db:check`, `pnpm check:boundaries`, T011–T013 xanh → bắt đầu các câu chuyện.

---

## Phase 3: User Story 1 - Soạn bài tay với nội dung riêng cho từng kênh (Priority: P1) 🎯 MVP

**Goal**: tạo bài nháp nhiều kênh, nội dung chung + bản riêng từng kênh, kiểm tra giới hạn kênh, lưu nháp, mở lại sửa tiếp.

**Independent Test** (quickstart A): tài khoản có 2 kênh giả lập tạo bài chọn cả hai kênh, nội dung riêng từng kênh, lưu nháp, mở lại → nội dung còn nguyên, `status = draft`; Instagram thiếu media → `issues` có `media_required` nhưng vẫn lưu được; tài khoản B `GET` cùng id → 404.

### Tests for User Story 1 ⚠️ viết trước, phải đỏ

- [X] T024 [P] [US1] Kiểm thử đơn vị quy tắc kiểm tra kênh `apps/server/test/unit/content/validation.spec.ts`: vượt `max_text_length`, vượt `max_hashtags`, thiếu media khi `media_required`, kênh không hoạt động, bài rỗng (chỉ khoảng trắng) không lưu được, emoji/xuống dòng không bị cắt âm thầm
- [X] T025 [P] [US1] Kiểm thử e2e `apps/server/test/e2e/posts-compose.e2e.spec.ts` (`PLATFORM_DRIVER=fake`): `POST /posts` 201 `version = 1`; `NO_ACTIVE_CHANNEL` 409 khi chưa có kênh; `GET /posts/:id` trả `validation[]`; `PUT /posts/:id` bài Nháp đúng `expectedVersion`, lệch → `VERSION_CONFLICT` kèm bài mới; tab chưa `customized` lấy `sharedText`, sửa riêng rồi đổi `sharedText` không ghi đè bản riêng; bài Nháp `POST_CONTENT_INVALID` khi gửi duyệt/duyệt nhưng lưu được; `GET /channel-rules`
- [X] T026 [P] [US1] Kiểm thử truy cập chéo mức API `apps/server/test/e2e/posts-cross-account.e2e.spec.ts`: A đọc/sửa/xóa bài của B → 404 `NOT_FOUND` (không phân biệt "không tồn tại"); không điểm cuối nào nhận `accountId`; mọi điểm cuối có `@CustomerAccess(quyền)` (thiếu → `ACCESS_NOT_DECLARED`)
- [X] T027 [P] [US1] Kiểm thử "AI khóa không cản" `apps/server/test/e2e/posts-ai-locked.e2e.spec.ts`: đặt ngân sách AI hết → soạn/lưu/xem trước vẫn chạy; xác nhận không có lời gọi Cổng AI nào trong luồng (SC-011, FR-005)

### Implementation for User Story 1 — Máy chủ

- [X] T028 [P] [US1] Khuôn Zod dùng chung ở `packages/shared/src/modules/content/post.ts`: `CreatePostSchema`, `UpdatePostSchema`, `VariantInput` (`customized`, `text`, `hashtags[]`, `media[]`), `PostSchema`, `PostSummarySchema`, `ChannelRuleSchema`; ràng buộc **khớp CSDL**: `internalName ≤ 80`, `sharedText ≤ 63206`, hashtag không khoảng trắng ≤ 100 ký tự và ≤ 30 phần tử, `media ≤ 20` phần tử `{ mediaId: uuid, kind: 'image'|'video' }`
- [X] T029 [US1] `ContentPublicApi.createDraft(tx, input)` và `saveContent(tx, input)` (nhánh Nháp: cập nhật bài + thêm/bớt/sửa `channel_variants`, so khớp nội dung để biết `contentChanged`, ghi `post_events` `created`/`channels_changed`; `source` luôn `manual`; chỉ nhận kết nối **đang hoạt động** qua `platform_gateway`; bài phải có ≥ 1 kênh hoặc có chữ) trong `apps/server/src/modules/content/internal/posts.repository.ts` và `public-api.ts`
- [X] T030 [US1] `apps/server/src/modules/content/internal/posts.controller.ts`: `POST /posts` (`post.edit`), `GET /posts/:id` (`status.view`, trả `Post` + `validation[]` + `attempts[]` từ `publishing.statusesByPosts`), `GET /channel-rules` (`status.view`); lỗi theo `ErrorResponse` chuẩn tiếng Việt
- [X] T031 [US1] Đường `PUT /posts/:id` ở `apps/server/src/modules/approval/internal/approval.controller.ts` → `approval.savePost` nhánh `draft` (nhánh `pending_review`/`approved` làm ở US4/US6): cập nhật có điều kiện theo `expectedVersion`, thân lỗi `VERSION_CONFLICT` kèm bài mới nhất

### Implementation for User Story 1 — Web *(cần 011 đã merge; danh sách kênh thật cần 010)*

- [X] T032 [P] [US1] Kiểm thử web `apps/web/test/posts/ComposePage.spec.tsx` (Testing Library + `vitest-axe`): tab theo kênh, nội dung chung → bản riêng, cảnh báo chữ + biểu tượng, chặn rời trang khi chưa lưu, hướng dẫn "Kết nối kênh để bắt đầu" khi chưa có kênh, nhãn "Kênh cần kết nối lại" khi kênh hỏng (nội dung kênh vẫn giữ), dùng được ở 360 px, vùng chạm ≥ 44 px
- [X] T033 [P] [US1] Khung dữ liệu + API ở `apps/web/src/features/posts/api.ts` và `apps/web/src/features/posts/queries.ts` (dùng nền quản lý dữ liệu/biểu mẫu/khóa phiên bản của 011)
- [X] T034 [US1] Trang Soạn / xem bài `apps/web/src/features/posts/ComposePage.tsx`: chọn kênh, tab theo kênh, ô nội dung chung + cờ `customized`, hashtag, vùng đính media (hiện sẵn, hoạt động đầy đủ khi có thư viện), cảnh báo giới hạn bằng chữ + biểu tượng, nút "Lưu nháp", chặn mất dữ liệu (011 FR-017), khóa phiên bản (011 FR-018), chỉ-xem theo quyền (011 FR-019)
- [X] T035 [P] [US1] Thành phần xem trước theo kênh `apps/web/src/features/posts/ChannelPreview.tsx` (thuần hiển thị theo `channelType`: đoạn văn, hashtag, ô media; không gọi nền tảng)
- [X] T036 [US1] Đăng ký tuyến "Thêm bài" / `/posts/new` / `/posts/:id` ở `apps/web/src/app/router.tsx` và mục điều hướng; trạng thái `draft` dùng bảng quy đổi trạng thái của 011

**Checkpoint**: US1 chạy độc lập – soạn và lưu nháp (MVP phần soạn).

---

## Phase 4: User Story 2 - Chủ tài khoản duyệt bài và lên lịch trong một thao tác (Priority: P1)

**Goal**: duyệt một bài (Nháp hoặc Chờ duyệt) → `approved` + đúng một mục lịch đăng và một việc cho mỗi kênh, trong một giao dịch; tất cả hoặc không; idempotent.

**Independent Test** (quickstart B, C): duyệt bài hai kênh → hai mục `scheduled` + hai việc `publish`; gọi lại 20 lần song song → 1 thành công, còn lại `POST_ALREADY_APPROVED`, vẫn đúng 2 mục/2 việc; giờ `now+2'` → `TIME_IN_PAST` kèm `suggestedAt`; một kênh `expired` → `CHANNEL_INACTIVE` và **không** mục nào được tạo; cộng tác viên gọi `approve` → 403.

### Tests for User Story 2 ⚠️ viết trước, phải đỏ

- [X] T037 [P] [US2] `apps/server/test/db/approve-concurrency.db.spec.ts`: 20 yêu cầu `approve` cùng lúc cho một bài → đúng 1 thành công, đúng một mục mỗi kênh, đúng một việc mỗi mục; hai tài khoản cùng loại kênh không ảnh hưởng nhau; duyệt trên `expectedVersion` cũ → `VERSION_CONFLICT`, không duyệt nhầm bản (SC-003)
- [X] T038 [P] [US2] `apps/server/test/db/approve-atomicity.db.spec.ts`: lỗi giả lập ném **sau** `publishing.schedule` → không bài `approved`, không mục, không việc, không sự kiện, không thông báo; một kênh lỗi → **cả bài** không duyệt, 0 mục cho mọi kênh (tất cả hoặc không)
- [X] T039 [P] [US2] `apps/server/test/db/instagram-quota.db.spec.ts`: hai bài khác nhau duyệt đồng thời vượt `max_posts_per_24h` → số mục hiệu lực không quá hạn mức, bài thứ hai `CHANNEL_QUOTA_EXCEEDED` (kèm "Chọn giờ khác" / "Bỏ kênh này khỏi bài")
- [X] T040 [P] [US2] `apps/server/test/e2e/posts-approve.e2e.spec.ts`: 403 cho cộng tác viên (`post.approve`); `PLAN_EXPIRED` 403 khi gói hết hạn; `TIME_IN_PAST` đúng ranh giới (đúng 5 phút chấp nhận, dưới 5 phút từ chối); `POST_CONTENT_INVALID` kèm `channelIssues[]`; bài soạn tay duyệt được khi hạn mức 100 bài AI đã hết (FR-032); khóa AI không cản duyệt (SC-011)
- [X] T041 [P] [US2] `apps/server/test/unit/approval/suggest-times.spec.ts`: giờ gợi ý ≥ now()+5 phút, nằm trong `POST_SUGGEST_HOURS` (UTC+7), `count` giờ **khác nhau**, tránh trùng giờ đã có; sát nửa đêm UTC+7 cho đúng ngày

### Implementation for User Story 2 — Máy chủ

- [X] T042 [US2] `apps/server/src/modules/approval/internal/suggest-times.ts` + `ApprovalPublicApi.suggestTimes(count, after?)` (đọc `POST_SUGGEST_HOURS`, khung "giờ vàng" UTC+7, trả `count` giờ khác nhau; `count ≤ 100`)
- [X] T043 [US2] `ApprovalPublicApi.approve(postId, expectedVersion, scheduledAt)` trong `apps/server/src/modules/approval/internal/approval.service.ts` theo contracts/module-api.md mục 3: (1) **trước tx** quyền `post.approve` (guard), gói còn hạn, `publishing.precheckChannels`; (2) **trong một `tenantTx`** `content.loadForUpdate` → `validateForScheduling` → giờ ≥ now()+`POST_MIN_LEAD_MINUTES` (lỗi `TIME_IN_PAST` kèm `suggestedAt`) → `content.transition(draft|pending_review → approved)` (đặt `approved_by`, `approved_at`, `scheduled_at`, xóa nhãn trả lại) → `publishing.schedule` → `audit_log`; lỗi bất kỳ → hoàn tác cả bài; gom mọi vướng mắc theo kênh thành **một** phản hồi `channelIssues[{ connectionId, code, remedies }]`
- [X] T044 [US2] `POST /posts/:id/approve` (`post.approve`) ở `approval.controller.ts`: `{ expectedVersion, scheduledAt }`; gọi lặp trên bài đã duyệt cùng phiên bản → `POST_ALREADY_APPROVED`, không tạo mục/việc/thông báo thứ hai; `POST /approvals/suggest-times` (`post.approve` hoặc `post.edit`)
- [X] T045 [P] [US2] Khuôn Zod `packages/shared/src/modules/approval/approve.ts`: `ApproveBodySchema`, `ChannelIssueSchema`, `BulkResultSchema`, `SuggestTimesSchema` (≤ 100)

### Implementation for User Story 2 — Web *(cần 011)*

- [X] T046 [P] [US2] Kiểm thử web `apps/web/test/posts/ApprovePanel.spec.tsx`: nút "Duyệt và lên lịch" chỉ hiện cho chủ; hộp chọn giờ điền sẵn giờ gợi ý; lỗi hiện đủ mọi kênh vướng cùng lúc với "Kết nối lại" / "Chọn giờ khác" / "Bỏ kênh này khỏi bài"; "Bài này đã được duyệt" khi bấm đúp; trạng thái, người duyệt, thời điểm sau khi duyệt
- [X] T047 [US2] `apps/web/src/features/posts/ApprovePanel.tsx` và `SchedulePicker.tsx` (UTC+7 ↔ UTC), tích hợp vào `ComposePage.tsx`; chặn bấm đúp; hiện nhãn "Đã lên lịch", giờ đăng, người duyệt, thời điểm duyệt

**Checkpoint**: US1 + US2 – soạn → duyệt → có mục lịch đăng (đầu–cuối máy chủ với bản giả lập).

---

## Phase 5: User Story 3 - Chờ duyệt: duyệt nhanh, duyệt nhiều bài, trả lại kèm ghi chú (Priority: P1)

**Goal**: cộng tác viên gửi duyệt; chủ thấy danh sách Chờ duyệt, duyệt từng bài/nhiều bài (mỗi bài độc lập), trả lại kèm ghi chú bắt buộc; một thông báo + một email cho mỗi lần gửi nhiều bài.

**Independent Test** (quickstart D): `minh` gửi 3 bài → một email, một thông báo cho chủ; chủ `GET /approvals/pending` → 3 bài theo giờ gần nhất, bài giờ đã qua có `timePassed = true`; `approve-batch` 2 bài hợp lệ + 1 bài giờ quá khứ → `approved: 2, failed: 1 (TIME_IN_PAST)`; `return` bài còn lại với ghi chú → `minh` thấy `returnedNote`, có thông báo in-app, **không** email.

### Tests for User Story 3 ⚠️ viết trước, phải đỏ

- [X] T048 [P] [US3] `apps/server/test/e2e/approvals-pending.e2e.spec.ts`: `GET /approvals/pending` (chỉ chủ, sắp theo `scheduledAt` gần nhất, `timePassed`, `returned`, `editedAfterApproval`, phân trang), `GET /approvals/pending/count`, cộng tác viên → 403
- [X] T049 [P] [US3] `apps/server/test/e2e/approvals-bulk.e2e.spec.ts`: `approve-batch` mỗi bài một giao dịch độc lập, một bài lỗi không ảnh hưởng bài khác (**0** ảnh hưởng chéo, SC-006); 101 bài → `BULK_LIMIT_EXCEEDED`; "Dời tất cả bài quá giờ về giờ gợi ý" mỗi bài nhận giờ khác nhau, không tự dời khi chưa xác nhận; hạn 50 bài ≤ 10 giây (SC-006); `return-batch` ghi chú chung; ghi chú rỗng hoặc > 500 → `RETURN_NOTE_REQUIRED`
- [X] T050 [P] [US3] `apps/server/test/e2e/approvals-notifications.e2e.spec.ts` (`MAIL_TRANSPORT=memory`): gửi duyệt 3 bài một lần → đúng **một** thông báo + **một** email (`post_pending_review`, `postIds ≤ 50`, khóa chống trùng từ `submissionId`); `post_returned` in-app, **không** email, `authorUserId = submitted_by`; gửi lại không tạo bản sao; thông báo ghi hàng chờ cùng giao dịch (hoàn tác khi lỗi)
- [X] T051 [P] [US3] `apps/server/test/db/approvals-isolation.db.spec.ts`: A thử `approve`, `return`, `approve-batch`, `pending` trên bài của B → 404/rỗng, 0 rò rỉ (SC-009)

### Implementation for User Story 3 — Máy chủ

- [X] T052 [US3] `ContentPublicApi.listPendingReview(page)` + `countPendingReview()` ở `apps/server/src/modules/content/internal/posts.repository.ts` (chỉ mục `(account_id, status, scheduled_at)`, tính `timePassed` khi đọc; người soạn dựng bằng `AccountPublicApi.describeMembers`, kể cả "Cộng tác viên đã gỡ")
- [X] T053 [US3] `ApprovalPublicApi.submit({ items })` trong `approval.service.ts` (`draft → pending_review`, đặt `submitted_by/at`, một `submissionId` cho cả lần gửi, phát **một** `post_pending_review` với `refs { submissionId, postIds ≤ POST_BULK_SUBMIT_LIMIT, authorUserId }` qua `NOTIFICATIONS.emit(tx, …)`; chia nhóm 50 nếu nhiều hơn — research R8) và `POST /posts/submit` (`post.edit`)
- [X] T054 [US3] `ApprovalPublicApi.approveBatch` và `bulk.ts` (N giao dịch độc lập ≤ `POST_BULK_APPROVE_LIMIT`, mỗi bài kết quả `ok|failed` + `ErrorBody`); `POST /approvals/approve-batch`
- [X] T055 [US3] `ApprovalPublicApi.returnPost` / `returnBatch` (`pending_review|approved → draft`, `returned_note` 1–500 ký tự, `returned_by/at`; bài `approved` thì `publishing.cancelByPost` cùng `tx`; thông báo `post_returned` mỗi bài; audit `post.return`) và `POST /posts/:id/return`, `POST /approvals/return-batch`
- [X] T056 [US3] `GET /approvals/pending`, `GET /approvals/pending/count` (`post.approve`) ở `approval.controller.ts`; khuôn Zod `PendingItemSchema` ở `packages/shared/src/modules/approval/pending.ts`

### Implementation for User Story 3 — Web *(cần 011)*

- [X] T057 [P] [US3] Kiểm thử web `apps/web/test/approvals/PendingPage.spec.tsx`: danh sách (tiêu đề/đoạn đầu, biểu tượng kênh, người soạn, giờ dự kiến, nhãn "Đã sửa sau khi duyệt"/"Bị trả lại"/"Giờ đã qua"), chọn nhiều + "Chọn tất cả", kết quả "Đã duyệt N bài, M bài chưa duyệt được" kèm cách xử lý từng bài, ghi chú trả lại bắt buộc, tự chuyển bài kế tiếp, trạng thái rỗng "Không có bài chờ duyệt", 360 px, vùng chạm ≥ 44 px, `vitest-axe`
- [X] T058 [US3] `apps/web/src/features/approvals/PendingPage.tsx` (+ `PendingList.tsx`, `ReviewDrawer.tsx` xem trước theo kênh, `ReturnDialog.tsx`, `BulkResultPanel.tsx`, ô "Dời tất cả bài quá giờ về giờ gợi ý"); duyệt xong tự chuyển bài kế tiếp; bài đổi sau khi mở → "Bài vừa được cập nhật, vui lòng xem lại" kèm nội dung mới
- [ ] T059 [US3] Mục điều hướng "Chờ duyệt" chỉ cho chủ + số bài chờ (`GET /approvals/pending/count`, làm mới theo quy tắc 011) ở `apps/web/src/app/router.tsx`; cộng tác viên truy cập trực tiếp bị từ chối

**Checkpoint**: US1–US3 – luồng cốt lõi soạn → gửi duyệt → duyệt/trả lại (MVP đầy đủ phía nghiệp vụ).

---

## Phase 6: User Story 4 - Cộng tác viên gửi duyệt, rút lại, nhận lại bài bị trả (Priority: P2)

**Goal**: cộng tác viên gửi duyệt, rút lại, sửa lại bài bị trả rồi gửi lại; bài đang Chờ duyệt không sửa được; lịch sử bài đầy đủ.

**Independent Test**: `minh` gửi → chủ trả kèm ghi chú → `minh` thấy ghi chú, sửa, gửi lại → lịch sử có đủ 3 sự kiện (`submitted`, `returned`, `submitted`) kèm người và thời điểm UTC+7; chủ tự soạn duyệt thẳng từ Nháp không cần gửi duyệt.

### Tests for User Story 4 ⚠️ viết trước, phải đỏ

- [X] T060 [P] [US4] `apps/server/test/e2e/posts-collaborator.e2e.spec.ts`: cộng tác viên `savePost` bài `pending_review` → `POST_NOT_EDITABLE`; `withdraw` chỉ người gửi duyệt (kiểm theo `submitted_by`) → bài về Nháp; `approve`/`return`/`unschedule` → 403 (SC-009); gửi lại bài bị trả xóa nhãn "Bị trả lại" nhưng giữ ghi chú cũ trong lịch sử; chủ duyệt thẳng từ Nháp
- [X] T061 [P] [US4] `apps/server/test/e2e/posts-history.e2e.spec.ts`: `GET /posts/:id/history` trả `{ events[] }` theo thứ tự, mỗi sự kiện có `type`, người (`actorDisplayName` kể cả "Cộng tác viên đã gỡ"), `at`, `data` (ghi chú trả lại được phép; **không** nội dung bài)

### Implementation for User Story 4 — Máy chủ

- [X] T062 [US4] `ApprovalPublicApi.withdraw` + `POST /posts/:id/withdraw` (`post.edit` + là người gửi): `pending_review → draft`, sự kiện `withdrawn`, audit `post.withdraw`
- [X] T063 [US4] Mở rộng `approval.savePost` nhánh `pending_review`: cộng tác viên → `POST_NOT_EDITABLE`; chủ lưu giữ nguyên trạng thái (research R7); gửi lại bài `draft` có nhãn trả lại xóa `returned_note` khỏi bài (sự kiện cũ vẫn trong lịch sử)
- [X] T064 [US4] `GET /posts/:id/history` (`status.view`) ở `apps/server/src/modules/content/internal/posts.controller.ts`; dựng tên người qua `AccountPublicApi.describeMembers`; khuôn Zod `PostEventSchema` ở `packages/shared/src/modules/content/post-event.ts`

### Implementation for User Story 4 — Web *(cần 011)*

- [X] T065 [P] [US4] Kiểm thử web `apps/web/test/posts/CollaboratorFlow.spec.tsx`: cộng tác viên thấy "Gửi duyệt", không thấy "Duyệt"; chủ thấy "Duyệt và lên lịch"; nhãn + ghi chú "Bị trả lại" ở đầu màn hình soạn (người trả, thời điểm); bài đang Chờ duyệt chỉ-xem + nút "Rút lại"; tab "Lịch sử" đúng thứ tự, giờ UTC+7
- [ ] T066 [US4] `apps/web/src/features/posts/SubmitButton.tsx`, `ReturnedBanner.tsx`, `HistoryTab.tsx`, `WithdrawButton.tsx` và ghép vào `ComposePage.tsx` theo quyền (FR-025)

**Checkpoint**: vòng cộng tác (F3) trọn vẹn.

---

## Phase 7: User Story 5 - Lịch tuần/tháng và kéo thả đổi giờ (Priority: P2)

**Goal**: Lịch đọc bài theo khoảng giờ + trạng thái đăng; đổi giờ bài đã lên lịch (không cần duyệt lại), chỉ khi mọi mục còn `scheduled`.

**Independent Test** (quickstart F): `GET /calendar?from&to` đúng bài đúng giờ UTC; `PUT /posts/:id/schedule` ngày mai → thành công, `status` vẫn `approved`, việc đổi `runAfter`; giờ quá khứ → `TIME_IN_PAST`; `minh` đổi giờ → chủ nhận `approved_post_rescheduled` (in-app); hai yêu cầu cùng `expectedVersion` → một thành công, một `VERSION_CONFLICT`.

### Tests for User Story 5 ⚠️ viết trước, phải đỏ

- [X] T067 [P] [US5] `apps/server/test/e2e/calendar.e2e.spec.ts`: `GET /calendar` khoảng ≤ 42 ngày (vượt → `VALIDATION_FAILED`), `[from, to)` UTC, mọi trạng thái trừ xóa mềm, chỉ trường thẻ + `attemptStatus` từ `publishing.statusesByPosts`, `movable`/`movableReason`; truy cập chéo → 0 bài của tài khoản khác; 200 bài ≤ 2 giây (SC-008)
- [X] T068 [P] [US5] `apps/server/test/e2e/posts-reschedule.e2e.spec.ts`: đổi giờ giữ `approved`; mục đã rời `scheduled` → `CHANNEL_ALREADY_PUBLISHING`, hoàn tác không đổi gì; giờ < now()+5' → `TIME_IN_PAST`; vượt hạn mức ở giờ mới → `CHANNEL_QUOTA_EXCEEDED` và hoàn tác; cộng tác viên đổi giờ → `approved_post_rescheduled` cho chủ, chủ tự đổi thì không thông báo; bài chưa duyệt chỉ đặt giờ dự kiến; sự kiện `rescheduled` ghi `fromAt/toAt`
- [X] T069 [P] [US5] Kiểm thử đồng thời đổi giờ trong `apps/server/test/db/reschedule-concurrency.db.spec.ts`: hai yêu cầu cùng `expectedVersion` → một thành công, một `VERSION_CONFLICT` kèm giờ mới nhất; đổi giờ vs Worker vừa nhận việc → đổi giờ bị từ chối, không ghi đè

### Implementation for User Story 5 — Máy chủ

- [X] T070 [US5] `ContentPublicApi.calendar({ from, to })` (chỉ mục `(account_id, scheduled_at) WHERE deleted_at IS NULL AND scheduled_at IS NOT NULL`) + `GET /calendar` (`status.view`) ở `apps/server/src/modules/content/internal/calendar.controller.ts`; ghép `attemptStatus` từ `publishing.statusesByPosts` (không cache); khuôn Zod `CalendarItemSchema` ở `packages/shared/src/modules/content/calendar.ts`
- [X] T071 [US5] `ApprovalPublicApi.reschedule(postId, expectedVersion, scheduledAt)` + `PUT /posts/:id/schedule` (`post.reschedule`): bài `approved` → `publishing.reschedule` cùng `tx` + `content.transition` (giữ trạng thái, `version+1`) + sự kiện + audit `post.reschedule`; bài chưa duyệt chỉ đặt `scheduled_at`; phát `approved_post_rescheduled` khi người đổi là cộng tác viên (`refs { postId, postVersion, byUserId }`)

### Implementation for User Story 5 — Web *(cần 011)*

- [X] T072 [P] [US5] Kiểm thử web `apps/web/test/calendar/CalendarPage.spec.tsx`: chế độ tuần/tháng, "Hôm nay", chuyển tuần/tháng, "+N bài nữa" mở danh sách đầy đủ trong ngày, ngày trống có "Thêm bài" đã điền sẵn ngày (ngày đã qua không cho), thẻ không kéo được có giải thích ngắn, hoàn tác thẻ khi bị từ chối, dưới 768 px hiện danh sách theo ngày + nút "Đổi giờ", `vitest-axe`, thao tác bàn phím đổi giờ không cần kéo thả
- [X] T073 [US5] `apps/web/src/features/calendar/CalendarPage.tsx` với `WeekView.tsx`, `MonthView.tsx`, `DayList.tsx` (điện thoại), `PostCard.tsx` (tiêu đề ngắn, giờ UTC+7, biểu tượng kênh, trạng thái chữ + biểu tượng); ranh giới ngày tính theo UTC+7 ở **web** rồi gửi `from/to` UTC
- [X] T074 [US5] Kéo thả bằng sự kiện gốc HTML5 + trợ giúp con trỏ cảm ứng ở `apps/web/src/features/calendar/useDragReschedule.ts` và nút "Đổi giờ" (`RescheduleDialog.tsx`) làm đường chính cho điện thoại/bàn phím; thả → `PUT /posts/:id/schedule`, hoàn tác thẻ + giải thích khi lỗi, `VERSION_CONFLICT` hiện giờ mới nhất; đổi giờ hiện ≤ 2 giây (SC-005)
- [X] T075 [US5] Mục điều hướng "Lịch" cho chủ và cộng tác viên + nút "Thêm bài" ở ngày trống mở `ComposePage` với ngày điền sẵn ở `apps/web/src/app/router.tsx`

**Checkpoint**: Lịch hoạt động; đổi giờ không cần duyệt lại.

---

## Phase 8: User Story 6 - Sửa bài đã duyệt: tự về Chờ duyệt, hủy lịch (Priority: P2)

**Goal**: sửa nội dung bài đã duyệt → về Chờ duyệt, hủy mục + việc cùng giao dịch, báo chủ; "Hủy lịch" đưa bài về Nháp.

**Independent Test** (quickstart E): bài hai kênh đã lên lịch; `minh` sửa một chữ ở Facebook → `pending_review` + `editedAfterApproval`, mọi mục `cancelled`, việc `publish` bị hủy, chủ nhận `post_pending_review`; chủ duyệt lại → mục mới `scheduled`, không còn mục cũ hiệu lực; lặp với đổi hashtag/media/thêm kênh/bớt kênh.

### Tests for User Story 6 ⚠️ viết trước, phải đỏ

- [X] T076 [P] [US6] `apps/server/test/e2e/posts-edit-after-approval.e2e.spec.ts`: với **mỗi** kiểu sửa (chữ, hashtag, media, thêm kênh, bớt kênh) bài về Chờ duyệt, mục `cancelled`, việc bị hủy, **không đăng nội dung cũ** (SC-004); chủ tự sửa cũng về Chờ duyệt (không ngoại lệ); chỉ đổi giờ **không** về Chờ duyệt (đi đường `reschedule`); gửi cả nội dung và giờ cùng lúc → `VALIDATION_FAILED`
- [X] T077 [P] [US6] `apps/server/test/db/edit-after-approval-atomicity.db.spec.ts`: lỗi sau `publishing.cancelByPost` → hoàn tác trọn gói (bài vẫn `approved`, mục/việc/sự kiện/thông báo không đổi); có mục đã `processing/succeeded` → `CHANNEL_ALREADY_PUBLISHING`, kênh đó không sửa được còn phần chưa đăng theo FR-021
- [X] T078 [P] [US6] `apps/server/test/e2e/posts-unschedule.e2e.spec.ts`: `POST /posts/:id/unschedule` (chỉ chủ) → mục chờ giờ `cancelled`, bài về `draft`, nội dung không mất; bài đã bắt đầu đăng → `CHANNEL_ALREADY_PUBLISHING`; gọi lặp → `POST_ALREADY_APPROVED`/kết quả tương đương, không tác dụng phụ

### Implementation for User Story 6 — Máy chủ

- [X] T079 [US6] `ContentPublicApi.applyEdit` + nhánh `approved` của `approval.savePost` (research R7): một `tenantTx` đọc bài → so khớp nội dung (băm tiền tố cố định tính ở `content`: chữ, hashtag, danh sách media, tập kênh) → đặt `pending_review` + `edited_after_approval = true` + `version+1` → `publishing.cancelByPost(tx, postId)` (hủy mục + việc) → sự kiện `edited_after_approval` → phát `post_pending_review` (`submissionId` mới) → audit `post.edit_after_approval`; `cancelByPost` trả `already_publishing` → hoàn tác + `CHANNEL_ALREADY_PUBLISHING`
- [X] T080 [US6] `ApprovalPublicApi.unschedule` + `POST /posts/:id/unschedule` (`post.approve`): `approved → draft`, `publishing.cancelByPost`, sự kiện `unscheduled`, audit `post.unschedule`

### Implementation for User Story 6 — Web *(cần 011)*

- [X] T081 [P] [US6] Kiểm thử web `apps/web/test/posts/EditAfterApproval.spec.tsx`: cảnh báo trước khi lưu bài đã duyệt ("bài sẽ về Chờ duyệt, lịch đăng cũ bị hủy"), nhãn "Chờ duyệt – Đã sửa sau khi duyệt", kênh đã đăng/đang đăng khóa kèm giải thích, nút "Hủy lịch" có hộp xác nhận chỉ cho chủ
- [X] T082 [US6] `apps/web/src/features/posts/EditAfterApprovalNotice.tsx`, `UnscheduleDialog.tsx` và ghép vào `ComposePage.tsx`; bảng quy đổi trạng thái bổ sung khóa `draft`, `pending_review`, `approved`, nhãn `returned`, `edited_after_approval`, `time_passed` vào nền trạng thái của 011

**Checkpoint**: vòng đời đầy đủ; nội dung đã duyệt là nội dung được đăng.

---

## Phase 9: User Story 7 - Danh sách Bài viết để tìm và mở lại bài (Priority: P3)

**Goal**: một chỗ thấy mọi bài, lọc theo trạng thái, tìm theo từ khóa, xóa mềm bài Nháp.

**Independent Test**: tạo bài ở 4 trạng thái → bộ lọc trả đúng tập; xóa một Nháp → biến khỏi danh sách; cộng tác viên thấy bài của cả nhóm nhưng không có thao tác duyệt.

### Tests for User Story 7 ⚠️ viết trước, phải đỏ

- [X] T083 [P] [US7] `apps/server/test/e2e/posts-list.e2e.spec.ts`: `GET /posts` lọc `status`, tìm `q` (`ILIKE` trên `shared_text` + `internal_name`, ký tự `%`/`_` được thoát), phân trang theo con trỏ `(created_at, id)`, `limit ≤ 50`; `DELETE /posts/:id` chỉ Nháp (người tạo hoặc chủ) → 204 xóa mềm; bài khác Nháp → `POST_NOT_EDITABLE`; bài đã xóa mềm không còn ở danh sách/Lịch/Chờ duyệt (FR-033); `expectedVersion` lệch → `VERSION_CONFLICT`

### Implementation for User Story 7 — Máy chủ

- [X] T084 [US7] `GET /posts` (`status.view`) và `DELETE /posts/:id` (`post.edit`, `?expectedVersion`) ở `posts.controller.ts`; `ContentPublicApi.deleteDraft(tx, id, expectedVersion)` đặt `deleted_at`, ghi audit `post.delete_draft`; bảo đảm việc dọn hằng ngày sẵn có xóa hẳn sau 30 ngày (nằm trong phạm vi xóa tài khoản, FR-033)

### Implementation for User Story 7 — Web *(cần 011)*

- [X] T085 [P] [US7] Kiểm thử web `apps/web/test/posts/PostsListPage.spec.tsx`: bộ lọc trạng thái (chữ + biểu tượng; ẩn "Đã hủy" khi không có bài), tìm từ khóa, cuộn tải thêm, xóa Nháp có xác nhận, trạng thái rỗng "Chưa có bài nào" kèm "Thêm bài"
- [X] T086 [US7] `apps/web/src/features/posts/PostsListPage.tsx` + mục điều hướng "Bài viết" ở `apps/web/src/app/router.tsx`

**Checkpoint**: cả 7 câu chuyện hoạt động.

---

## Phase 10: Polish & Cross-Cutting

**Purpose**: bảo đảm hiến pháp, hiệu năng, tài liệu.

- [X] T087 [P] Kiểm thử phủ kiểm toán `apps/server/test/e2e/posts-audit-coverage.e2e.spec.ts`: mọi thao tác `post.submit|withdraw|approve|return|unschedule|reschedule|edit_after_approval|delete_draft` ghi `infra.audit_log` có `trace_id`, `metadata` chỉ mã (không `text`, `sharedText`, `hashtags`)
- [X] T088 [P] Ma trận truy cập `apps/server/test/e2e/posts-access-matrix.e2e.spec.ts`: chủ / cộng tác viên / không đăng nhập / tài khoản khác × toàn bộ ~26 điểm cuối (contracts/http-api.md); thiếu `@CustomerAccess` → `ACCESS_NOT_DECLARED`
- [X] T089 [P] Quét nội dung rò rỉ: nội dung bài không xuất hiện trong nhật ký kỹ thuật, dữ liệu việc `publish`, tham số thông báo (`postTitle ≤ 60`); không số tiền ở phản hồi nào — bổ sung vào `apps/server/test/db/secrets-in-logs.db.spec.ts`
- [X] T090 Đo hiệu năng (SC-006/SC-008): duyệt 1 bài ≤ 300 ms, duyệt 50 bài ≤ 10 giây, Lịch tháng 200 bài và Chờ duyệt 100 bài ≤ 2 giây; thêm vào `apps/server/test/db/performance.db.spec.ts`
- [X] T091 Cập nhật `.specify/memory/architecture.md` lên v1.6: mục 4 (bảng `content.posts`, `channel_variants`, `post_events`, `channel_rules`, `publishing.publish_attempts`), mục 11 (thuật ngữ research R12), mục sơ đồ module (`content → platform_gateway`); đồng bộ `TaiLieuDacTa/` nếu có đường dẫn nhắc tới
- [X] T092 Ghi POC-2 (hạn mức Instagram và Zalo OA chưa xác minh, plan R-C) vào `docs/wiki/open-questions.md` (hoặc tệp "câu hỏi mở" tương ứng, xem `AGENTS.md`); chạy `pnpm wiki:check`
- [ ] T093 Chạy toàn bộ kiểm tra: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db`, `pnpm test:queue`, `pnpm check:boundaries`, `pnpm db:check`, `pnpm db:lint-migrations`, quét bí mật; sửa mọi vi phạm
- [ ] T094 Chạy `specs/012-manual-compose-approval-calendar/quickstart.md` kịch bản A–H với `PLATFORM_DRIVER=fake PUBLISH_EXECUTOR=fake MAIL_TRANSPORT=memory`; ghi kết quả; kịch bản liên quan web chỉ chạy được khi 011 đã merge
- [X] T095 Rà lại bảng "Điều chỉnh / ghi nhận so với spec" của plan.md (trạng thái `cancelled`, khóa lạc quan cấp bài, `post_events` vs `audit_log`, `internal_name ≤ 80`) với mã đã làm; ghi lệch nếu có; đánh số lại `0017`/`0018` theo `dev` nếu trùng (R-B)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: bắt đầu ngay.
- **Foundational (Phase 2)**: sau Setup; **chặn mọi câu chuyện**.
- **US1 (Phase 3)**: sau Phase 2.
- **US2 (Phase 4)**: sau Phase 2; cần `createDraft` (T029) của US1 — hoặc fixture tạo bài trực tiếp qua `ContentPublicApi` trong kiểm thử.
- **US3 (Phase 5)**: sau Phase 2; dùng `approve` của US2 (T043) cho `approveBatch`.
- **US4 (Phase 6)**: sau US3 (`submit`, `return`).
- **US5 (Phase 7)**: sau US2 (bài đã duyệt mới đổi giờ được).
- **US6 (Phase 8)**: sau US2 và US4 (`savePost`).
- **US7 (Phase 9)**: sau US1 (danh sách) — độc lập với US2–US6.
- **Polish (Phase 10)**: sau các câu chuyện mong muốn.

### Web gating (plan R-A)

Mọi nhiệm vụ nhóm **Web** cần 011 đã merge vào `dev` (danh sách kênh thật cần thêm 010). `/speckit-implement` chạy
`worktree-sync` để kéo `dev` về trước. Nếu 011 chưa merge: làm hết phần **Máy chủ** của mọi câu chuyện rồi dừng; phần Web để lại.

### Within Each User Story

- Kiểm thử (đỏ) → khuôn Zod dùng chung → hàm công khai module → điểm cuối → web.
- Hàm công khai của `content`/`publishing` không gọi nhau ngược chiều; mọi thao tác đổi trạng thái hoặc đụng lịch đi qua `approval`.

### Parallel Opportunities

- Phase 1: T002, T003, T005 song song.
- Phase 2: T008, T009 (bảng), T011–T013, T018, T020 song song sau khi có migration (T006–T007) và quy ước.
- Trong mỗi câu chuyện: mọi nhiệm vụ kiểm thử `[P]` cùng lúc; khuôn Zod (T028, T045) song song với kiểm thử.
- Sau Phase 2: US1 (nhóm Web) song song với US2 (Máy chủ) khi có hai người; US7 song song với US4–US6.

---

## Parallel Example: User Story 2

```bash
# Chạy cùng lúc các kiểm thử đỏ của US2:
Task: "approve-concurrency.db.spec.ts (T037)"
Task: "approve-atomicity.db.spec.ts (T038)"
Task: "instagram-quota.db.spec.ts (T039)"
Task: "posts-approve.e2e.spec.ts (T040)"
Task: "suggest-times.spec.ts (T041)"
```

---

## Implementation Strategy

### MVP First

1. Phase 1 + Phase 2 (nền, mục lịch đăng, bộ thực thi tạm).
2. US1 (soạn + lưu nháp) → **DỪNG và kiểm**: quickstart A.
3. US2 (duyệt một bài) → quickstart B, C: duyệt đúng một lần, tất cả hoặc không.
4. US3 (Chờ duyệt, hàng loạt, trả lại) → quickstart D: đủ luồng F3. **MVP nghiệp vụ = US1 + US2 + US3**.

### Incremental Delivery

1. + US4 (cộng tác viên đủ vòng) → + US5 (Lịch, đổi giờ) → + US6 (sửa sau duyệt, hủy lịch) → + US7 (danh sách).
2. Mỗi câu chuyện thêm giá trị mà không phá câu chuyện trước; 013 thay thân `executor.stub` mà không đổi hợp đồng `PublishingPublicApi`.

### Bàn giao cho 013

- Giữ nguyên: tên loại việc `publishing.run_attempt`, payload `{ attemptId }`, `dedupeKey = publish:{attemptId}`, chỉ mục duy nhất, bộ kiểm thử hợp đồng T012/T013.
- 013 thêm cột và bảng `publish_steps` bằng migration chỉ thêm; không sửa CHECK `status` (đã đủ bộ trạng thái).


## Ghi chú thi công (web)

Đã làm phần máy chủ của cả 7 câu chuyện và phần web của US1–US7 (màn Soạn/xem bài, Chờ duyệt, Lịch, Bài viết). Chưa làm / lệch:

- **T059** – số bài chờ trên điều hướng: bảng điều hướng của 011 bị ghim đúng 7 mục (`nav-registry.spec.ts`) nên `Chờ duyệt` KHÔNG thêm thành mục riêng;
  lối vào là liên kết "Chờ duyệt" ở màn Bài viết (chỉ chủ). Chưa gắn `setCountSources({ pendingReview })` (sẽ làm mọi kiểm thử màn hình gọi mạng thêm) – cần quyết định cách gắn theo quyền.
- **T066** – `HistoryTab` (lịch sử bài). API `GET /posts/:id/history` đã có; chưa có tab trên màn Soạn bài. (Nút Gửi duyệt / Rút lại / nhãn "Bị trả lại" đã nằm trong `ComposePage`.)
- **T074/T075** – Lịch: kéo thả dùng sự kiện HTML5 gốc (đường phụ), "Đổi giờ" là đường chính; nút "Thêm bài" ở ngày trống chưa điền sẵn ngày (`/posts/new` chưa đọc tham số ngày).
- **T093** – toàn bộ kiểm tra xanh (unit 437, CSDL 738, hàng chờ 107, web 438, `check:boundaries`, `db:check`, `db:lint-migrations`, `check:secrets`, `check:web-rules`) trừ hai lỗi **có sẵn từ `dev`**, không do 012: `pnpm typecheck` ở `tooling/test/check-wiki.spec.ts` và `prettier` ở `docs/wiki/concepts/feature-status.md`.
- **T094** – kịch bản quickstart phía máy chủ đã được kiểm bằng e2e (`test/e2e/posts-*.e2e.spec.ts`); chưa chạy tay đầu–cuối trên trình duyệt.
- Danh sách Bài viết chưa có "tải thêm" theo con trỏ (API đã hỗ trợ); `ComposePage` chưa có vùng đính media (chờ thư viện media); chưa có kiểm thử riêng `CollaboratorFlow`/`EditAfterApproval` – hành vi tương ứng được phủ trong `test/posts/ComposePage.spec.tsx`.

## Notes

- `[P]` = khác tệp, không phụ thuộc việc chưa xong; nhãn `[USn]` truy vết về spec.md.
- Mỗi câu chuyện hoàn thành và kiểm độc lập được; dừng ở mỗi checkpoint để kiểm.
- Tránh: nhiệm vụ mơ hồ, xung đột cùng tệp (nhiều nhiệm vụ cùng sửa `approval.service.ts` / `ComposePage.tsx` chạy **tuần tự**), phụ thuộc chéo phá tính độc lập.
- Không commit trừ khi người dùng yêu cầu.
