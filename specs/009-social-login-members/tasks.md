---

description: "Danh sách việc cho 009 – Đăng nhập Google / Facebook, cách đăng nhập, mời / gỡ cộng tác viên"
---

# Tasks: Tài khoản & đăng nhập đầy đủ – Google / Facebook, liên kết cách đăng nhập, mời / gỡ cộng tác viên

**Input**: Tài liệu thiết kế ở `specs/009-social-login-members/` (plan.md, spec.md, research.md,
data-model.md, contracts/, quickstart.md)

**Prerequisites**: plan.md, spec.md, research.md (R1–R20), data-model.md, contracts/auth-http-api.md,
contracts/module-api.md

**Tests**: **Có**. Spec có tiêu chí kiểm thử độc lập cho từng câu chuyện và các SC đo được (SC-003, SC-005,
SC-007, SC-008, SC-009, SC-010, SC-011); hiến pháp bắt buộc kiểm thử truy cập chéo cho bảng tenant mới, kiểm
thử hàm `SECURITY DEFINER` và "chạy lại hai lần" cho việc nền. Kiểm thử của mỗi câu chuyện viết trước và
phải **đỏ** trước khi làm phần triển khai.

**Organization**: Theo câu chuyện người dùng. Migration, hàm CSDL, `allowDetached`, `IdentityProvider`, máy
trạng thái `oauth_flows` và việc `account.mail_notice` là nền của mọi câu chuyện nên nằm ở Phase 2. FR-009a
(thông báo của Meta) không thuộc câu chuyện nào trong spec nên có phase riêng (Phase 8), không gắn nhãn
`[USx]`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: chạy song song được (khác tệp, không phụ thuộc việc chưa xong)
- **[Story]**: US1…US5 theo spec.md
- Đường dẫn tính từ gốc repo (worktree `impl/009-social-login-members`)

## Path Conventions

- API/Worker: `apps/server/src/`; kiểm thử `apps/server/test/` – đơn vị + e2e (`*.spec.ts`,
  `*.e2e.spec.ts`: `pnpm --filter @app/server test`), CSDL thật (`test/db/*.db.spec.ts`: `pnpm test:db`),
  hàng chờ (`test/queue/*.queue.spec.ts`: `pnpm test:queue`)
- Web: `apps/web/src/`, kiểm thử `apps/web/test/`
- Dùng chung: `packages/shared/src/`
- Công cụ: `tooling/`

## Quy ước chung cho mọi việc

- Định danh tiếng Anh, chú thích và thông điệp tiếng Việt. Ánh xạ thuật ngữ: research.md "Thuật ngữ mới".
- Module chỉ truy cập CSDL qua `tenantTx`/`systemTx`, và riêng xác thực qua `authTx`/`runInAccountScope`
  (004). Dùng `account.current_account_id()`, không dùng `current_setting('app.account_id')`.
- Mã tài khoản chỉ lấy từ phiên hoặc từ kết quả hàm `SECURITY DEFINER`; không điểm cuối nào nhận mã tài
  khoản từ yêu cầu.
- Không ghi vào nhật ký, `infra.audit_log.metadata`, dữ liệu việc hay phản hồi lỗi: mật khẩu, mã phiên, mã
  một lần, `token_hash`, `code`, `state`, `code_verifier`, `signed_request`, mã quyền của nhà cung cấp,
  email (FR-029, FR-030). `metadata` kiểm toán chỉ có `{ ip, ua_family, reason, provider }`.
- Mọi chuyển trạng thái (lời mời, `oauth_flows.stage`, ghế) là `UPDATE … WHERE <trạng thái mong đợi>`; 0
  dòng bị ảnh hưởng = thất bại có chủ đích, không ném lỗi 500.
- UUID v7 sinh ở ứng dụng, kể cả mã truyền vào hàm CSDL. Thời gian `timestamptz` UTC.
- Thư và màn hình: tiếng Việt đời thường, không có số tiền; mã một lần nằm ở `#fragment` của liên kết.
- Phiên bản thư viện mới khóa chính xác (`pnpm add -E`).
- Số migration `0014`/`0015` đánh lại nếu trùng khi hợp nhất (research R20).

---

## Phase 1: Setup (hạ tầng dùng chung)

**Purpose**: Thêm phụ thuộc và cấu hình cho nhà cung cấp đăng nhập.

