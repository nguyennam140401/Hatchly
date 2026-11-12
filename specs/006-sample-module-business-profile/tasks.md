---
description: "Danh sách việc – 006 Module mẫu trọn luồng: khung Hồ sơ kinh doanh"
---

# Tasks: Module mẫu trọn luồng màn hình → CSDL – khung "Hồ sơ kinh doanh"

**Input**: tài liệu thiết kế trong `specs/006-sample-module-business-profile/` (plan.md, spec.md, research.md R1–R15,
data-model.md, contracts/, quickstart.md)

**Tests**: BẮT BUỘC – FR-021 yêu cầu bộ kiểm thử mẫu nhóm (a)–(h); SC-007 yêu cầu mỗi nhóm có ít nhất một kiểm thử chạy
trong CI. Mỗi tệp kiểm thử MUST có chú thích đầu tệp ghi rõ nhóm (a)…(h) và "chép mẫu này khi…" để đội chép theo.

**Organization**: theo câu chuyện người dùng (US1–US7 trong spec.md). Mã định danh tiếng Anh, chú thích/thông điệp
tiếng Việt (CLAUDE.md). Ánh xạ thuật ngữ: data-model.md mục 0.

## Format: `[ID] [P?] [Story] Mô tả`

- **[P]**: chạy song song được (tệp khác nhau, không phụ thuộc việc chưa xong)
- **[Story]**: US1…US7 theo spec.md
- Đường dẫn tính từ gốc worktree

---

## Phase 1: Setup

**Purpose**: chuẩn bị gói/khung trống cho tính năng

- [X] T001 Thêm `account` vào `allowedDeps` của module `context` trong `apps/server/src/modules/modules.manifest.json` → `["account", "ai_gateway", "queue"]`; chạy `pnpm check:boundaries` và `pnpm --filter @app/server test -- test/manifest.spec.ts` xác nhận không vòng phụ thuộc
- [X] T002 [P] Tạo khung tệp rỗng cho hợp đồng dùng chung `packages/shared/src/modules/context/{industries,limits,profile}.ts` và xuất lại từ `packages/shared/src/modules/context/index.ts`; xác nhận lối vào `@app/shared/context` đã khai báo trong `packages/shared/package.json` (`exports`) – thêm nếu thiếu
- [X] T003 [P] Tạo gói `e2e/` (`@app/e2e`): `e2e/package.json` với `@playwright/test` và `@axe-core/playwright` **cố định phiên bản chính xác** (không `^`/`~`, R12), script `test:e2e`; thêm `e2e` vào `pnpm-workspace.yaml`; thêm script gốc `"test:e2e": "pnpm --filter @app/e2e test:e2e"` vào `package.json`; thêm `e2e/` vào cấu hình tsconfig/eslint gốc nếu cần để `pnpm typecheck` và `pnpm lint` phủ gói mới

---

## Phase 2: Foundational (chặn mọi câu chuyện)

**Purpose**: quyền, hợp đồng dùng chung, CSDL, mở rộng khung 002/004 – mọi US đều cần

**⚠️ CRITICAL**: chưa xong phase này thì chưa làm US nào

### Quyền `context.view` / `context.edit` (R9, FR-008)

- [X] T004 Thay dòng `context.manage` trong `packages/shared/src/auth/permissions.ts` bằng hai quyền: `context.view` (chủ + cộng tác viên, chú thích trỏ `TaiLieuDacTa/Dac_ta_yeu_cau_App_AI_Content_MXH.md#pq-context-view`) và `context.edit` (chỉ chủ, chú thích trỏ `#pq-context-edit`); gỡ hẳn mã `context.manage` khỏi mã nguồn (`grep -rn "context.manage" apps packages` phải rỗng ngoài tài liệu)
- [X] T005 Thêm thông điệp từ chối vào `PERMISSION_DENIED_MESSAGES` trong `apps/server/src/core/auth/permissions.ts`: `context.view` → "Bạn không có quyền xem hồ sơ kinh doanh."; `context.edit` → "Chỉ chủ tài khoản mới sửa được hồ sơ kinh doanh." kèm hành động `contact_owner` "Nhờ chủ tài khoản cập nhật" (contracts/context-http-api.md mục 2, 5)
- [X] T006 [P] Cập nhật kiểm thử quyền `packages/shared/test/auth.spec.ts` và `apps/server/test/auth/permissions.spec.ts`: chủ có cả hai quyền; cộng tác viên chỉ `context.view`; hỗ trợ/quản trị nội bộ không có quyền nào (FR-012); `context.manage` không còn tồn tại

### Hợp đồng dùng chung `@app/shared/context` (R5, R6, FR-001, FR-001a, FR-004)

