---

description: "Danh sách việc cho tính năng 010 – Kết nối kênh Facebook Page + Instagram + TikTok"
---

# Tasks: Kết nối kênh Facebook Page + Instagram + TikTok (010)

**Input**: `specs/010-connect-facebook-instagram/` – plan.md, spec.md, research.md (R1…R12), data-model.md, contracts/ (6 tệp), quickstart.md

**Prerequisites**: plan.md, spec.md (đã có). `/speckit-implement` chạy `before_implement` → `/speckit-worktree-sync` để merge `dev` (có 011–014) vào worktree **trước** khi viết mã (xem T001).

**Tests**: **Có** – Hiến pháp bắt buộc: kiểm thử truy cập chéo, hợp đồng bộ chuyển đổi, chạy lại hai lần, đua, quét bí mật (SC-003/004/011). Mỗi story có mục kiểm thử; viết trước và thấy thất bại rồi mới hiện thực.

**Organization**: nhóm theo user story (US1…US9) để triển khai và kiểm thử độc lập. Tên định danh tiếng Anh (`channel_connections`, `platform_gateway`…), chú thích mã bằng tiếng Việt.

## Format: `[ID] [P?] [Story] Mô tả kèm đường dẫn`

- **[P]**: chạy song song được (khác tệp, không phụ thuộc việc chưa xong)
- **[USn]**: thuộc user story n của spec.md
- Đường dẫn theo cấu trúc trong plan.md: `apps/server/src/modules/platform_gateway/…` (viết tắt **`PG/`**), `apps/server/test/platform-gateway/` (**`PGT/`**), `apps/web/src/features/channels/` (**`WEB/`**), `packages/shared/src/` (**`SH/`**)

---

## Phase 1: Setup (nền tảng dự án)

**Purpose**: đưa worktree về đúng nền `dev`, ghi quyết định kiến trúc, khai báo cấu hình.