- [ ] T001 Thêm `arctic` khóa phiên bản chính xác: `pnpm --filter @app/server add -E arctic` trong `apps/server/package.json`. Sau khi cài, đọc tài liệu/kiểu của **đúng phiên bản đã khóa** trong `node_modules/arctic` (lớp `Google`, `Facebook`, `generateState`, `generateCodeVerifier`, `decodeIdToken`, lỗi `OAuth2RequestError`) và ghi tên hàm + chữ ký thực tế thành chú thích đầu tệp `apps/server/src/modules/account/internal/auth/oauth/identity-provider.ts` (tạo tệp rỗng có chú thích; nội dung ở T020) – không dựa trí nhớ (research R1)
- [ ] T002 [P] Thêm cấu hình ở `apps/server/src/core/config/oauth-config.ts` (mới) và nối vào `apps/server/src/core/config/config.schema.ts`, `load-config.ts`: `OAUTH_DRIVER` (`real` | `fake`, mặc định `fake` ở dev/test), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` (bắt buộc khi `real`), `FACEBOOK_GRAPH_VERSION`, `OAUTH_FLOW_TTL_MINUTES=10`, `LINK_CONFIRM_TTL_MINUTES=30`, `REAUTH_WINDOW_MINUTES=10`, `INVITE_TTL_DAYS=7`, `INVITE_MAX_PER_ACCOUNT_PER_DAY=10`, `DETACHED_RETENTION_DAYS=90`, `DETACHED_NOTICE_DAYS=7` (contracts/module-api.md mục 6). Thêm `OAUTH_DRIVER=fake` vào danh sách bị từ chối ở staging/production trong `apps/server/src/core/config/assert-no-fakes.ts`. Bổ sung ca kiểm thử vào `apps/server/test/config.spec.ts`: thiếu khóa khi `real` → lỗi cấu hình; `fake` ở production → từ chối khởi động
- [ ] T003 [P] Thêm các biến của T002 vào `apps/server/.env.example` (giá trị dev: `OAUTH_DRIVER=fake`, khóa Google/Facebook để trống có chú thích "bắt buộc khi OAUTH_DRIVER=real; lấy từ kho bí mật", các TTL để chú thích với mặc định) và vào `apps/server/test/helpers/auth-env.ts` + `apps/server/src/ops/e2e-env.ts` (`OAUTH_DRIVER=fake`)

---

## Phase 2: Foundational (điều kiện tiên quyết – CHẶN mọi câu chuyện)

**Purpose**: Kiểu dùng chung, cấu trúc CSDL + hàm, lớp chặn quyền với tài khoản chờ, nhà cung cấp đăng nhập
(thật + giả lập), máy trạng thái `oauth_flows`, việc gửi thư không mã.

**⚠️ CRITICAL**: Không câu chuyện nào bắt đầu được trước khi phase này xong.

### Kiểu và lược đồ dùng chung

- [ ] T004 [P] Trong `packages/shared/src/core/error-response.ts` và `packages/shared/src/core/vi-error-messages.ts`: thêm 17 mã lỗi của contracts/auth-http-api.md mục 8 với đúng HTTP, thông điệp và `actions` trong bảng (`OAUTH_CANCELLED`, `OAUTH_FAILED`, `OAUTH_FLOW_INVALID`, `PROVIDER_UNAVAILABLE`, `IDENTITY_IN_USE`, `PROVIDER_ACCOUNT_CONFLICT`, `LOGIN_METHOD_EXISTS`, `LAST_LOGIN_METHOD`, `REAUTH_REQUIRED`, `REAUTH_MISMATCH`, `INVITE_INVALID`, `INVITE_EMAIL_MISMATCH`, `INVITE_EMAIL_IN_USE`, `INVITE_SELF`, `ALREADY_IN_ACCOUNT`, `NO_ACCOUNT`, `SIGNED_REQUEST_INVALID`); thêm `ErrorAction.kind = 'reauth'`; đổi thông điệp `SEATS_FULL` thành "Đã đủ 2 cộng tác viên. Gỡ một người hoặc hủy một lời mời để mời người khác."
- [ ] T005 [P] Trong `packages/shared/src/auth/schemas.ts`, `responses.ts`, `index.ts`: thêm lược đồ Zod và kiểu cho mọi thân yêu cầu/phản hồi của contracts/auth-http-api.md mục 1–6: `OAuthStartRequest` (`{ purpose: 'login' }` | `{ purpose: 'invite', invitationToken, acceptTerms: true, termsVersion }`), `OAuthPendingResponse` (`stage` ∈ `signed_in` | `needs_signup` | `needs_email` | `needs_link_confirm` | `awaiting_email` | `completed` | `failed`; `methods`; `hint`; `error`), `OAuthSignupRequest`, `OAuthLinkPasswordRequest`, `OAuthConfirmRequest`, `LoginMethod` (`kind` ∈ `password` | `google` | `facebook`), `LoginMethodsResponse` (`reauthFresh`), `LoginMethodStartRequest` (`purpose` ∈ `link` | `reauth`), `ReauthRequest`, `MembersResponse`, `InvitationView`, `InviteRequest`, `InvitationPreviewResponse` (`mode` ∈ `new_user` | `login_required` | `in_use`), `InvitationAcceptRequest`, `AcceptExistingRequest`, `MyInvitationsResponse`, `ClaimAccountRequest`, `DataDeletionStatusResponse`; mở rộng `MeResponse.account.status` thêm `'unclaimed'`

### Cấu trúc CSDL

- [ ] T006 Sửa `apps/server/src/core/db/tenant-root.ts`: `CHECK` của `accounts.status` thêm `'unclaimed'`. Sửa `apps/server/src/modules/account/internal/db/schema.ts` theo data-model mục 1: `users` thêm `detached_at timestamptz NULL`, `deletion_notice_sent_at timestamptz NULL` + `CHECK (deletion_notice_sent_at IS NULL OR detached_at IS NOT NULL)`; `login_identities` thêm `provider_email text NULL`, `provider_display_name text NULL` + `CHECK (provider <> 'password' OR (provider_email IS NULL AND provider_display_name IS NULL))`; `sessions` thêm `reauthenticated_at timestamptz NULL` và `revoke_reason` thêm `identity_link_reset`, `account_joined`, `account_claimed`; `auth_throttle.kind` thêm `mail_invite`, `invite_account`, `mail_link_confirm`, `oauth_start_ip`; `memberships.user_id` **bỏ khóa ngoại** tới `users.id` (bỏ `.references(...)`, thành mã tham chiếu – data-model mục 1), giữ `NOT NULL` và mọi ràng buộc khác
- [ ] T007 Trong `apps/server/src/modules/account/internal/db/schema.ts` thêm 2 bảng tenant bằng `tenantTable` (data-model mục 2): `invitations` (`email text`, `email_normalized text`, `invited_by_user_id uuid`, `role text` `CHECK (role = 'collaborator')`, `seat smallint` `CHECK (seat BETWEEN 1 AND 2)`, `status text` `CHECK` ∈ `pending` | `accepted` | `cancelled` | `expired`, `token_hash bytea`, `account_label text NULL` (≤ 120 ký tự – thêm `CHECK (char_length(account_label) <= 120)`), `last_sent_at`, `expires_at`, `accepted_user_id uuid NULL`, `closed_at timestamptz NULL`; duy nhất `(account_id, seat) WHERE status = 'pending'`, duy nhất `(account_id, email_normalized) WHERE status = 'pending'`, duy nhất toàn cục `token_hash`, chỉ mục `(email_normalized) WHERE status = 'pending'`) và `former_members` (`user_id uuid` **không** khóa ngoại, `display_name text`, `removed_at timestamptz`, `removed_by_user_id uuid`; duy nhất `(account_id, user_id)`). Khai báo hai chỉ mục toàn cục của `invitations` trong `indexExceptions` kèm lý do ghi ở data-model
- [ ] T008 Trong cùng tệp `schema.ts` thêm 2 bảng dùng chung bằng `sharedTable(..., { reason })` (data-model mục 3, chép nguyên `reason`): `oauth_flows` (đủ các cột trong bảng: `flow_token_hash bytea` duy nhất, `state_hash bytea`, `code_verifier text NULL`, `provider` ∈ `google` | `facebook`, `purpose` ∈ `login` | `link` | `reauth` | `invite`, `stage` ∈ `started` | `signed_in` | `needs_signup` | `needs_email` | `needs_link_confirm` | `awaiting_email` | `completed` | `failed`, `actor_user_id`, `invitation_id`, `terms_version`, `terms_accepted_at`, `provider_subject`, `provider_email`, `provider_email_verified boolean`, `provider_display_name`, `claimed_email`, `claimed_email_normalized`, `display_name`, `target_user_id`, `target_tenant_id` (không đặt tên `account_id`), `password_allowed boolean`, `mail_token_hash bytea NULL` duy nhất, `result_code text NULL`, `expires_at`, `created_at`, `updated_at`, `closed_at`; `CHECK` cho `provider`, `purpose`, `stage`) và `meta_deletion_requests` (`confirmation_code text` duy nhất, `kind` ∈ `deauthorize` | `data_deletion`, `subject_hmac bytea`, `status` ∈ `completed` | `no_data`, `received_at`; duy nhất `(kind, subject_hmac)`). Cấp quyền cho `app` như các bảng dùng chung của 004 (`auth_throttle`)
- [ ] T009 Sinh migration `apps/server/drizzle/migrations/0014_account_social_members_tables.sql` bằng `pnpm db:generate` từ T006–T008; rà tệp sinh ra: chỉ có `ADD COLUMN`, `CREATE TABLE`, `CREATE INDEX`, thay `CHECK` (drop + add trong cùng tệp), chính sách RLS `tenant_isolation` cho 2 bảng tenant, và **đúng một** `DROP CONSTRAINT` cho khóa ngoại `memberships.user_id → users.id` (tương thích ngược: bản API cũ không dựa vào ràng buộc này); không có `DROP COLUMN`/`DROP TABLE`. Nếu `db:lint-migrations` chặn `DROP CONSTRAINT` thì thêm ngoại lệ có lý do cho đúng dòng này. Chạy `pnpm db:migrate && pnpm db:check && pnpm db:lint-migrations` phải sạch
- [ ] T010 [P] Viết kiểm thử **đỏ trước** `apps/server/test/db/social-functions.db.spec.ts` cho 11 hàm ở data-model mục 4 (dùng `apps/server/test/db/helpers/auth-seed.ts`, mở rộng nếu cần): (a) vai trò không được cấp gọi → bị từ chối (`app` gọi hàm của `system` và ngược lại, `support` gọi bất kỳ); (b) mỗi hàm chỉ trả đúng các cột liệt kê; (c) `auth_resolve_session_v2` trả `detached = true` khi tài khoản `unclaimed`; (d) `auth_lookup_identity` khớp chính xác, bỏ qua tài khoản đã xóa; (e) `auth_register_oauth` → `created` / `email_taken` / `identity_taken`, tạo đủ `accounts(active)` + `users` + `login_identities` + `memberships(owner, 0)` trong một khối; (f) `auth_find_invitation` chỉ trả khi `pending`, chưa quá hạn, tài khoản không `deleting`; `existing_user_state` ∈ `none` | `detached` | `member`; (g) `auth_accept_invitation_new` → `accepted` | `invalid` | `email_in_use` | `identity_taken` | `seat_taken`; (h) `auth_accept_invitation_existing` → `accepted` | `invalid` (không `pending`, quá hạn, tài khoản mời `deleting`) | `email_mismatch` (email đã xác minh của người dùng khác email lời mời) | `not_eligible` | `seat_taken`, chuyển `users` + `login_identities`, xóa `sessions` + `auth_tokens`, kích hoạt lại dòng `memberships` `removed`, xóa `former_members`, `detached_at = NULL` **và** `deletion_notice_sent_at = NULL` (người đã nhận thư báo trước vẫn chấp nhận được – không vi phạm `CHECK`), xóa tài khoản chờ; (i) `member_detach` → `detached` | `not_found` | `owner`, tài khoản lấy từ `account.current_account_id()`; (j) `detached_users_due('notice' | 'purge', …)` đúng mốc `retention − notice` / `retention` ngày và `notice` ngày sau thư, kiểm với tham số 90/7 **và** một bộ khác (vd 30/3); (k) `purge_detached_account` với tài khoản `active` hoặc chưa đủ ngày → `false`, không xóa gì; xóa thành công thì dòng `memberships` `removed` của người đó ở tài khoản cũ **còn nguyên** (không còn khóa ngoại); (l) `auth_housekeeping` chuyển `pending` quá hạn → `expired` và **trả đúng danh sách** `(account_id, invitation_id)` vừa hết hạn (chạy lần hai trả rỗng), xóa `invitations` đóng > 90 ngày, `former_members` > 12 tháng; (m) `auth_pending_invitations_for_email` chỉ trả lời mời `pending`, chưa quá hạn, của tài khoản không `deleting`
- [ ] T011 Tạo migration tay `apps/server/drizzle/migrations/0015_account_social_members_functions.sql` (`pnpm --filter @app/server db:generate:custom`) với 8 hàm cho `app` và 3 hàm cho `system` theo đúng hành vi ở data-model mục 4. Mọi hàm: `SECURITY DEFINER`, `OWNER owner`, `SET search_path = pg_catalog, account`, `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE` cho **đúng một** vai trò; tham số đặt theo quy ước của `0010_account_auth_functions.sql`. Chữ ký chốt: `auth_resolve_session_v2(p_token_hash bytea, p_touch_after interval, p_idle interval)`; `auth_lookup_identity(p_provider text, p_provider_subject text)`; `auth_register_oauth(p_account_id uuid, p_user_id uuid, p_identity_id uuid, p_membership_id uuid, p_display_name text, p_email text, p_email_normalized text, p_email_verified boolean, p_provider text, p_provider_subject text, p_provider_email text, p_provider_display_name text, p_terms_version text) RETURNS text`; `auth_find_invitation(p_token_hash bytea)`; `auth_pending_invitations_for_email(p_email_normalized text)`; `auth_accept_invitation_new(p_invitation_id uuid, p_token_hash bytea, p_user_id uuid, p_identity_id uuid, p_membership_id uuid, p_display_name text, p_password_hash text, p_provider text, p_provider_subject text, p_provider_email text, p_provider_display_name text, p_terms_version text) RETURNS text`; `auth_accept_invitation_existing(p_invitation_id uuid, p_user_id uuid) RETURNS text`; `member_detach(p_user_id uuid, p_shell_account_id uuid, p_shell_membership_id uuid, p_former_id uuid, p_removed_by_user_id uuid) RETURNS text`; `detached_users_due(p_kind text, p_limit int, p_retention_days int, p_notice_days int)`; `purge_detached_account(p_account_id uuid, p_retention_days int, p_notice_days int) RETURNS boolean` (hai tham số ngày lấy từ cấu hình T002); `auth_housekeeping() RETURNS TABLE (account_id uuid, invitation_id uuid)` (các lời mời vừa chuyển `expired` trong lần gọi này). `auth_accept_invitation_existing` trả thêm `'email_mismatch'` và đặt cả `detached_at`, `deletion_notice_sent_at` về NULL. Các hàm đổi ghế (`auth_accept_invitation_*`) lấy `pg_advisory_xact_lock(hashtextextended('account.seats:' || account_id::text, 0))` trước khi đọc ghế (research R9). Giữ nguyên hàm `auth_resolve_session` cũ (R20). Chạy `pnpm db:migrate && pnpm db:check`; T010 phải **xanh**
- [ ] T012 [P] Thêm `invitations`, `former_members` vào `apps/server/test/db/fixtures/cross-tenant-fixtures.ts` để `cross-tenant-coverage.db.spec.ts` phủ hai bảng mới; viết `apps/server/test/db/invitations-isolation.db.spec.ts`: trong ngữ cảnh tài khoản A không đọc/sửa/xóa được `invitations`, `former_members` của tài khoản B; không có ngữ cảnh → 0 dòng (SC-007, FR-031)

### Lõi `core/auth`: người ở tài khoản chờ

- [ ] T013 [P] Viết kiểm thử đơn vị **đỏ trước**: bổ sung `apps/server/test/auth/access.guard.spec.ts` và `apps/server/test/auth/access-declarations.spec.ts` theo contracts/module-api.md mục 1: `actor.detached` + khai báo không có `allowDetached` → 403 `NO_ACCOUNT` + nhật ký `auth.denied` (`reason: detached`); kiểm này chạy **sau** khi gắn người gọi và **trước** kiểm email/quyền; `allowDetached` kèm quyền → lỗi khi khởi động; `can(permission)` luôn `false` khi `detached`; bổ sung `apps/server/test/auth/origin-check.spec.ts`: đúng hai đường dẫn `/api/v1/auth/facebook/deauthorize`, `/api/v1/auth/facebook/data-deletion` được miễn kiểm tra nguồn gửi, mọi đường dẫn khác (kể cả tiền tố tương tự) vẫn bị kiểm
- [ ] T014 Hiện thực T013: `apps/server/src/core/context/actor.types.ts` (`CustomerActor.detached: boolean`), `apps/server/src/core/auth/actor.ts`, `access.decorators.ts` (tùy chọn `allowDetached`), `access-declarations.ts` (từ chối `allowDetached` + quyền khi quét khai báo), `access.guard.ts` (chặn `detached`), `auth-errors.ts` (`noAccount()` → 403 `NO_ACCOUNT`), `permissions.ts` (`can` trả `false` khi `detached`), `origin-check.middleware.ts` (danh sách miễn **cố định trong mã** gồm đúng hai đường dẫn)
- [ ] T015 Sửa `apps/server/src/core/auth/session-resolver.ts`, `session-cache.ts` và `apps/server/src/modules/account/internal/auth/session.service.ts` để tra phiên bằng `auth_resolve_session_v2` và mang `detached` vào `CustomerActor`; cho phép cấp phiên khi đăng nhập (`POST /auth/login`) cho người ở tài khoản chờ (trước đây 403 khi membership `removed`). Sửa `apps/server/src/modules/account/internal/auth/me.ts`: `account.status = 'unclaimed'` → `permissions = []`. Bổ sung ca vào `apps/server/test/auth/session-cache.spec.ts`
- [ ] T016 Trong `apps/server/src/modules/account/internal/auth/customer-auth.controller.ts` thêm `allowDetached: true` cho các điểm cuối của 004 ở contracts/auth-http-api.md mục 7: `GET /auth/me`, `POST /auth/logout`, `POST /auth/logout-all`, `POST /auth/password/change`, `PATCH /auth/email`, `POST /auth/email/resend` (giữ nguyên `allowUnverifiedEmail` đang có). Không thêm cho điểm cuối nào khác
- [ ] T017 [P] Tạo `apps/server/src/core/auth/account-label.ts`: `ACCOUNT_LABEL_RESOLVER` (Symbol) + `interface AccountLabelResolver { currentAccountLabel(): Promise<string | null> }` (contracts/module-api.md mục 1); xuất qua `apps/server/src/core/auth/auth.module.ts`. Chưa có nhà cung cấp → nơi dùng tiêm `@Optional()`
- [ ] T018 [P] Sửa `apps/server/src/core/logging/logging.module.ts`: với mọi route dưới `/api/v1/auth/oauth/` và `/api/v1/dev/oauth/` nhật ký yêu cầu ghi **đường dẫn mẫu, không ghi chuỗi truy vấn**; pino che các khóa `code`, `state`, `signed_request`, `code_verifier`, `invitationToken`, `token`, `password` (research R19). Thêm mẫu `code=`, `state=`, `signed_request=` vào `tooling/scan-secrets.mjs` kèm ca kiểm thử trong `tooling/test/`

### Nhà cung cấp đăng nhập

- [ ] T019 [P] Viết kiểm thử hợp đồng **đỏ trước** `apps/server/test/contracts/identity/identity-provider.contract.ts` + `identity.fake.contract.spec.ts` (chạy luôn) + `identity.sandbox.contract.spec.ts` (chỉ chạy khi có biến môi trường khóa thật, như 005): `authorizationUrl` chứa `state` (và `code_challenge` với Google), không chứa bí mật ứng dụng; `exchange` trả `ProviderProfile` không có mã quyền; lỗi phân loại được `cancelled` | `invalid_grant` | `unavailable` | `malformed`; hết chờ 10 giây → `unavailable`
- [ ] T020 Hiện thực `apps/server/src/modules/account/internal/auth/oauth/identity-provider.ts`: `interface IdentityProvider`, `type ProviderProfile = { provider: 'google' | 'facebook'; subject: string; email: string | null; emailVerified: boolean; displayName: string | null }`, `ProviderError` (contracts/module-api.md mục 3), token DI `IDENTITY_PROVIDERS` (map theo `name`)
- [ ] T021 Hiện thực bản giả lập `apps/server/src/modules/account/internal/auth/oauth/fake.provider.ts` + `fake-authorize.controller.ts`: `authorizationUrl` trỏ về `GET /api/v1/dev/oauth/fake/authorize?scenario=…` (`@Public`, **chỉ đăng ký khi `OAUTH_DRIVER=fake`**); kịch bản `google_verified`, `google_unverified`, `facebook_with_email` (`emailVerified = true`), `facebook_no_email` (`email = null`, `emailVerified = false`), `cancel`, `provider_down`; tham số tùy chọn `sub`, `email`, `name`; chuyển hướng về callback thật với mã giả mang kịch bản. Ở dev (không có `scenario`) hiện trang HTML tối giản để chọn kịch bản. Thêm ca vào `apps/server/test/e2e/dev-fakes-production-404.e2e.spec.ts`: production → 404
- [ ] T022 Hiện thực bản thật `apps/server/src/modules/account/internal/auth/oauth/arctic.providers.ts` theo chữ ký đã ghi ở T001: Google xin `openid profile email`, có PKCE, đọc `sub`, `email`, `email_verified`, `name` từ ID token bằng `decodeIdToken` rồi kiểm `iss`, `aud`, `exp`; `emailVerified` = đúng giá trị `email_verified`. Facebook xin `public_profile email`, gọi **một** lần `GET /{FACEBOOK_GRAPH_VERSION}/me?fields=id,name,email` kèm `appsecret_proof`, rồi bỏ mã quyền (không ghi CSDL, không ghi nhật ký); **`emailVerified = true` khi có trả email, `false` khi không** – đây là chỗ duy nhất quyết định độ tin của email Facebook, ghi chú thích trỏ research R3 và quickstart mục 3. Hết chờ gọi nhà cung cấp 10 giây → `unavailable`. Địa chỉ quay về `{WEB_BASE_URL}/api/v1/auth/oauth/{provider}/callback`. Không lấy ảnh đại diện (FR-006)
- [ ] T023 Đăng ký trong `apps/server/src/modules/account/account.module.ts`: chọn bản `arctic` hoặc `fake` theo `OAUTH_DRIVER`, controller giả lập chỉ khi `fake`. T019 (bản fake) phải **xanh**

### Máy trạng thái `oauth_flows`, bộ đếm, kiểm toán

- [ ] T024 [P] Viết kiểm thử **đỏ trước** `apps/server/test/auth/oauth-flow.spec.ts` (đơn vị, phần thuần) và `apps/server/test/db/oauth-flows.db.spec.ts` (CSDL thật): bảng chuyển giai đoạn đúng sơ đồ data-model mục 3 (mọi cặp không có trong sơ đồ bị từ chối); mỗi chuyển là cập nhật có điều kiện `WHERE id AND stage = $expected AND expires_at > now()` – hai yêu cầu đồng thời cùng chuyển → đúng một thành công; hạn theo giai đoạn (10 phút `started`; 30 phút `needs_*`; `awaiting_email` 24 giờ nếu email mới, 30 phút nếu trùng); `code_verifier` về NULL ngay khi quay về; gửi lại liên kết đổi `mail_token_hash` (mã cũ không còn tra được); tra theo cookie và theo mã thư chỉ bằng băm SHA-256
- [ ] T025 Hiện thực `apps/server/src/modules/account/internal/auth/oauth/oauth-flow.service.ts` qua `authTx`: `start(provider, purpose, ctx)` (sinh mã cookie 32 byte + `state` + `code_verifier` bằng hàm của `arctic`, lưu băm), `consumeCallback(flowToken, state)`, `findByCookie`, `findByMailToken`, `transition(id, from, to, patch)`, `issueMailToken(id, ttl)`, `fail(id, resultCode)`; hàm thuần `nextStage(...)` cho sơ đồ. Thêm vào `apps/server/src/core/auth/cookies.ts` cookie `__Host-oauth` (`HttpOnly; Secure; SameSite=Lax; Path=/`, 30 phút, xóa khi lượt kết thúc) + ca trong `apps/server/test/auth/cookies.spec.ts`. T024 phải **xanh**
- [ ] T026 [P] Mở rộng `apps/server/src/modules/account/internal/auth/throttle.service.ts` với 4 loại bộ đếm (data-model mục 5): `mail_invite` (khóa: email được mời, 3 / 60 phút), `invite_account` (khóa: mã tài khoản, `INVITE_MAX_PER_ACCOUNT_PER_DAY` / 24 giờ), `mail_link_confirm` (khóa: email đích, 3 / 60 phút, dùng chung cho thư xác nhận liên kết và hoàn tất đăng ký), `oauth_start_ip` (khóa: địa chỉ mạng, 30 / 60 phút); bổ sung ca vào `apps/server/test/db/auth-throttle.db.spec.ts`
- [ ] T027 [P] Mở rộng `apps/server/src/modules/account/internal/auth/audit.ts` với 19 hành động ở data-model mục 7 (kiểu hợp `action`, `reason` của `auth.oauth.failed` ∈ `cancelled` | `state_mismatch` | `expired` | `provider_error` | `account_unavailable`); hàm ghi chỉ nhận `{ ip, ua_family, reason, provider }`; hành động trước khi biết tenant ghi bằng `authTx` với `account_id = NULL`. `infra.audit_log.action` không có `CHECK` nên không cần migration cho danh mục hành động

### Thư không mã qua hàng chờ

- [ ] T028 [P] Viết kiểm thử **đỏ trước** `apps/server/test/queue/account-mail-notice.queue.spec.ts`: việc `account.mail_notice` tạo trong cùng giao dịch với dữ liệu (rollback → không có việc); dữ liệu việc chỉ có `{ template, userId, subjectUserId?, provider? }` (không email, tên, mã, liên kết); bộ xử lý tra người nhận trong tenant và gọi `Mailer.deliver`; người nhận không còn hoặc bị khóa → bỏ qua (thành công); lỗi tạm thời → thử lại; **chạy lại hai lần** với cùng khóa chống trùng → một thư
- [ ] T029 Tạo `apps/server/src/modules/account/jobs.ts` (theo mẫu `apps/server/src/modules/context/jobs.ts`) khai báo loại việc `account.mail_notice` (hàng chờ `notify`, phạm vi `tenant`), và `apps/server/src/modules/account/internal/auth/mail-notice.handler.ts`; thêm 6 mẫu thư không mã vào `apps/server/src/modules/account/internal/auth/mail/templates.ts`: `identityAdded`, `identityRemoved`, `identityLinkBlocked` ("Ai đó vừa thử đăng nhập bằng {Google/Facebook} với email của bạn. Tài khoản của bạn đã liên kết một tài khoản {…} khác nên không có gì thay đổi. Nếu là bạn, hãy đăng nhập bằng cách bạn vẫn dùng." – dùng ở T044), `identityRemovedByProvider` (hướng dẫn vào lại bằng "Quên mật khẩu"), `inviteAccepted`, `detachedDeletionNotice` (nêu ngày xóa và cách giữ lại) – tiếng Việt đời thường, không mã bí mật, không số tiền; hàm `enqueueMailNotice(tx, { template, userId, … , dedupeKey })` dùng `enqueue-registered` của module `queue`. Đăng ký trong `account.module.ts`. Thêm `account.mail_notice` vào `apps/server/test/unit/queue/job-types.spec.ts`. T028 phải **xanh**

### Hỗ trợ kiểm thử

- [ ] T030 [P] Mở rộng `apps/server/test/auth/helpers/app.ts` và `actors.ts`: `oauthLogin(agent, { scenario, sub?, email?, name? })` chạy trọn vòng `start` → trang giả lập → `callback` và trả `agent` giữ cookie; `seedOwner`, `seedCollaborator`, `seedInvitation` (trả cả mã rõ), `seedDetachedUser` (người ở tài khoản chờ, tùy chọn lùi `detached_at`); hàm đọc thư mới nhất theo người nhận từ `MAIL_TRANSPORT=memory` và rút mã trong `#token=`