- [X] T007 [P] Viết `packages/shared/src/modules/context/industries.ts`: `INDUSTRIES` (mã + nhãn tiếng Việt) gồm đúng `fashion` Thời trang, `food_beverage` Ăn uống, `cosmetics` Mỹ phẩm, `education` Giáo dục, `beauty_services` Dịch vụ làm đẹp, `other` Khác; `INDUSTRY_CODES` dạng tuple `as const` cho `z.enum`; kiểu `IndustryCode`; chú thích "mã đã dùng không được xóa"
- [X] T008 [P] Viết `packages/shared/src/modules/context/limits.ts`: `PROFILE_LIMITS = { industryOther: 100, introduction: 2000, products: 5000, policies: 5000, tone: 500, keywordsMax: 20, keywordLength: 50 }` (`as const`) và hàm `charCount(s) = [...s].length` (đếm theo điểm mã Unicode để khớp `char_length` của PostgreSQL)
- [X] T009 Viết `packages/shared/src/modules/context/profile.ts` (phụ thuộc T007, T008): `ProfileFields = z.strictObject({ industryCode: z.enum(INDUSTRY_CODES), industryOther: z.string().nullable(), introduction: z.string(), products: z.string().nullable(), policies: z.string().nullable(), tone: z.string().nullable(), keywords: z.array(z.string()) })` + transform chuẩn hóa (cắt khoảng trắng đầu/cuối mọi trường; trường tùy chọn rỗng → `null`; `industryOther` → `null` khi `industryCode ≠ 'other'`; từ khóa cắt khoảng trắng, giữ thứ tự) + `superRefine` theo `PROFILE_LIMITS` với đúng thông điệp data-model mục 3: "Hãy chọn ngành kinh doanh.", "Hãy nhập tên ngành của bạn (tối đa 100 ký tự)." (bắt buộc 1–100 khi `other`), "Hãy viết vài dòng giới thiệu (tối đa 2.000 ký tự)." (bắt buộc 1–2.000), "Phần sản phẩm/dịch vụ dài quá 5.000 ký tự – hãy rút gọn." (tương tự cho chính sách ≤ 5.000, giọng văn ≤ 500), từ khóa ≤ 20 mục, mỗi mục 1–50, "Từ khóa "X" bị trùng – hãy xóa bớt." (không phân biệt hoa thường); đường dẫn lỗi theo tên trường
- [X] T010 Bổ sung DTO HTTP vào `packages/shared/src/modules/context/profile.ts` theo contracts/context-http-api.md: `SavedBy = { userId, displayName: string | null, memberStatus: 'active' | 'left' }`; `ProfileView = { profileId, version, savedAt (ISO UTC), savedBy, fields }`; `GetProfileResponse = { profile: ProfileView | null, missingOptional: ('products'|'policies'|'tone'|'keywords')[] }`; `SaveProfileRequest = z.strictObject({ expectedVersion: z.int().min(0), fields: ProfileFields })`; `SaveProfileResponse = { changed: boolean, profile: ProfileView }`; `VersionListQuery = { page: z.coerce.number().int().min(1).default(1) }`; `VersionListResponse = { items: { versionId, version, savedAt, savedBy }[], page, pageSize: 20, total }`; `VersionIdParam = { versionId: z.uuid() }`; `VersionDetailResponse = { versionId, version, savedAt, savedBy, fields, isCurrent }`; hằng `VERSION_PAGE_SIZE = 20`
- [X] T011 [P] Kiểm thử (a) `packages/shared/test/context-profile.spec.ts`: mỗi giới hạn đúng biên (đạt ở N, lỗi ở N+1, đếm emoji là 1 ký tự), "Khác" bắt buộc tên ngành, `industryOther` bị bỏ khi ngành khác, chuẩn hóa khoảng trắng/chuỗi rỗng → `null`, từ khóa trùng không phân biệt hoa thường, trường lạ bị từ chối (`strictObject`, vd `accountId`), thông điệp tiếng Việt đúng nguyên văn

### Mở rộng khung 002/004

- [X] T012 [P] Thêm tùy chọn `conflictMessage` vào `versionConflict(message?)` và `updateVersioned(…, { conflictMessage })` trong `apps/server/src/core/db/versioned.ts` (giữ thông điệp mặc định cũ – tương thích ngược, R3); thêm ca kiểm thử thông điệp tùy chỉnh vào `apps/server/test/db/versioned.db.spec.ts`
- [X] T013 [P] Thêm `describeMembers(userIds: readonly string[]): Promise<{ userId: string; displayName: string; status: 'active' | 'removed' | 'disabled' }[]>` vào `apps/server/src/modules/account/public-api.ts`, hiện thực ở `apps/server/src/modules/account/internal/members/describe-members.ts` (đọc `users` + `memberships` trong `tenantTx` của người gọi, không nhận `accountId`, tối đa 100 mã/lần – vượt thì ném lỗi lập trình, mã không thuộc tài khoản không có trong kết quả) và nối vào implementation của `AccountPublicApi` trong `apps/server/src/modules/account/`
- [X] T014 [P] Kiểm thử `apps/server/test/db/account-describe-members.db.spec.ts`: mã của tài khoản khác không trả về; thành viên đã gỡ trả `removed`; mã không tồn tại bị bỏ qua; không ngữ cảnh tenant → `TENANT_CONTEXT_MISSING`; > 100 mã → lỗi

### CSDL schema `context` (data-model.md mục 1–2, FR-010, FR-024)

- [X] T015 Viết `apps/server/src/modules/context/internal/db/schema.ts`: `businessProfiles = tenantTable(context, 'business_profiles', {…}, { softDelete: true, versioned: true })` với chỉ mục UNIQUE `business_profiles_account_id_key (account_id)`; `profileVersions = tenantTable(context, 'profile_versions', {…})` (không versioned, không softDelete) gồm `profile_id uuid NOT NULL` FK `context.business_profiles(id) ON DELETE CASCADE`, `version_number integer NOT NULL CHECK ≥ 1`, `industry_code text NOT NULL CHECK char_length BETWEEN 1 AND 50`, `industry_other text NULL CHECK char_length ≤ 100` + CHECK `(industry_code = 'other') = (industry_other IS NOT NULL)`, `introduction text NOT NULL CHECK char_length BETWEEN 1 AND 2000`, `products text NULL CHECK ≤ 5000`, `policies text NULL CHECK ≤ 5000`, `tone text NULL CHECK ≤ 500`, `keywords text[] NOT NULL default '{}' CHECK cardinality(keywords) ≤ 20`, `saved_by_user_id uuid NOT NULL` **không FK** (ADR-09, chú thích lý do); chỉ mục UNIQUE (`account_id`, `profile_id`, `version_number`); đăng ký schema vào nơi drizzle-kit gom schema (theo khuôn module `account`)
- [X] T016 Chạy `pnpm db:generate` sinh `apps/server/drizzle/migrations/0012_context_business_profiles.sql`; review tay: bật RLS + chính sách `tenant_isolation` cho cả hai bảng, FK `account_id` và `profile_id` ON DELETE CASCADE, chỉ thêm (không DROP/ALTER phá vỡ – FR-024); `pnpm db:lint-migrations` ĐẠT
- [X] T017 Viết migration tay `apps/server/drizzle/migrations/0013_context_profile_versions_immutable.sql`: `REVOKE UPDATE, DELETE ON context.profile_versions FROM app, system` (tên vai trò theo `apps/server/src/core/db/roles.ts`), chú thích "xóa chỉ qua CASCADE khi xóa tài khoản"; cập nhật journal trong `apps/server/drizzle/migrations/meta/`; `pnpm db:setup && pnpm db:check` → 0 vi phạm