- [X] T001 Sau khi `/speckit-worktree-sync` đã merge `dev`: chạy `git grep -n tokenExpiresAt` ngoài `PG/`; nếu có nơi *đọc* mới (012/013) thì chuyển sang `expiry` và ghi vào mục "Ranh giới" của plan.md; xác nhận `pnpm install && pnpm typecheck` xanh trước khi sửa mã
- [X] T002 [P] Viết `ADR-13` trong `TaiLieuDacTa/` (và liên kết từ `docs/wiki`): (a) TikTok vào giai đoạn 1 ở dạng tắt – đảo ghi chú "giai đoạn sau" của ADR-05; (b) mã hóa phong bì + `KeyWrapper` (KMS chưa chốt, K5); (c) thêm phụ thuộc `platform_gateway → account`; (d) mở rộng nhóm quyền `analytics` + `ads` so với "quyền tối thiểu" Hiến pháp VII (PO 2026-11-18, FR-043) – theo mẫu bối cảnh/phương án/tiêu chí có trọng số/hệ quả/điều kiện xem xét lại
- [X] T003 [P] Thêm biến cấu hình vào `apps/server/src/config/config.schema.ts` (zod) và `apps/server/.env.example`: `CHANNEL_CONNECT_REDIRECT_BASE`, `CHANNEL_SCOPE_GROUPS` (mặc định `publish,analytics,ads`; giá trị `trends` ⇒ API không khởi động), `CHANNEL_SCOPES_FACEBOOK_PAGE`, `CHANNEL_SCOPES_INSTAGRAM`, `CHANNEL_SCOPES_TIKTOK`, `META_TOKEN_REFRESH_ENABLED`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_BASE_URL`, `TIKTOK_TIMEOUT_MS` (mặc định 10000), `TIKTOK_APP_STATUS` (`sandbox|in_review|approved`), `CHANNEL_INTERACTIVE_TIMEOUT_MS` (mặc định 10000), `CREDENTIAL_VAULT_DRIVER` (`kms|env-master-key|fake`), `KMS_KEY_ID`, `CREDENTIAL_MASTER_KEY_B64`, `STAGING_ALLOW_ENV_MASTER_KEY`; thiếu biến bắt buộc khi `PLATFORM_ADAPTER_MODE=real` ⇒ chỉ nêu **tên biến** (mẫu `resolveOAuthConfig` của 009)
- [X] T004 [P] Mở rộng máy chủ giả `graph-stub` (013) trong `apps/server/test/support/graph-stub/`: OAuth (`dialog/oauth` → `code`), đổi mã ngắn/dài hạn, `me/accounts` có phân trang và `instagram_business_account`, `debug_token`, `me/permissions`, `DELETE {user}/permissions`; thêm `tiktok-stub` (`/v2/oauth/token/`, `/v2/oauth/revoke/`, `user/info`, `creator_info/query`) có **bộ đếm lời gọi** (dùng cho "0 lời gọi khi công tắc tắt")
- [X] T005 [P] Thêm khóa chuỗi `channels.*` (tiếng Việt đời thường) vào `apps/web/src/lib/i18n/vi.ts`: tiêu đề, trạng thái (chữ), ghi chú CTV, trạng thái trống ("Ứng dụng chỉ đăng bài khi bạn bấm Duyệt."), hộp ngắt kết nối, "TikTok chỉ đăng video", "đang thử nghiệm", thông điệp lỗi theo mã của `contracts/channels-http-api.md` mục 3

---

## Phase 2: Foundational (chặn mọi user story)

**Purpose**: kiểu dùng chung, quyền, CSDL, trạng thái dẫn xuất, công tắc, cổng ngược, hợp đồng bộ chuyển đổi.

**⚠️ CRITICAL**: chưa có phase này thì không bắt đầu user story nào.

- [X] T006 [P] Cập nhật `SH/modules/platform_gateway/index.ts` (zod): `CHANNEL_TYPES` thêm `'tiktok'`; `ChannelState` (`active|expiring|needs_reconnect|ineligible|suspended|disconnected`); `ChannelConnectionStatus` **giữ đúng 4 giá trị** `active|expiring|expired|disconnected`; `ChannelConnectionDto.tokenExpiresAt: string | null` (**NULL ⇔ `expiry.kind='none'`**); thêm `state?`, `reasonCode?`, `expiry?`, `sourceConnectionId?`; DTO `OverviewResponse`, `ChannelOverviewItem`, `ConnectRequest/Response`, `SelectionResponse`, `ConfirmRequest/Response` (`externalIds`: 1..20, strict), `RecheckResponse`, `DisconnectPreview/Response`, bảng mã lỗi (`FEATURE_NOT_ENABLED`, `PLAN_EXPIRED`, `LIMIT_REACHED`, `ALREADY_CONNECTED`, `OWNED_BY_ANOTHER_ACCOUNT`, `WRONG_CHANNEL`, `STATE_INVALID`, `SELECTION_NOT_FOUND`, `CONNECTION_NOT_FOUND`, `RECHECK_TOO_SOON`, `PROVIDER_UNAVAILABLE`, `CHANNEL_INELIGIBLE`) – **không** trường chứa mã quyền; `@app/shared/content` giữ nguyên (không có `tiktok`)
- [X] T007 [P] Thêm quyền `channel.view` (chủ + cộng tác viên) và `feature.manage` (chỉ `admin` nội bộ; owner/collaborator/support = false) vào `SH/auth/permissions.ts`; cập nhật ma trận quyền + kiểm thử (SC-003 của 004) ở `apps/server/test/auth/` và `apps/web/src/app/shell/nav-registry.spec.ts`
- [X] T008 [P] Mở rộng `SH/modules/notifications/events.ts` (danh mục đóng): `channel_token_expiring` thêm `refs.stage?: 'd7'|'d1'|'expired'`, `refs.connectionIds?: uuid[] (≤ 10)` (sự kiện cũ không `stage` vẫn hợp lệ); thêm `channel_needs_reconnect` (`refs: {connectionId, connectionIds?, reason: 'token_expired'|'token_revoked'|'scope_missing'|'source_page_lost'|'not_eligible'}`, `params: {channelDisplayName?, affectedPosts?: int}`); người nhận = chủ, email `immediate`, hành động `reconnect_channel`; thêm mẫu nội dung tiếng Việt ở module `notifications` (không số tiền AI, không mã lỗi gốc)
- [X] T009 Viết migration `apps/server/drizzle/migrations/NNNN_platform_gateway_010_*.sql` **chỉ thêm** (tương thích ngược): 5 bảng tenant `channel_connections`, `connect_states`, `connect_selections`, `feature_overrides`, `feature_override_events` (cột, kiểu, CHECK, chỉ mục đúng `data-model.md` mục 1–6, gồm `CHECK ((status='disconnected') = (disconnected_at IS NOT NULL))`, `CHECK ((expiry_kind='none') = (token_expires_at IS NULL))`, `CHECK (channel_type='instagram' OR source_connection_id IS NULL)`, `CHECK (source_connection_id IS DISTINCT FROM id)`, `UNIQUE (channel_type, external_id) WHERE status <> 'disconnected'`, `UNIQUE (account_id, flag_key)`, `jsonb_array_length(candidates) <= 100`); bảng dùng chung `gateway_settings` (nạp 6 khóa mặc định: `channel.tiktok.enabled_default=false`, `channel.max_per_platform=5`, `channel.expiry_warn_days=7`, `channel.manual_check_cooldown_sec=20`, `channel.selection_ttl_sec=600`, `channel.check_batch_limit=500`); RLS `tenant_isolation` (`account_id = account.current_account_id()`) cho 5 bảng tenant; `feature_override_events` chỉ `INSERT, SELECT` cho `app`; hàm `SECURITY DEFINER` `platform_gateway.list_due_connections(batch_limit, now)` (chỉ trả `account_id, connection_id`) và `platform_gateway.channel_stats()`; khung nhìn `support_channel_view` (không cột `*_ciphertext`); khai báo `indexExceptions` có lý do cho chỉ mục duy nhất toàn cục và chỉ mục quét theo hạn
- [X] T010 Viết `PG/internal/db/schema.ts` (Drizzle, `tenantTable`/`sharedTable`) khớp T009; chạy `pnpm db:check` (công cụ phát hiện bảng có `account_id` thiếu RLS) và `pnpm db:lint-migrations` xanh *(ghi chú thi công: `db:lint-migrations` ĐẠT; migration áp được lên Postgres 17 và `conventions.db.spec` (db:check) 0 vi phạm – đã sửa 1 vi phạm quy tắc i bằng REVOKE trong 0023)*
- [X] T011 [P] Cập nhật `apps/server/src/modules/modules.manifest.json`: `platform_gateway.allowedDeps = ["account", "notifications", "queue"]`; mở rộng quy tắc ESLint "chỉ `internal/adapters` + `internal/vault` được import `revealCredential`" sang `internal/adapters/tiktok/`; `pnpm check:boundaries` xanh
- [X] T012 [P] Hàm thuần `PG/internal/connections/connection-state.ts`: `deriveState(row, ctx{sourceRow, featureEnabled, now, warnDays})` đúng bảng ưu tiên trong `data-model.md` ("Trạng thái hiển thị") và `toLegacyStatus(state)` (`active→active, expiring→expiring, needs_reconnect→expired, ineligible→expired, suspended→disconnected, disconnected→disconnected`); kiểm thử bảng + bất biến "`status ∈ {active,expiring}` ⇔ `state ∈ {active,expiring}`" trong `PGT/connection-state.spec.ts`
- [X] T013 [P] `PG/internal/features/feature-gate.ts` + hàm thuần `resolveFlag` (override `on|off|default` × mặc định; lỗi đọc ⇒ **false** + log `feature.read_failed`, đếm `channel_feature_read_failed_total`); cache trong tiến trình theo `(accountId, flag)` TTL ≤ 60 giây (mặc định 30; TTL lỗi 5 giây); `PG/internal/settings/gateway-settings.ts` đọc `gateway_settings` (cache ≤ 60 giây); `PGT/resolve-flag.spec.ts` (6 tổ hợp + lỗi đọc)
- [X] T014 [P] `PG/internal/connections/limits.ts`: `pg_advisory_xact_lock(hashtextextended('channel_limit:'||account_id||':'||channel_type,0))` + đếm `status <> 'disconnected'` (kết nối "Cần kết nối lại" vẫn tính) so với `channel.max_per_platform`; trả `LIMIT_REACHED {used, limit}`
- [X] T015 Mở rộng giao diện nội bộ: `PlatformAdapter` thêm `revoke(cred, ctx) → 'done'|'failed'|'unsupported'` (không ném) và `expiryOf(...) → ExpiryInfo` (`none|token|data_access`); `ConnectionCandidate` thêm `avatarUrl?, accountType?, grantedScopes?, sourceExternalId?, refreshToken?, expiry?`; `checkAccount.eligible` trả thêm `expiry`; cập nhật `FakeAdapter` (kịch bản "2 Page", "IG cá nhân", "thiếu quyền", "vai trò thấp", "thu hồi", loại `tiktok`) và `PGT/adapter-contract.spec.ts` dùng chung (013) thêm ca: `revoke` không ném, `expiryOf` đúng 3 dạng, `authorizeUrl` không chứa bí mật ứng dụng
- [X] T016 `PG/internal/connections/pg-connection-store.ts`: `ConnectionStore` thật (đọc/ghi qua `tenantTx`/`systemTx`, `updateVersioned`, đếm, tìm Instagram phụ thuộc Page, kết nối lại tại chỗ giữ `id`); chọn driver `real|fake` trong `PG/platform_gateway.module.ts` (bản sandbox 005 vẫn chạy khi `driver=fake`); mở rộng `assert-no-fakes`: production từ chối `fake` ở vault/adapter và `env-master-key`, staging chỉ cho `env-master-key` khi `STAGING_ALLOW_ENV_MASTER_KEY=true`
- [X] T017 `ConnectionConsumersPort` + `registerConnectionConsumers(port)` trong `PG/public-api.ts` (bản rỗng mặc định: `count 0`, `cancelled 0`, `errorMappings=[]`); trong `apps/server/src/modules/publishing/` đăng ký ở `onModuleInit`: `scheduledImpact` ← hàm mới `countScheduledByConnections` (cộng thêm vào `PublishingPublicApi`, đếm lượt `scheduled|retry_wait` còn hiệu lực + giờ gần nhất), `onDisconnect` ← `cancelAllForConnection(tx, id)` (013), `errorMappings` ← `publishing.error_mappings`; `publishing` **không** import nội bộ `platform_gateway`; ghi đề xuất nhỏ cho 013 (nối `reportAuthFailure` từ `precheck`/`classifyError`) vào `docs/wiki/open-questions` hoặc ghi chú PR
- [X] T018 Mở rộng `PG/public-api.ts` (chỉ **cộng thêm**, không đổi nghĩa thao tác đang dùng): `getConnectionState`, `listConnections({channelTypes?, usableOnly?})`, `isFeatureEnabled('channel.tiktok')`, `reportAuthFailure` (chỉ `active → needs_reconnect` bằng cập nhật có điều kiện; idempotent; phát thông báo gom), `disconnectAllForAccount()`; `ChannelConnection.status` luôn ra từ `toLegacyStatus(state)`; giữ `GET /api/v1/channels` (bộ chọn 012) hình dạng cũ, **không trả `tiktok`**
- [X] T019 [P] Test tương thích 012/013 `PGT/legacy-compat.spec.ts` + `apps/server/test/db/`: với mọi `state` không dùng được thì `status ∈ {expired, disconnected}` để `publishing/precheck` dừng; bộ chọn kênh của 012 không bao giờ có `tiktok`; kiểm thử hiện có của 005/012/013 vẫn xanh với `driver=fake`

**Checkpoint**: nền tảng sẵn sàng – các user story bắt đầu được.

---

## Phase 3: User Story 1 – Kết nối Facebook Page (P1) 🎯 MVP

**Goal**: chủ bấm kết nối → cấp quyền ở Facebook → chọn một/nhiều Page → có thẻ kênh "Đang hoạt động" kèm ngày hết hạn.

**Independent Test**: với Meta giả (kịch bản "2 Page") – chọn 1 Page ⇒ đúng 1 kết nối `facebook_page` trạng thái hoạt động có hạn; giao diện công khai không trả mã quyền; tài khoản khác không thấy; hủy/từ chối quyền ⇒ không tạo gì, không lưu mã.

### Tests for User Story 1 (viết trước, phải thất bại)

- [X] T020 [P] [US1] Hợp đồng bộ chuyển đổi Facebook trong `PGT/adapter-contract.spec.ts`: `authorizeUrl` đủ tham số + không `client_secret`; `exchangeCallback` hủy ⇒ `CONNECT_CANCELLED`, 2 Page ⇒ 2 ứng viên, phân trang > 1 trang
- [ ] T021 [P] [US1] Kiểm thử HTTP `PGT/connect-flow.http.spec.ts`: `connect` → callback → `selections/:id` → `confirm`; `state` sai/hết hạn/đã dùng/của người khác/khác loại kênh ⇒ cùng `STATE_INVALID`; luồng đăng nhập Facebook 009 không tự tạo kết nối (US1-7, FR-005); chọn một Page duy nhất ⇒ chọn sẵn
- [ ] T022 [P] [US1] DB test `apps/server/test/db/platform-gateway/connect-race.db.spec.ts`: hai `confirm` cùng Page ⇒ 1 kết nối + `ALREADY_CONNECTED`; hai tài khoản cùng Page ⇒ `OWNED_BY_ANOTHER_ACCOUNT` (không lộ thêm); chọn quá chỗ còn lại song song ⇒ `LIMIT_REACHED` trước khi tạo gì (R8)

### Implementation for User Story 1

- [X] T023 [US1] `FacebookAdapter` (đã có `submit…` từ 013): thêm `authorizeUrl` (`dialog/oauth`, `scope` theo `CHANNEL_SCOPE_GROUPS` × `CHANNEL_SCOPES_FACEBOOK_PAGE`, `auth_type=rerequest` khi thiếu quyền), `exchangeCallback` (đổi `code` → mã ngắn hạn → dài hạn `fb_exchange_token`; `GET /me/accounts?fields=id,name,picture{url},access_token,tasks,instagram_business_account{id,username}` có phân trang ≤ 100 Page; ứng viên: `accessToken` = mã Page, `refreshToken` = mã người dùng dài hạn, `avatarUrl`, `grantedScopes`), `checkAccount` cơ bản (`debug_token` `is_valid` + đủ quyền bắt buộc, `tasks` chứa `CREATE_CONTENT`); `GraphClient` che `access_token|code|client_secret|fb_exchange_token` thành `[redacted]` trong URL log, `AbortSignal` ≤ `CHANNEL_INTERACTIVE_TIMEOUT_MS` ở `PG/internal/adapters/meta/`
- [X] T024 [US1] Phiên kết nối `PG/internal/connections/connect-session.ts`: `connect_states` (`state_hash` = SHA-256 của 32 byte ngẫu nhiên, **không lưu bản rõ**; `user_id` từ phiên; dùng một lần bằng `UPDATE … SET used_at=now() WHERE state_hash=$1 AND used_at IS NULL AND expires_at > now() RETURNING …`; TTL từ `channel.selection_ttl_sec` = 600 giây); `connect_selections` (mỗi ứng viên mã hóa riêng, AAD `selection_id`+`external_id`; CHECK `jsonb_array_length <= 100`; xóa hẳn sau `confirm`/hết hạn); đúng người đang đăng nhập mới gọi lại được
- [X] T025 [US1] `PG/internal/connections/connections.service.ts`: `startConnect` (kiểm `channel.manage` ở API, gói còn hạn, giới hạn, trả `authorizeUrl`), `handleCallback` (302 theo `contracts/channels-http-api.md` 1.3: `/channels/select/:id` hoặc `/channels?error=<code>` với `code ∈ CONNECT_CANCELLED|STATE_INVALID|STATE_EXPIRED|WRONG_CHANNEL|FEATURE_NOT_ENABLED|PROVIDER_UNAVAILABLE|SCOPE_MISSING|NO_CANDIDATES`), `getSelection` (ứng viên + `blocked` + `remainingSlots`; người khác/hết hạn ⇒ `404 SELECTION_NOT_FOUND`), `confirm` (xử lý **từng ứng viên độc lập** trong giao dịch riêng, `409 LIMIT_REACHED` nếu chọn > chỗ còn lại, kết quả `created|already_connected|owned_by_another_account|ineligible|limit_reached|not_in_selection`; `updateVersioned`; kiểm toán `channel.connect`/`channel.connect_failed`; ứng viên không chọn bị hủy cùng dòng phiên)
- [X] T026 [US1] `PG/internal/connections/connections.controller.ts`: `POST /channels/connect`, `GET /channels/callback/:channelType`, `GET /channels/selections/:selectionId`, `POST /channels/selections/:selectionId/confirm`, giữ `POST /channels` (005) ủy quyền cho `confirm`; `@CustomerAccess` + `channel.manage`; mã tài khoản **chỉ từ phiên**; lỗi theo `AppError` `{code, message(vi), actions[]}` (mỗi lỗi ≥ 1 hành động); kết nối không thuộc tài khoản/không tồn tại ⇒ cùng `404 CONNECTION_NOT_FOUND`
- [ ] T027 [P] [US1] Web: `WEB/SelectChannelsPage.tsx` (tuyến `/channels/select/:selectionId`, quyền `channel.manage`): danh sách ứng viên (ảnh + tên), chọn sẵn khi chỉ có 1 ứng viên chọn được, chọn nhiều tới `remainingSlots` (nút "Xác nhận" vô hiệu + giải thích khi vượt), ứng viên `blocked` hiện "Đã kết nối"/lý do + hành động, kết quả từng Page sau `confirm`; hủy/lỗi ⇒ thông điệp + "Thử lại"; endpoint + khóa truy vấn trong `apps/web/src/lib/api/endpoints/channels.ts`
- [ ] T028 [P] [US1] Web: `WEB/ConnectMenu.tsx` (chọn nền tảng → hiện `used/limit` → `POST /connect` → `window.location.assign(authorizeUrl)`; `canAdd=false` hiện lý do), banner kết quả `?reconnected`/`?error` rồi xóa tham số URL; thêm tuyến `/channels/select/:selectionId` vào `apps/web/src/app/routes.tsx`

**Checkpoint**: US1 chạy độc lập với Meta giả (MVP của luồng kết nối).

---

## Phase 4: User Story 4 – Mã quyền lưu an toàn (P1)

**Goal**: mã quyền chỉ ở dạng mã hóa phong bì, chỉ `platform_gateway` giải mã; không rò ở bất kỳ đâu; cô lập tenant tuyệt đối.

**Independent Test**: đọc thô `channel_connections` không thấy mã rõ; quét log/phản hồi/thông báo/URL gọi ra không có `EAA…`/`act.…`/`fake_tok_*`/`client_secret`; tài khoản A không đọc/sửa/ngắt/đoán mã của B.

### Tests for User Story 4

- [X] T029 [P] [US4] `PGT/kms-vault.spec.ts`: round-trip; AAD sai (đem bản mã sang kết nối/tài khoản khác) ⇒ giải mã thất bại; xoay `keyId` giải mã được bản cũ; bản mã đổi 1 bit ⇒ thất bại; `DecryptedCredential` in/JSON ra `[credential]`
- [X] T030 [P] [US4] DB test truy cập chéo (thực hiện bằng fixture trong `test/db/fixtures/cross-tenant-fixtures.ts`, chạy qua khuôn `describeCrossTenant`; `cross-tenant-coverage` bắt buộc đủ 5 bảng) cho **cả 5 bảng tenant** (A đọc/sửa/xóa/đoán mã của B ⇒ thất bại, không phân biệt "không tồn tại" – SC-004); thiếu biến phiên ⇒ không thấy dòng nào; kiểm tra bảng có `account_id` thiếu RLS qua `pnpm db:check`
- [ ] T031 [P] [US4] `PGT/secret-scan.spec.ts`: sau chuỗi kết nối đầy đủ, quét phản hồi HTTP, log có cấu trúc, `ClassifiedError`, thông báo/email, URL gọi ra, dữ liệu job, bằng mẫu `EAA…`, `act.…`, `fake_tok_*`, `client_secret`, `fb_exchange_token` ⇒ 0 khớp (SC-003); đọc thô `token_ciphertext` ⇒ không giải mã được nếu thiếu khóa

### Implementation for User Story 4

- [X] T032 [P] [US4] `PG/internal/vault/key-wrapper.ts` (giao diện `wrap/unwrap`), `env-master-key.wrapper.ts` (khóa chủ 256 bit từ `Secret`, `CREDENTIAL_MASTER_KEY_B64`), `kms.wrapper.ts` (khung gọi KMS, cấu hình `KMS_KEY_ID`; hiện thực thật chờ K5 – trả lỗi rõ khi chưa cấu hình)
- [X] T033 [US4] `PG/internal/vault/kms-credential-vault.ts`: mã hóa phong bì – DEK 256 bit ngẫu nhiên/bản ghi, AES-256-GCM (`node:crypto`, **không tự viết mật mã**), **AAD = `accountId|purpose|refId`**, định dạng `v1 | keyId | wrappedDek | iv(12) | tag(16) | ciphertext`; thay `FakeCredentialVault` khi `CREDENTIAL_VAULT_DRIVER != fake`; giải mã chỉ trong `ConnectionsService`/`PlatformGatewayService` ngay trước lời gọi, không cache bản rõ (T029 phải xanh)
- [ ] T034 [US4] Bảo đảm DTO dùng danh sách trường cho phép (không `select *`), `ChannelOverviewItem` không có trường quyền, log/URL che tham số nhạy cảm; hỗ trợ xem kênh qua `support_channel_view` + `GET /staff/accounts/:accountId/channels` (`@StaffAccess('support.lookup')`, ghi kiểm toán `support.view_channel`) trong `PG/internal/connections/staff-channels.controller.ts`; kiểm thử khung nhìn không có cột `*_ciphertext`
- [ ] T035 [US4] Kiểm toán thao tác kênh: ghi `infra.audit_log` cho `channel.connect|connect_failed|reconnect|recheck|disconnect|state_changed` với metadata chỉ `{connection_id, channel_type, result, reason_code, trace_id}` – không mã quyền, không tên Page đầy đủ (FR-030); log kỹ thuật tách khỏi nhật ký nghiệp vụ, luôn có `trace_id`, `account_id`

**Checkpoint**: US1 + US4 – kết nối và lưu an toàn, qua cổng cô lập tenant.

---

## Phase 5: User Story 3 – Kiểm tra điều kiện tài khoản (P1)

**Goal**: báo ngay, bằng lời thường kèm hành động khắc phục, khi tài khoản không đủ điều kiện; "Kiểm tra lại" có giới hạn tần suất.

**Independent Test**: kịch bản giả "thiếu quyền", "vai trò thấp", "IG cá nhân", "Page bị xóa" ⇒ mỗi ca đúng một thông điệp + ≥ 1 hành động, không tạo kết nối; lỗi tạm thời không đổi trạng thái kênh.

### Tests for User Story 3

- [ ] T036 [P] [US3] Hợp đồng `checkAccount` trong `PGT/adapter-contract.spec.ts` cho Facebook/Instagram/TikTok/giả: đủ quyền ⇒ eligible; thiếu quyền; vai trò thấp; IG cá nhân; Page bị xóa – mỗi ca đúng một `reasonCode` + `remedies ≥ 1`; `quotaRemaining = null` không hiện số giả
- [ ] T037 [P] [US3] `PGT/recheck.http.spec.ts`: `POST /channels/:id/recheck` giới hạn tần suất bằng cập nhật có điều kiện `last_manual_check_at < now() - cooldown` ⇒ `429 RECHECK_TOO_SOON {retryAfterSec}`; nền tảng tạm thời không phản hồi ⇒ `200 {result:'unavailable'}` **không đổi** trạng thái (FR-012, US3-5); mã lạ ⇒ `unknown` không đổi trạng thái

### Implementation for User Story 3

- [X] T038 [P] [US3] Bảng lỗi kết nối/kiểm tra `PG/internal/errors/connect-errors.ts` (mặc định trong mã; ghi đè bằng `errorMappings()` của cổng ngược): đúng bảng ở `contracts/meta-tiktok-adapters.md` mục 5 (`CONNECT_CANCELLED`, `SCOPE_MISSING`, `TOKEN_EXPIRED/REVOKED`, `ROLE_TOO_LOW`, `PAGE_UNAVAILABLE`, `NOT_PROFESSIONAL`, `PAGE_NOT_LINKED`, `APP_NOT_APPROVED`, `UNKNOWN`); **mã lạ ⇒ `unknown`**, lỗi mạng/5xx khi *kiểm tra* ⇒ `transient`; mỗi dòng có thông điệp tiếng Việt + ≥ 1 hành động; mã gốc chỉ ở `supportDetails.lastErrorCode`
- [ ] T039 [US3] Hoàn thiện `FacebookAdapter.checkAccount` đủ (a) quyền bắt buộc, (b) vai trò, (c) Page còn tồn tại, (d) `quotaRemaining=null`; `expiryOf` (`debug_token`: bỏ mốc `0`; `none` khi không còn mốc; còn mốc ⇒ `min(expires_at, data_access_expires_at)` kèm `kind`) trong `PG/internal/adapters/meta/facebook.adapter.ts`
- [ ] T040 [US3] `connections.service.recheck` + `POST /channels/:connectionId/recheck` (`channel.manage`): đọc → gọi `checkAccount` (+ làm mới nếu hạn gần) **ngoài giao dịch** → ghi `updateVersioned`; trả `{connection, result: 'ok'|'changed'|'unavailable'}`; chỉ kết quả **khẳng định** mới đổi trạng thái (FR-012); chi tiết điều kiện (`conditions`: loại tài khoản, quyền tick/chữ, hạn mức chỉ khi biết) trong `ChannelOverviewItem`
- [ ] T041 [P] [US3] Web: `WEB/ConditionsPanel.tsx` (loại tài khoản, quyền đã cấp dạng tick + chữ, dòng hạn mức chỉ khi `quotaRemaining ≠ null`) và nút "Kiểm tra lại" có trạng thái đang chạy + đếm ngược khi `429` + thông điệp "Chưa kiểm tra được, thử lại sau" khi `unavailable` (`aria-live="polite"`)

**Checkpoint**: US3 – điều kiện tài khoản rõ ràng, an toàn khi nền tảng lỗi.

---

## Phase 6: User Story 2 – Kết nối Instagram chuyên nghiệp (P1)

**Goal**: kết nối Instagram qua Page, báo rõ khi là tài khoản cá nhân/chưa liên kết Page, nhớ Page nguồn.

**Independent Test**: (a) IG chuyên nghiệp có Page ⇒ kết nối `instagram`; (b) IG cá nhân ⇒ không tạo, có hướng dẫn + "Kiểm tra lại"; (c) Page không có IG ⇒ hướng dẫn liên kết Page; (d) Facebook và Instagram độc lập nhau.

### Tests for User Story 2

- [ ] T042 [P] [US2] Hợp đồng `InstagramAdapter` trong `PGT/adapter-contract.spec.ts`: `exchangeCallback` Page có `instagram_business_account` ⇒ ứng viên IG (`externalId=ig_user_id`, `displayName=@username`, `sourceExternalId`=mã Page); Page không IG ⇒ không có ứng viên + `PAGE_NOT_LINKED`; `checkAccount` `BUSINESS|MEDIA_CREATOR` ⇒ eligible, `PERSONAL` ⇒ `NOT_PROFESSIONAL`; `revoke` ⇒ `unsupported`
- [ ] T043 [P] [US2] `PGT/instagram-source.db.spec.ts`: `source_connection_id` được gán khi đã có Page nguồn trong tài khoản; chưa có ⇒ NULL (IG độc lập, US2-6); sau này kết nối Page đó ⇒ liên kết trong cùng giao dịch `confirm`

### Implementation for User Story 2

- [ ] T044 [US2] `InstagramAdapter` (`PG/internal/adapters/meta/instagram.adapter.ts`): `authorizeUrl` (`CHANNEL_SCOPES_INSTAGRAM`; dùng lại quyền đã cấp khi đủ – `include_granted_scopes`, chỉ `rerequest` phần thiếu), `exchangeCallback` (ứng viên = Page có IG; ghi nhận Page không có IG để hiện `PAGE_NOT_LINKED`), `checkAccount` (`GET /{ig_user_id}?fields=username,account_type`; hạn mức đăng 24 giờ ⇒ `quotaRemaining`), `expiryOf`/`refreshToken` dùng mã Page nguồn, `revoke` ⇒ `unsupported` (không thu hồi quyền người dùng dùng chung)
- [ ] T045 [US2] Liên kết Page nguồn trong `confirm`: gán `source_connection_id` nếu Page nguồn có trong tài khoản, và khi sau đó kết nối Page thì cập nhật các Instagram `source_connection_id IS NULL` cùng `sourceExternalId` (cùng giao dịch); chỉ mục `(account_id, source_connection_id)` dùng ở `pg-connection-store.ts`
- [ ] T046 [P] [US2] Web: ứng viên Instagram `blocked` hiện hướng dẫn 3 bước ngắn (chuyển sang tài khoản chuyên nghiệp, liên kết với Page) + nút "Kiểm tra lại"; thẻ Instagram hiện "Liên kết qua Page: *tên Page*" + cảnh báo khi Page nguồn hỏng (trong `WEB/ChannelCard.tsx` sẽ tạo ở US6 – tạm đặt thành phần con `WEB/SourcePageNote.tsx`)

**Checkpoint**: US2 – Instagram chạy độc lập và cùng Facebook.

---

## Phase 7: User Story 6 – Màn hình "Kênh kết nối" (P1)

**Goal**: màn hình hiển thị đúng sức khỏe mọi kênh trong ≤ 1 giây ở 360 px, chủ thao tác được, cộng tác viên chỉ xem.

**Independent Test**: dữ liệu giả đủ trạng thái ở 360 px: mỗi trạng thái đúng chữ + biểu tượng + nút; cộng tác viên thấy cùng nội dung nhưng không có nút và `POST /connect` ⇒ 403.

### Tests for User Story 6

- [ ] T047 [P] [US6] `PGT/overview.http.spec.ts`: `GET /channels/overview` chỉ đọc dữ liệu lưu (**0 lời gọi nền tảng**), `Cache-Control: no-store`, sắp xếp theo nền tảng → trạng thái cần chú ý → `connectedAt`, `attention[]` đúng, `viewerCanManage` (chủ true / CTV false), `planActive=false` ⇒ `canAdd=false`; CTV gọi `connect|recheck|DELETE` ⇒ `403 PERMISSION_DENIED` + ghi nhật ký
- [ ] T048 [P] [US6] Web test: `apps/web/src/features/channels/ChannelsPage.spec.tsx` (trạng thái trống có "chỉ đăng bài khi bạn bấm Duyệt", đủ trạng thái chữ + biểu tượng, CTV không nút, lỗi tải ⇒ `ErrorNotice` + "Thử lại") và Playwright `apps/web/e2e/channels.spec.ts` ở **360/768/1280 px** (không cuộn ngang, vùng chạm ≥ 44 px, axe WCAG 2.1 AA sạch trên: trống, nhiều kết nối đủ trạng thái, CTV chỉ xem, hộp ngắt, chọn Page)

### Implementation for User Story 6

- [ ] T049 [US6] `GET /channels/overview` (`channel.view`) trong `connections.controller.ts` + `connections.service.overview`: dựng `OverviewResponse` từ 1 truy vấn kết nối + 1 truy vấn đếm lịch (`ConnectionConsumersPort.scheduledImpact`; thiếu ⇒ `{0, null}`), `deriveState` cho từng kết nối, `shortCode` 6 ký tự từ `connectionId`, `reasonVi`/`actionsVi` từ bảng lỗi (T038), `features.tiktok`, `limits`, `platforms[]` (`used`, `limit`, `canAdd`), `attention[]`, `planActive` từ `account.getPublishingEligibility()`; mục tiêu ≤ 1 giây (SC-007)
- [ ] T050 [P] [US6] Web: `WEB/ChannelCard.tsx` theo `contracts/web-ui.md` mục 3 – ảnh (alt = tên), tên cắt `line-clamp` (≤ 120, render văn bản thuần), nhãn loại bằng chữ, mã rút gọn `#abc123`, `Badge` chữ + biểu tượng (✔ ⏳ ⚠ ⛔ ⏸), hạn quyền theo UTC+7 ("Quyền có hiệu lực đến 12/01/2027 (còn 5 ngày)" / "Không có ngày hết hạn cố định – sẽ báo ngay nếu bị thu hồi"), thời điểm kiểm tra/kết nối, nút theo trạng thái và quyền, "Chi tiết cho hỗ trợ" thu gọn mặc định
- [ ] T051 [P] [US6] Web: `WEB/AttentionBanner.tsx` (liệt kê **từng kết nối** cần chú ý + nút "Kết nối lại"/"Xem"), `WEB/ChannelGroup.tsx` (nhóm theo nền tảng, tiêu đề "Facebook Page (2/5)"), `WEB/FilterBar.tsx` (lọc nền tảng + trạng thái dạng chip), `WEB/SupportDetails.tsx`
- [ ] T052 [US6] Web: `WEB/ChannelsPage.tsx` (lười tải; `useApiQuery(queryKeys.channels.overview())`; `AsyncBoundary`; skeleton; trạng thái trống; dòng giải thích cho CTV "Chỉ chủ tài khoản mới kết nối được kênh – hãy báo chủ tài khoản"; gói hết hạn ⇒ thay nút kết nối bằng dòng giải thích) và thay `comingSoon(t('nav.channelsPlan'))` của `/channels` trong `apps/web/src/app/routes.tsx`
- [ ] T053 [US6] Web: `apps/web/src/app/shell/nav-registry.ts` – mục `channels-plan` đổi `permission: 'channel.view'`, thêm `badge: 'channelAttentionCount'` (từ `overview.attention.length`, làm mới mỗi 60 giây khi tab hiện, dùng lại `queryKeys.channels.overview()`) ⇒ dấu chỉ báo ở menu mọi màn hình (FR-026); cập nhật `nav-registry.spec.ts` + ma trận quyền
- [ ] T054 [US6] Giữ `GET /channels` (bộ chọn của 012, quyền `status.view`) không đổi hình dạng, thêm `state?`/`reasonCode?` tùy chọn, **lọc bỏ `tiktok`**; ComposePage vẫn chỉ cho chọn `active|expiring` và phân biệt các kết nối cùng nền tảng bằng tên + mã rút gọn (FR-035)