**Checkpoint**: `pnpm db:migrate`, `pnpm db:check`, `pnpm test:db`, `pnpm --filter @app/server test`, `pnpm check:boundaries` đều xanh; mọi điểm cuối sẵn có vẫn chạy như 004.

---

## Phase 3: User Story 1 – Vào ứng dụng bằng tài khoản Google hoặc Facebook (Priority: P1) 🎯 MVP

**Goal**: Người mới bấm "Tiếp tục với Google/Facebook", đồng ý điều khoản và có ngay tài khoản khách hàng
với vai trò chủ; lần sau bấm là vào thẳng. Facebook không trả email → nhập email và xác minh qua thư.

**Independent Test**: Với nhà cung cấp giả lập: `google_verified` (và `facebook_with_email`) có email chưa
tồn tại → sau bước đồng ý có đúng 1 tài khoản, 1 người dùng, 1 vai trò chủ, 1 cách đăng nhập,
`emailVerified: true`; đăng xuất rồi đăng nhập lại → vào đúng tài khoản đó, không tạo thêm gì.

### Tests for User Story 1 (viết trước, phải đỏ)

- [ ] T031 [P] [US1] `apps/server/test/auth/oauth-login.e2e.spec.ts`: (1) `google_verified` và `facebook_with_email`, email mới → callback 303 về `{WEB}/oauth/result` **không tham số**; `GET /auth/oauth/pending` trả `needs_signup` với `suggestedDisplayName`, `suggestedEmail` đầy đủ; `POST /auth/oauth/signup` thiếu `acceptTerms: true` → 400 `VALIDATION_FAILED`, không tạo gì; đủ → 200 `MeResponse` (`role: owner`, `emailVerified: true`) + cookie phiên, có `terms_version` + thời điểm đồng ý, kiểm toán `auth.register.oauth`; (2) đăng nhập lại bằng danh tính đã liên kết → `signed_in`, cookie phiên, không hỏi điều khoản, không tạo dòng mới; (3) bỏ dở ở `needs_signup` → không có `accounts`/`users`/`login_identities` nào; (4) `facebook_no_email` và `google_unverified` → `needs_email`; `signup` với email mới → 202 `{ status: 'check_email' }`, **chưa** có người dùng; mở mã trong thư `completeSignup` qua `POST /auth/oauth/confirm` (không cần cookie `__Host-oauth`) → tạo tài khoản + phiên; mã dùng lần hai / quá 24 giờ → 400 `TOKEN_INVALID`; (5) `cancel` → `failed` với `OAUTH_CANCELLED`, `provider_down` → `OAUTH_FAILED`/`PROVIDER_UNAVAILABLE`, không tạo gì, kiểm toán `auth.oauth.failed` đúng `reason`; (6) callback không cookie, sai `state`, lặp lại, quá 10 phút → `OAUTH_FLOW_INVALID` (edge cases); (7) hai `signup` đồng thời cùng một lượt / cùng danh tính → đúng một người dùng; (8) người dùng bị khóa hoặc tài khoản `deleting` → `failed` `ACCOUNT_UNAVAILABLE` – cả khi danh tính đã liên kết **lẫn** khi danh tính chưa liên kết có email đã xác minh trùng người dùng đó (không vào `needs_link_confirm`, không tạo người dùng thay thế); email tự nhập trùng người dùng đó → vẫn 202 `check_email`, không gửi thư; (9) đổi email phía nhà cung cấp sau khi liên kết (cùng `sub`, email khác) → vẫn vào đúng người dùng, email trong ứng dụng không đổi; (10) `{provider}` lạ → 404; quá 30 lượt `start`/giờ từ một địa chỉ → 429 `RATE_LIMITED`; (11) `login_identities` chỉ có `provider_subject`, `provider_email`, `provider_display_name` – không cột nào chứa mã quyền; phản hồi `pending` không có `state`, mã nhà cung cấp, `provider_subject` (US1 kịch bản 7); (12) lối vào nhân viên nội bộ không có điểm cuối nhà cung cấp (FR-001)
- [ ] T032 [P] [US1] Kiểm thử web `apps/web/test/auth/oauth-result.spec.tsx` và bổ sung `login.spec.tsx`, `register.spec.tsx`: nút "Tiếp tục với Google"/"Tiếp tục với Facebook" có ở LoginPage và RegisterPage, **không** có ở StaffLoginPage; `OAuthResultPage` hiện đúng từng `stage`: `needs_signup` (tên điền sẵn, ô đồng ý **chưa tích**, nút "Tạo tài khoản" khóa đến khi tích), `needs_email` (ô email + tên + ô đồng ý → màn hình "Hãy kiểm tra email"), `failed` (thông điệp + nút "Thử lại" và "Đăng nhập bằng email"); `OAuthConfirmPage` đọc mã từ `#token=` rồi xóa khỏi thanh địa chỉ; `vitest-axe` không vi phạm ở 360 px

### Implementation for User Story 1