### Khung module `context` (rỗng, để các US điền)

- [X] T018 Khai báo `ContextPublicApi` (chỉ `getCurrentProfile(): Promise<CurrentBusinessProfile | null>`, JSDoc theo contracts/context-public-api.md mục 1) và kiểu `CurrentBusinessProfile` (data-model mục 6: `profileId, version, savedAt, industryCode, industryOther, introduction, products, policies, tone, keywords` – không `accountId`/`savedByUserId`) trong `apps/server/src/modules/context/public-api.ts`; xuất token `CONTEXT_PUBLIC_API` qua `apps/server/src/modules/context/index.ts`
- [X] T019 Viết hàm thuần `apps/server/src/modules/context/internal/profile-content.ts`: `sameProfileContent(a, b)` (so nội dung đã chuẩn hóa, từ khóa so theo thứ tự), `rowToFields(row)`, `fieldsToRow(fields)`, `missingOptional(fields | null)` (thiếu `products`/`policies`/`tone`/`keywords` rỗng; `null` → cả bốn)
- [X] T020 [P] Kiểm thử (a) `apps/server/test/unit/context/profile-content.spec.ts`: `sameProfileContent` (giống sau chuẩn hóa → true; đổi thứ tự từ khóa → false), ánh xạ dòng ↔ DTO hai chiều, `missingOptional`

**Checkpoint**: quyền, hợp đồng, bảng, khung module sẵn sàng – bắt đầu các US

---

## Phase 3: User Story 1 – Chủ điền và cập nhật hồ sơ (P1) 🎯 MVP

**Goal**: chủ xem, lưu hồ sơ thành phiên bản 1, 2…; "không có thay đổi"; hợp lệ hai lớp; chặn rời trang khi chưa lưu.

**Independent Test**: chủ mới mở `/business-profile` → biểu mẫu trống + gợi ý → lưu → tải lại thấy "Phiên bản 1"; sửa → "Phiên bản 2"; lưu lại không sửa → "Không có thay đổi để lưu".

### Tests US1

- [X] T021 [P] [US1] Kiểm thử (b) phần chủ trong `apps/server/test/context/profile-api.e2e.spec.ts`: `GET /context/profile` chưa có hồ sơ → 200 `{ profile: null, missingOptional: [4 trường] }`; `PUT` `expectedVersion: 0` → 200 `changed: true`, `version: 1`; `PUT` sửa từ 1 → `version: 2`; `PUT` giống bản hiện hành (chỉ khác khoảng trắng đầu/cuối) → `changed: false`, không tạo phiên bản; thân sai → 400 `VALIDATION_FAILED` với `fieldErrors` đường dẫn `fields.<tên>` cùng thông điệp với T009, hành động `fix_input`; mọi lỗi qua `ErrorResponse.safeParse`
- [X] T022 [P] [US1] Kiểm thử (f) `apps/web/test/context/BusinessProfilePage.spec.tsx` (vitest + Testing Library + `vitest-axe`, giả lập `context-api`): trạng thái đang tải (`aria-busy`), trống + thẻ gợi ý, có hồ sơ (dòng "Phiên bản N · lưu lúc HH:mm dd/MM/yyyy (giờ Việt Nam) · bởi <tên>"), đang lưu (nút "Đang lưu…" vô hiệu), lưu thành công `role="status"` "Đã lưu phiên bản N", "Không có thay đổi để lưu", lỗi hợp lệ cạnh ô (`aria-invalid`, `aria-describedby`, tiêu điểm vào ô lỗi đầu), lỗi từ máy chủ gắn đúng ô, lỗi mạng `role="alert"` + "Thử lại" + "Chi tiết cho hỗ trợ" thu gọn, nội dung `<script>` hiển thị nguyên văn; 0 vi phạm axe
- [X] T023 [P] [US1] Kiểm thử (f) `apps/web/test/context/ProfileForm.spec.tsx`: chọn "Khác" hiện ô "Tên ngành" bắt buộc; bộ đếm "x/2.000"; thêm từ khóa bằng Enter, xóa bằng nút "Xóa từ khóa X", chặn quá 20; chặn rời trang khi còn thay đổi (`useBlocker` → hộp "Bỏ các thay đổi chưa lưu?" Ở lại / Bỏ thay đổi)

### Implementation US1

