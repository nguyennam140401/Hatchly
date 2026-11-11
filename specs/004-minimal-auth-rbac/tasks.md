---

description: "Danh sách việc cho 004 – Xác thực tối thiểu (email + mật khẩu, phiên, 4 vai trò, chặn quyền ở API)"
---

# Tasks: Xác thực tối thiểu – email + mật khẩu, phiên, 4 vai trò, chặn quyền ở API

**Input**: Tài liệu thiết kế ở `specs/004-minimal-auth-rbac/` (plan.md, spec.md, research.md, data-model.md,
contracts/, quickstart.md)

**Prerequisites**: plan.md, spec.md, research.md (R1–R14), data-model.md, contracts/auth-http-api.md,
contracts/authz-api.md, contracts/auth-ops.md

**Tests**: **Có**. Spec yêu cầu kiểm thử độc lập cho từng câu chuyện và các SC đo được; hiến pháp bắt buộc
kiểm thử truy cập chéo cho mọi bảng tenant mới, và kiểm thử hàm/ranh giới. Kiểm thử của mỗi câu chuyện
viết trước và phải **đỏ** trước khi làm phần triển khai.

**Organization**: Theo câu chuyện người dùng. Lớp chặn quyền (guard, khai báo, phiên) là nền móng của
mọi điểm cuối nên nằm ở Phase 2; US3 kiểm chứng và hoàn thiện nó (quét khai báo, ma trận, ghế thành viên,
thu hồi ≤ 60 giây).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: chạy song song được (khác tệp, không phụ thuộc việc chưa xong)
- **[Story]**: US1…US5 theo spec.md
- Đường dẫn tính từ gốc repo (worktree `impl/004-minimal-auth-rbac`)

## Path Conventions

- API/Worker: `apps/server/src/`, kiểm thử `apps/server/test/` (đơn vị + e2e: `pnpm test`; CSDL thật:
  `apps/server/test/db/*.db.spec.ts`, `pnpm test:db`)
- Web: `apps/web/src/`, kiểm thử `apps/web/test/`
- Dùng chung: `packages/shared/src/`
- Công cụ: `tooling/`

## Quy ước chung cho mọi việc

- Định danh tiếng Anh, chú thích và thông điệp tiếng Việt. Ánh xạ thuật ngữ: research.md "Thuật ngữ mới".
- Module chỉ truy cập CSDL qua `tenantTx`/`systemTx`/`support*` (002) và, riêng xác thực, `authTx` và
  `runInAccountScope` (R4). Không bao giờ dùng `current_setting('app.account_id')` trực tiếp; dùng
  `account.current_account_id()`.
- Không ghi mật khẩu, mã phiên, mã một lần, `token_hash`, băm mật khẩu, email vào nhật ký hay
  `infra.audit_log.metadata` (FR-018, FR-019).
- Phiên bản thư viện mới khóa chính xác (`pnpm add -E`).

---

## Phase 1: Setup (hạ tầng dùng chung)

**Purpose**: Thêm phụ thuộc, môi trường dev và tệp dữ liệu tĩnh.

- [X] T001 Thêm phụ thuộc máy chủ khóa phiên bản chính xác: `pnpm --filter @app/server add -E @node-rs/argon2 nodemailer` và `pnpm --filter @app/server add -D -E @types/nodemailer` trong `apps/server/package.json`. **Quyết định của tasks**: không cài `cookie-parser`; đọc/ghi cookie bằng hàm nhỏ tự viết ở T026 (nguyên tắc IX – bớt một phụ thuộc). Không cài `arctic` (R1)
- [X] T002 [P] Thêm phụ thuộc web khóa phiên bản: `pnpm --filter @app/web add -E react-router` và `pnpm --filter @app/web add -D -E vitest-axe` trong `apps/web/package.json`; nạp matcher `vitest-axe` trong tệp setup kiểm thử web hiện có (tạo `apps/web/test/setup.ts` nếu chưa có và khai báo trong cấu hình vitest của web)
- [X] T003 [P] Thêm dịch vụ `mailpit` vào `docker-compose.yml` (ảnh `axllent/mailpit` khóa thẻ phiên bản, cổng `1025` SMTP và `8025` giao diện, chú thích "chỉ dev"); truyền các biến mới (auth-ops.md mục 1) cho dịch vụ `api`; sửa script `db:up` ở `package.json` gốc để bật cả `mailpit`
- [X] T004 [P] Thêm vào `apps/server/.env.example` mọi biến ở contracts/auth-ops.md mục 1 với giá trị dev: `WEB_BASE_URL=http://localhost:5173`, `AUTH_THROTTLE_SECRET=dev_only_…` (≥ 32 byte), `TERMS_VERSION=2026-11`, `MAIL_TRANSPORT=smtp`, `SMTP_URL=smtp://localhost:1025`, `MAIL_FROM="App" <no-reply@example.test>`, các biến tùy chọn để chú thích với mặc định
- [X] T005 [P] Tạo danh sách mật khẩu cấm `apps/server/src/modules/account/internal/auth/password/common-passwords.txt`: ~10.000 mật khẩu phổ biến nhất (SecLists `10k-most-common`) + danh sách tiếng Việt thường gặp (`matkhau`, `123456789`, `anhyeuem`…), mỗi dòng một mục, chữ thường; ghi nguồn và giấy phép ở dòng chú thích đầu tệp (R2). Đảm bảo tệp được chép vào `dist` khi build (kiểm `tsconfig.build.json`/script `build` của `apps/server/package.json`)

---

## Phase 2: Foundational (điều kiện tiên quyết – CHẶN mọi câu chuyện)

**Purpose**: Cấu hình, mã lỗi, bảng + hàm CSDL, `authTx`, lõi `core/auth` (danh mục quyền, khai báo, guard,
bộ nhớ đệm phiên, CSRF), `core/mail`, các khối dựng của module `account`, khung kiểm thử e2e và khung web.

**⚠️ CRITICAL**: Chưa xong phase này thì không bắt đầu câu chuyện nào.

### Cấu hình và hợp đồng dùng chung