- [ ] T033 [US1] `apps/server/src/modules/account/internal/auth/oauth/oauth-login.service.ts` – phần bắt đầu và quay về: `start(provider, 'login')` (bộ đếm `oauth_start_ip`, `oauthFlow.start`, trả `authorizationUrl`; nhà cung cấp lỗi → 503 `PROVIDER_UNAVAILABLE`); `handleCallback(provider, query, flowToken)`: `consumeCallback` → `provider.exchange` → `auth_lookup_identity`; danh tính đã liên kết + người dùng/tài khoản hợp lệ → cấp phiên (dùng `session.service.ts`), `stage = signed_in`, kiểm toán `auth.oauth.succeeded`; danh tính chưa liên kết: `emailVerified` → tra người dùng theo email (`auth_lookup_email` của 004) → chưa có → `needs_signup`, đã có → `needs_link_confirm` (chi tiết ở US2; tạm thời đặt giai đoạn + `target_user_id`, `target_tenant_id`, `password_allowed`); không có email / chưa xác minh → `needs_email`; người dùng bị khóa / tài khoản `deleting` → `failed` `ACCOUNT_UNAVAILABLE` (áp dụng cả cho người dùng tìm được theo danh tính lẫn theo email đã xác minh – FR-008). Email trùng **nhân viên nội bộ** xử lý như chưa có người dùng khách hàng (US2 kịch bản 8). Mọi lỗi ghi `result_code` vào lượt, không ném ra ngoài
- [ ] T034 [US1] Trong `oauth-login.service.ts` – phần hoàn tất đăng ký: `pending(flowToken)` → `OAuthPendingResponse` (che `suggestedEmail` ở `needs_link_confirm`); `signup(flowToken, body)`: ở `needs_signup` gọi `auth_register_oauth` với email của nhà cung cấp, `email_verified = true` → `created` → cấp phiên, `completed`, kiểm toán `auth.register.oauth`; `identity_taken` → 409 `IDENTITY_IN_USE`; `email_taken` (tranh chấp) → chuyển `needs_link_confirm`. Ở `needs_email`: chuẩn hóa email (`email.ts` của 004), lưu `claimed_email*`, `display_name`, điều khoản → `awaiting_email` + `issueMailToken` (24 giờ) → gửi thư `completeSignup` bằng `MailDispatcher.sendAfterCommit` (bộ đếm `mail_link_confirm`; quá ngưỡng vẫn 202) → **luôn** 202 `{ status: 'check_email' }` (nhánh email trùng người dùng đã có làm ở T044). `confirm(token)`: tra `findByMailToken`, lượt đăng ký mới → `auth_register_oauth` với `claimed_email`, `email_verified = true` → phiên; không hợp lệ → 400 `TOKEN_INVALID`
- [ ] T035 [US1] Thêm mẫu thư có mã `completeSignup` (liên kết `{WEB}/oauth/confirm#token=…`, nêu hạn 24 giờ) vào `apps/server/src/modules/account/internal/auth/mail/templates.ts`
- [ ] T036 [US1] `apps/server/src/modules/account/internal/auth/oauth/oauth.controller.ts` + đăng ký trong `account.module.ts`: `POST /auth/oauth/:provider/start`, `GET /auth/oauth/:provider/callback` (**luôn 303** về `{WEB_BASE_URL}/oauth/result`, không tham số; đặt cookie phiên khi `signed_in`), `GET /auth/oauth/pending`, `POST /auth/oauth/signup`, `POST /auth/oauth/confirm` – tất cả `@Public`, kiểm đầu vào bằng lược đồ T005; `:provider` ngoài `google` | `facebook` → 404; xóa cookie `__Host-oauth` khi lượt kết thúc. T031 phải **xanh**
- [ ] T037 [P] [US1] Web: thêm vào `apps/web/src/features/auth/auth-api.ts` các lời gọi `oauthStart`, `oauthPending`, `oauthSignup`, `oauthConfirm`; tạo `apps/web/src/features/auth/ProviderButtons.tsx` (hai nút, vùng chạm ≥ 44 × 44 px, có chữ + biểu tượng; bấm → gọi `start` rồi `window.location.assign(authorizationUrl)`); gắn vào `LoginPage.tsx` và `RegisterPage.tsx` (không gắn vào `StaffLoginPage.tsx`)
- [ ] T038 [US1] Web: tạo `apps/web/src/features/auth/OAuthResultPage.tsx` (đọc `pending`, hiện theo `stage`: `signed_in`/`completed` → về màn hình đầu; `needs_signup`; `needs_email`; `awaiting_email` → "Hãy kiểm tra email"; `failed` → thông điệp + hành động theo `error.actions`) và `OAuthConfirmPage.tsx` (mã từ `#token=`); thêm route `/oauth/result`, `/oauth/confirm` vào `apps/web/src/app/router.tsx` (ngoài `SessionGate`). T032 phải **xanh**

**Checkpoint**: quickstart kịch bản A và B (bước 1–3) chạy được; US1 kiểm chứng độc lập.

---

## Phase 4: User Story 2 – Trùng email: xác nhận trước khi liên kết, không tự gộp (Priority: P1)

**Goal**: Tài khoản Google/Facebook chưa liên kết có email trùng người dùng đã có thì không được vào và
không tạo người dùng thứ hai; phải xác nhận bằng mật khẩu hoặc liên kết gửi qua email.

**Independent Test**: Tạo người dùng bằng email + mật khẩu; đăng nhập `google_verified` cùng email → không
có phiên, không có người dùng thứ hai; nhập đúng mật khẩu → 2 cách đăng nhập và được đăng nhập; đường "gửi
liên kết qua email" cho kết quả tương đương.

**Phụ thuộc**: US1 (vòng đăng nhập và `oauth.controller.ts`).

### Tests for User Story 2 (viết trước, phải đỏ)

- [ ] T039 [P] [US2] `apps/server/test/auth/oauth-link-confirm.e2e.spec.ts` – **ma trận SC-003** sinh bằng vòng lặp: {có / không mật khẩu} × {email người dùng đã / chưa xác minh} × {`google_verified`, `google_unverified`, `facebook_with_email`, `facebook_no_email` (tự nhập email trùng)}; với mọi ô khẳng định: sau callback **không** có cookie phiên, số `users` của email vẫn là 1. Ô email nhà cung cấp đã xác minh → `needs_link_confirm`, `methods = ['password','email']` chỉ khi người dùng có mật khẩu **và** email đã xác minh, còn lại `['email']`; `hint` đúng cách đã liên kết (US2 kịch bản 5); `suggestedEmail` bị che. Ô tự nhập / chưa xác minh → `signup` trả 202 `check_email` **giống hệt** (thân, mã HTTP, cookie; chênh thời gian trong ngưỡng của `timing.e2e.spec.ts`) với email chưa có người dùng, và thư là `confirmIdentityLink`. Thêm: đúng mật khẩu → liên kết + phiên + kiểm toán `auth.identity.link_confirmed` + việc `account.mail_notice` (`identity_added`); sai mật khẩu → 401 `INVALID_CREDENTIALS`, tăng **cùng** bộ đếm `login_email` với đăng nhập, quá ngưỡng → 429 `LOGIN_THROTTLED`; `link/password` khi không được phép → 400 `OAUTH_FLOW_INVALID`; `link/send-email` → 202, mã dùng một lần, hạn 30 phút, mã mới vô hiệu mã cũ, quá 3 thư/giờ vẫn 202; người dùng đã có **chưa xác minh email** xác nhận qua thư → dòng `password` bị xóa, mọi phiên cũ bị thu hồi (`identity_link_reset`), `email_verified_at` được đặt, mật khẩu cũ không đăng nhập được (kịch bản 6); bỏ dở → không có liên kết, cách cũ vẫn dùng được; email trùng nhân viên nội bộ → đi nhánh người mới (kịch bản 8). **Người dùng đã có một danh tính cùng nhà cung cấp** (Facebook A đã liên kết, đăng nhập bằng Facebook B cùng email): email nhà cung cấp đã xác minh → `failed` `PROVIDER_ACCOUNT_CONFLICT`, kiểm toán `auth.identity.link_denied`, không có phiên, không đổi danh tính; email tự nhập → 202 `check_email` **giống hệt** các ô khác, **không** phát mã liên kết, có đúng một việc `account.mail_notice` (`identity_link_blocked`) và quá ngưỡng `mail_link_confirm` thì không tạo việc; tranh chấp ở bước xác nhận (danh tính cùng loại được thêm sau khi lượt bắt đầu) → 409 `PROVIDER_ACCOUNT_CONFLICT`, không trả 500
- [ ] T040 [P] [US2] Bổ sung `apps/web/test/auth/oauth-result.spec.tsx`: `needs_link_confirm` với `methods = ['password','email']` hiện ô mật khẩu + nút "Gửi liên kết qua email"; `['email']` chỉ có nút gửi liên kết kèm gợi ý theo `hint` ("hoặc đăng nhập bằng Facebook rồi thêm Google trong Cài đặt"); sai mật khẩu hiện lỗi cạnh ô nhập; sau khi gửi liên kết hiện "Hãy kiểm tra email" + "Gửi lại"; `OAuthConfirmPage` với mã hỏng hiện lỗi + nút "Gửi lại"/"Về đăng nhập"

### Implementation for User Story 2

- [ ] T041 [US2] Trong `oauth-login.service.ts` hoàn thiện nhánh `needs_link_confirm` của `handleCallback`: `password_allowed = (người dùng có dòng password) AND (email_verified_at IS NOT NULL)` (FR-011); `hint` = nhà cung cấp người dùng đã liên kết (nếu có); kiểm toán `auth.identity.link_requested`. Trước khi vào `needs_link_confirm`: nếu người dùng đích **đã có danh tính cùng `provider`** (mã người dùng phía nhà cung cấp khác) → lượt `failed` với `PROVIDER_ACCOUNT_CONFLICT`, kiểm toán `auth.identity.link_denied` (`reason: provider_conflict`) – mỗi người dùng tối đa một danh tính mỗi loại (FR-014)
- [ ] T042 [US2] Trong `oauth-login.service.ts`: `linkWithPassword(flowToken, password)` – chỉ khi `needs_link_confirm` và `password_allowed`; kiểm mật khẩu bằng `password-hasher.ts`, dùng **cùng** bộ đếm `login_email` của 004; đúng → trong `runInAccountScope(target_tenant_id)`: `INSERT login_identities` (kèm `provider_email`, `provider_display_name`), `enqueueMailNotice('identity_added')`, kiểm toán `auth.identity.link_confirmed` + `auth.identity.linked`, cấp phiên, `completed`; vi phạm `login_identities_provider_subject_key` → `IDENTITY_IN_USE`; vi phạm `login_identities_account_user_provider_key` (tranh chấp: danh tính cùng loại vừa được thêm) → 409 `PROVIDER_ACCOUNT_CONFLICT`, không trả 500; sai → kiểm toán `auth.identity.link_denied`
- [ ] T043 [US2] Trong `oauth-login.service.ts`: `sendLinkEmail(flowToken)` – `needs_link_confirm` → `awaiting_email`, `issueMailToken` (`LINK_CONFIRM_TTL_MINUTES`), gửi thư `confirmIdentityLink` tới email của **người dùng đã có** (tra trong tenant đích) bằng `MailDispatcher.sendAfterCommit`, bộ đếm `mail_link_confirm`; gọi lại khi đang `awaiting_email` = "Gửi lại" (mã mới). Mở rộng `confirm(token)` cho lượt có `target_user_id`: liên kết + phiên như T042; nếu `email_verified_at IS NULL` → xóa dòng `password`, thu hồi mọi phiên (`identity_link_reset`), đặt `email_verified_at = now()` trong cùng giao dịch (data-model mục 6); vi phạm `login_identities_account_user_provider_key` ở bước này → 409 `PROVIDER_ACCOUNT_CONFLICT` như T042; người dùng đích bị khóa hoặc tài khoản `deleting` → 400 `TOKEN_INVALID`, không cấp phiên (FR-008)
- [ ] T044 [US2] Trong `oauth-login.service.ts` hoàn thiện `signup` ở `needs_email` khi email tự nhập **trùng người dùng đã có**: đặt `target_user_id`, `target_tenant_id`, `password_allowed = false` → `awaiting_email` (30 phút) → thư `confirmIdentityLink`; phản hồi, cookie và đường mã giống hệt nhánh email mới (FR-010a, research R4) – cả hai nhánh cùng đi qua một hàm trả về, không rẽ sớm. Hai trường hợp đặc biệt vẫn trả đúng 202 đó: (a) người dùng đích **đã có danh tính cùng `provider`** → không phát mã liên kết, lượt chuyển `failed` (`result_code = PROVIDER_ACCOUNT_CONFLICT`, không lộ qua phản hồi `signup`), trong `runInAccountScope(tenant đích)` tạo việc `enqueueMailNotice('identity_link_blocked', userId = người dùng đích, provider)` nếu chưa quá ngưỡng `mail_link_confirm`, kiểm toán `auth.identity.link_denied`; (b) người dùng đích bị khóa hoặc tài khoản `deleting` → không gửi thư nào
- [ ] T045 [US2] Thêm mẫu thư có mã `confirmIdentityLink` (liên kết `{WEB}/oauth/confirm#token=…`, nêu nhà cung cấp, hạn 30 phút, hướng dẫn nếu không phải họ làm) vào `mail/templates.ts`; thêm `POST /auth/oauth/link/password`, `POST /auth/oauth/link/send-email` vào `oauth.controller.ts`. T039 phải **xanh**
- [ ] T046 [US2] Web: bổ sung `OAuthResultPage.tsx` phần `needs_link_confirm` (tiêu đề "Email này đã có tài khoản. Hãy xác nhận đây là bạn…", theo `methods`/`hint`) và `auth-api.ts` (`oauthLinkPassword`, `oauthLinkSendEmail`). T040 phải **xanh**

**Checkpoint**: quickstart kịch bản B bước 4 và C chạy được; ma trận SC-003 xanh.

---

## Phase 5: User Story 3 – Chủ tài khoản mời cộng tác viên qua email (Priority: P1)