**Checkpoint**: US6 – màn hình hoàn chỉnh; cùng US1–US4 đủ để quay video nộp xét duyệt Meta (SC-010) khi có 013.

---

## Phase 8: User Story 5 – Ngày hết hạn, làm mới, nhắc nhở (P1)

**Goal**: việc nền hằng ngày tự làm mới, nhắc 7 ngày/1 ngày/hết hạn (gom), chuyển "Cần kết nối lại" đúng lúc, không bao giờ đăng bằng quyền hỏng.

**Independent Test**: đồng hồ giả – hạn 10 ngày ⇒ làm mới được; làm mới lỗi còn 6 ngày ⇒ đúng 1 thông báo + 1 email (`d7`), còn 1 ngày ⇒ thêm `d1`, hết hạn ⇒ `needs_reconnect` + `expired`; kết nối lại ⇒ hoạt động, cảnh báo biến mất.

### Tests for User Story 5

- [ ] T055 [P] [US5] Queue test `apps/server/test/queue/platform-gateway/check-connection.queue.spec.ts`: chạy lại **hai lần** cho cùng kết quả (`expectIdempotent`); hai Worker cùng lấy ⇒ một kết quả + một thông báo (`startTestWorkers(2)`); Worker chết giữa chừng sau làm mới trước khi ghi ⇒ chạy lại không mất kết nối, không ghi đè quyền mới; đua Worker làm mới × người dùng kết nối lại ⇒ `token_issued_at` mới hơn thắng
- [ ] T056 [P] [US5] `PGT/expiry-reminders.spec.ts` (đồng hồ giả): chuỗi `d7 → d1 → expired` chỉ phát khi `stage > last_notified_stage`; nhiều kết nối cùng hết hạn một ngày ⇒ **một** thông báo/email liệt kê (`connectionIds`); lỗi tạm thời/mã lạ ⇒ trạng thái không đổi (FR-012) và **không** cập nhật `last_checked_at`; Meta không có hạn ⇒ `expiry.kind='none'`, kiểm tra hằng ngày vẫn bắt thu hồi; cách tính `daysLeft` theo UTC+7
- [ ] T057 [P] [US5] `PGT/reconnect-notifications.spec.ts`: thông báo `channel_needs_reconnect` nêu số bài bị ảnh hưởng (số nguyên, không nội dung bài, không số tiền); lượt đăng đến giờ trên kênh `needs_reconnect` ⇒ 013 `precheck` dừng thành lỗi **cần người dùng** (không gửi); `reportAuthFailure` idempotent, chỉ `active → needs_reconnect`