- [X] T024 [US1] Viết `apps/server/src/modules/context/internal/profile.service.ts` – `getProfile()` và `saveProfile(expectedVersion, fields, userId)` trong một `tenantTx` theo data-model mục 4: `expectedVersion = 0` + chưa có → INSERT hồ sơ (version 1) + INSERT phiên bản #1; `= 0` + đã có (vi phạm UNIQUE) → `versionConflict(...)`; `= N` hiện hành → đọc phiên bản N, `sameProfileContent` giống → `{ changed: false }` (không ghi); khác → `updateVersioned(N → N+1, { conflictMessage: 'Hồ sơ vừa được cập nhật ở nơi khác. Tải bản mới nhất để xem.' })` + INSERT phiên bản #N+1; `≠` hiện hành → xung đột; ≤ 3 câu lệnh ghi mỗi lần lưu; tên người lưu lấy qua `AccountPublicApi.describeMembers` (không có trong kết quả hoặc `status = 'removed'` → `memberStatus: 'left'`, `displayName: null`; `active`/`disabled` → `memberStatus: 'active'`, hiện tên); không cache (FR-015). Để chỗ gọi `enqueue` (T062) ngay sau INSERT phiên bản
- [X] T025 [US1] Nhật ký (FR-020, R14): (1) `profile.service.ts` ghi `context.profile.saved` (`version`, `changed`); (2) từ chối quyền dùng `auth.denied` sẵn có của `apps/server/src/core/auth/access.guard.ts` (không ghi lặp); (3) thêm vào `apps/server/src/core/errors/error.filter.ts` nhật ký `request.rejected` mức `warn` cho mọi `AppError` 4xx với `code`, `route` (đường dẫn mẫu, không giá trị tham số – dùng lại helper của guard), `account_id` (từ ngữ cảnh thực thi nếu có), `trace_id` – bao phủ `VALIDATION_FAILED` và `VERSION_CONFLICT`; không bao giờ ghi thân yêu cầu hay giá trị người dùng trong `fieldErrors`; MUST NOT ghi nội dung trường
- [X] T026 [US1] Viết `apps/server/src/modules/context/internal/profile.controller.ts`: `GET /context/profile` (`@CustomerAccess('context.view')`) và `PUT /context/profile` (`@CustomerAccess('context.edit')`, `@ValidBody(SaveProfileRequest)`); `userId` và mã tài khoản chỉ lấy từ phiên; trả đúng DTO T010 kèm `missingOptional`
- [X] T027 [US1] Đăng ký controller (chỉ ở API) và provider trong `apps/server/src/modules/context/context.module.ts`; inject `ACCOUNT_PUBLIC_API`
- [X] T028 [P] [US1] Viết `apps/web/src/features/context/context-api.ts` theo khuôn `apps/web/src/features/auth/auth-api.ts`: `getProfile`, `saveProfile`, `listVersions`, `getVersion` – `safeParse` mọi phản hồi bằng lược đồ `@app/shared/context`, lỗi thành `ApiError`
- [X] T029 [P] [US1] Viết `apps/web/src/features/context/KeywordsInput.tsx`: ô nhập + Enter thêm, thẻ có nút xóa nhãn "Xóa từ khóa X", tối đa 20, vùng chạm ≥ 44 × 44 px
- [X] T030 [P] [US1] Viết `apps/web/src/features/context/useUnsavedChangesGuard.ts`: `useBlocker` của React Router + `beforeunload` khi `dirty`
- [X] T031 [US1] Viết `apps/web/src/features/context/ProfileForm.tsx`: `<select>` ngành theo `INDUSTRIES` (ô "Tên ngành" khi "Khác"), `<textarea>` giới thiệu/sản phẩm/chính sách có bộ đếm (`aria-live="polite"` khi gần giới hạn), giọng văn với `placeholder` gợi ý, `KeywordsInput`; `<label>` mọi ô; kiểm hợp lệ bằng chính `ProfileFields.safeParse`; lỗi cạnh ô + tóm tắt đầu biểu mẫu; prop `readOnly` (dùng ở US2)
- [X] T032 [US1] Viết `apps/web/src/features/context/BusinessProfilePage.tsx` bằng `useState`/`useReducer` (không thêm thư viện): mọi trạng thái bảng trong contracts/business-profile-ui.md (chữ + biểu tượng, không chỉ màu), thời gian hiển thị UTC+7, thẻ gợi ý từ `missingOptional`, chống bấm hai lần, gắn `useUnsavedChangesGuard`, bố cục một cột từ 360 px
- [X] T033 [US1] Thêm tuyến `/business-profile` sau `SessionGate` trong `apps/web/src/app/router.tsx` và mục điều hướng tới trang (theo khuôn tuyến hiện có)

**Checkpoint**: US1 chạy độc lập – lưu/xem phiên bản qua màn hình thật

---

## Phase 4: User Story 2 – Chủ sửa, cộng tác viên chỉ xem, chặn ở máy chủ (P1)

**Goal**: CTV xem đầy đủ nhưng không sửa; mọi yêu cầu sửa của CTV/hỗ trợ/chưa đăng nhập bị chặn ở API.

**Independent Test**: đăng nhập CTV → trang chỉ xem, không nút "Lưu"; gửi thẳng `PUT /context/profile` → 403 "Chỉ chủ tài khoản mới sửa được hồ sơ kinh doanh.", không phiên bản nào được tạo.

### Tests US2

- [X] T034 [P] [US2] Bổ sung (b) vào `apps/server/test/context/profile-api.e2e.spec.ts`: CTV `GET` → 200, `PUT` → 403 `FORBIDDEN` hành động `contact_owner`, số phiên bản không đổi; nhân viên hỗ trợ/quản trị (cookie nội bộ) → 401/403 cho cả 4 điểm cuối (FR-012); chưa đăng nhập → 401 `UNAUTHENTICATED` hành động `navigate` "Đăng nhập lại"; ghi nhật ký `rejected` với `reason: forbidden`
- [X] T035 [P] [US2] Xác nhận `apps/server/test/auth/access-matrix.e2e.spec.ts` tự phủ `context.view`, `context.edit` (bổ sung khai báo điểm cuối nếu ma trận cần) và `apps/server/test/auth/access-declarations.spec.ts` bắt được điểm cuối thiếu `@CustomerAccess`
- [X] T036 [P] [US2] Kiểm thử (f) `apps/web/test/context/ReadOnlyView.spec.tsx`: có `context.view` không có `context.edit` → trường `readOnly`, không nút "Lưu", dòng "Bạn đang xem. Chỉ chủ tài khoản mới sửa được hồ sơ."; thiếu `context.view` → "Bạn không có quyền xem hồ sơ kinh doanh" + nút về Tổng quan; 0 vi phạm axe

### Implementation US2

- [X] T037 [US2] Trong `apps/web/src/features/context/BusinessProfilePage.tsx` đọc `permissions` từ phiên (`apps/web/src/features/auth/session.tsx`, `/auth/me`) chỉ để ẩn/hiện: chế độ chỉ xem cho CTV, trang không đủ quyền khi thiếu `context.view`; xử lý 403 từ máy chủ (vai trò bị đổi giữa chừng) hiển thị thông điệp + hành động từ `ApiError`
- [X] T038 [US2] Kiểm `apps/server/test/auth/staff.e2e.spec.ts` (hoặc thêm ca vào `profile-api.e2e.spec.ts`) rằng cookie nội bộ không vào được `context/*`; không tạo khung nhìn hỗ trợ cho hồ sơ