**Goal**: Chủ mời bằng email từ Cài đặt → Thành viên; người được mời mở liên kết, đặt mật khẩu hoặc dùng
Google/Facebook, và vào với vai trò cộng tác viên. Cộng tác viên + lời mời đang chờ ≤ 2.

**Independent Test**: Chủ gửi lời mời tới email mới → đúng 1 thư mời; mở liên kết, đặt tên + mật khẩu →
đăng nhập được, `GET /auth/me` trả `role: collaborator` của đúng tài khoản; gọi API cần quyền duyệt → 403;
`GET /members` của chủ có người mới.

**Phụ thuộc**: nhánh mật khẩu chỉ cần Phase 2; nhánh Google/Facebook (T056) cần US1.

### Tests for User Story 3 (viết trước, phải đỏ)

- [ ] T047 [P] [US3] `apps/server/test/db/seats-concurrency.db.spec.ts` (SC-005): 1.000 lượt mời / chấp nhận / hủy đan xen đồng thời trên một tài khoản → tại mọi thời điểm (ghế `memberships` `active` ∪ ghế `invitations` `pending`) ⊆ {1, 2}; hai lượt chấp nhận đồng thời khi còn 1 chỗ → đúng một `accepted`; mời đồng thời khi còn 1 chỗ → đúng một thành công
- [ ] T048 [P] [US3] `apps/server/test/auth/members-invite.e2e.spec.ts`: `GET /members` trả `owner`, `collaborators`, `invitations`, `seats`; `POST /members/invitations` → 201 `InvitationView`, một thư `inviteMember` (nêu tên người mời, nhãn tài khoản, vai trò, hạn), `seats.used` tăng, kiểm toán `account.invitation.sent`; email đang có lời mời chờ → 200 coi là "Gửi lại", không chiếm thêm chỗ; đủ 2 → 409 `SEATS_FULL`; mời chính mình → 400 `INVITE_SELF`; phản hồi **giống hệt** dù email đã có người dùng hay chưa (FR-023); 429 khi quá 3 thư/giờ cho một email hoặc 10 lời mời mới/ngày; `resend` → mã cũ báo `INVITE_INVALID`, hạn tính lại; `DELETE` lời mời → 204, chỗ được trả, mã hết hiệu lực; lời mời quá 7 ngày → `INVITE_INVALID` và chỗ được trả (dọn tại chỗ khi mời); `POST /invitations/preview` trả `mode` đúng (`new_user` | `login_required` | `in_use`); `POST /invitations/accept` → người dùng mới với email của lời mời, **đã xác minh**, `role: collaborator`, lời mời `accepted` không dùng lại được, chủ nhận việc `account.mail_notice` (`invite_accepted`); thiếu `acceptTerms` → 400; email đang thuộc tài khoản khác → 409 `INVITE_EMAIL_IN_USE`; nhánh nhà cung cấp `purpose: 'invite'`: email trùng → tham gia; `facebook_no_email` → tham gia; email khác → `failed` `INVITE_EMAIL_MISMATCH`; cộng tác viên gọi mọi điểm cuối `/members/*` → 403 `FORBIDDEN`; chủ tài khoản A dùng `{id}` lời mời của B → 404 (SC-007); cộng tác viên mới gọi API cần quyền duyệt → 403; lời mời của tài khoản `deleting` → `INVITE_INVALID` (FR-024); nhánh nhà cung cấp với danh tính Google đã thuộc người dùng khác → `failed` `IDENTITY_IN_USE`, lời mời vẫn `pending`; **yêu cầu có phiên hợp lệ**: người đang là chủ/cộng tác viên gọi `POST /invitations/accept` hoặc `start` với `purpose: 'invite'` → 409 `ALREADY_IN_ACCOUNT`, người ở tài khoản chờ có email khác email được mời → 409 `INVITE_EMAIL_MISMATCH`, cả hai không tạo người dùng mới và không đổi phiên đang có; ép lỗi ở bước tạo việc `account.mail_notice` khi chấp nhận → lời mời vẫn `pending`, không có người dùng mới (cùng giao dịch); `resend`/hủy có kiểm toán `account.invitation.resent` / `account.invitation.cancelled`
- [ ] T049 [P] [US3] Kiểm thử đơn vị `apps/server/test/auth/invite-email-rule.spec.ts` cho hàm thuần quy tắc email của lời mời (research R10): email nhà cung cấp trùng (sau chuẩn hóa) → nhận; khác → từ chối dù đã xác minh hay chưa; không có email → nhận
- [ ] T050 [P] [US3] Kiểm thử web `apps/web/test/members/members-page.spec.tsx` và `join-page.spec.tsx`: danh sách hiện chủ / cộng tác viên / lời mời "Đang chờ" bằng chữ + biểu tượng, dòng "Còn n/2 chỗ"; đủ chỗ → nút "Mời" khóa kèm lời giải thích; "Gửi lại", "Hủy lời mời"; cộng tác viên không thấy mục Thành viên và vào thẳng route bị từ chối; `JoinPage` theo `mode`: `new_user` (tên + mật khẩu + ô đồng ý chưa tích + nút nhà cung cấp chỉ bấm được sau khi tích), `login_required`, `in_use`, lời mời hỏng ("Lời mời không còn hiệu lực" + gợi ý nhờ gửi lại); người **đang đăng nhập** mở liên kết: đang thuộc một tài khoản → "Bạn đang thuộc một tài khoản khác" kèm cách khắc phục, email phiên khác email được mời → nút "Đăng xuất rồi mở lại liên kết"; ô đồng ý có lời nêu Google và Meta (T094); `vitest-axe` ở 360 px

### Implementation for User Story 3

- [ ] T051 [US3] Tạo `apps/server/src/modules/account/internal/auth/invitations.service.ts` – phía chủ, trong `tenantTx` của phiên: `list()` (`MembersResponse`), `invite(email)`: chuẩn hóa email → từ chối `INVITE_SELF` → bộ đếm `mail_invite`, `invite_account` → `pg_advisory_xact_lock(hashtextextended('account.seats:' || account_id, 0))` → dọn tại chỗ `UPDATE invitations SET status = 'expired' … WHERE status = 'pending' AND expires_at <= now()` → nếu email đang có lời mời `pending` thì coi là `resend` → chọn ghế trống trong {1, 2} trừ ghế `memberships` `active` và `invitations` `pending` → hết → 409 `SEATS_FULL` → `INSERT` (mã 32 byte, lưu SHA-256; `account_label` từ `ACCOUNT_LABEL_RESOLVER` hoặc "tài khoản của {tên người mời}"; `expires_at = now() + INVITE_TTL_DAYS`) → kiểm toán `account.invitation.sent` → gửi `inviteMember` bằng `MailDispatcher.sendAfterCommit`. `resend(id)`: `UPDATE … SET token_hash, last_sent_at, expires_at WHERE id AND status = 'pending'` (0 dòng → 404), kiểm toán `account.invitation.resent`. `cancel(id)`: `UPDATE … SET status = 'cancelled', closed_at WHERE id AND status = 'pending'`, kiểm toán `account.invitation.cancelled`. **Không** tra email được mời có người dùng hay chưa ở đường này (FR-023)
- [ ] T052 [US3] Thêm mẫu thư có mã `inviteMember` (liên kết `{WEB}/join#token=…`; tên hiển thị người mời, nhãn tài khoản, vai trò "cộng tác viên", hạn) vào `mail/templates.ts`
- [ ] T053 [US3] Tạo `apps/server/src/modules/account/internal/auth/members.controller.ts` + đăng ký: `GET /members`, `POST /members/invitations` (201 / 200 khi là gửi lại), `POST /members/invitations/:id/resend`, `DELETE /members/invitations/:id` – tất cả `@CustomerAccess({ permission: 'members.manage' })`; không nhận mã tài khoản. (`DELETE /members/:userId` làm ở US4)
- [ ] T054 [US3] Trong `invitations.service.ts` – phía người được mời: hàm thuần `inviteEmailMatches(...)` (T049); `preview(token)` qua `auth_find_invitation` → `mode` theo `existing_user_state` (`none` → `new_user`, `detached` → `login_required`, `member` → `in_use`); `acceptNew(token, displayName, password, termsVersion)`: nếu yêu cầu **có phiên hợp lệ**: người đang là chủ/cộng tác viên → 409 `ALREADY_IN_ACCOUNT`; người ở tài khoản chờ có email khác email được mời → 409 `INVITE_EMAIL_MISMATCH` (email trùng thì web dùng `accept-existing` – `mode = login_required`); không bao giờ tạo người dùng mới đè lên phiên đang có. Kiểm chính sách mật khẩu của 004 → băm → mở `runInAccountScope(account_id lấy từ auth_find_invitation)` **trước** rồi gọi `auth_accept_invitation_new` **bên trong giao dịch đó** → ánh xạ `invalid` → 400 `INVITE_INVALID`, `email_in_use` → 409 `INVITE_EMAIL_IN_USE`, `seat_taken` → 409 `SEATS_FULL` (kết quả khác `accepted` → rollback); `accepted` → trong **cùng giao dịch**: kiểm toán `account.invitation.accepted`, `enqueueMailNotice('invite_accepted', userId = chủ, subjectUserId = người mới)`; chỉ cấp phiên **sau khi giao dịch xác nhận**
- [ ] T055 [US3] Tạo `apps/server/src/modules/account/internal/auth/invitations.controller.ts` + đăng ký: `POST /invitations/preview`, `POST /invitations/accept` (`@Public`). (`GET /invitations/mine`, `POST /invitations/accept-existing` làm ở US4)
- [ ] T056 [US3] Nhánh nhà cung cấp cho lời mời (cần US1): trong `oauth-login.service.ts`, `start` với `purpose: 'invite'` kiểm lời mời bằng `auth_find_invitation` (hỏng → 400 `INVITE_INVALID`), yêu cầu `acceptTerms: true` **trước** khi chuyển sang nhà cung cấp, lưu `invitation_id` + điều khoản vào lượt; `handleCallback` với `purpose = invite`: `inviteEmailMatches` sai → `failed` `INVITE_EMAIL_MISMATCH`; đúng → `auth_accept_invitation_new` với danh tính nhà cung cấp (không mật khẩu), `display_name` từ nhà cung cấp, gọi trong cùng giao dịch với kiểm toán + `enqueueMailNotice` như T054 → phiên, `completed`. Kết quả khác `accepted` → lượt `failed` với `result_code`: `invalid` → `INVITE_INVALID`, `email_in_use` → `INVITE_EMAIL_IN_USE`, `identity_taken` → `IDENTITY_IN_USE`, `seat_taken` → `SEATS_FULL`. `start` với `purpose: 'invite'` áp dụng cùng quy tắc "yêu cầu có phiên hợp lệ" của T054 (409 `ALREADY_IN_ACCOUNT` / `INVITE_EMAIL_MISMATCH`)
- [ ] T057 [P] [US3] Module `context` cung cấp nhãn tài khoản: tạo `apps/server/src/modules/context/internal/account-label.provider.ts` (đọc tên cửa hàng trong hồ sơ kinh doanh của tài khoản trong ngữ cảnh, chạy trong `tenantTx` của người gọi; chưa có hồ sơ → `null`) và đăng ký `{ provide: ACCOUNT_LABEL_RESOLVER, useClass: … }` + export trong `apps/server/src/modules/context/context.module.ts`. Không thêm phụ thuộc `account → context` trong `modules.manifest.json`; `pnpm check:boundaries` phải sạch
- [ ] T058 [P] [US3] Sửa `addMember(...)` trong `apps/server/src/modules/account/internal/auth/members.service.ts` (thao tác nội bộ cho kiểm thử/dữ liệu mẫu) để lấy khóa `account.seats:{account_id}` và tránh ghế của lời mời `pending` (contracts/module-api.md mục 2); bổ sung ca vào `apps/server/test/db/auth-concurrency.db.spec.ts`
- [ ] T059 [US3] Việc định kỳ dọn dẹp: thêm loại việc `account.auth_housekeeping` (`scheduled` · `system`, mỗi 10 phút) vào `apps/server/src/modules/account/jobs.ts` và `apps/server/src/modules/account/internal/auth/housekeeping.handler.ts`: gọi `auth_housekeeping()` rồi ghi kiểm toán `account.invitation.expired` cho từng lời mời vừa hết hạn (theo danh sách `(account_id, invitation_id)` hàm trả về – chữ ký chốt ở T011); xóa `oauth_flows` đã kết thúc hoặc quá hạn > 24 giờ; xóa `meta_deletion_requests` > 12 tháng. Kiểm thử `apps/server/test/queue/account-auth-housekeeping.queue.spec.ts`: **chạy hai lần cho cùng kết quả**, không ghi kiểm toán trùng, không đụng lời mời còn hạn
- [ ] T060 [US3] Web: tạo `apps/web/src/features/members/members-api.ts`, `MembersPage.tsx` (Cài đặt → Thành viên, chỉ hiện với `members.manage`) và `JoinPage.tsx` (đọc mã từ `#token=`, gọi `preview`, dùng `ProviderButtons` với `purpose: 'invite'`); thêm route `/settings/members` (sau `SessionGate`, chặn theo quyền) và `/join` (công khai) vào `apps/web/src/app/router.tsx`; thêm liên kết "Thành viên" vào điều hướng Cài đặt hiện có. T047–T050 phải **xanh**