### Implementation for User Story 5

- [ ] T058 [US5] Khai báo việc trong `PG/internal/maintenance/jobs.ts` (`defineJobType`/`defineSchedule`, hàng chờ `scheduled`, phong bì mang `accountId`, payload chỉ mã tham chiếu): `platform_gateway.channel_maintenance` (cron `0 20 * * *` UTC = 03:00 UTC+7, khóa `scheduled:channel_maintenance:{slot}`), `platform_gateway.check_connection` (khóa `check_connection:{connectionId}:{yyyymmdd}` và `…:recheck:{version}`; thử lại 3 lần 1→5→15 phút **chỉ** khi lỗi hạ tầng của ta), `platform_gateway.cleanup_connect_data` (cron `15 * * * *`, khóa `scheduled:cleanup_connect_data:{slot}`); đăng ký bộ xử lý chỉ ở Worker
- [ ] T059 [US5] `PG/internal/maintenance/due-connections.ts` + handler `channel_maintenance`: gọi `list_due_connections(batch_limit=500, now)` (điều kiện đến hạn đúng `contracts/jobs-and-notifications.md` 1.1: `active` chưa kiểm tra > 20 giờ, hoặc hạn < `warn_days+1` ngày, hoặc `recheck_required`, hoặc TikTok có `last_checked_at < gateway_settings.updated_at`); `needs_reconnect` thuần **không** quét lại; tạo việc `check_connection` cùng giao dịch hàng chờ; còn dư ⇒ lần chạy sau
- [ ] T060 [US5] `PG/internal/maintenance/check-connection.handler.ts` theo 8 bước ở `contracts/jobs-and-notifications.md` 1.2: đặt lại ngữ cảnh tenant bằng `systemTx({tenant})`; kiểm gói (`planActive=false`/`deletionRequested` ⇒ chỉ đặt `recheck_required=true`, **không** gọi nền tảng, **không** nhắc – FR-033); công tắc TikTok; bỏ qua Instagram có Page nguồn hỏng; giải mã → `refreshToken` (khi `tokenRefresh` và hạn < `warn_days+1` ngày) → `checkAccount` + `expiryOf` **ngoài giao dịch** (`signal` ≤ 10 giây); ghi bằng `UPDATE … WHERE id AND version`; nhắc theo `last_notified_stage`; 0 dòng do đua ⇒ đọc lại, bỏ kết quả nếu bản ghi có `token_issued_at` mới hơn
- [ ] T061 [US5] Làm mới Meta: `FacebookAdapter.refreshToken`/`InstagramAdapter.refreshToken` đổi lại mã người dùng dài hạn (`fb_exchange_token`) rồi lấy lại mã Page, ghi `token_issued_at` mới; `capabilities.tokenRefresh` theo `META_TOKEN_REFRESH_ENABLED`; thất bại do thu hồi ⇒ `user_action`, do mạng ⇒ `transient`
- [ ] T062 [US5] Thông báo gom: `PG/internal/notify/channel-notify.ts` phát `notifications.emit(tx, …)` **trong cùng giao dịch** ghi trạng thái; khóa chống trùng ở `dedupe-keys.ts` (`channel_token_expiring:{connectionId}:{expiresOn}:{stage}`, `channel_needs_reconnect:{connectionId}:{reason}:{ngày UTC}`); `params.channelDisplayName` = tên kênh đầu + "và N kênh khác" (≤ 120 ký tự); số bài từ `scheduledImpact`; khi Page chuyển `needs_reconnect`/`disconnected` ⇒ **một** sự kiện gộp Page + Instagram phụ thuộc (`reason:'source_page_lost'`)
- [ ] T063 [US5] `reportAuthFailure` (hoàn thiện từ T018) + việc `cleanup_connect_data` (`DELETE … WHERE used_at IS NOT NULL OR expires_at < now() - interval '1 hour'` cho `connect_states` và `connect_selections`, lô ≤ 1000, idempotent) trong `PG/internal/maintenance/cleanup.handler.ts`
- [ ] T064 [P] [US5] Chỉ số OpenTelemetry trong `PG/internal/metrics.ts`: `channel_connections{state,channel_type}` (gauge qua `channel_stats()`), `channel_expiring_lt7d`, `channel_refresh_total{channel_type,result}`, `channel_connect_total{channel_type,result}`; cảnh báo: tỷ lệ làm mới lỗi > 5%/giờ, `channel_feature_read_failed_total` > 0 kéo dài 10 phút; cảnh báo "quyền còn < 7 ngày" dùng chung ngưỡng 7 ngày (Hiến pháp VIII); `account_id` chỉ ở log, không ở nhãn chỉ số
- [ ] T065 [P] [US5] Web: thẻ hiển thị `expiry` (3 dạng), nhãn "Sắp hết hạn"/"Cần kết nối lại" kèm lý do + số bài bị ảnh hưởng + giờ gần nhất (`scheduledImpact`) trong `WEB/ChannelCard.tsx` và `WEB/AttentionBanner.tsx`; trạng thái luôn chữ + biểu tượng