**Checkpoint**: US1 + US2 độc lập, quyền chặn ở API

---

## Phase 5: User Story 3 – Cô lập dữ liệu giữa tài khoản (P1)

**Goal**: A không bao giờ đọc/sửa được hồ sơ B; bảng mới được kiểm thử truy cập chéo tự nhận diện.

**Independent Test**: tạo hồ sơ A và B; B đọc phiên bản của A theo mã → 404; không ngữ cảnh tenant → 0 dòng; `db:check` 0 vi phạm.

### Tests US3

- [X] T039 [P] [US3] Mở rộng `CrossTenantOptions` trong `apps/server/test/db/helpers/cross-tenant.ts` thêm `seedParent?` (tạo dữ liệu cha cho bảng có FK nội bộ, tương thích ngược với các lời gọi cũ – R13)
- [X] T040 [US3] Tạo `apps/server/test/db/fixtures/cross-tenant-fixtures.ts`: mục cho `context.business_profiles` và `context.profile_versions` (`insertRow`, `updateRow`, `seedParent` tạo hồ sơ cha); danh sách miễn trừ các bảng 002/004 đã có spec riêng, mỗi mục kèm lý do trỏ tới tệp spec hiện có
- [X] T041 [US3] Kiểm thử (c) `apps/server/test/db/cross-tenant-coverage.db.spec.ts`: duyệt mọi bảng `tenant` trong `tableRegistry()`; bảng không có fixture và không nằm trong miễn trừ → thất bại, thông điệp chỉ tên bảng; chạy `describeCrossTenant` cho mọi fixture (đọc/sửa/xóa chéo → thất bại)
- [X] T042 [P] [US3] Kiểm thử (c) `apps/server/test/db/context-isolation.db.spec.ts`: vai trò `app` không ngữ cảnh tenant đọc hai bảng → 0 dòng; `getVersion` với `versionId` của tài khoản khác và mã ngẫu nhiên → cùng một lỗi `NOT_FOUND`; `app` UPDATE/DELETE `context.profile_versions` → lỗi quyền (REVOKE T017); xóa tài khoản → CASCADE xóa hai bảng
- [X] T043 [P] [US3] Thêm `PUT /context/profile` vào `apps/server/test/auth/account-id-injection.e2e.spec.ts`: `accountId`/`account_id` trong thân → 400 (trường lạ); `?accountId=<B>` → bị bỏ qua, phiên bản tạo cho A; B không có dòng nào. Thêm vào `apps/server/test/context/profile-api.e2e.spec.ts`: `GET /context/profile/versions/:versionId` của mình → 200 đúng nội dung + `isCurrent`; `versionId` sai định dạng → 400; B `GET /context/profile/versions/<versionId của A>` và mã ngẫu nhiên → cùng 404 "Không tìm thấy phiên bản này."

### Implementation US3

- [X] T044 [US3] Thêm `getVersion(versionId)` vào `apps/server/src/modules/context/internal/profile.service.ts` (không thấy – kể cả thuộc tài khoản khác – → `NOT_FOUND` "Không tìm thấy phiên bản này.", hành động `navigate` "Về hồ sơ kinh doanh"; trả `VersionDetailResponse` kèm `isCurrent`) và `GET /context/profile/versions/:versionId` (`@CustomerAccess('context.view')`, `@ValidParam(VersionIdParam)`) vào `apps/server/src/modules/context/internal/profile.controller.ts`
- [X] T045 [US3] Rà `profile.service.ts`/`profile.controller.ts`: mọi truy cập qua `tenantTx`; không tham số nào nhận mã tài khoản; mọi lược đồ **thân** là `z.strictObject`, điểm cuối không đọc tham số truy vấn ngoài `page`; không phân biệt "không tồn tại" và "của tài khoản khác" (FR-009, FR-011); chạy `pnpm db:check` và `pnpm test:db -- cross-tenant-coverage context-isolation` ĐẠT

**Checkpoint**: SC-002 đạt – truy cập chéo 100% thất bại đúng

---

## Phase 6: User Story 4 – Hai người cùng sửa không ghi đè (P2)

**Goal**: lưu dựa trên phiên bản cũ bị chặn kèm "Tải bản mới nhất"; cạnh tranh đúng 1 thắng, không lỗ/trùng số.

**Independent Test**: hai phiên cùng ở N; phiên 1 lưu → N+1; phiên 2 → 409 xung đột, nội dung đang gõ còn nguyên; 10 yêu cầu đồng thời → đúng 1 thành công.

### Tests US4

- [X] T046 [P] [US4] Kiểm thử (d) `apps/server/test/db/context-concurrency.db.spec.ts`: 10 lần `saveProfile` đồng thời từ cùng `expectedVersion` (cả `0` – tạo lần đầu – và `N`) → đúng 1 thành công, 9 `VERSION_CONFLICT`, `version_number` liên tục không lỗ/trùng; số vòng lặp đọc từ `CONCURRENCY_LOOPS`; CI chạy `CONCURRENCY_LOOPS=10`; trước khi merge chạy tay `CONCURRENCY_LOOPS=100` và dán kết quả (số lần thắng/xung đột/lỗ số) vào mô tả PR – bằng chứng SC-004
- [X] T047 [P] [US4] Bổ sung (b) vào `apps/server/test/context/profile-api.e2e.spec.ts`: `PUT` với `expectedVersion` cũ → 409 `VERSION_CONFLICT`, thông điệp "Hồ sơ vừa được cập nhật ở nơi khác. Tải bản mới nhất để xem.", hành động `retry` "Tải bản mới nhất"; bấm "Lưu" hai lần liên tiếp cùng nội dung → lần hai là xung đột hoặc `changed: false`, không tạo hai phiên bản
- [X] T048 [P] [US4] Kiểm thử (f) `apps/web/test/context/Conflict.spec.tsx`: phản hồi 409 → `role="alert"` + nút "Tải bản mới nhất", nội dung đang gõ **giữ nguyên**; bấm "Tải bản mới nhất" khi đang có thay đổi → hỏi xác nhận trước khi thay