**Checkpoint**: quickstart kịch bản D chạy được; SC-005 xanh.

---

## Phase 6: User Story 4 – Chủ tài khoản gỡ cộng tác viên (Priority: P2)

**Goal**: Chủ gỡ cộng tác viên; người bị gỡ mất quyền trong ≤ 60 giây, chỗ được trả, dữ liệu họ tạo giữ
nguyên. Người bị gỡ thấy màn hình "không còn thuộc tài khoản nào", có thể tự tạo tài khoản riêng hoặc nhận
lời mời mới; sau 90 ngày không thuộc tài khoản nào thì bị xóa (báo trước 7 ngày).

**Independent Test**: Tài khoản có 1 cộng tác viên đang đăng nhập: chủ gỡ → trong ≤ 60 giây mọi lời gọi của
người đó bị từ chối; `seats.used` giảm; tên người đó vẫn tra được qua `describeMembers` với `status: removed`.

**Phụ thuộc**: US3 (lời mời) cho nhánh "được mời lại".

### Tests for User Story 4 (viết trước, phải đỏ)

- [ ] T061 [P] [US4] `apps/server/test/auth/members-remove.e2e.spec.ts`: `DELETE /members/{userId}` → 204; vai trò `removed`, mọi phiên của người đó bị xóa, lời gọi tiếp theo của họ bị từ chối trong ≤ 60 giây (dùng lại cách đo của `revocation.e2e.spec.ts`), `seats.used` giảm; có dòng `former_members` (tên, không email); `describeMembers([userId])` trả `status: 'removed'` + tên lúc bị gỡ; người bị gỡ nhận thư `memberRemoved` (nêu nhãn tài khoản, không nêu lý do); kiểm toán `account.member.removed` (ai gỡ ai); gỡ chính mình / gỡ chủ → 409 `OWNER_REQUIRED`; `userId` của tài khoản khác hoặc không tồn tại → 404; cộng tác viên gọi → 403; việc nền và dữ liệu khác của tài khoản không đổi (đếm dòng `pgboss` + bảng `context` trước/sau); ép `Mailer` lỗi khi gửi `memberRemoved` → thao tác gỡ vẫn 204 và có hiệu lực, có nhật ký `mail.send_failed` kèm `trace_id`
- [ ] T062 [P] [US4] `apps/server/test/auth/no-account.e2e.spec.ts`: người bị gỡ đăng nhập lại (mật khẩu và nhà cung cấp) → có phiên, `GET /auth/me` trả `account.status = 'unclaimed'`, `permissions = []`; điểm cuối nghiệp vụ → 403 `NO_ACCOUNT`; `GET /invitations/mine` chỉ trả lời mời gửi tới **email đã xác minh của phiên**, rỗng khi không ở tài khoản chờ; `POST /invitations/accept-existing` (theo `token` hoặc `invitationId`) → 200 + cookie phiên **mới**, **cùng `userId`** như trước, dòng `former_members` ở tài khoản cũ bị xóa nếu tham gia lại đúng tài khoản đó, tài khoản chờ bị xóa; email phiên khác email được mời → 409 `INVITE_EMAIL_MISMATCH`; người đang thuộc tài khoản thật → 409 `ALREADY_IN_ACCOUNT`; hết chỗ → 409 `SEATS_FULL`; `POST /account/claim` thiếu `acceptTerms` → 400, đủ → 200 `account.status = 'active'`, `role = 'owner'`, cookie phiên mới, `detached_at = NULL`, kiểm toán `account.claimed`; gọi lại → 409 `ALREADY_IN_ACCOUNT`; sau khi `claim`, lời mời tới email đó không chấp nhận được (edge case); `accept-existing` theo `invitationId` với email phiên khác email được mời → 409 `INVITE_EMAIL_MISMATCH` (không phải `ALREADY_IN_ACCOUNT`); `GET /invitations/mine` không trả lời mời quá hạn hoặc của tài khoản `deleting`; **xoay phiên không làm mới xác nhận danh tính**: phiên cũ hơn 10 phút gọi `claim` hoặc `accept-existing` → phiên mới vẫn nhận 403 `REAUTH_REQUIRED` ở `POST /auth/login-methods/{provider}/start` (`link`), còn phiên vừa xác nhận lại thì phiên mới giữ đúng mốc cũ (FR-012)
- [ ] T063 [P] [US4] `apps/server/test/queue/account-detached-users.queue.spec.ts` (SC-010, FR-028a): lùi `detached_at` về 84 ngày → một việc `account.mail_notice` (`detached_deletion_notice`), `deletion_notice_sent_at` được đặt; **chạy lại** → không có việc thứ hai; lùi về 91 ngày + thư đã gửi 8 ngày → người dùng, cách đăng nhập, phiên và tài khoản chờ bị xóa, kiểm toán `account.user.purged` không chứa email/tên, `former_members` và dòng `memberships` `removed` của tài khoản cũ còn nguyên (truy vết – không còn khóa ngoại); người **đã nhận thư báo trước** chấp nhận lời mời hoặc `claim` → thành công, `detached_at` và `deletion_notice_sent_at` về NULL, không bị xóa ở lần chạy sau; đủ 90 ngày nhưng thư mới gửi 3 ngày → **không** xóa; người vừa `claim` hoặc vừa tham gia lại giữa lúc việc chạy → không bị xóa; lời mời đang chờ không làm dừng mốc; mỗi lần xử lý tối đa 200 và lần sau xử lý phần còn lại; chạy hai lần cho cùng kết quả
- [ ] T064 [P] [US4] Kiểm thử web `apps/web/test/auth/no-account.spec.tsx` + bổ sung `session-gate.spec.tsx`, `apps/web/test/members/members-page.spec.tsx`: `SessionGate` chuyển `account.status = 'unclaimed'` → `/no-account` cho mọi route nghiệp vụ; `NoAccountPage` hiện "Bạn không còn là thành viên của tài khoản nào", danh sách lời mời đang chờ + nút "Tham gia", nút "Tạo tài khoản kinh doanh của riêng tôi" (ô đồng ý chưa tích), liên kết "Cách đăng nhập", "Đăng xuất"; hộp xác nhận gỡ ở `MembersPage` nêu hệ quả ("… sẽ không vào được tài khoản này nữa. Bài và media họ đã tạo vẫn được giữ lại"); `vitest-axe` ở 360 px

### Implementation for User Story 4

- [ ] T065 [US4] Sửa `apps/server/src/modules/account/internal/auth/members.service.ts`: `removeMember(userId)` trong `tenantTx` của phiên gọi `member_detach(userId, <uuid tài khoản chờ>, <uuid membership>, <uuid former>, actor.userId)` → `not_found` → 404, `owner` → 409 `OWNER_REQUIRED`, `detached` → kiểm toán `account.member.removed`, đọc nhãn tài khoản (resolver) **trước** khi xác nhận rồi gửi thư `memberRemoved` bằng `MailDispatcher.sendAfterCommit` (người nhận đã rời tenant – research R16); loại bỏ mục phiên của người đó khỏi bộ nhớ đệm của bản API hiện tại. Gửi thư thất bại → ghi `mail.send_failed` kèm `trace_id` và tăng chỉ số lỗi gửi thư, **không** làm hỏng thao tác gỡ (điểm lệch nguyên tắc V đã ghi ở plan – Complexity Tracking). `removeMember(...)` của `AccountPublicApi` đi qua cùng đường này. Thêm mẫu thư `memberRemoved` vào `mail/templates.ts` và `DELETE /members/:userId` vào `members.controller.ts`
- [ ] T066 [P] [US4] Sửa `apps/server/src/modules/account/internal/members/describe-members.ts` và `apps/server/src/modules/account/public-api.ts`: `describeMembers(userIds)` trả thêm người trong `former_members` của tài khoản trong ngữ cảnh với `status: 'removed'` và tên lúc bị gỡ; `listActiveMembers()` không đổi. Bổ sung ca vào `apps/server/test/db/account-describe-members.db.spec.ts`
- [ ] T067 [US4] Trong `invitations.service.ts`: `mine(actor)` – chỉ khi `actor.detached` và email phiên đã xác minh thì gọi `auth_pending_invitations_for_email(email đã chuẩn hóa của phiên)`, ngược lại trả rỗng; `acceptExisting(actor, { token | invitationId })`: không `detached` → 409 `ALREADY_IN_ACCOUNT`; với `{ token }` tra `auth_find_invitation` để lấy `invitation_id` + tài khoản mời, với `{ invitationId }` **không** tra trước ở ứng dụng mà dựa hoàn toàn vào kết quả hàm; đọc mốc xác nhận danh tính của phiên hiện tại `coalesce(reauthenticated_at, created_at)` **trước** khi gọi hàm (hàm xóa phiên cũ); gọi `auth_accept_invitation_existing` trong cùng giao dịch với kiểm toán + tạo việc (như T054) → `email_mismatch` → 409 `INVITE_EMAIL_MISMATCH`, `not_eligible` → 409 `ALREADY_IN_ACCOUNT`, `seat_taken` → 409 `SEATS_FULL`, `invalid` → 400 `INVITE_INVALID` (kết quả khác `accepted` → rollback), `accepted` → kiểm toán `account.invitation.accepted`, `enqueueMailNotice('invite_accepted')`; sau khi xác nhận cấp phiên **mới** (lý do thu hồi phiên cũ `account_joined`) với `reauthenticated_at` = mốc đã đọc – xoay phiên không phải là xác thực lại (research R11). Thêm `GET /invitations/mine`, `POST /invitations/accept-existing` (`@CustomerAccess({ allowDetached: true })`) vào `invitations.controller.ts`
- [ ] T068 [US4] Tạo `apps/server/src/modules/account/internal/auth/account-claim.service.ts` + điểm cuối `POST /account/claim` (`@CustomerAccess({ allowDetached: true })`, đặt trong `customer-auth.controller.ts`): không `detached` → 409 `ALREADY_IN_ACCOUNT`; trong `tenantTx` của phiên (vai trò `app` có quyền `UPDATE` trên `account.accounts` trong tenant của mình – migration `0002`, không cần hàm CSDL mới): `UPDATE accounts SET status = 'active' WHERE id = account.current_account_id() AND status = 'unclaimed'` (0 dòng → 409 `ALREADY_IN_ACCOUNT`), `UPDATE users SET detached_at = NULL, deletion_notice_sent_at = NULL` + ghi thời điểm và phiên bản điều khoản đã đồng ý, thu hồi phiên hiện tại (`account_claimed`) – tất cả cùng giao dịch; rồi cấp phiên mới với `reauthenticated_at = coalesce(reauthenticated_at, created_at)` của phiên vừa thu hồi (đọc trong cùng giao dịch; xoay phiên không làm mới xác nhận danh tính – research R11); kiểm toán `account.claimed`
- [ ] T069 [US4] Thêm loại việc `account.detached_users` (`scheduled` · `system`, mỗi giờ) vào `jobs.ts` và `apps/server/src/modules/account/internal/auth/detached-users.handler.ts` theo research R18: (1) `detached_users_due('notice', 200, DETACHED_RETENTION_DAYS, DETACHED_NOTICE_DAYS)` → với từng người, trong ngữ cảnh tài khoản chờ: `UPDATE users SET deletion_notice_sent_at = now() WHERE id AND deletion_notice_sent_at IS NULL AND detached_at IS NOT NULL` + `enqueueMailNotice('detached_deletion_notice', dedupeKey = 'account.notice:deletion:{userId}:{detached_at}')` cùng giao dịch; (2) `detached_users_due('purge', 200, DETACHED_RETENTION_DAYS, DETACHED_NOTICE_DAYS)` → `purge_detached_account(account_id, DETACHED_RETENTION_DAYS, DETACHED_NOTICE_DAYS)`; `true` → kiểm toán `account.user.purged` (không dữ liệu cá nhân), xóa việc còn lại của tài khoản đó (queue.md mục 7), tăng chỉ số `account_detached_purged_total`. T061–T063 phải **xanh**
- [ ] T070 [US4] Web: tạo `apps/web/src/features/auth/NoAccountPage.tsx`; sửa `apps/web/src/app/SessionGate.tsx` (chuyển `unclaimed` → `/no-account`; cho phép `/no-account`, `/settings/login-methods`, `/join`) và `router.tsx`; thêm nút "Gỡ" + hộp xác nhận vào `MembersPage.tsx`; bổ sung `members-api.ts`, `auth-api.ts` (`myInvitations`, `acceptExistingInvitation`, `claimAccount`, `removeMember`); `JoinPage` ở `mode = login_required` khi đã đăng nhập gọi `accept-existing`. T064 phải **xanh**

**Checkpoint**: quickstart kịch bản E và H chạy được.

---

## Phase 7: User Story 5 – Tự quản lý các cách đăng nhập của mình (Priority: P2)