**Checkpoint**: US5 – vòng đời quyền tự vận hành, không đăng bằng quyền hỏng.

---

## Phase 9: User Story 8 – Nhiều kết nối mỗi nền tảng (P1)

**Goal**: tối đa 5 kết nối/nền tảng, cô lập từng kết nối, Instagram phụ thuộc Page nguồn, lọc/nhóm trên màn hình.

**Independent Test**: Meta giả có 3 Page: kết nối 2 trong cùng lần cấp quyền ⇒ 2 kết nối độc lập; một kết nối hỏng ⇒ chỉ thẻ đó báo lỗi; ngắt một ⇒ cái kia và bài của nó không đổi; vượt giới hạn ⇒ từ chối rõ.

### Tests for User Story 8

- [X] T066 [P] [US8] `apps/server/test/db/platform-gateway/limits.db.spec.ts`: chọn quá giới hạn song song (hai thẻ trình duyệt) ⇒ chỉ vừa đủ N, còn lại `LIMIT_REACHED`; ngắt trả chỗ ngay; `needs_reconnect` vẫn tính; kết nối lại không tốn thêm chỗ; một Page lỗi điều kiện trong lúc chọn 2 Page ⇒ Page đạt vẫn được kết nối (kết quả từng Page độc lập)
- [ ] T067 [P] [US8] `PGT/dependent-instagram.spec.ts`: Page A ngắt/hết hạn ⇒ Instagram `needs_reconnect` (`SOURCE_PAGE_LOST`) **không** bị xóa mã quyền; thông báo gộp cả hai kênh; Page A hoạt động lại + "Kiểm tra lại" Instagram ⇒ `active` không cấp quyền lại (FR-042); `deriveState` dẫn xuất nên Page phục hồi thì Instagram tự đúng