- [X] T006 Mở rộng `apps/server/src/core/config/config.schema.ts` với mọi biến ở contracts/auth-ops.md mục 1: `WEB_BASE_URL` (bắt buộc, URL), `WEB_ORIGINS` (mặc định gốc của `WEB_BASE_URL`, danh sách phân tách dấu phẩy), `TRUST_PROXY_HOPS` (mặc định `0` khi `APP_ENV=development`, `1` khi staging/production), `AUTH_THROTTLE_SECRET` (`secret()`, "≥ 32 byte"), `SESSION_IDLE_DAYS`/`SESSION_ABSOLUTE_DAYS` (`14`/`30`), `STAFF_SESSION_IDLE_MINUTES`/`STAFF_SESSION_ABSOLUTE_HOURS` (`30`/`12`), `STAFF_ALLOWED_CIDRS` (rỗng = không giới hạn, kiểm cú pháp CIDR), `LOGIN_MAX_FAILURES_PER_EMAIL`/`LOGIN_MAX_FAILURES_PER_IP`/`LOGIN_WINDOW_MINUTES`/`LOGIN_BLOCK_MINUTES` (`5`/`30`/`15`/`15`), `ARGON2_MEMORY_KIB`/`ARGON2_TIME_COST` (`19456`/`2`), `TERMS_VERSION` (bắt buộc), `MAIL_TRANSPORT` (`smtp` | `memory`; "`memory` bị từ chối khi `APP_ENV=production`"), `SMTP_URL` (`secret()`, bắt buộc khi `smtp`), `MAIL_FROM` (bắt buộc khi `smtp`). Thông báo lỗi chỉ nêu tên biến. Thêm ca kiểm thử vào `apps/server/test/config.spec.ts` (thiếu biến bắt buộc, `memory` ở production, CIDR sai)
- [X] T007 [P] Thêm mã lỗi vào `packages/shared/src/core/error-response.ts` (`ERROR_CODES`) và thông điệp tiếng Việt vào `packages/shared/src/core/vi-error-messages.ts` đúng bảng contracts/auth-http-api.md mục 3: `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `EMAIL_NOT_VERIFIED` 403, `ACCESS_NOT_DECLARED` 403, `CSRF_REJECTED` 403, `INVALID_CREDENTIALS` 401, `LOGIN_THROTTLED` 429 (`retryAfterSeconds`), `RATE_LIMITED` 429, `ACCOUNT_UNAVAILABLE` 403, `TOKEN_INVALID` 400, `EMAIL_ALREADY_VERIFIED` 409, `IP_NOT_ALLOWED` 403, `OWNER_REQUIRED` 409, `SEATS_FULL` 409; thêm `ErrorAction.kind` `resend_verification`, `contact_owner`. Cập nhật `packages/shared/test/core.spec.ts`
- [X] T008 [P] Tạo `packages/shared/src/auth/` và xuất từ `packages/shared/src/index.ts`: `permissions.ts` (dữ liệu thuần `PERMISSIONS` đúng 13 dòng ở contracts/authz-api.md mục 1, kiểu `Permission`, `CustomerRole`, `StaffRole` – **nguồn duy nhất**, lõi máy chủ nhập lại từ đây), `schemas.ts` (Zod: `registerInput` với `displayName` "1–80 ký tự sau `trim`", `email`, `password` "8–128 ký tự" (kiểm độ dài cơ bản; chính sách đầy đủ ở máy chủ), `acceptTerms: z.literal(true)`, `termsVersion`; `loginInput`; `verifyEmailInput { token }`; `resendInput { email? }`; `changeEmailInput { email }`; `forgotPasswordInput { email }`; `resetPasswordInput { token, newPassword }`; `changePasswordInput { currentPassword, newPassword }`; `staffLoginInput`), `responses.ts` (`MeResponse`, `StaffMeResponse`, `CheckEmailResponse { status: 'check_email' }` theo contracts/auth-http-api.md). Kiểm thử ở `packages/shared/test/auth.spec.ts`

### CSDL: bảng, hàm, migration

- [X] T009 Định nghĩa 8 bảng trong `apps/server/src/modules/account/internal/db/schema.ts` (xóa `.gitkeep`) đúng data-model.md mục 2–3 bằng `tenantTable`/`sharedTable` của 002:
  - `users`: `display_name` text, `email` text, `email_normalized` text với chỉ mục duy nhất toàn cục `users_email_normalized_key` (`indexExceptions`: "email duy nhất trên mọi tài khoản – FR-002"), `email_verified_at` timestamptz NULL, `status` `CHECK IN ('active','disabled')`, `terms_version`, `terms_accepted_at`, `password_changed_at` NULL;
  - `login_identities`: `user_id` FK `users(id)` ON DELETE CASCADE, `provider` `CHECK IN ('password','google','facebook')`, `provider_subject`, `password_hash` NULL với `CHECK ((provider = 'password') = (password_hash IS NOT NULL))`, `last_used_at` NULL; duy nhất toàn cục `(provider, provider_subject)` (ngoại lệ có lý do FR-003); duy nhất `(account_id, user_id, provider)`;
  - `memberships`: `user_id` FK, `role` `CHECK IN ('owner','collaborator')`, `seat smallint` `CHECK (seat BETWEEN 0 AND 2)` và `CHECK ((role = 'owner') = (seat = 0))`, `status` `CHECK IN ('active','removed','disabled')`, `CHECK (role <> 'owner' OR status = 'active')`, `added_by_user_id` NULL; duy nhất `(account_id, seat) WHERE status = 'active'`; duy nhất `(account_id, user_id)`;
  - `sessions`: `user_id` FK, `token_hash bytea` duy nhất toàn cục (ngoại lệ: "tra theo mã trước khi biết tenant"), `last_seen_at`, `idle_expires_at`, `absolute_expires_at`, `revoked_at` NULL, `revoke_reason` NULL `CHECK IN ('logout','logout_all','password_changed','password_reset','email_verified','member_removed','user_disabled')`, `user_agent_summary` NULL "≤ 60 ký tự" (`CHECK char_length ≤ 60`); chỉ mục `(account_id, user_id) WHERE revoked_at IS NULL`;
  - `auth_tokens`: `user_id` FK, `purpose` `CHECK IN ('verify_email','reset_password')`, `token_hash bytea` duy nhất toàn cục (ngoại lệ có lý do), `email_normalized`, `expires_at`, `used_at` NULL;
  - `staff_users` (shared, reason "Nhân viên nội bộ không thuộc tài khoản khách hàng – FR-016"): `id`, `email_normalized` duy nhất, `display_name`, `role` `CHECK IN ('support','admin')`, `password_hash`, `status` `CHECK IN ('active','disabled')`, `created_at`, `updated_at`, `password_changed_at`;
  - `staff_sessions` (shared, reason "Phiên của nhân viên nội bộ – FR-010, FR-016"): như `sessions` nhưng `staff_user_id` FK `staff_users`, không có `account_id`, thêm `assurance text NOT NULL DEFAULT 'password'`, `ip inet`;
  - `auth_throttle` (shared, reason "Bộ đếm chống dò theo email/địa chỉ mạng trước khi biết tenant – FR-007"): PK `(kind, key_hash)`, `kind` `CHECK IN ('login_email','login_ip','mail_reset','mail_verify','register_ip')`, `key_hash bytea`, `window_start`, `count int`, `blocked_until` NULL
- [X] T010 Sinh migration `apps/server/drizzle/migrations/0009_account_auth_tables.sql` bằng `pnpm --filter @app/server db:generate --name account_auth_tables`; rà tệp sinh ra: có chính sách `tenant_isolation` cho 5 bảng tenant, mọi `CHECK` và chỉ mục ở T009, chỉ thêm (không `DROP`/`ALTER` phá vỡ); `pnpm --filter @app/server db:lint-migrations` sạch (phụ thuộc T009)
- [X] T011 Tạo migration tay `apps/server/drizzle/migrations/0010_account_auth_functions.sql` bằng `pnpm --filter @app/server db:generate:custom --name account_auth_functions` với 4 hàm `account.auth_register`, `account.auth_lookup_email`, `account.auth_resolve_session`, `account.auth_find_token` đúng chữ ký, cột trả về và hành vi ở data-model.md mục 4. Mỗi hàm: `SECURITY DEFINER`, `OWNER TO owner`, `SET search_path = pg_catalog, account`, `REVOKE ALL ... FROM PUBLIC`, `GRANT EXECUTE ... TO "app"` (không cấp `system`, `support`). `auth_register` bắt `unique_violation` trên `users_email_normalized_key` → hoàn tác khối con và trả `'email_taken'`, lỗi khác ném. `auth_lookup_email` bỏ qua tài khoản có `deleted_at`. `auth_resolve_session` chỉ trả khi phiên hiệu lực, `users.status = 'active'`, membership `active`, tài khoản không `deleting`/đã xóa; cập nhật `last_seen_at`, `idle_expires_at` khi `now() - last_seen_at > p_touch_after` (`VOLATILE`). `auth_find_token` chỉ khi `used_at IS NULL AND expires_at > now()`, không tiêu thụ
- [X] T012 [P] Tạo migration tay `apps/server/drizzle/migrations/0011_audit_actor_types.sql` (`db:generate:custom --name audit_actor_types`): thay `CHECK` của `infra.audit_log.actor_type` thành `{support, admin, system, user, anonymous}` (R11, mở rộng, tương thích ngược). Chạy `pnpm db:setup` và `pnpm db:check` → 0 vi phạm (phụ thuộc T010, T011)
- [X] T013 Kiểm thử CSDL `apps/server/test/db/auth-functions.db.spec.ts`: vai trò `support` và `system` gọi 4 hàm bị từ chối; mỗi hàm chỉ trả đúng các cột ở data-model.md mục 4; `auth_register` chạy đồng thời cùng email → đúng 1 `'created'`, 1 `'email_taken'`, không còn dòng dở dang; `auth_resolve_session` trả 0 dòng với phiên đã thu hồi, quá hạn không hoạt động, quá hạn tuyệt đối, người dùng `disabled`, membership `removed`, tài khoản `deleting`; `auth_find_token` trả 0 dòng với mã đã dùng/hết hạn/sai mục đích; `app` vẫn không INSERT được `account.accounts` trực tiếp
- [X] T014 [P] Kiểm thử truy cập chéo `apps/server/test/db/auth-isolation.db.spec.ts` cho `users`, `login_identities`, `memberships`, `sessions`, `auth_tokens` dùng `apps/server/test/db/helpers/cross-tenant.ts` của 002: trong ngữ cảnh tài khoản A không đọc/sửa/xóa được dòng của B; không có ngữ cảnh → 0 dòng (cổng CI 1)

### Lõi CSDL, ngữ cảnh, nhật ký, ranh giới

- [X] T015 Tạo `authTx(fn)` ở `apps/server/src/core/db/auth-tx.ts`: giao dịch bể `app` **không** đặt ngữ cảnh tenant, dùng chung cơ chế giao dịch của `apps/server/src/core/db/transaction.ts` (bộ gác truy vấn 002 vẫn chặn bảng tenant: dev/test ném lỗi). **Không** xuất qua `apps/server/src/core/db/index.ts` hay `core/index.ts` (hàm hạn chế – contracts/authz-api.md mục 5). Kiểm thử ở `apps/server/test/db/auth-tx.db.spec.ts`: đọc/ghi được `account.auth_throttle`, `infra.audit_log`; truy cập bảng tenant bị bộ gác chặn
- [X] T016 Mở rộng `apps/server/src/core/context/execution-storage.ts` (và kiểu `ExecutionContext` ở `apps/server/src/core/context/request-context.ts`) với `actor?: Actor` (data-model.md mục 7: `{ kind: 'user'; userId; accountId; role; emailVerified; sessionId }` | `{ kind: 'staff'; staffId; role; sessionId }`); trong `apps/server/src/core/logging/logging.module.ts` thêm `actor_id`, `actor_kind` vào mixin mọi dòng nhật ký và bổ sung `redact` của pino: `req.headers.cookie`, `res.headers["set-cookie"]`, `req.headers.authorization`, `*.password`, `*.currentPassword`, `*.newPassword`, `*.token` (R13). Cập nhật `apps/server/test/db/logging-context.db.spec.ts`
- [X] T017 Sửa `tooling/boundaries/build-rules.cjs`: thêm quy tắc `auth-tx-restricted` (chỉ `apps/server/src/core/auth/**` và `apps/server/src/modules/account/internal/auth/**` được nhập `core/db/auth-tx.ts`), `account-scope-restricted` (chỉ `modules/account/internal/auth/**` nhập `core/auth/account-scope.ts` và `core/auth/session-cache.ts` – riêng `session-cache.ts` thêm cả `core/auth/**`); thu hẹp `bind-account-restricted` để trong `core/auth` chỉ `core/auth/access.guard.ts` được nhập `core/context/bind-account.ts` (giữ ngoại lệ hiện có cho `modules/queue`). Thêm fixture vi phạm + `expected.json` dưới `tooling/boundaries/fixtures/` cho từng quy tắc và ca trong `tooling/boundaries/boundaries.spec.ts`

### Lõi `core/auth`

- [X] T018 [P] Tạo `apps/server/src/core/auth/permissions.ts`: nhập lại `PERMISSIONS`, `Permission`, `CustomerRole`, `StaffRole` từ `@app/shared`; thêm `permissionsOf(role)` và `PERMISSION_DENIED_MESSAGES: Record<Permission, string>` (vd `'post.approve' → 'Chỉ chủ tài khoản mới duyệt được bài.'`, `'channel.manage' → 'Chỉ chủ tài khoản mới kết nối được kênh.'`…, đủ 13 quyền). Kiểm thử đơn vị `apps/server/test/auth/permissions.spec.ts`: ma trận khớp đúng bảng FR-012; không quyền khách hàng nào cấp cho `support`/`admin` và ngược lại; mọi quyền có thông điệp
- [X] T019 [P] Tạo `apps/server/src/core/auth/access.decorators.ts`: `@Public()`, `@CustomerAccess(...perms)` và `@CustomerAccess({ allowUnverifiedEmail: true }, ...perms)`, `@StaffAccess(...perms)` lưu metadata bằng `SetMetadata`; đặt được ở method và class (method ghi đè class); hàm `readAccessDeclaration(handler, class)` trả khai báo hoặc `null`, ném lỗi khi một handler có hai khai báo
- [X] T020 [P] Tạo `apps/server/src/core/auth/session-cache.ts`: `Map<token_hash_hex, { actor; expiresAt }>`, `expiresAt = min(now + 60 giây, absolute_expires_at)`, tối đa 10.000 mục, đầy thì bỏ mục cũ nhất (thứ tự chèn), `get`/`set`/`evict(tokenHash)`/`evictWhere(pred)`, đồng hồ tiêm được để kiểm thử; không bao giờ lưu mã gốc. Kiểm thử `apps/server/test/auth/session-cache.spec.ts` (TTL, giới hạn 10.000, evict)
- [X] T021 [P] Tạo `apps/server/src/core/auth/session-resolver.ts`: token DI `SESSION_RESOLVER` và giao diện `SessionResolver { resolveCustomer(tokenHash: Buffer); resolveStaff(tokenHash: Buffer, ip: string) }` đúng contracts/authz-api.md mục 4
- [X] T022 [P] Tạo `apps/server/src/core/auth/actor.ts`: kiểu `Actor`, `currentActor()`, `requireCustomer()`, `requireStaff()` (ném lỗi lập trình khi sai loại), `can(permission)` đọc từ `ExecutionContext` (contracts/authz-api.md mục 3). Kiểm thử `apps/server/test/auth/actor.spec.ts`
- [X] T023 Tạo `apps/server/src/core/auth/account-scope.ts`: `runInAccountScope(accountId, fn)` chạy `fn` trong ngữ cảnh thực thi con có `accountId` (để `tenantTx` dùng được) mà không đổi ngữ cảnh yêu cầu gốc; ném `TenantContextError('TENANT_CONTEXT_CONFLICT')` khi yêu cầu đã gắn tài khoản khác hoặc đang trong giao dịch. Kiểm thử `apps/server/test/db/account-scope.db.spec.ts`
- [X] T024 [P] Tạo `apps/server/src/core/auth/client-ip.ts`: lấy địa chỉ mạng khách theo `TRUST_PROXY_HOPS` (cài `trust proxy` của Express trong `apps/server/src/app/configure-api-app.ts`), hàm `ipInCidrs(ip, cidrs)` hỗ trợ IPv4/IPv6 (dùng `node:net` `BlockList`, không tự viết phép so khớp bit). Kiểm thử `apps/server/test/auth/client-ip.spec.ts`
- [X] T025 [P] Tạo `apps/server/src/core/auth/origin-check.middleware.ts`: với POST/PUT/PATCH/DELETE (kể cả điểm cuối công khai) chấp nhận khi `Origin` thuộc `WEB_ORIGINS` hoặc `Sec-Fetch-Site: same-origin`, ngược lại 403 `CSRF_REJECTED` (R3). Kiểm thử `apps/server/test/auth/origin-check.spec.ts` (thiếu cả hai, Origin lạ, `same-site` nhưng khác origin, GET luôn qua)
- [X] T026 [P] Tạo `apps/server/src/core/auth/cookies.ts`: đọc cookie theo tên từ tiêu đề `Cookie` (không cài thư viện – T001), `setSessionCookie(res, name, token, maxAgeSeconds | undefined)` và `clearSessionCookie(res, name)` với `HttpOnly; Secure; SameSite=Lax; Path=/`, không `Domain`; tên `__Host-sid` và `__Host-staff_sid` (contracts/auth-http-api.md mục 4); `hashToken(token): Buffer` = SHA-256 của mã base64url. Kiểm thử `apps/server/test/auth/cookies.spec.ts`
- [X] T027 Tạo `apps/server/src/core/auth/access.guard.ts` (`AccessGuard`, toàn cục) đúng thứ tự R7 và bảng contracts/authz-api.md mục 6: thiếu khai báo → 403 `ACCESS_NOT_DECLARED` + nhật ký `error` `auth.access_not_declared`; `@Public` → cho qua, có cookie khách hàng hợp lệ thì gắn `actor` (không gắn tài khoản); `@CustomerAccess` chỉ đọc `__Host-sid`, `@StaffAccess` chỉ đọc `__Host-staff_sid` → không có/sai/hết hạn → 401 `UNAUTHENTICATED`; tra `session-cache` trước, trượt thì gọi `SessionResolver` rồi lưu cache; chưa xác minh email mà không `allowUnverifiedEmail` → 403 `EMAIL_NOT_VERIFIED`; thiếu quyền → 403 `FORBIDDEN` với `PERMISSION_DENIED_MESSAGES` (thêm hành động `contact_owner` khi là `collaborator`) và nhật ký `warn` `auth.denied` gồm `trace_id`, `actor_id`, `account_id`, `required`, `reason`; `@StaffAccess` ngoài `STAFF_ALLOWED_CIDRS` → 403 `IP_NOT_ALLOWED` (ghi kiểm toán qua `authTx`); hợp lệ khách hàng → `bindAccountToRequest(actor.accountId)` (nơi **duy nhất** gọi hàm này), đặt `actor` vào ngữ cảnh. Không đọc path/query/body. Lỗi CSDL khi tra phiên → 503 `SERVICE_UNAVAILABLE`. Kiểm thử đơn vị `apps/server/test/auth/access.guard.spec.ts` với `SessionResolver` giả, phủ từng dòng của bảng mục 6
- [X] T028 Tạo `apps/server/src/core/auth/auth.module.ts`: đăng ký `AccessGuard` làm `APP_GUARD`, áp `origin-check.middleware` cho mọi route; nhập vào `apps/server/src/core/core.module.ts` hoặc `apps/server/src/app/api-app.module.ts` (chỉ API, không Worker). Khai báo `@Public()` cho `apps/server/src/core/health/health.controller.ts` (`healthz`, `readyz`) và khai báo phù hợp cho `apps/server/src/core/diagnostics/diagnostics.controller.ts`. Xuất công khai qua `apps/server/src/core/index.ts`: `PERMISSIONS`, `Permission`, `permissionsOf`, `Public`, `CustomerAccess`, `StaffAccess`, `currentActor`, `requireCustomer`, `requireStaff`, `can`, `SESSION_RESOLVER`, `SessionResolver`, `Actor`; **không** xuất `authTx`, `runInAccountScope`, `sessionCache`. Cập nhật `apps/server/test/health.e2e.spec.ts`, `apps/server/test/validation.e2e.spec.ts` nếu cần khai báo/Origin

### Gửi thư

- [X] T029 [P] Tạo `apps/server/src/core/mail/`: `mailer.ts` (giao diện `Mailer.send({ to, subject, text, html })`, token `MAILER`), `smtp.transport.ts` (`nodemailer` từ `SMTP_URL`, `MAIL_FROM`, giới hạn 10 giây), `memory.transport.ts` (giữ thư trong mảng, `messages()`, `clear()` cho kiểm thử), `mail.module.ts` (chọn theo `MAIL_TRANSPORT`); xuất `MailModule`, `MAILER`, `Mailer`, `MemoryMailTransport` qua `apps/server/src/core/index.ts`. Kiểm thử `apps/server/test/mail.spec.ts`

### Khối dựng của module `account`

- [X] T030 [P] Tạo `apps/server/src/modules/account/internal/auth/password/`: `password-hasher.ts` (bọc `@node-rs/argon2`, argon2id `memoryCost=ARGON2_MEMORY_KIB`, `timeCost=ARGON2_TIME_COST`, `parallelism=1`; `hash`, `verify`, `needsRehash`; `verifyDummy()` chạy verify trên một băm giả cố định để cân thời gian – R2), `password-policy.ts` (chuẩn hóa NFKC, không cắt khoảng trắng, "8–128 ký tự" tính theo điểm mã sau chuẩn hóa, quá 128 thì từ chối **trước khi băm**, cấm mục trong `common-passwords.txt` so chữ thường, cấm trùng email hoặc phần trước `@`; trả mã lý do `PASSWORD_WEAK` cho `fieldErrors`). Kiểm thử `apps/server/test/auth/password.spec.ts` (gồm mật khẩu tiếng Việt dấu dựng sẵn/tổ hợp khớp nhau, `matkhau` bị cấm, 129 ký tự bị từ chối nhanh)
- [X] T031 [P] Tạo `apps/server/src/modules/account/internal/auth/email.ts`: `normalizeEmail` = `trim` → NFC → chữ thường toàn bộ → kiểm cú pháp Zod `email()` cho phép tên miền quốc tế; trả `{ email (đã trim), emailNormalized }`. Kiểm thử `apps/server/test/auth/email.spec.ts`
- [X] T032 [P] Tạo `apps/server/src/modules/account/internal/auth/tokens.ts`: `newToken()` = 32 byte `randomBytes` base64url, `hashToken` (dùng lại `core/auth/cookies.ts`), `hmacKey(kind, value)` = `HMAC-SHA256(AUTH_THROTTLE_SECRET, kind + ':' + value)`; chỉ dùng `node:crypto`
- [X] T033 Tạo `apps/server/src/modules/account/internal/auth/throttle.service.ts` (R6): `hit(kind, value)` là **một** câu `INSERT … ON CONFLICT (kind, key_hash) DO UPDATE … RETURNING` trong `authTx` – hết cửa sổ thì đặt lại `count`, vượt ngưỡng thì đặt `blocked_until`, tự xóa dòng của khóa khi đã hết hạn; `check(kind, value)` trả `{ blocked, retryAfterSeconds }`; `reset(kind, value)`. Ngưỡng: `login_email` 5/15 phút → chặn 15 phút, `login_ip` 30/15 phút, `mail_reset`/`mail_verify` 3/giờ, `register_ip` 20/giờ (từ cấu hình T006). Kiểm thử `apps/server/test/db/auth-throttle.db.spec.ts`: ngưỡng theo email đúng khi đếm từ **2 bể `app`** khác nhau (SC-006); song song 20 lần chỉ đếm đúng 20
- [X] T034 [P] Tạo `apps/server/src/modules/account/internal/auth/audit.ts`: `writeAuthAudit(tx, { actorType: 'user'|'support'|'admin'|'system'|'anonymous', actorId, action, result, accountId?, ip, uaFamily, reason? })` ghi `infra.audit_log` với `metadata` **chỉ** `{ ip, ua_family, reason }` (R11, không email/mật khẩu/mã); hằng danh mục hành động `auth.register`, `auth.login.succeeded`, `auth.login.failed`, `auth.login.throttled`, `auth.logout_all`, `auth.password.reset`, `auth.password.changed`, `auth.email.verified`, `auth.email.changed`, `account.member.added|removed|disabled`, `staff.login.succeeded|failed|denied_ip`, `staff.created|disabled|password_reset`, `staff.request`; mã `trace_id` lấy từ ngữ cảnh
- [X] T035 Tạo `apps/server/src/modules/account/internal/auth/session.service.ts`: `createCustomerSession({ accountId, userId, userAgent })` (mã mới, lưu `token_hash`, `idle_expires_at = now + SESSION_IDLE_DAYS`, `absolute_expires_at = now + SESSION_ABSOLUTE_DAYS`, `user_agent_summary` "≤ 60 ký tự" dạng "Chrome · Android") chạy qua `runInAccountScope` + `tenantTx`; `revokeSession(id, reason)`, `revokeAllForUser(userId, reason, { exceptSessionId? })` bằng `UPDATE … WHERE revoked_at IS NULL`, kèm `sessionCache.evict` trên bản hiện tại; `resolveCustomer(tokenHash)` gọi `account.auth_resolve_session` qua `authTx` (`p_touch_after = 1 giờ`) và dựng `Actor`. Cung cấp `SESSION_RESOLVER` trong `apps/server/src/modules/account/account.module.ts` (tạm để `resolveStaff` trả `null` tới US4); `AccountModule` nhập `MailModule`
- [X] T036 [P] Tạo `apps/server/src/modules/account/internal/auth/mail/dispatch.ts`: `sendAfterCommit(template, to, vars)` chạy `setImmediate` sau khi giao dịch xác nhận, giới hạn 10 giây, lỗi thì ghi `mail.send_failed` gồm `user_id`, `template` (không ghi địa chỉ thư); và `apps/server/src/modules/account/internal/auth/mail/templates.ts` khung mẫu thư tiếng Việt (bản chữ + HTML đơn giản, không mật khẩu, không số tiền AI) – nội dung từng mẫu thêm ở câu chuyện tương ứng

### Khung kiểm thử e2e

- [X] T037 Tạo `apps/server/test/auth/helpers/app.ts`: dựng `ApiAppModule` thật trên CSDL thử của 002 với `MAIL_TRANSPORT=memory`, `ARGON2_MEMORY_KIB`/`ARGON2_TIME_COST` nhỏ, `WEB_ORIGINS` cố định; tiện ích `agent()` (supertest giữ cookie, tự gắn `Origin`), `inbox()` đọc `MemoryMailTransport`, `tokenFromMail(mail)` lấy mã từ `#token=`, `registerAndVerify(...)`, `captureLogs()` bắt mọi dòng pino; khai báo trong cấu hình vitest phù hợp (e2e cần CSDL → chạy trong `pnpm test:db` hoặc tách `test:e2e`; chọn một và ghi vào `apps/server/package.json`)
- [X] T038 Tạo `apps/server/test/auth/support/access-matrix.module.ts` (`AccessMatrixTestModule`, chỉ trong `test/`, không vào bản phát hành): mỗi quyền trong `PERMISSIONS` một điểm cuối `GET /api/v1/__test/perm/<permission>` khai báo `@CustomerAccess`/`@StaffAccess` tương ứng; thêm `GET /__test/customer-unverified` (`allowUnverifiedEmail`), `GET /__test/public`, `GET /__test/undeclared` (cố ý không khai báo), và `POST /__test/echo-account` trả `currentAccountId()` cùng mọi `accountId` trong path/query/body; helper `app.ts` cho phép nhập mô-đun này

### Khung web

- [X] T039 Sửa `apps/web/src/lib/api-client.ts`: `credentials: 'same-origin'`; ném lỗi có kiểu theo `ErrorResponse`; phát sự kiện/gọi callback khi gặp 401 `UNAUTHENTICATED` và 403 `EMAIL_NOT_VERIFIED` để cổng phiên xử lý. Cập nhật kiểm thử web hiện có
- [X] T040 Tạo `apps/web/src/app/router.tsx` (`createBrowserRouter`) và sửa `apps/web/src/main.tsx` dùng router; "cổng phiên" `apps/web/src/app/SessionGate.tsx` gọi `GET /api/v1/auth/me` khi tải, 401 → `/login?next=<đường dẫn hiện tại>` (chỉ chấp nhận `next` là đường dẫn nội bộ bắt đầu bằng `/` và không bắt đầu bằng `//` – chống chuyển hướng mở), `EMAIL_NOT_VERIFIED` → `/verify-email`; giữ `StartPage` là trang `/` sau cổng. Tạo `apps/web/src/features/auth/PasswordField.tsx` (nút hiện/ẩn mật khẩu có `aria-pressed`, `autocomplete` truyền vào, lỗi gắn `aria-describedby`, vùng chạm ≥ 44 × 44 px) và `apps/web/src/features/auth/AuthLayout.tsx` (bố cục chạy từ 360 px). Kiểm thử `apps/web/test/auth/session-gate.spec.tsx` (gồm chặn `next=//evil.example`)

**Checkpoint**: Nền móng xong – guard chạy trên mọi route, CSDL và lõi sẵn sàng, các câu chuyện bắt đầu được.

---

## Phase 3: User Story 1 – Chủ kinh doanh đăng ký tài khoản và vào ứng dụng (Priority: P1) 🎯 MVP

**Goal**: Đăng ký tạo nguyên vẹn tài khoản + người dùng + cách đăng nhập + vai trò chủ, gửi thư xác minh;
mở liên kết xác minh thì được đăng nhập. Phản hồi đăng ký giống hệt nhau cho email mới và email đã có.

**Independent Test**: Gửi `POST /auth/register` với email mới → đúng 1 tài khoản, 1 người dùng, 1 `owner`,
1 `login_identities(password)`; hộp thư `memory` có 1 thư xác minh; `POST /auth/email/verify` với mã trong
thư → 200 `MeResponse` + cookie; gọi `GET /__test/perm/post.approve` → 200 và `currentAccountId()` là tài
khoản vừa tạo.

### Tests for User Story 1 ⚠️ (viết trước, phải đỏ)

- [X] T041 [P] [US1] Kiểm thử e2e `apps/server/test/auth/register-login.e2e.spec.ts` (khối `describe('US1')`): AS1 (tạo đủ 4 dòng + mã xác minh, `email_verified_at` NULL, `terms_version`/`terms_accepted_at` được ghi, 202 `{ status: 'check_email' }`, **không** có `Set-Cookie`); AS2 (email trùng khác hoa/thường/khoảng trắng → phản hồi giống hệt về mã, thân, tiêu đề; không tài khoản thứ hai; thư "email đã có tài khoản"); AS3 (mật khẩu yếu `PASSWORD_WEAK` ở `fieldErrors`, thiếu `acceptTerms` → 400, không ghi gì); AS5 (băm `$argon2id$`, mật khẩu không có trong nhật ký bắt được); AS6 (verify thành công cấp cookie, dùng lại mã → 400 `TOKEN_INVALID`, mã quá 24 giờ → `TOKEN_INVALID`); AS7 (`PATCH /auth/email` khi chưa xác minh → thư mới tới email mới, mã cũ hết hiệu lực; email mới đã có người dùng → phản hồi như thành công, không đổi gì); AS8 (sau verify với phiên chưa xác minh gọi `/__test/perm/post.edit` → 403 `EMAIL_NOT_VERIFIED`); resend giới hạn 3 thư/giờ/email nhưng phản hồi luôn 202 như nhau; `register_ip` vượt 20/giờ → 429 `RATE_LIMITED`; thiếu `Origin` → 403 `CSRF_REJECTED`
- [X] T042 [P] [US1] Kiểm thử CSDL `apps/server/test/db/auth-concurrency.db.spec.ts` (phần US1): 2 lần đăng ký đồng thời cùng email → đúng 1 tài khoản; tiêu thụ cùng một mã `verify_email` đồng thời 2 lần → đúng 1 thành công; AS4: ép lỗi giữa chừng trong `auth_register` → không còn dòng `accounts`/`users` dở dang

### Implementation for User Story 1

- [X] T043 [P] [US1] Thêm mẫu thư `verifyEmail` (liên kết `${WEB_BASE_URL}/verify-email#token=…`, hạn 24 giờ) và `emailAlreadyRegistered` (nút "Đăng nhập" → `/login`, "Quên mật khẩu" → `/forgot-password`) vào `apps/server/src/modules/account/internal/auth/mail/templates.ts`
- [X] T044 [US1] Tạo `apps/server/src/modules/account/internal/auth/registration.service.ts`: kiểm `register_ip` (T033), chuẩn hóa email (T031), kiểm chính sách (T030), **luôn** băm mật khẩu (kể cả khi email đã có – cân thời gian), sinh UUID v7 cho 5 mã + mã xác minh, gọi `account.auth_register` qua `authTx`; `'created'` → ghi kiểm toán `auth.register` và `sendAfterCommit(verifyEmail)`; `'email_taken'` → tra `auth_lookup_email` và `sendAfterCommit(emailAlreadyRegistered)`; cả hai trả cùng kết quả `check_email`
- [X] T045 [US1] Tạo `apps/server/src/modules/account/internal/auth/email-verification.service.ts`: `verify(token)` – `auth_find_token(hash, 'verify_email')` qua `authTx`, rồi trong `runInAccountScope` + `tenantTx` tiêu thụ bằng `UPDATE … SET used_at = now() WHERE id = $1 AND used_at IS NULL AND expires_at > now() RETURNING` (0 dòng → `TOKEN_INVALID`), đặt `users.email_verified_at` khi `email_normalized` của mã khớp email hiện tại, thu hồi phiên hiện tại (`email_verified`), tạo phiên mới (T035), kiểm toán `auth.email.verified`; `resend({ email? , actor? })` – dùng email của phiên nếu có, giới hạn `mail_verify` 3/giờ, đánh dấu `used_at` các mã `verify_email` cũ cùng giao dịch, luôn trả `check_email`; `changeEmail(newEmail)` – chỉ khi `email_verified_at IS NULL` (ngược lại 409 `EMAIL_ALREADY_VERIFIED`), email mới đã có → gửi `emailAlreadyRegistered` tới email đó và không đổi gì, ngược lại cập nhật `email`/`email_normalized`, vô hiệu mã cũ, gửi thư mới, kiểm toán `auth.email.changed`
- [X] T046 [US1] Tạo `apps/server/src/modules/account/internal/auth/customer-auth.controller.ts` (tiền tố `/api/v1/auth`) với `POST /register` (`@Public`, 202), `POST /email/verify` (`@Public`, 200 `MeResponse` + `__Host-sid` `Max-Age` = hết hạn tuyệt đối), `POST /email/resend` (`@Public`, 202), `PATCH /email` (`@CustomerAccess({ allowUnverifiedEmail: true })`, 202) dùng `ValidBody` với lược đồ ở `@app/shared`; hàm dựng `MeResponse` dùng chung (`apps/server/src/modules/account/internal/auth/me.ts`, `permissions` từ `permissionsOf`, không bao giờ có băm/mã); đăng ký controller trong `apps/server/src/modules/account/account.module.ts`
- [X] T047 [P] [US1] Tạo `apps/web/src/features/auth/RegisterPage.tsx` (route `/register`): trường tên hiển thị, email (`autocomplete="email"`), mật khẩu (`PasswordField`, `autocomplete="new-password"`), ô đồng ý điều khoản **không đặt sẵn**; lỗi theo trường từ `fieldErrors`; thành công → màn hình "Hãy kiểm tra email" có nút "Gửi lại thư" (gọi `resend` với email vừa nhập); tiếng Việt đời thường
- [X] T048 [P] [US1] Tạo `apps/web/src/features/auth/VerifyEmailPage.tsx` (route `/verify-email`): đọc `#token=` từ fragment, xóa fragment bằng `history.replaceState` **trước** khi gọi API, POST `/auth/email/verify`, thành công → vào `/`; `TOKEN_INVALID` → thông báo + nút "Gửi lại thư"; khi không có mã và người dùng đang đăng nhập chưa xác minh → màn hình "Hãy xác nhận email" với "Gửi lại thư", "Sửa email đăng ký" (`PATCH /auth/email`), "Đăng xuất"
- [X] T049 [P] [US1] Kiểm thử web `apps/web/test/auth/register.spec.tsx` và `apps/web/test/auth/verify-email.spec.tsx`: `vitest-axe` không lỗi, thao tác hết bằng bàn phím, ô đồng ý mặc định không tích, lỗi đọc được qua `aria-describedby`, fragment bị xóa trước khi gọi API

**Checkpoint**: US1 chạy độc lập – đăng ký, xác minh, gửi lại, sửa email.

---

## Phase 4: User Story 2 – Đăng nhập, giữ phiên và đăng xuất (Priority: P1)

**Goal**: Đăng nhập bằng email + mật khẩu tạo phiên lưu bền; "tôi là ai"; đăng xuất thiết bị hiện tại
và mọi thiết bị; chống dò; phiên quá hạn bị từ chối.

**Independent Test**: Đăng nhập đúng → `GET /auth/me` trả người dùng, tài khoản, vai trò; `POST /auth/logout`
→ cùng cookie gọi lại `GET /auth/me` → 401 `UNAUTHENTICATED`.

### Tests for User Story 2 ⚠️

- [X] T050 [P] [US2] Thêm khối `describe('US2')` vào `apps/server/test/auth/register-login.e2e.spec.ts`: AS1 (`MeResponse` đúng hợp đồng, không có băm/mã; cookie `__Host-sid` có `HttpOnly; Secure; SameSite=Lax; Path=/`, không `Domain`; đăng nhập lần hai cấp mã khác – chống cố định phiên); AS2 (email không tồn tại và sai mật khẩu → cùng 401 `INVALID_CREDENTIALS`, `detail = invalid_credentials`); AS3 (5 lần sai → lần 6 429 `LOGIN_THROTTLED` có `Retry-After` + hành động tới `/forgot-password`, trong lúc chặn mật khẩu đúng cũng bị chặn và **không** chạy verify; hết hạn chặn (đồng hồ giả/cấu hình nhỏ) → đăng nhập được; 30 lần sai từ một địa chỉ mạng trên nhiều email → chặn địa chỉ); AS4 (logout → 401 ngay trên cùng bản); AS5 (2 agent, `logout-all` → agent kia 401 sau khi bộ nhớ đệm hết hạn); AS6 (phiên quá `idle_expires_at`/`absolute_expires_at` → 401); AS7 (POST có `Origin` lạ → 403 `CSRF_REJECTED`); đăng nhập trước khi xác minh → `GET /auth/me` 200 với `emailVerified: false`, `/__test/perm/post.edit` → 403 `EMAIL_NOT_VERIFIED`; người dùng `disabled`/tài khoản `deleting` với mật khẩu đúng → 403 `ACCOUNT_UNAVAILABLE`, mật khẩu sai → vẫn 401; đăng nhập thành công với băm tham số cũ → được băm lại

### Implementation for User Story 2

- [X] T051 [US2] Thêm `loginWithPassword({ email, password, ip, userAgent })` vào `apps/server/src/modules/account/internal/auth/session.service.ts`: chuẩn hóa email; `check` `login_email` và `login_ip` – bị chặn thì trả `LOGIN_THROTTLED` (`retryAfterSeconds`) và kiểm toán `auth.login.throttled` mà **không** verify; `auth_lookup_email` qua `authTx`; không có dòng hoặc không có băm → `verifyDummy()` + `hit` cả hai bộ đếm + kiểm toán `auth.login.failed` (`unknown_email`) + `INVALID_CREDENTIALS`; sai mật khẩu → tương tự (`bad_password`); đúng mà `user_status`/`member_status` không `active` hoặc `account_status = 'deleting'` → `ACCOUNT_UNAVAILABLE`; đúng → `reset` `login_email`, băm lại nếu `needsRehash`, cập nhật `last_used_at`, tạo phiên (T035), kiểm toán `auth.login.succeeded`
- [X] T052 [US2] Thêm vào `apps/server/src/modules/account/internal/auth/customer-auth.controller.ts`: `POST /login` (`@Public`, 200 `MeResponse` + cookie, 429 đặt tiêu đề `Retry-After`), `POST /logout` (`@CustomerAccess({ allowUnverifiedEmail: true })`, 204, thu hồi `logout`, `sessionCache.evict`, xóa cookie `Max-Age=0`), `POST /logout-all` (cùng khai báo, 204, `revokeAllForUser('logout_all')` gồm cả phiên hiện tại, kiểm toán `auth.logout_all`, xóa cookie), `GET /me` (cùng khai báo, 200 `MeResponse`)
- [X] T053 [P] [US2] Tạo `apps/web/src/features/auth/LoginPage.tsx` (route `/login`): email (`autocomplete="email"`), `PasswordField` (`autocomplete="current-password"`), liên kết "Quên mật khẩu", "Tạo tài khoản"; hiện thông điệp `INVALID_CREDENTIALS`/`LOGIN_THROTTLED` (số phút còn lại + nút "Quên mật khẩu")/`ACCOUNT_UNAVAILABLE`; thành công → quay về `next` hợp lệ hoặc `/`; chưa xác minh → `/verify-email`
- [X] T054 [P] [US2] Tạo `apps/web/src/features/auth/SecuritySettingsPage.tsx` (route `/settings/security`, sau cổng phiên) với nút "Đăng xuất" và "Đăng xuất khỏi mọi thiết bị" (có hộp xác nhận); thêm nút "Đăng xuất" ở `apps/web/src/app/StartPage.tsx`
- [X] T055 [P] [US2] Kiểm thử web `apps/web/test/auth/login.spec.tsx` và `apps/web/test/auth/security-settings.spec.tsx`: `vitest-axe` không lỗi, bàn phím, hiện/ẩn mật khẩu, quay về `next` sau đăng nhập, không theo `next` ngoài miền

**Checkpoint**: US1 + US2 – người dùng đăng ký, xác minh, đăng nhập, đăng xuất được.

---

## Phase 5: User Story 3 – Mọi API bị chặn quyền theo vai trò, mặc định từ chối (Priority: P1)

**Goal**: Mọi điểm cuối bắt buộc có khai báo (kiểm ở khởi động và CI); ma trận 5 loại người gọi × 13
quyền khớp FR-012; mã tài khoản chỉ từ phiên; thao tác thành viên nội bộ (ghế) và thu hồi ≤ 60 giây.

**Independent Test**: Chạy `access-matrix.e2e.spec.ts` (5 trạng thái × 13 quyền khớp 100%) và
`access-declarations.spec.ts` (thêm điểm cuối không khai báo → kiểm thử đỏ và gọi điểm cuối đó → 403).

### Tests for User Story 3 ⚠️

- [X] T056 [P] [US3] Kiểm thử `apps/server/test/auth/access-declarations.spec.ts`: dựng `ApiAppModule`, duyệt mọi route bằng `DiscoveryService` + `MetadataScanner`, khẳng định mọi handler có **đúng một** khai báo; dựng thêm mô-đun có `/__test/undeclared` → báo đúng tên handler thiếu; hai khai báo trên một handler → lỗi (FR-013, SC-004)
- [X] T057 [P] [US3] Kiểm thử e2e `apps/server/test/auth/access-matrix.e2e.spec.ts` dùng `AccessMatrixTestModule` (T038): 5 trạng thái (chưa đăng nhập, `owner`, `collaborator`, `support`, `admin` – nhân viên tạo trực tiếp bằng `authTx` nếu US4 chưa xong) × 13 quyền → 200/401/403 khớp 100% bảng FR-012 (SC-003); AS1 cộng tác viên gọi `post.approve` → 403 `FORBIDDEN` với "Chỉ chủ tài khoản mới duyệt được bài." và hành động `contact_owner`; AS3 chưa đăng nhập chỉ gọi được `@Public`; AS4 nhân viên gọi điểm cuối khách hàng → 401; AS5 khách hàng gọi điểm cuối nội bộ → 401; AS7 mỗi lần từ chối có dòng `auth.denied` với `trace_id`, `actor_id`, `account_id`, `required`, không có cookie/mã
- [X] T058 [P] [US3] Kiểm thử e2e `apps/server/test/auth/account-id-injection.e2e.spec.ts` (AS2, SC-004): chủ tài khoản A gọi `POST /__test/echo-account/<B>?accountId=<B>` với thân `{ accountId: <B> }` và tiêu đề `X-Account-Id: <B>` → `currentAccountId()` luôn là A; đọc dữ liệu qua `tenantTx` chỉ thấy của A
- [X] T059 [P] [US3] Thêm vào `apps/server/test/db/auth-concurrency.db.spec.ts` (phần US3): thêm đồng thời 3 cộng tác viên → đúng 2 thành công, lần thứ 3 `SEATS_FULL`; gỡ/khóa chủ → `OWNER_REQUIRED` và `CHECK` CSDL chặn cả khi ghi thẳng
- [X] T060 [P] [US3] Kiểm thử e2e `apps/server/test/auth/revocation.e2e.spec.ts` (AS6, SC-005): hai bản API (hai `INestApplication` cùng CSDL, đồng hồ giả cho `session-cache`); khóa/gỡ cộng tác viên trên bản 1 → bản 2 từ chối trong ≤ 60 giây và ngay lập tức sau khi cache hết hạn; người dùng không còn membership hiệu lực → 401 như chưa đăng nhập; logout trên bản 1 có hiệu lực ngay trên bản 1

### Implementation for User Story 3

- [X] T061 [US3] Tạo `apps/server/src/core/auth/access-declarations.ts`: `scanAccessDeclarations(app)` duyệt route bằng `DiscoveryService` + `MetadataScanner`, trả danh sách handler thiếu/trùng khai báo; gọi khi API khởi động trong `apps/server/src/core/auth/auth.module.ts` (`onApplicationBootstrap`): `APP_ENV` development/test → ném lỗi, staging/production → ghi `error` `auth.access_not_declared` và guard vẫn từ chối
- [X] T062 [US3] Tạo `apps/server/src/modules/account/internal/auth/members.service.ts` (R5): `addMember({ accountId, userId?, displayName, email, role: 'collaborator', addedByUserId })` chọn ghế trống nhỏ nhất trong {1, 2}, trùng ghế (`23505`) thử lại một lần rồi `SEATS_FULL`; `removeMember`/`disableMember`/`enableMember` bằng cập nhật có điều kiện theo trạng thái hiện tại (`active → removed`, `active ↔ disabled`), chặn chủ → 409 `OWNER_REQUIRED`; mỗi chuyển đổi ghi kiểm toán `account.member.added|removed|disabled` trong cùng `tenantTx` và thu hồi mọi phiên của người đó (`member_removed`/`user_disabled`); tất cả chạy qua `runInAccountScope` với `accountId` đã xác minh
- [X] T063 [US3] Mở `members.service` ra giao diện công khai nội bộ trong `apps/server/src/modules/account/public-api.ts` (`AccountPublicApi.addMember/removeMember/disableMember` – chú thích "chỉ cho kiểm thử, dữ liệu mẫu; luồng mời người dùng cuối ở WBS 4.4") và cung cấp trong `apps/server/src/modules/account/account.module.ts`, xuất qua `apps/server/src/modules/account/index.ts`
- [X] T064 [US3] Viết hướng dẫn cho lập trình viên module `apps/server/docs/auth.md`: cách khai báo `@Public`/`@CustomerAccess`/`@StaffAccess`, `currentActor()`/`can()`, quy tắc mặc định từ chối, thêm quyền mới (một dòng ở `packages/shared/src/auth/permissions.ts` + truy vết FR + cập nhật ma trận), hàm hạn chế và quy tắc ranh giới

**Checkpoint**: US1–US3 – cửa vào khách hàng đầy đủ, guard được kiểm bằng ma trận và CI.

---

## Phase 6: User Story 4 – Nhân viên nội bộ đăng nhập riêng, mọi thao tác được ghi lại (Priority: P2)

**Goal**: Nhân viên tạo bằng lệnh vận hành, đăng nhập ở lối vào nội bộ với phiên ngắn, giới hạn theo CIDR,
kiểm toán mọi đăng nhập và thao tác.

**Independent Test**: `pnpm staff create … --role support` → `POST /internal/auth/login` → gọi
`/__test/perm/support.lookup` → 200 và có bản ghi kiểm toán; cùng thông tin ở `POST /auth/login` → 401
`INVALID_CREDENTIALS`.

### Tests for User Story 4 ⚠️

- [X] T065 [P] [US4] Kiểm thử e2e `apps/server/test/auth/staff.e2e.spec.ts`: đăng nhập nội bộ → `StaffMeResponse` + cookie `__Host-staff_sid` (cookie phiên trình duyệt, không `Max-Age`); AS1 `support` gọi `/__test/perm/plan.manage` → 403, `admin` → 200; AS2 đăng nhập thành công/thất bại có `staff.login.succeeded|failed` với `ip`, không mật khẩu; AS3 `staff disable` → mọi phiên bị từ chối ≤ 60 giây; AS4 `STAFF_ALLOWED_CIDRS=203.0.113.0/24` → đăng nhập 403 `IP_NOT_ALLOWED` + `staff.login.denied_ip`, yêu cầu nội bộ từ ngoài dải cũng 403; cùng email ở lối vào khách hàng → 401; chống dò áp cùng ngưỡng; phiên quá 30 phút không hoạt động/12 giờ tuyệt đối → 401; yêu cầu nội bộ thay đổi dữ liệu có bản ghi `staff.request` (SC-008)
- [X] T066 [P] [US4] Kiểm thử `apps/server/test/ops/staff-cli.spec.ts` (CSDL thật): `create` đọc mật khẩu từ stdin và áp chính sách FR-005, `disable`, `reset-password` thu hồi mọi phiên, `list` không in băm; mã thoát `0`/`1`/`2` đúng contracts/auth-ops.md mục 2

### Implementation for User Story 4

- [X] T067 [US4] Tạo `apps/server/src/modules/account/internal/auth/staff.service.ts` (mọi truy cập qua `authTx`): `login({ email, password, ip, userAgent })` – kiểm `STAFF_ALLOWED_CIDRS` trước (ngoài dải → `IP_NOT_ALLOWED` + kiểm toán `staff.login.denied_ip`), cùng bộ đếm `login_email`/`login_ip` và `verifyDummy` như khách hàng, tạo `staff_sessions` (`idle = STAFF_SESSION_IDLE_MINUTES`, `absolute = STAFF_SESSION_ABSOLUTE_HOURS`, `assurance = 'password'`, `ip`), kiểm toán `staff.login.succeeded|failed` với `actor_type` = vai trò nhân viên; `resolveStaff(tokenHash, ip)` – phiên hiệu lực + `staff_users.status = 'active'`, cập nhật `last_seen_at` khi cũ hơn 1 phút; `logout`; `create`, `disable` (thu hồi mọi phiên), `resetPassword` (thu hồi mọi phiên), `list` – kiểm toán `staff.created|disabled|password_reset` với `actor_type = 'system'`, `actor_id = 'ops-cli'`
- [X] T068 [US4] Nối `resolveStaff` của `SESSION_RESOLVER` trong `apps/server/src/modules/account/internal/auth/session.service.ts` sang `staff.service`; thêm `apps/server/src/core/auth/staff-audit.interceptor.ts` (đăng ký toàn cục trong `auth.module.ts`) ghi `staff.request` (phương thức, route mẫu, kết quả – không thân yêu cầu) qua `authTx` cho mọi yêu cầu `@StaffAccess` thay đổi dữ liệu; `supportSearch`/`supportViewAccount` nhận `staffId` từ `requireStaff()` (ghi chú tại `apps/server/src/core/db/support.ts`)
- [X] T069 [US4] Tạo `apps/server/src/modules/account/internal/auth/staff-auth.controller.ts` (tiền tố `/api/v1/internal/auth`): `POST /login` (`@Public`, 200 `StaffMeResponse` + `__Host-staff_sid` không `Max-Age`), `POST /logout` (`@StaffAccess()`, 204), `GET /me` (`@StaffAccess()`, 200 `StaffMeResponse`); đăng ký trong `account.module.ts`
- [X] T070 [US4] Tạo lệnh vận hành `apps/server/src/ops/staff.ts` (`create --email --name --role support|admin`, `disable --email`, `reset-password --email`, `list`): đọc mật khẩu từ stdin, ẩn ký tự khi là TTY, không nhận mật khẩu qua tham số; dùng `DATABASE_APP_URL`; mã thoát `0`/`1`/`2`; thêm script `"staff": "tsx --env-file-if-exists=.env src/ops/staff.ts"` vào `apps/server/package.json` và bảo đảm `src/ops` được biên dịch vào `dist` (chạy được `node dist/ops/staff.js` trong ảnh)
- [X] T071 [P] [US4] Tạo `apps/web/src/features/auth/StaffLoginPage.tsx` (route `/internal/login`, gọi `/api/v1/internal/auth/login`, thông điệp `IP_NOT_ALLOWED`, `INVALID_CREDENTIALS`, `LOGIN_THROTTLED`) và kiểm thử `apps/web/test/auth/staff-login.spec.tsx` (`vitest-axe`, bàn phím)

**Checkpoint**: US4 – lối vào nội bộ chạy độc lập với lối vào khách hàng.

---

## Phase 7: User Story 5 – Quên mật khẩu và đổi mật khẩu (Priority: P2)

**Goal**: Đặt lại qua liên kết dùng một lần (30 phút, 3 thư/giờ), phản hồi không lộ email; đổi mật khẩu
khi nhập đúng mật khẩu hiện tại; thu hồi phiên và gửi thư báo.

**Independent Test**: `POST /auth/password/forgot` cho email có thật → 1 thư có liên kết; `POST
/auth/password/reset` → đăng nhập bằng mật khẩu mới được, mật khẩu cũ không, phiên cũ 401; dùng lại mã → 400
`TOKEN_INVALID`.

### Tests for User Story 5 ⚠️

- [X] T072 [P] [US5] Kiểm thử e2e `apps/server/test/auth/password-reset.e2e.spec.ts`: AS1 email có/không có tài khoản → cùng 202 `check_email`, chỉ email có thật nhận thư; quá 3 thư/giờ/email → không gửi thêm, phản hồi vẫn như cũ; AS2 mã đã dùng, quá 30 phút, hoặc bị mã mới thay → 400 `TOKEN_INVALID`; reset thành công → 200 `MeResponse` + cookie mới, mọi phiên cũ 401, mật khẩu cũ 401, `password_changed_at` được đặt; AS3 `POST /auth/password/change` với mật khẩu hiện tại sai → 401 `INVALID_CREDENTIALS` trên `currentPassword` và được đếm (lần 6 → 429 `LOGIN_THROTTLED`); đổi đúng → 204, phiên khác bị thu hồi, phiên hiện tại được cấp mã mới; AS4 thư "mật khẩu vừa được thay đổi" sau cả reset và change; mật khẩu mới yếu → 400 `VALIDATION_FAILED`

### Implementation for User Story 5

- [X] T073 [P] [US5] Thêm mẫu thư `resetPassword` (liên kết `${WEB_BASE_URL}/reset-password#token=…`, hạn 30 phút) và `passwordChanged` (hướng dẫn nếu không phải họ làm: dùng "Quên mật khẩu", liên hệ hỗ trợ) vào `apps/server/src/modules/account/internal/auth/mail/templates.ts`
- [X] T074 [US5] Tạo `apps/server/src/modules/account/internal/auth/password-reset.service.ts`: `forgot(email)` – giới hạn `RATE_LIMITED` theo địa chỉ mạng, `auth_lookup_email`, có tài khoản và chưa chạm `mail_reset` 3/giờ → trong `runInAccountScope` + `tenantTx` đánh dấu `used_at` các mã `reset_password` cũ, tạo mã mới `expires_at = now + 30 phút`, `sendAfterCommit(resetPassword)`; luôn trả `check_email`; `reset(token, newPassword)` – kiểm chính sách, `auth_find_token(hash, 'reset_password')`, tiêu thụ có điều kiện (0 dòng → `TOKEN_INVALID`), cập nhật `password_hash` + `password_changed_at`, `revokeAllForUser('password_reset')`, tạo phiên mới, kiểm toán `auth.password.reset`, gửi `passwordChanged`; `change(actor, currentPassword, newPassword)` – kiểm chặn `login_email`, verify mật khẩu hiện tại (sai → `hit` + `INVALID_CREDENTIALS` với `fieldErrors.currentPassword`), cập nhật băm, `revokeAllForUser('password_changed', { exceptSessionId })` rồi thu hồi và cấp mã mới cho phiên hiện tại, kiểm toán `auth.password.changed`, gửi `passwordChanged`
- [X] T075 [US5] Thêm vào `apps/server/src/modules/account/internal/auth/customer-auth.controller.ts`: `POST /password/forgot` (`@Public`, 202), `POST /password/reset` (`@Public`, 200 `MeResponse` + cookie mới), `POST /password/change` (`@CustomerAccess()` – đòi email đã xác minh, 204 + đặt lại cookie với mã mới)
- [X] T076 [P] [US5] Tạo `apps/web/src/features/auth/ForgotPasswordPage.tsx` (route `/forgot-password`, luôn hiện "Nếu email có tài khoản, chúng tôi đã gửi hướng dẫn") và `apps/web/src/features/auth/ResetPasswordPage.tsx` (route `/reset-password`, đọc và xóa `#token=` bằng `history.replaceState` trước khi gọi API, `PasswordField` `autocomplete="new-password"`, `TOKEN_INVALID` → nút "Gửi lại liên kết")
- [X] T077 [US5] Thêm biểu mẫu "Đổi mật khẩu" (mật khẩu hiện tại `autocomplete="current-password"`, mật khẩu mới `autocomplete="new-password"`) vào `apps/web/src/features/auth/SecuritySettingsPage.tsx`
- [X] T078 [P] [US5] Kiểm thử web `apps/web/test/auth/forgot-reset.spec.tsx` và bổ sung `apps/web/test/auth/security-settings.spec.tsx`: `vitest-axe` không lỗi, bàn phím, fragment bị xóa, thông điệp không phân biệt email có/không

**Checkpoint**: Mọi câu chuyện hoàn tất và kiểm được độc lập.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Dữ liệu mẫu, đo đạc SC, quét bí mật, tài liệu, rà hiến pháp.

- [X] T079 [P] Tạo `apps/server/src/ops/seed-auth.ts` và script `"dev:seed-auth"` (gốc và `apps/server/package.json`): chỉ chạy khi `APP_ENV ∈ {development, test}`; tạo 1 tài khoản với chủ `owner@example.test` (đã xác minh) + `collab1@example.test`, `collab2@example.test` qua `AccountPublicApi.addMember`, 1 nhân viên `support` và 1 `admin` qua `staff.service`; in mật khẩu mẫu đúng một lần; chạy lại an toàn (bỏ qua nếu đã có)
- [X] T080 [P] Kiểm thử e2e `apps/server/test/auth/auth-secrets-in-logs.e2e.spec.ts` (SC-007, FR-019): chạy luồng đăng ký → xác minh → đăng nhập sai/đúng → quên/đặt lại → đổi mật khẩu → đăng nhập nội bộ; bắt mọi dòng nhật ký, mọi phản hồi và `infra.audit_log.metadata`; khẳng định không có mật khẩu thử, mã phiên, mã một lần, `token_hash` (hex/base64), chuỗi `$argon2id$`, email trong metadata kiểm toán
- [X] T081 [P] Kiểm thử đo `apps/server/test/auth/timing.e2e.spec.ts`: SC-006 – 200 lần đăng nhập với email có/không có, chênh lệch thời gian trung bình < 50 ms, cùng thông điệp; 1.000 lần thử cho một email từ nhiều địa chỉ mạng → tối đa 5 lần được đánh giá mỗi 15 phút; SC-002 – p95 đăng nhập ≤ 2 giây và guard thêm ≤ 20 ms p95 khi cache trúng (dùng tham số argon2 thật ở ca đo p95)
- [X] T082 [P] Mở rộng quét bí mật ở `tooling/verify.mjs`: thêm mẫu `__Host-sid=`, `__Host-staff_sid=`, `$argon2id$` cho mã nguồn và nhật ký mẫu (contracts/auth-ops.md mục 5); thêm fixture vi phạm vào `tooling/test/` nếu có bộ kiểm thử của verify
- [X] T083 [P] Cập nhật `.specify/memory/architecture.md` lên v1.4 (v1.3 đã dùng cho 003): T7 cụ thể "bộ thư viện: argon2 + phiên máy chủ + arctic (sau)" kèm lý do RLS (mục 2, mục 12), mục API/xác thực (guard, khai báo, `authTx`, `runInAccountScope`, 4 hàm `SECURITY DEFINER`), thuật ngữ mới vào bảng ánh xạ mục 11 (research.md "Thuật ngữ mới"), dữ liệu cá nhân mới (data-model.md mục 8)
- [X] T084 [P] Cập nhật tài liệu gốc ở repo chính (thư mục `TaiLieuDacTa/` bị gitignore, sửa tại `D:/ToolHangNgay/AppDangNenTang/TaiLieuDacTa/`): dòng T7 của `Lua_chon_Cong_nghe_App_AI_Content_MXH.md` (R1) và danh mục dữ liệu cá nhân của tài liệu Kiến trúc dữ liệu mục 9 (data-model.md mục 8: địa chỉ mạng ở kiểm toán, HMAC trong `auth_throttle`, tóm tắt thiết bị); báo người dùng vì tệp không theo nhánh — **Kết quả**: phiên implement bị khóa trong worktree nên đã sửa bản sao `TaiLieuDacTa/` của worktree (`Lua_chon_Cong_nghe…` dòng T7 + đoạn "Chọn cụ thể"; `Kien_truc_Du_lieu…` mục 9 bảng dữ liệu cá nhân 004); cần chép hai tệp này về repo chính.
- [X] T085 [P] Cập nhật `apps/server/docs/database.md`: `authTx`, `runInAccountScope`, 4 hàm `SECURITY DEFINER` (khi nào dùng, quyền, kiểm thử bắt buộc), các chỉ mục toàn cục ngoại lệ quy tắc `d`
- [X] T086 Chạy toàn bộ cổng: `pnpm verify` (lint, typecheck strict, ranh giới gồm `auth-tx-restricted`/`account-scope-restricted`, test, quét bí mật), `pnpm test:db`, `pnpm db:check` → 0 vi phạm; sửa mọi lỗi
- [ ] T087 Chạy kịch bản thủ công quickstart.md mục 0 và mục 2 (8 kịch bản trên màn hình 360 px với Mailpit) và các truy vấn mục 3; ghi kết quả vào cuối `specs/004-minimal-auth-rbac/quickstart.md` (mục "Kết quả kiểm chứng")
- [X] T088 Chạy `/constitution-review` trên thay đổi của nhánh, chú trọng nguyên tắc I (RLS, `SECURITY DEFINER`, mã tài khoản chỉ từ phiên), VI (mặc định từ chối), VII (băm, mã, nhật ký); xử lý mọi phát hiện — **Kết quả (2026-11-10)**: không vi phạm nghiêm trọng I/II/III. Còn: FK `user_id` một cột (nên đổi FK ghép `(account_id, user_id)`), `AccountPublicApi` nhận `accountId` qua tham số (chỉ kiểm thử/dữ liệu mẫu), thư trong tiến trình (V – đã theo dõi), chưa có việc định kỳ dọn `sessions`/`auth_tokens`/`auth_throttle` (chờ 003).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: không phụ thuộc
- **Foundational (Phase 2)**: sau Setup – CHẶN mọi câu chuyện
- **US1 (Phase 3)**: sau Foundational
- **US2 (Phase 4)**: sau Foundational; kiểm thử dùng `registerAndVerify` nên cần US1 xong (hoặc tạo người dùng trực tiếp qua `auth_register` trong kiểm thử)
- **US3 (Phase 5)**: sau Foundational; ma trận cần người dùng đăng nhập được → sau US1 + US2
- **US4 (Phase 6)**: sau Foundational; độc lập với US1–US3 (chỉ dùng chung guard và `staff_*`)
- **US5 (Phase 7)**: sau US2 (đổi mật khẩu cần phiên, `customer-auth.controller.ts` đã có)
- **Polish (Phase 8)**: sau mọi câu chuyện cần thiết; T079 cần US3 (`addMember`) và US4 (`staff.service`)

### Thứ tự bên trong Phase 2

- T006 → (T007, T008 song song) → T009 → T010 → T011 → T012 → (T013, T014)
- T015 sau T010 (cần bảng `auth_throttle`); T016, T017 song song với phần CSDL
- T018 cần T008; T019–T022, T024–T026 song song; T023 cần T016; T027 cần T018–T026; T028 cần T027
- T029 song song với core/auth; T030–T032, T034, T036 song song; T033 cần T015 + T032; T035 cần T021, T023, T026, T032
- T037 cần T028, T029, T035; T038 cần T028
- T039 → T040

### User Story Dependencies

- **US1 (P1)**: chỉ phụ thuộc Foundational – MVP
- **US2 (P1)**: dùng chung `customer-auth.controller.ts` với US1 (làm tuần tự trên tệp đó)
- **US3 (P1)**: dùng người dùng của US1/US2 trong kiểm thử; `members.service` mới hoàn toàn
- **US4 (P2)**: độc lập; ca "nhân viên" trong ma trận US3 tạo nhân viên trực tiếp nếu US4 chưa xong
- **US5 (P2)**: cần US2

### Within Each User Story

- Kiểm thử viết trước và phải đỏ
- Mẫu thư → dịch vụ → controller → trang web → kiểm thử web
- Các việc cùng tệp (`customer-auth.controller.ts`, `session.service.ts`, `templates.ts`, `register-login.e2e.spec.ts`, `auth-concurrency.db.spec.ts`, `SecuritySettingsPage.tsx`) làm tuần tự

### Parallel Opportunities

- Setup: T002–T005 song song
- Foundational: T007/T008; T013/T014; T018–T022, T024–T026, T029, T030–T032, T034, T036
- Sau Foundational: US4 chạy song song với US1→US2→US3
- Trong mỗi câu chuyện: các kiểm thử [P] và các trang web [P]
- Polish: T079–T085 song song

---

## Parallel Example: User Story 1

```bash
# Kiểm thử viết trước, song song:
Task: "T041 [US1] e2e đăng ký/xác minh trong apps/server/test/auth/register-login.e2e.spec.ts"
Task: "T042 [US1] đồng thời đăng ký/tiêu thụ mã trong apps/server/test/db/auth-concurrency.db.spec.ts"

# Trong lúc làm dịch vụ (T044, T045), làm song song phần web:
Task: "T047 [US1] RegisterPage trong apps/web/src/features/auth/RegisterPage.tsx"
Task: "T048 [US1] VerifyEmailPage trong apps/web/src/features/auth/VerifyEmailPage.tsx"
Task: "T049 [US1] kiểm thử web trong apps/web/test/auth/register.spec.tsx, verify-email.spec.tsx"
```

## Parallel Example: User Story 3

```bash
Task: "T056 [US3] apps/server/test/auth/access-declarations.spec.ts"
Task: "T057 [US3] apps/server/test/auth/access-matrix.e2e.spec.ts"
Task: "T058 [US3] apps/server/test/auth/account-id-injection.e2e.spec.ts"
Task: "T059 [US3] apps/server/test/db/auth-concurrency.db.spec.ts (ghế)"
Task: "T060 [US3] apps/server/test/auth/revocation.e2e.spec.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup
2. Phase 2 Foundational (guard mặc định từ chối đã chạy trên mọi route)
3. Phase 3 US1 – đăng ký + xác minh → được đăng nhập
4. **DỪNG và KIỂM**: Independent Test của US1, `pnpm verify`, `pnpm test:db`

### Incremental Delivery

1. Setup + Foundational → nền móng
2. US1 → đăng ký (MVP)
3. US2 → đăng nhập/đăng xuất (cửa vào dùng hằng ngày)
4. US3 → ma trận quyền + kiểm CI (điều kiện để module WBS 2.x bắt đầu)
5. US4 → lối vào nội bộ (có thể làm song song với 2–4)
6. US5 → quên/đổi mật khẩu
7. Polish → đo SC, tài liệu, rà hiến pháp

### Parallel Team Strategy

1. Cả nhóm làm Setup + Foundational
2. Sau đó: A làm US1 → US2 → US5 (luồng khách hàng); B làm US4 (nhân viên); C làm US3 (ma trận, ghế, thu hồi) khi US2 xong

---

## Notes

- [P] = khác tệp, không phụ thuộc việc chưa xong
- Mỗi việc có truy vết về FR/SC qua câu chuyện và tài liệu hợp đồng
- Commit sau mỗi việc hoặc nhóm việc hợp lý
- Tránh: đọc mã tài khoản từ đầu vào người dùng, nhập `authTx`/`runInAccountScope` ngoài ranh giới, ghi bí mật vào nhật ký