### Implementation US4

- [X] T049 [US4] Trong `apps/web/src/features/context/BusinessProfilePage.tsx` xử lý trạng thái xung đột: giữ nội dung biểu mẫu, hiện cảnh báo + "Tải bản mới nhất" (hỏi trước nếu `dirty`), tải lại hồ sơ và cập nhật `expectedVersion`; phiên hết hạn khi lưu → giữ nội dung trên trang, hành động "Đăng nhập lại" theo `SessionGate`

**Checkpoint**: khóa lạc quan chạy đúng qua màn hình và CSDL

---

## Phase 7: User Story 5 – Xem lịch sử phiên bản (P2)

**Goal**: danh sách phiên bản mới nhất trước, 20/trang, người lưu (kể cả "Thành viên đã rời"); mở bản cũ chỉ xem.

**Independent Test**: lưu 3 lần → lịch sử 3 dòng, mới nhất đầu, ghi người lưu + giờ UTC+7; mở phiên bản 1 thấy đúng nội dung, "Bản cũ – chỉ xem".

### Tests US5

- [X] T050 [P] [US5] Bổ sung (b) vào `apps/server/test/context/profile-api.e2e.spec.ts`: `GET /context/profile/versions` chưa có hồ sơ → `items: [], total: 0`; 21 phiên bản → trang 1 có 20 dòng mới nhất trước, trang 2 có 1 dòng, `pageSize: 20`, `total: 21`; `page=0` → 400; người lưu đã bị gỡ → `memberStatus: 'left'`, `displayName: null`; người lưu bị `disabled` → vẫn có `displayName`, `memberStatus: 'active'`
- [X] T051 [P] [US5] Kiểm thử (f) `apps/web/test/context/VersionHistory.spec.tsx`: danh sách "Phiên bản N · thời điểm · người lưu", "Xem thêm" tải trang kế, "Thành viên đã rời"; `VersionDetailPage` hiện tiêu đề "Bản cũ – chỉ xem", không nút khôi phục; 404 → "Không tìm thấy phiên bản này." + "Về hồ sơ kinh doanh"; 0 vi phạm axe

### Implementation US5

- [X] T052 [US5] Thêm `listVersions(page)` (`ORDER BY version_number DESC LIMIT 20 OFFSET …` + `total`, theo chỉ mục `(account_id, profile_id, version_number)`) vào `apps/server/src/modules/context/internal/profile.service.ts`; tên người lưu gom một lần gọi `describeMembers` mỗi trang
- [X] T053 [US5] Thêm `GET /context/profile/versions` (`@CustomerAccess('context.view')`, `@ValidQuery(VersionListQuery)`) vào `apps/server/src/modules/context/internal/profile.controller.ts`
- [X] T054 [P] [US5] Viết `apps/web/src/features/context/VersionHistory.tsx` (danh sách, "Xem thêm", thu gọn trên điện thoại) và gắn vào `BusinessProfilePage.tsx`
- [X] T055 [P] [US5] Viết `apps/web/src/features/context/VersionDetailPage.tsx` (dùng `ProfileForm` `readOnly`, tiêu đề "Bản cũ – chỉ xem" + nhãn phiên bản) và thêm tuyến `/business-profile/versions/:versionId` (quyền `context.view`) vào `apps/web/src/app/router.tsx`

**Checkpoint**: lịch sử phiên bản chạy độc lập

---

## Phase 8: User Story 6 – Module khác đọc hồ sơ qua giao diện công khai + sự kiện "hồ sơ đã thay đổi" (P2)

**Goal**: `ContextPublicApi.getCurrentProfile()` chạy trong API và việc nền; mỗi lần lưu có thay đổi tạo đúng một việc `context.profile_changed` trong cùng giao dịch; bộ xử lý mẫu ở Worker idempotent.

**Independent Test**: gọi `getCurrentProfile` trong ngữ cảnh A → hồ sơ A + version; B chưa có → `null`; không ngữ cảnh → `TENANT_CONTEXT_MISSING`; lưu v1 → đúng 1 việc, Worker ghi `context.profile_changed.processed`.

### Tests US6

- [X] T056 [P] [US6] Kiểm thử (e) `apps/server/test/context/public-api.contract.db.spec.ts` theo bảng contracts/context-public-api.md mục 1: A có v3 → đúng nội dung v3; B chưa có → `null`; không ngữ cảnh → `TENANT_CONTEXT_MISSING`; ngay sau lưu v4 → trả v4 (SC-005); trong `runJobInline` với `accountId: A` → hồ sơ A; kết quả không có khóa `accountId`, `account_id`, `savedByUserId`, email, số điện thoại
- [X] T057 [P] [US6] Kiểm thử (h) `apps/server/test/queue/context-profile-changed.queue.spec.ts` theo contracts/context-public-api.md mục 2: lưu v1 → đúng 1 việc `{ profileId, version: 1 }` của tài khoản đó, `dedupeKey` `profile:<profileId>:v1`; lưu bị từ chối (hợp lệ / xung đột / lỗi giả lập sau `enqueue`) → 0 việc; "không có thay đổi" → 0 việc; `expectIdempotent` hai lần chạy cùng ảnh chụp CSDL và cùng nhật ký; việc v1 chạy khi hiện hành v2 → nhật ký `superseded`, không lỗi; `startTestWorkers(2)` → mỗi việc chạy đúng một lần; nhật ký không chứa chuỗi nội dung hồ sơ thử
- [X] T058 [P] [US6] Fixture + kiểm thử cho quy tắc T059 (US6 kịch bản 2, R16): `tooling/boundaries/fixtures/j-cross-schema-sql/` (module `context` có `sql\`select * from "account"."users"\``) → lỗi; thêm ca vào `tooling/boundaries/boundaries.spec.ts`; ca import `modules/context/internal/**` từ module khác dùng lại fixture `a-internal-import` (ghi chú trong spec, không tạo trùng)