### Implementation for User Story 8

- [ ] T068 [US8] Hoàn thiện phần nhiều kết nối trong `connections.service`: danh sách `platforms[]` có `used/limit/canAdd`; `confirm` nhiều Page một lần đã có từ T025 → bổ sung "Thêm Facebook Page" đánh dấu "Đã kết nối" cho Page đã có trong tài khoản; mọi thao tác (recheck, disconnect, reconnect) áp dụng **riêng từng kết nối** (`updateVersioned`)
- [ ] T069 [P] [US8] Web: `FilterBar` lọc theo nền tảng + trạng thái hoạt động đúng (chip), phân biệt trùng tên bằng ảnh + mã rút gọn, tìm đúng kết nối cần xử lý trong ≤ 10 giây (SC-013); ComposePage (012) hiển thị rõ từng kết nối bằng tên + mã rút gọn

**Checkpoint**: US8 – nhiều kết nối ổn định, độc lập.

---

## Phase 10: User Story 7 – Kết nối lại và ngắt kết nối (P2)

**Goal**: kết nối lại giữ nguyên `connectionId` (bài đã lên lịch không đứt); ngắt xóa mã quyền ngay, thu hồi phía nền tảng khi có thể.

**Independent Test**: kết nối, tạo bài đã lên lịch, cho kênh hết hạn, kết nối lại cùng Page ⇒ cùng mã kênh + hạn mới + bài nguyên vẹn; Page khác ⇒ `WRONG_CHANNEL`, kênh cũ không đổi; ngắt ⇒ `*_ciphertext = NULL` cùng giao dịch.

### Tests for User Story 7

- [ ] T070 [P] [US7] DB/HTTP test `apps/server/test/db/platform-gateway/reconnect-disconnect.db.spec.ts`: kết nối lại cùng `external_id` ⇒ cùng `id`, hạn mới, `channel_variants`/`publish_attempts` nguyên vẹn (SC-008, 100% bài giữ kênh + giờ); Page khác ⇒ `WRONG_CHANNEL`; ngắt ⇒ `status='disconnected'`, `disconnected_at`, hai cột `*_ciphertext` NULL, `onDisconnect` hủy lượt chưa gửi trong **cùng giao dịch**, lượt `processing|unknown` để chạy xong; `DELETE` lặp ⇒ `200` idempotent; ngắt rồi kết nối lại ⇒ hàng mới (US7-3); thu hồi thất bại ⇒ `revoked:'failed'` + `hintVi` nhưng **vẫn xóa** mã phía mình (FR-017)
- [ ] T071 [P] [US7] `PGT/plan-lifecycle.spec.ts`: gói hết hạn ⇒ `connect` (cả kết nối mới lẫn kết nối lại) bị `403 PLAN_EXPIRED`, vẫn xem + ngắt được; việc hằng ngày **0 lời gọi nền tảng, 0 thông báo**; gia hạn ⇒ lần chạy kế tiếp kiểm tra lại từng kết nối độc lập (US7-7); `disconnectAllForAccount` + việc `platform_gateway.disconnect_all` chạy lại hai lần (SC-009)