**Goal**: Cài đặt → Cách đăng nhập: xem ba dòng, liên kết thêm, gỡ khi còn ít nhất một cách khác, người chỉ
dùng Google/Facebook tạo được mật khẩu; các thao tác nhạy cảm đòi xác nhận lại danh tính trong 10 phút.

**Independent Test**: Người có mật khẩu liên kết thêm Google → đăng xuất, đăng nhập bằng Google vào đúng tài
khoản; gỡ Google → đăng nhập bằng Google không vào được tài khoản đó; thử gỡ cách cuối → bị từ chối.

**Phụ thuộc**: US1 (vòng đăng nhập nhà cung cấp).

### Tests for User Story 5 (viết trước, phải đỏ)

- [ ] T071 [P] [US5] `apps/server/test/db/last-identity-concurrency.db.spec.ts` (SC-009): người dùng có đúng 2 cách đăng nhập, hai yêu cầu gỡ (mỗi cái gỡ một cách) chạy đồng thời, lặp 200 lần → luôn còn đúng 1 cách; người có 1 cách → gỡ luôn bị từ chối
- [ ] T072 [P] [US5] `apps/server/test/auth/login-methods.e2e.spec.ts`: `GET /auth/login-methods` luôn đủ 3 dòng (`linked`, `providerEmail`, `providerDisplayName`, `linkedAt`) + `reauthFresh`; phiên quá 10 phút: `link`/`DELETE`/`password/request` → 403 `REAUTH_REQUIRED` với `actions` có `reauth`; `POST /auth/reauth` đúng mật khẩu → 204, sai → 401 + **cùng** bộ đếm `login_email`, kiểm toán `auth.reauth`; xác nhận lại bằng nhà cung cấp (`purpose: 'reauth'`) với danh tính đã liên kết → `completed`, với danh tính không thuộc người dùng → `failed` `REAUTH_MISMATCH`; phiên vừa đăng nhập (< 10 phút) coi là mới xác nhận; liên kết Google có email **khác** email người dùng → thành công, email chính không đổi, việc `account.mail_notice` (`identity_added`), kiểm toán `auth.identity.linked`; đã có loại đó → 409 `LOGIN_METHOD_EXISTS`; danh tính đã gắn người dùng khác → `failed` `IDENTITY_IN_USE`, không chuyển, không gộp; gỡ khi còn ≥ 2 → 204, cách đó không vào được nữa, phiên hiện có giữ nguyên, thư `identity_removed`, kiểm toán `auth.identity.unlinked`; gỡ cách cuối → 409 `LAST_LOGIN_METHOD`; `kind` chưa liên kết → 404; người chỉ có Google: `password/request` → 202 + thư đặt mật khẩu → `POST /auth/password/reset` tạo dòng `password`, kiểm toán `auth.password.set`, đăng nhập bằng email + mật khẩu được; `POST /auth/password/forgot` cho người chưa có mật khẩu gửi thư với phản hồi **giống hệt** mọi email khác; cộng tác viên và người ở tài khoản chờ dùng được đầy đủ; người chưa xác minh email chỉ xem được danh sách và `reauth`
- [ ] T073 [P] [US5] Kiểm thử web `apps/web/test/auth/login-methods.spec.tsx`: ba dòng với "Đã liên kết" (kèm email/tên phía nhà cung cấp) hoặc nút "Liên kết" / "Tạo mật khẩu"; trạng thái bằng chữ + biểu tượng; nhận `REAUTH_REQUIRED` → mở hộp xác nhận lại (ô mật khẩu nếu có mật khẩu, nút nhà cung cấp đã liên kết) rồi tự làm lại thao tác; gỡ cách cuối hiện "Hãy thêm cách đăng nhập khác trước khi gỡ"; `vitest-axe` ở 360 px, thao tác được bằng bàn phím

### Implementation for User Story 5

- [ ] T074 [US5] Tạo `apps/server/src/modules/account/internal/auth/login-methods.service.ts`: `list(actor)`; `isReauthFresh(sessionId)` đọc **dòng phiên trong giao dịch** (không qua bộ nhớ đệm): `coalesce(reauthenticated_at, created_at) >= now() - REAUTH_WINDOW_MINUTES` (phiên do xoay vòng ở `claim`/`accept-existing` mang `reauthenticated_at` của phiên cũ nên không tự thành "mới xác nhận" – T067, T068); `reauthWithPassword(actor, password)` (bộ đếm `login_email`, đặt `sessions.reauthenticated_at = now()`, kiểm toán `auth.reauth`); `remove(actor, kind)`: đòi phiên mới xác nhận → `SELECT … FROM login_identities WHERE user_id = $1 FOR UPDATE` → đếm → còn ≥ 2 mới `DELETE` (research R13), ngược lại 409 `LAST_LOGIN_METHOD`; chưa liên kết → 404; `enqueueMailNotice('identity_removed')`, kiểm toán `auth.identity.unlinked`; `requestPassword(actor)`: đòi phiên mới xác nhận, đã có mật khẩu → 409 `LOGIN_METHOD_EXISTS`, ngược lại phát mã `reset_password` của 004 tới email của người dùng
- [ ] T075 [US5] Trong `oauth-login.service.ts` thêm mục đích `link` và `reauth`: `startForActor(actor, provider, purpose)` – `link` đòi phiên mới xác nhận (403 `REAUTH_REQUIRED`) và chưa có loại đó (409 `LOGIN_METHOD_EXISTS`); lưu `actor_user_id`. `handleCallback`: `link` → trong tenant của người dùng `INSERT login_identities` (không so email – FR-014), vi phạm `provider_subject_key` → `failed` `IDENTITY_IN_USE`, thành công → `enqueueMailNotice('identity_added')`, kiểm toán `auth.identity.linked`, `completed`; `reauth` → danh tính phải thuộc đúng `actor_user_id`, đúng → đặt `reauthenticated_at`, `completed`; sai → `failed` `REAUTH_MISMATCH`. Phiên hiện có không đổi
- [ ] T076 [US5] Sửa `apps/server/src/modules/account/internal/auth/password-reset.service.ts` (research R14): `forgot` gửi thư cả khi người dùng chưa có dòng `password` (phản hồi và thời gian không đổi); `reset` ghi kiểu thêm-hoặc-cập-nhật dòng `password`, kiểm toán `auth.password.set` khi là tạo mới; chỉnh lời mẫu thư `resetPassword` cho trường hợp "tạo mật khẩu". Chạy lại `password-reset.e2e.spec.ts` và `timing.e2e.spec.ts` của 004 – phải vẫn xanh
- [ ] T077 [US5] Tạo `apps/server/src/modules/account/internal/auth/login-methods.controller.ts` + đăng ký: `GET /auth/login-methods` và `POST /auth/reauth` (`allowUnverifiedEmail` + `allowDetached`), `POST /auth/login-methods/:provider/start`, `DELETE /auth/login-methods/:kind`, `POST /auth/login-methods/password/request` (`allowDetached`). T071, T072 phải **xanh**
- [ ] T078 [US5] Web: tạo `apps/web/src/features/auth/LoginMethodsPage.tsx` (kèm hộp xác nhận lại danh tính; sau vòng nhà cung cấp quay về `/oauth/result` → đọc `pending` → trở lại `/settings/login-methods` kèm kết quả), bổ sung `auth-api.ts`; thêm route `/settings/login-methods` (cho cả chủ, cộng tác viên, người ở tài khoản chờ) và liên kết từ `SecuritySettingsPage.tsx`; `OAuthResultPage` xử lý `purpose` `link`/`reauth`. T073 phải **xanh**

**Checkpoint**: quickstart kịch bản F chạy được.

---

## Phase 8: FR-009a – Thông báo gỡ ứng dụng / xóa dữ liệu của Meta

**Goal**: Nhận `signed_request` của Meta, gỡ cách đăng nhập Facebook của người tương ứng, trả mã xác nhận +
trang trạng thái; chạy lại an toàn. Không xóa người dùng hay dữ liệu tài khoản (đó là FR-14).

**Independent Test**: Gửi `signed_request` hợp lệ tới `POST /auth/facebook/data-deletion` → `{ url,
confirmation_code }`, cách đăng nhập Facebook biến mất, có thư bảo mật; gửi lại → cùng mã, không thư thứ hai;
sửa một ký tự chữ ký → 400.

**Phụ thuộc**: Phase 2 (kiểm chứng đầy đủ cần US1 để có danh tính Facebook).

- [ ] T079 [P] Tạo `apps/server/test/support/make-signed-request.ts` (in `signed_request` hợp lệ cho một `user_id` bằng `FACEBOOK_APP_SECRET`; dùng được như CLI `tsx … <fb_user_id>` và như hàm trong kiểm thử) và kiểm thử đơn vị **đỏ trước** `apps/server/test/auth/signed-request.spec.ts`: hợp lệ → trả tải; sai chữ ký một ký tự, thiếu dấu chấm, base64url hỏng, JSON hỏng, `algorithm` khác `HMAC-SHA256`, thiếu `user_id` → từ chối; so sánh bằng `timingSafeEqual` (độ dài khác nhau không ném lỗi)
- [ ] T080 [P] `apps/server/test/auth/meta-callbacks.e2e.spec.ts` (**đỏ trước**): hai điểm cuối nhận `application/x-www-form-urlencoded` **không** có `Origin`/cookie vẫn qua kiểm tra nguồn gửi; chữ ký sai → 400 `SIGNED_REQUEST_INVALID`, không tác dụng phụ; hợp lệ → dòng `login_identities` Facebook của đúng người bị xóa, kiểm toán `auth.identity.unlinked_by_provider`, việc `account.mail_notice` (`identity_removed_by_provider`), dòng `meta_deletion_requests` (`status: completed`, chỉ HMAC – không có mã người dùng Facebook rõ); `data-deletion` trả `{ url: "{WEB}/data-deletion/{code}", confirmation_code }`, `deauthorize` trả `{}`; gửi lại → 200, **cùng** mã, không thư thứ hai; người không tồn tại → 200 với `no_data`; Facebook là cách đăng nhập **cuối cùng** → vẫn gỡ, người dùng + vai trò + dữ liệu tài khoản còn nguyên; `GET /public/data-deletion/{code}` → `{ status, receivedAt }` không có dữ liệu cá nhân, mã lạ → 404; xử lý xong trong yêu cầu (SC-010 ≤ 1 phút); **gỡ → liên kết lại Facebook → gỡ lần hai**: danh tính bị xóa lần nữa, có thư thứ hai, **cùng** mã xác nhận; dòng `meta_deletion_requests` đã có nhưng danh tính vẫn còn (mô phỏng tiến trình chết giữa chừng) → gửi lại thì gỡ xong và `status` thành `completed`
- [ ] T081 Tạo `apps/server/src/modules/account/internal/auth/meta-callbacks.service.ts`: `parseSignedRequest(raw)` bằng `node:crypto` (`createHmac('sha256', FACEBOOK_APP_SECRET)` + `timingSafeEqual`, chỉ nhận `algorithm = HMAC-SHA256`); `handle(kind, userId)`: `subject_hmac = HMAC(AUTH_THROTTLE_SECRET hoặc bí mật máy chủ sẵn có, userId)` → `INSERT meta_deletion_requests (…, status = 'no_data') ON CONFLICT (kind, subject_hmac) DO UPDATE SET received_at = now() RETURNING confirmation_code` (thông báo lặp nhận lại mã cũ) → **luôn** chạy tiếp bước gỡ, kể cả khi dòng đã có: `auth_lookup_identity('facebook', userId)` → không có → giữ nguyên `status`; có → trong `runInAccountScope(account_id)`: `DELETE login_identities` (bỏ qua quy tắc "còn ít nhất một" – ngoại lệ FR-016), `enqueueMailNotice('identity_removed_by_provider')`, kiểm toán `auth.identity.unlinked_by_provider` cùng giao dịch, rồi đặt `status = 'completed'`. Thư chỉ được tạo trong giao dịch thật sự xóa được dòng nên thông báo lặp không gửi trùng; `status(code)`. Trước khi viết, đối chiếu định dạng `signed_request` và thân phản hồi với tài liệu Meta hiện hành ("Data Deletion Request Callback", "Deauthorize Callback") – research R15
- [ ] T082 Tạo `apps/server/src/modules/account/internal/auth/meta-callbacks.controller.ts` + đăng ký: `POST /auth/facebook/deauthorize`, `POST /auth/facebook/data-deletion` (`@Public`, đọc thân `application/x-www-form-urlencoded` – ứng dụng hiện chưa có bộ đọc loại này: bật cho **đúng hai route** này, không bật toàn cục), `GET /public/data-deletion/:code` (`@Public`). T079, T080 phải **xanh**
- [ ] T083 [P] Web: tạo `apps/web/src/features/auth/DataDeletionStatusPage.tsx` (route công khai `/data-deletion/:code`; hiện "Đã xử lý" / "Không có dữ liệu để xóa" + thời điểm nhận bằng chữ + biểu tượng; mã lạ → thông báo + liên kết về trang đầu) + kiểm thử `apps/web/test/auth/data-deletion-status.spec.tsx` (`vitest-axe` ở 360 px); thêm route vào `router.tsx`