### Implementation US6

- [X] T059 [US6] Thêm quy tắc "truy cập schema module khác" vào `tooling/check-boundaries.mjs` (R16): quét `apps/server/src/modules/<m>/**/*.ts`, tìm định danh SQL `"<schema>"."…"` hoặc `<schema>.<bảng>` trong template `sql\`…\`` và chuỗi truy vấn, với `<schema>` là schema của module khác trong `modules.manifest.json` (không tính schema của chính `<m>`; `core/` không quét) → lỗi chỉ rõ tệp:dòng, module và schema bị truy cập
- [X] T060 [US6] Viết `apps/server/src/modules/context/internal/public-api.impl.ts`: `getCurrentProfile()` đọc hồ sơ + phiên bản hiện hành trong `tenantTx` (chạy được cả từ việc nền), trả `CurrentBusinessProfile` chỉ trường nghiệp vụ, không cache (FR-013, FR-014, FR-015); đăng ký provider `CONTEXT_PUBLIC_API` trong `context.module.ts` (cả API và Worker)
- [X] T061 [US6] Viết `apps/server/src/modules/context/jobs.ts`: `profileChanged = defineJobType({ name: 'context.profile_changed', queue: 'ai_batch', scope: 'tenant', version: 1, payload: z.strictObject({ profileId: z.uuid(), version: z.int().min(1) }) })`; không xuất qua `index.ts`
- [X] T062 [US6] Trong `saveProfile` (`profile.service.ts`) gọi `enqueue(profileChanged, { profileId, version }, { dedupeKey: \`profile:${profileId}:v${version}\` })` trong **cùng** `tenantTx`, chỉ khi tạo phiên bản mới (FR-013a); payload không chứa nội dung/`accountId`
- [X] T063 [US6] Viết `apps/server/src/modules/context/internal/profile-changed.handler.ts` và đăng ký bằng `registerJobHandler` chỉ ở Worker trong `context.module.ts`: đọc `getCurrentProfile()`; `null` hoặc version hiện hành > payload → log `context.profile_changed.superseded`; bằng → log `context.profile_changed.processed` (`job_id`, `version`, `current_version`, `trace_id`); không ghi CSDL; chú thích "T7 gắn AI tóm tắt (qua Cổng AI) tại đây"

**Checkpoint**: giao diện công khai + sự kiện nền chạy trọn API → hàng chờ → Worker; `check:boundaries` bắt SQL vào schema module khác

---

## Phase 9: Kiểm thử đầu-cuối qua trình duyệt (nhóm g – phục vụ US1, US2, US4)

- [X] T064 [US1] Viết `e2e/playwright.config.ts`: chỉ Chromium; `webServer` khởi động API (`pnpm dev:api`) và web (`pnpm dev:web`) trỏ CSDL kiểm thử tạm tạo từ `TEST_DATABASE_ADMIN_URL`; thiếu biến → bỏ qua có thông báo; seed chủ + CTV mẫu (dùng lại `dev:seed-auth` hoặc helper `apps/server/test/db/helpers/auth-seed.ts`)
- [X] T065 [US1] Viết `e2e/tests/business-profile.e2e.ts`: chủ đăng nhập → điền → lưu v1 → sửa → v2 → lịch sử 2 dòng → mở v1 ("Bản cũ – chỉ xem"); CTV chỉ xem; hai tab → xung đột, nội dung tab 2 còn; khung nhìn 360 px không cuộn ngang; điều hướng bằng bàn phím; quét `@axe-core/playwright` 0 vi phạm nghiêm trọng (SC-006)
- [X] T066 Thêm bước `{ name: 'test:e2e', command: 'pnpm test:e2e', requiresEnv: 'TEST_DATABASE_ADMIN_URL' }` vào `tooling/verify.mjs` (sau `test:queue`)

---

## Phase 10: User Story 7 – Lập trình viên chép mẫu (P3)

**Goal**: hướng dẫn "chép mẫu" đủ để dựng tính năng mới không phải hỏi SA.

**Independent Test**: thành viên chưa làm 006 dựng tính năng thử (1 bảng, 1 màn hình, 1 thao tác ghi) chỉ theo hướng dẫn → `pnpm verify` ĐẠT trong ≤ 1 ngày công.

- [X] T067 [US7] Viết `docs/sample-module.md` (tiếng Việt, R15) theo tầng: CSDL (`tenantTable`, migration, REVOKE, `db:check`) → module (`public-api.ts`, `internal/`, `jobs.ts`, tệp kê khai) → API (`@CustomerAccess`, lược đồ dùng chung, `ErrorResponse`, thông điệp kèm hành động) → quyền (tách xem/sửa, mốc neo) → web (`features/<module>/`, trạng thái, khả năng truy cập) → kiểm thử (a)–(h) mỗi nhóm trỏ tệp mẫu; mỗi bước nêu điều bắt buộc theo hiến pháp + kiểm tra tự động xác nhận; tách "khung bắt buộc" và "đặc thù hồ sơ"; danh sách kiểm tra trước review; "điểm gắn kiểm tra trạng thái gói" (Clarifications Q3) – ghi rõ: hiện chưa có trạng thái gói (004 chưa làm); khi tính năng gói thêm kiểm tra, hồ sơ KHÔNG được gắn chặn và phải thêm ca "gói tạm dừng → chủ vẫn GET/PUT 200" vào `apps/server/test/context/profile-api.e2e.spec.ts`; trỏ `supportViewAccount` cho module cần khung nhìn hỗ trợ; mục "Lịch sử diễn tập" trống; điểm xem xét lại thư viện biểu mẫu (≥ 3 màn hình biểu mẫu lớn – R11)
- [X] T068 [P] [US7] Thêm một dòng trỏ tới `docs/sample-module.md` trong `README.md` và `CLAUDE.md`
- [X] T069 [US7] Kiểm "quên là bị bắt" (US7 kịch bản 2): thử tạm trên nhánh nháp – bảng thiếu RLS (`db:check`), điểm cuối thiếu `@CustomerAccess` (`access-declarations.spec.ts`), import nội bộ module khác (`check:boundaries`), bảng tenant mới thiếu fixture (`cross-tenant-coverage`) – ghi kết quả vào hướng dẫn rồi hoàn tác