### Implementation for User Story 7

- [ ] T072 [US7] Kết nối lại trong `connect-session`/`connections.service`: `connect {reconnectConnectionId}` ghi vào `connect_states.reconnect_connection_id`; sau gọi lại, ứng viên có `external_id` **bằng** kênh gốc ⇒ cập nhật token tại chỗ (`updateVersioned`, giữ `id`, `token_issued_at` mới), khác ⇒ `WRONG_CHANNEL` và kênh cũ không đổi; không qua màn hình chọn Page; `404 CONNECTION_NOT_FOUND` khi sai mã
- [ ] T073 [US7] `PG/internal/connections/revoke.ts` + `GET /channels/:connectionId/disconnect-preview` + `DELETE /channels/:connectionId`: preview trả `scheduledImpact` + `dependents` (Instagram liên quan); `DELETE` trong **một giao dịch**: đọc mã → `status='disconnected'`, `disconnected_at`, hai `*_ciphertext := NULL`, `onDisconnect`, kiểm toán, thông báo gom cho Instagram phụ thuộc; thu hồi phía nền tảng **sau** bằng bản trong bộ nhớ, thời gian chờ 5 giây, không chặn xóa; Facebook chỉ thu hồi khi là kết nối **cuối cùng** dùng chung mã người dùng (so băm `refresh_ciphertext`, không giải mã), ngược lại `unsupported` + hướng dẫn gỡ trong cài đặt Facebook
- [ ] T074 [US7] `disconnectAllForAccount()` + việc `platform_gateway.disconnect_all` (khóa `disconnect_all:{accountId}`, 5 lần giãn cách tăng dần, idempotent; thu hồi ≤ 5 giây/kết nối, song song ≤ 5) trong `PG/internal/maintenance/disconnect-all.handler.ts`; ghi chú điểm nối cho luồng xóa tài khoản (FR-14, chưa có) trong `docs/wiki`
- [ ] T075 [P] [US7] Web: `WEB/DisconnectDialog.tsx` (mở bằng `disconnect-preview`; nêu số bài đã lên lịch cho **riêng kênh này** + "Instagram @… liên kết với Page này sẽ cần kết nối lại" + "bài và lịch sử đã đăng vẫn được giữ"; nút "Ngắt và xóa quyền"; bẫy tiêu điểm, đóng bằng Esc; khi `revoked='failed'` hiện `hintVi`) và luồng "Kết nối lại" trên đúng thẻ (banner "Đã kết nối lại", `WRONG_CHANNEL` ⇒ lựa chọn "Chọn lại"/"Ngắt kênh"); `useApiMutation` + `invalidate(queryKeys.channels.*)`

**Checkpoint**: US7 – vòng đời kênh đầy đủ.

---

## Phase 11: User Story 9 – TikTok sau công tắc theo khách hàng (P2)

**Goal**: TikTok mặc định tắt, bật/tắt theo từng khách ≤ 1 phút không cần phát hành, chặn ở API **và** Worker, vô hình khi tắt.

**Independent Test**: khách A tắt ⇒ API từ chối + giao diện không có TikTok + **0 lời gọi mạng**; bật cho A ⇒ kết nối được, B vẫn không thấy; tắt lại ⇒ "Tạm tắt", ngắt được, mã quyền còn mã hóa; đổi mặc định ⇒ khách không ghi đè thấy TikTok, khách ghi đè `off` vẫn không.

### Tests for User Story 9

- [ ] T076 [P] [US9] `PGT/tiktok-flag.spec.ts`: khách A tắt/B bật ⇒ A không thấy TikTok ở overview, gọi `connect|confirm|recheck` ⇒ `403 FEATURE_NOT_ENABLED`; **0 lời gọi mạng** (đếm trên `tiktok-stub`) ở mọi thao tác kể cả Worker `check_connection`; kiểm thử cấu trúc: `getAdapter('tiktok')` ở `real` luôn trả `FeatureGuardedAdapter`; bật ⇒ ≤ 1 phút (đồng hồ giả) kết nối được; tắt lại ⇒ `suspended`, ngắt được; đổi mặc định `true` ⇒ khách không ghi đè thấy, khách `off` không thấy; lỗi đọc cấu hình ⇒ `enabled=false` và màn hình Facebook/Instagram vẫn bình thường
- [ ] T077 [P] [US9] `PGT/staff-features.http.spec.ts`: chủ/CTV/`support` gọi `PUT` ⇒ `403`; thiếu `reason` ⇒ `422`; mỗi lần đổi có đúng 1 dòng `feature_override_events` + 1 dòng `infra.audit_log` `feature.set`; bật lại ⇒ `recheck_required=true` cho kết nối TikTok của tài khoản trong cùng giao dịch; A không đọc/sửa `feature_overrides`/`feature_override_events` của B
- [ ] T078 [P] [US9] Hợp đồng `TiktokAdapter` trong `PGT/adapter-contract.spec.ts`: `authorizeUrl`, `exchangeCallback` (một ứng viên `open_id`), `checkAccount` (`video.publish|video.upload` + `max_video_post_duration_sec`; thiếu quyền ⇒ `SCOPE_MISSING`), `expiryOf` (`token` = hạn `refresh_token`), `refreshToken` ghi **cả hai** mã mới, `revoke`, `mediaRules` chỉ video; `submit`/`checkStatus` ⇒ `failed` `user_action` `TIKTOK:POSTING_NOT_AVAILABLE`, **không bao giờ `transient`**; `reconcile` ⇒ `unsupported`

### Implementation for User Story 9

- [ ] T079 [US9] `PG/internal/adapters/tiktok/{tiktok.adapter.ts, tiktok-client.ts, tiktok-errors.ts}` theo `contracts/meta-tiktok-adapters.md` mục 4 (`fetch` + `AbortSignal` ≤ `TIKTOK_TIMEOUT_MS`; URL log che `code|client_secret|access_token`); `capabilities`: `reconcile:false, asyncProcessing:true, tokenRefresh:true, reportsQuota:false, maxReconcileWindowHours:null`; đăng ký trong `registry.ts` **chỉ khi** `driver=real` (luôn có bản giả cho dev/test); chỉ tạo qua `FeatureGuardedAdapter` (decorator gọi `requireFeature('channel.tiktok')` **trước** khi chạm `TiktokClient`)
- [ ] T080 [US9] `requireFeature` ở mọi điểm: `startConnect`, `handleCallback`, `confirm`, `recheck`, `check_connection` (Worker), `PlatformGatewayService` với `channelType='tiktok'`; tắt/không đọc được ⇒ `403 FEATURE_NOT_ENABLED` (API) hoặc bỏ qua + ghi nhật ký (Worker); `confirm` kiểm **lại** công tắc (tắt giữa chừng ⇒ hủy phiên, không tạo kết nối); `deriveState` ⇒ `suspended`/`FEATURE_OFF`, `status` công khai `disconnected`, giữ mã quyền mã hóa, Worker không làm mới
- [ ] T081 [US9] `PG/internal/features/features.service.ts` + `staff-features.controller.ts`: `GET /staff/features/channel.tiktok`, `PUT /staff/features/channel.tiktok/default`, `PUT /staff/accounts/:accountId/features/channel.tiktok` (`@StaffAccess('feature.manage')`, `{value:'on'|'off'|'default', reason: 1..500}`); **một giao dịch**: upsert/xóa `feature_overrides` (hoặc cập nhật `gateway_settings`) + chèn `feature_override_events` + `infra.audit_log` `feature.set` (metadata `flag, old, new, reason_len`) + `recheck_required=true` cho kết nối TikTok + xóa cache cục bộ; ghi đè dùng `systemTx({tenant: accountId})` (không `BYPASSRLS`); danh sách khóa hợp lệ một hằng số + CHECK
- [ ] T082 [P] [US9] Lệnh nội bộ `apps/server/src/ops/staff-feature.ts`: `pnpm staff feature get|set-default|set <accountId> --value on|off|default --reason "…"` bọc cùng `features.service` (cùng kiểm toán, bắt buộc phiên nhân viên/`actor`); thêm script `staff` vào `apps/server/package.json`
- [ ] T083 [P] [US9] Web: vẽ nhóm/nút/bộ lọc TikTok **chỉ khi** `overview.features.tiktok=true`; chú thích "TikTok chỉ đăng video" + giới hạn thời lượng/dung lượng nếu biết; nhãn "đang thử nghiệm" khi `experimental`; thẻ `suspended` chỉ có **Xem/Ngắt** + chú thích "Tính năng đang tạm tắt"; test DOM `features.tiktok=false` ⇒ **0** nút/thẻ/bộ lọc/văn bản "TikTok" ở `ChannelsPage`, `SelectChannelsPage`, menu (SC-011)