**Checkpoint**: quickstart kịch bản G chạy được.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Cổng chất lượng xuyên suốt, quan sát, dữ liệu mẫu, tài liệu.

- [ ] T084 [P] Mở rộng `apps/server/test/auth/access-matrix.e2e.spec.ts` + `support/access-matrix.module.ts`: thêm cột "người ở tài khoản chờ" – mọi điểm cuối **không** nằm trong danh sách `+detached` của contracts/auth-http-api.md (mục 2, 4, 5, 7) phải trả 403 `NO_ACCOUNT`; thêm 25 điểm cuối mới vào ma trận với đúng mức truy cập (Public / Customer / `+unverified` / `+detached` / `members.manage`); bổ sung `apps/server/test/auth/account-id-injection.e2e.spec.ts`: gửi `accountId` trong thân/truy vấn tới `/members/*`, `/invitations/*`, `/account/claim` không đổi tài khoản thao tác
- [ ] T085 [P] Mở rộng `apps/server/test/auth/auth-secrets-in-logs.e2e.spec.ts` (SC-008): chạy trọn các luồng US1–US5 + Meta rồi quét nhật ký, phản hồi lỗi, `infra.audit_log.metadata` và dữ liệu việc trong `pgboss`: không có `code`, `state`, `code_verifier`, `signed_request`, mã lời mời, mã xác nhận, mật khẩu, mã phiên, email; không dòng nhật ký nào của `/auth/oauth/*` có chuỗi truy vấn. Thêm kiểm thử `apps/server/test/auth/audit-coverage.e2e.spec.ts`: mỗi hành động trong 19 hành động của data-model mục 7 có ít nhất một bản ghi sau khi chạy luồng tương ứng (FR-029)
- [ ] T086 [P] Chỉ số và cảnh báo (contracts/module-api.md mục 6): `auth_oauth_total{provider, outcome}`, `account_invitations_total{event}`, `account_detached_purged_total` tại các dịch vụ tương ứng (theo cách đăng ký chỉ số hiện có của 004/003); thêm hai histogram để đo SC-002 và SC-004: `auth_oauth_callback_duration_seconds{provider}` (từ lúc nhận callback đến lúc trả 303) và `account_mail_send_duration_seconds{template}` (từ lúc giao dịch xác nhận đến lúc bên gửi thư nhận – ít nhất cho `inviteMember`); thêm quy tắc cảnh báo "tỷ lệ `outcome=provider_error` của một nhà cung cấp > 20% trong 15 phút" vào tệp mới `ops/alerts/auth.rules.yml` (theo mẫu `ops/alerts/queue.rules.yml`) kèm ca kiểm thử `apps/server/test/unit/auth/alert-rules.spec.ts` (theo mẫu `apps/server/test/unit/queue/alert-rules.spec.ts`)
- [ ] T087 [P] Mở rộng `apps/server/src/ops/seed-auth.ts`: thêm một cộng tác viên, một lời mời đang chờ (in liên kết `/join#token=…` ra console **chỉ ở dev**) và một người ở tài khoản chờ; cập nhật `apps/server/test/ops/seed-auth.spec.ts` (chạy hai lần không tạo trùng)
- [ ] T088 [P] Cập nhật `apps/server/docs/auth.md`: đăng nhập qua nhà cung cấp (sơ đồ `oauth_flows.stage`, cookie `__Host-oauth`, bản giả lập và kịch bản), độ tin của email (Google theo `email_verified`; Facebook có trả email = đã xác minh; cách đổi lại ở một dòng), tài khoản chờ + `allowDetached` (cách khai báo điểm cuối mới), xác nhận lại danh tính, ghế + khóa `account.seats`, ba loại việc nền, hai điểm cuối Meta và danh sách miễn kiểm tra nguồn gửi, biến cấu hình
- [ ] T089 [P] Cập nhật `.specify/memory/architecture.md` lên v1.5: bảng mới của schema `account`, thuật ngữ Việt → Anh ở research "Thuật ngữ mới", trạng thái `unclaimed`, loại việc `account.mail_notice` / `account.detached_users` / `account.auth_housekeeping`, Google + Meta (đăng nhập) là bên nhận dữ liệu ở nước ngoài, ghi chú "báo cáo đếm tài khoản phải lọc `unclaimed`"
- [ ] T090 Rà soát giao diện toàn bộ 7 trang mới (`OAuthResultPage`, `OAuthConfirmPage`, `LoginMethodsPage`, `NoAccountPage`, `DataDeletionStatusPage`, `MembersPage`, `JoinPage`) theo SC-011 và FR-033: `pnpm --filter @app/web test` xanh với `vitest-axe` ở 360 px; thao tác hết được bằng bàn phím; vùng chạm ≥ 44 × 44 px; trạng thái bằng chữ + biểu tượng; mỗi lỗi có ít nhất một hành động; không màn hình/thư nào có số tiền; `pnpm check:web-bundle` sạch
- [ ] T091 Chạy toàn bộ cổng chất lượng và sửa đến khi sạch: `pnpm test`, `pnpm test:db`, `pnpm test:queue`, `pnpm db:check`, `pnpm db:lint-migrations`, `pnpm check:boundaries`, `pnpm check:secrets`, `pnpm verify`. Xác nhận `apps/server/src/modules/modules.manifest.json` **không** đổi `allowedDeps` của `account`
- [ ] T092 Chạy tay quickstart mục 2 kịch bản A–H với `OAUTH_DRIVER=fake` + Mailpit ở 360 px (chỉ chạy docker compose ở **một** checkout); ghi kết quả từng kịch bản vào cuối `specs/009-social-login-members/quickstart.md` (mục "Kết quả kiểm chứng")
- [ ] T093 Cập nhật tài liệu thiết kế cho khớp phần đã làm: chữ ký hàm chốt ở T011 (đối chiếu lại với tệp `0015` thực tế) vào `specs/009-social-login-members/data-model.md` mục 4; đánh dấu các mục "Phạm vi giao cho đầu việc sau" của plan.md **không** làm trong tính năng này. Ghi vào cuối `quickstart.md` danh sách việc **bắt buộc trước khi phát hành** chưa thể làm trong CI: kiểm giả định email Facebook với tài liệu Meta + tài khoản thử (research R3), chạy kịch bản A, B, C, G với `OAUTH_DRIVER=real`, thêm Google/Meta vào danh sách chuyển dữ liệu xuyên biên giới trong `TaiLieuDacTa/` (FR-032), ingress bỏ chuỗi truy vấn cho `/api/v1/auth/oauth/*`
- [ ] T094 [P] Web (FR-032): tạo thành phần dùng chung `apps/web/src/features/auth/ConsentNotice.tsx` – lời cạnh ô đồng ý điều khoản nêu rõ **Google và Meta** là bên nhận tên, email, mã người dùng khi đăng nhập bằng hai cách đó, kèm liên kết chính sách quyền riêng tư; ô đồng ý vẫn **không đặt sẵn**. Dùng ở `RegisterPage.tsx`, `OAuthResultPage.tsx` (`needs_signup`, `needs_email`), `JoinPage.tsx`, `NoAccountPage.tsx`; thêm khẳng định vào `apps/web/test/auth/oauth-result.spec.tsx`, `register.spec.tsx`, `no-account.spec.tsx` và `apps/web/test/members/join-page.spec.tsx`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: không phụ thuộc.
- **Phase 2 (Foundational)**: sau Phase 1; **chặn** mọi câu chuyện.
- **Phase 3 (US1)**: sau Phase 2. MVP.
- **Phase 4 (US2)**: sau US1 (dùng chung `oauth-login.service.ts`, `oauth.controller.ts`, `OAuthResultPage.tsx`).
- **Phase 5 (US3)**: sau Phase 2. Nhánh mật khẩu độc lập với US1/US2; riêng T056 cần US1.
- **Phase 6 (US4)**: sau US3 (lời mời cho nhánh "được mời lại", `MembersPage`).
- **Phase 7 (US5)**: sau US1.
- **Phase 8 (FR-009a)**: sau Phase 2; kiểm chứng đầy đủ cần US1.
- **Phase 9 (Polish)**: sau mọi phase muốn phát hành.

### Thứ tự trong Phase 2

- T004, T005 song song với phần CSDL.
- T006 → T007 → T008 (cùng tệp `schema.ts`) → T009 → T011; T010 viết song song và phải đỏ trước T011.
- T013 → T014 → T015 → T016; T017, T018 song song.
- T019 → T020 → T021 → T022 → T023.
- T024 → T025 (cần T009, T020); T026, T027 song song (cần T009).
- T028 → T029 (cần T009).
- T030 cần T021, T025.

### Trong mỗi câu chuyện

- Kiểm thử viết trước và đỏ → dịch vụ → controller → web.
- `oauth-login.service.ts` được sửa ở T033, T034, T041–T044, T056, T075: các việc này **tuần tự**, không song song.
- `mail/templates.ts` được sửa ở T029, T035, T045, T052, T065, T076: tuần tự theo thứ tự phase.
- `router.tsx`, `auth-api.ts` được sửa ở nhiều phase: tuần tự theo thứ tự phase.
- Chữ ký mọi hàm của `0015` chốt ở T011 (kể cả kiểu trả của `auth_housekeeping`); nếu khi làm vẫn phải chỉnh thì sửa thẳng tệp `0015` (chưa phát hành) rồi dựng lại CSDL dev/test, **không** tạo migration thứ ba.
- T094 (lời đồng ý nêu Google/Meta) làm sau khi các trang của US1, US3, US4 đã có.

### Sơ đồ phụ thuộc giữa các câu chuyện

```text
Setup → Foundational ─┬─▶ US1 ─┬─▶ US2
                      │        ├─▶ US5
                      │        └─▶ (T056 của US3)
                      ├─▶ US3 ───▶ US4
                      └─▶ FR-009a
                                     tất cả ─▶ Polish
```

### Parallel Opportunities

- Phase 1: T002, T003.
- Phase 2: T004, T005, T010, T012, T013, T017, T018, T019, T024, T026, T027, T028, T030 (khi tiền đề của từng việc đã xong).
- Sau Phase 2: **US1** và **US3 (nhánh mật khẩu)** và **Phase 8** làm song song được nếu có nhiều người; một người thì theo thứ tự ưu tiên.
- Trong mỗi câu chuyện: các việc kiểm thử `[P]` viết cùng lúc; phần web `[P]` song song với phần máy chủ khi lược đồ T005 đã có.

## Parallel Example: User Story 1

```text
# Viết kiểm thử cùng lúc (khác tệp):
T031  apps/server/test/auth/oauth-login.e2e.spec.ts
T032  apps/web/test/auth/oauth-result.spec.tsx (+ login.spec.tsx, register.spec.tsx)

# Trong lúc làm dịch vụ máy chủ (T033 → T034 → T035 → T036), phần web chạy song song:
T037  ProviderButtons.tsx + auth-api.ts
```

## Parallel Example: User Story 3

```text
T047  test/db/seats-concurrency.db.spec.ts
T048  test/auth/members-invite.e2e.spec.ts
T049  test/auth/invite-email-rule.spec.ts
T050  apps/web/test/members/*.spec.tsx
# rồi, song song với chuỗi T051 → T056:
T057  modules/context – ACCOUNT_LABEL_RESOLVER
T058  members.service.ts – addMember lấy khóa ghế
```

## Implementation Strategy

### MVP trước (chỉ US1)

1. Phase 1 → Phase 2 (dừng ở Checkpoint: mọi kiểm thử của 004 vẫn xanh).
2. Phase 3 (US1) → kiểm chứng độc lập bằng quickstart kịch bản A, B.
3. **Không phát hành riêng US1**: khi chưa có US2, một tài khoản Google/Facebook trùng email sẽ dừng ở
   `needs_link_confirm` mà không có cách đi tiếp (an toàn – không tự gộp – nhưng bế tắc). Mốc phát hành nhỏ
   nhất là **US1 + US2**.

### Giao tăng dần

1. Setup + Foundational → nền sẵn sàng.
2. US1 + US2 → đăng nhập Google/Facebook an toàn (mốc 1).
3. US3 → mời cộng tác viên (mốc 2). Chưa có US4 thì chủ chưa gỡ được qua giao diện.
4. US4 → gỡ + tài khoản chờ + xóa sau 90 ngày (mốc 3).
5. US5 → quản lý cách đăng nhập (mốc 4).
6. Phase 8 (Meta) – **bắt buộc trước khi gửi App Review của Meta**; Phase 9 trước khi hợp nhất.

### Lưu ý

- Mỗi việc xong thì chạy kiểm thử của phase đó; chỉ commit khi người dùng yêu cầu.
- Dừng ở mỗi Checkpoint để kiểm chứng câu chuyện độc lập.
- Việc ngoài mã nguồn (đăng ký ứng dụng Google/Meta, kho bí mật, `TaiLieuDacTa/`, ingress) **không** nằm
  trong danh sách này – xem plan.md "Phạm vi giao cho đầu việc sau" và T093.