---

## Phase 11: Polish & Cross-Cutting

- [X] T070 [P] Thêm điều kiện "không chứa chuỗi nội dung hồ sơ thử" vào kiểm thử quét nhật ký `apps/server/test/auth/auth-secrets-in-logs.e2e.spec.ts` hoặc `apps/server/test/db/secrets-in-logs.db.spec.ts` cho luồng lưu hồ sơ (FR-020); luồng lưu bị 400 với nội dung thử → nhật ký `request.rejected` có mặt và không chứa chuỗi nội dung thử
- [X] T071 [P] Rà hiệu năng: lưu ≤ 3 câu lệnh ghi, truy vấn theo chỉ mục `(account_id, …)`; ghi số đo trang hồ sơ ≤ 1 giây (SC-001) vào ghi chú PR
- [X] T072 Chạy `pnpm verify` đầy đủ (typecheck, lint, `check:boundaries`, `check:secrets`, `check:web-bundle`, `test:db`, `test:queue`, `test:e2e`) – mọi bước ĐẠT (SC-007, FR-023) + bằng chứng SC-004 từ kiểm thử cạnh tranh (d) — 2026-11-12: 10/11 bước ĐẠT; bước `test` đỏ chỉ ở `tooling/test/scan-secrets.spec.ts` (lỗi có sẵn từ 004: tệp mẫu `fixtures/secrets/leaky.log` bị `.gitignore` `*.log` nên không có trong repo). SC-004: `CONCURRENCY_LOOPS=100` → 300 thắng / 2.700 xung đột / 0 lỗ số
- [X] T073 Chạy toàn bộ quickstart.md mục 3 (kiểm tay) và chạy `/constitution-review` trên thay đổi, chú trọng nguyên tắc I, IV, VI — luồng mục 3 tự động hóa bằng `e2e/tests/business-profile.e2e.ts` (bước 1–6; nhật ký Worker phủ bởi kiểm thử (h)); constitution-review ĐẠT, đã sửa 1 điểm VI
- [ ] T074 Diễn tập SC-008 theo quickstart.md mục 4 và ghi kết quả (thời gian, câu hỏi phát sinh) vào mục "Lịch sử diễn tập" của `docs/sample-module.md` (có thể làm sau merge nếu chưa có người diễn tập)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (P1)**: không phụ thuộc
- **Foundational (P2)**: sau Setup – chặn mọi US
- **US1 (P3)**: sau Foundational – MVP
- **US2 (P4)**: sau Foundational; phần web (T037) dùng `BusinessProfilePage` của US1
- **US3 (P5)**: sau Foundational và US1 (dùng service/controller); tự có `getVersion` + điểm cuối `:versionId` (T044) – không phụ thuộc US5
- **US4 (P6)**: sau US1 (dùng `saveProfile` và trang)
- **US5 (P7)**: sau US1 (dùng service/controller/trang)
- **US6 (P8)**: sau US1 (gắn `enqueue` vào `saveProfile`); độc lập với US2–US5
- **E2E (P9)**: sau US1, US2, US4, US5
- **US7 (P10)**: sau mọi US (hướng dẫn trỏ tới mã thật)
- **Polish (P11)**: cuối cùng

### Within Each User Story

- Kiểm thử viết trước và phải ĐỎ trước khi hiện thực
- schema → service → controller → web
- Xong checkpoint mới sang câu chuyện kế

### Parallel Opportunities

- Setup: T002, T003 song song
- Foundational: T006, T007, T008, T011 (sau T009), T012, T013/T014, T020 song song; T015 → T016 → T017 tuần tự
- Sau US1: US4, US5, US6 có thể song song (tệp web khác nhau; service/controller sửa chung tệp → phối hợp thứ tự)
- Mọi tệp kiểm thử đánh [P] trong một US chạy song song

---

## Parallel Example: User Story 1

```text
# Kiểm thử trước (song song):
T021 apps/server/test/context/profile-api.e2e.spec.ts
T022 apps/web/test/context/BusinessProfilePage.spec.tsx
T023 apps/web/test/context/ProfileForm.spec.tsx

# Web phụ trợ song song với service/controller:
T028 apps/web/src/features/context/context-api.ts
T029 apps/web/src/features/context/KeywordsInput.tsx
T030 apps/web/src/features/context/useUnsavedChangesGuard.ts
```

## Parallel Example: User Story 6

```text
T056 apps/server/test/context/public-api.contract.db.spec.ts
T057 apps/server/test/queue/context-profile-changed.queue.spec.ts
T058 tooling/boundaries/fixtures/j-cross-schema-sql + boundaries.spec.ts
```

---

## Implementation Strategy

### MVP First (US1)

1. Phase 1 + Phase 2 (quyền, hợp đồng, bảng, khung module)
2. Phase 3 (US1) → **dừng và kiểm**: chủ lưu được v1, v2, "không có thay đổi"
3. Demo nội bộ

### Incremental Delivery

1. + US2 (quyền) + US3 (cô lập) → đủ ba câu P1, đủ điều kiện hiến pháp I/VI
2. + US4, US5, US6 (P2) → mẫu đủ các nhóm (b)–(h)
3. + E2E (g) + bước `test:e2e`
4. + US7 hướng dẫn chép mẫu → diễn tập SC-008

---

## Notes

- Mỗi tệp kiểm thử mẫu có chú thích nhóm (a)–(h) và "chép khi nào" – đây là sản phẩm chính của K6
- Không cache hồ sơ, không ghi nội dung hồ sơ vào nhật ký/payload việc
- Không thêm thư viện biểu mẫu/trạng thái; Playwright chỉ là công cụ dev, cố định phiên bản
- Commit theo từng nhóm việc; dừng ở checkpoint để kiểm độc lập