**Checkpoint**: US9 – TikTok kiểm soát được, không phát hành lại khi TikTok duyệt (SC-012).

---

## Phase 12: Polish & Cross-Cutting

**Purpose**: tài liệu, kiểm tra hiến pháp, cổng chất lượng.

- [ ] T084 [P] Viết `apps/server/docs/channels.md` (hướng dẫn lập trình viên: vault, trạng thái dẫn xuất, cổng ngược, công tắc, việc nền, cách thêm nền tảng) và liên kết từ `apps/server/docs/gateways.md` (mục 1, 5, 6); thêm `docs/wiki/modules/platform_gateway.md` (qua `/speckit-wiki-ingest 010` sau khi merge – không tự commit)
- [ ] T085 [P] Cập nhật tài liệu yêu cầu (Hiến pháp: quyết định có truy vết): `TaiLieuDacTa/` đặc tả yêu cầu – ghi chú TikTok vào giai đoạn 1 ở dạng tắt (mục phạm vi) + mã quyền `channel.view`/`feature.manage` (mục 3.1) + nhóm quyền `analytics`/`ads`; **Kiến trúc dữ liệu mục 9**: thêm **TikTok** vào danh sách bên nhận dữ liệu ở nước ngoài và cập nhật hồ sơ đánh giá tác động Q-D3/C6 (Meta nhận thêm dữ liệu thống kê); cập nhật `.specify/memory/architecture.md` nếu bảng module/hàng chờ đổi
- [ ] T086 Chạy `/constitution-review` trên toàn bộ thay đổi (trọng tâm I tenant, II không đăng nhầm/`status` tương thích, VII mã hóa + không rò, IV ranh giới `allowedDeps`), ghi kết quả vào mục "Kiểm tra hiến pháp sau thiết kế" của plan.md
- [ ] T087 [P] Rà soát trợ năng + hiệu năng: `GET /channels/overview` ≤ 1 giây với 15 kết nối (đo trong test), Playwright axe ở 360/768/1280 px, vùng chạm ≥ 44 px, trạng thái không chỉ dựa vào màu, tên Page ≤ 120 ký tự/emoji không vỡ bố cục
- [ ] T088 [P] Test tương thích CSDL bản cũ/mới: `pnpm test:compat`; `pnpm db:lint-migrations` (migration chỉ thêm, không đổi tên/xóa); API và Worker phát hành cùng nhau
- [ ] T089 Chạy toàn bộ cổng như CI: `pnpm typecheck; pnpm lint; pnpm check:boundaries; pnpm check:secrets; pnpm db:check; pnpm test; pnpm test:db; pnpm test:queue; pnpm test:web-e2e; pnpm verify` – tất cả xanh; ghi lại kết quả thất bại (nếu có) thay vì bỏ qua
- [ ] T090 Chạy lại **quickstart.md** mục 1–3 với bản giả (10 kịch bản thủ công + kiểm chứng bí mật); ghi các dữ kiện thật còn thiếu (hạn token Page, `data_access_expires_at`, quyền tối thiểu, TikTok) vào `research.md` R1/R2 và cập nhật POC-2; liệt kê rủi ro còn mở: KMS thật (K5), App Review quyền `ads`/`analytics`, TikTok chưa duyệt

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (P1)** → **Foundational (P2)** → các user story → **Polish (P12)**.
- T001 phải xong trước mọi việc sửa mã (đảm bảo worktree đã sync `dev`). T009 → T010 → T016; T006 → mọi DTO; T015 → bộ chuyển đổi của US1/US2/US9.

### User Story Dependencies

| Story | Phụ thuộc | Ghi chú |
|---|---|---|
| **US1** (P1, MVP) | Foundational | dùng vault giả cho tới khi US4 xong; `checkAccount` cơ bản |
| **US4** (P1) | Foundational; nên làm ngay sau US1 | thay vault giả bằng phong bì; bắt buộc trước staging/production |
| **US3** (P1) | US1 | hoàn thiện kiểm tra điều kiện + recheck + bảng lỗi |
| **US2** (P1) | US1, US3 | Instagram dùng chung `confirm` và kiểm tra điều kiện |
| **US6** (P1) | US1; hiển thị đủ cần US2/US3 | màn hình chính; thẻ dùng `deriveState` |
| **US5** (P1) | US1, US6 (thẻ/banner), Foundational (`jobs`, notifications) | |
| **US8** (P1) | US1, US2, US6 | nhiều kết nối + phụ thuộc Page nguồn |
| **US7** (P2) | US1, US5 | kết nối lại, ngắt, gói hết hạn |
| **US9** (P2) | Foundational (FeatureGate), US6 | TikTok tách riêng, có thể làm song song với US5/US7 |

Không có phụ thuộc vòng; mỗi story kiểm thử độc lập bằng bản giả.

### Within Each User Story

Kiểm thử (thất bại trước) → adapter/dịch vụ → điểm cuối → giao diện. Bảng/migration ở Foundational.

### Parallel Opportunities

- Setup: T002–T005 song song.
- Foundational: T006, T007, T008, T011, T012, T013, T014, T019 song song sau khi T001 xong; T009→T010→T016 tuần tự.
- Sau Foundational: US1 (nhóm B), US9 (nhóm C: T076–T083 gần như độc lập), US4 (T029–T033) song song nếu có nhiều người; một người thì theo thứ tự P1 → US4 → US3 → US2 → US6 → US5 → US8 → US7 → US9.
- Trong story: các test `[P]` và thành phần web `[P]` khác tệp.

---

## Parallel Example: User Story 1

```text
# Test song song (khác tệp):
T020 Hợp đồng FacebookAdapter       T021 Kiểm thử HTTP luồng kết nối       T022 DB test đua kết nối

# Web song song sau khi API xong:
T027 SelectChannelsPage             T028 ConnectMenu + tuyến
```

---

## Implementation Strategy

### MVP First (US1 + US4)

1. Phase 1 → Phase 2 (nền tảng, cổng cô lập tenant).
2. US1 (kết nối Facebook với Meta giả) → **dừng & kiểm**: 1 Page kết nối được, không rò mã.
3. US4 (vault phong bì + quét bí mật + truy cập chéo) – bắt buộc trước khi lên staging.
4. Thêm US3 → US2 → US6 → **đủ để quay video xét duyệt Meta (SC-010)** (cần 013).

### Incremental Delivery

US5 (vòng đời quyền) → US8 (nhiều kết nối) → US7 (kết nối lại/ngắt) → US9 (TikTok, mặc định tắt). Mỗi bước vẫn giữ `status` 4 giá trị nên **không phá 012/013**.

### Rủi ro cần theo dõi khi thi công

- KMS thật (K5) chưa chốt: production **bị chặn** cho tới khi có (`assert-no-fakes`); staging dùng `env-master-key`.
- Dữ kiện Meta/TikTok chưa kiểm chứng đánh dấu [POC-2] – đổi bằng cấu hình, không sửa luồng.
- Nhóm quyền `ads`/`analytics` có thể bị Meta từ chối: nộp hồ sơ chỉ với `publish` bằng cách đổi `CHANNEL_SCOPE_GROUPS`, không sửa mã.

## Notes

- Mọi ghi trạng thái dùng `UPDATE … WHERE version = :v`; không giữ giao dịch CSDL khi gọi nền tảng.
- Không cache mã quyền và trạng thái quyền; cache ≤ 60 giây **chỉ** cho công tắc/cấu hình.
- Tiền/AI không liên quan 010 (Nguyên tắc III: N/A); không hiển thị số tiền ở bất kỳ thông báo nào.
- Commit sau mỗi nhóm việc; dừng ở mỗi Checkpoint để kiểm story độc lập.
