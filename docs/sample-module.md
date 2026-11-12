# Chép mẫu module nghiệp vụ – từ màn hình tới CSDL

Hướng dẫn này đi kèm **module mẫu "Hồ sơ kinh doanh"** (tính năng 006, module `context`). Mục tiêu: một thành viên
chưa làm 006 dựng được tính năng mới (một bảng, một màn hình, một thao tác ghi) chỉ bằng cách đọc tài liệu này và
chép mã mẫu, rồi `pnpm verify` ĐẠT – không cần hỏi SA (SC-008).

Tài liệu nền đọc khi cần chi tiết: `apps/server/docs/database.md` (lớp CSDL), `apps/server/docs/queue.md` (hàng chờ),
`apps/server/docs/auth.md` (xác thực, quyền), hiến pháp `.specify/memory/constitution.md`.

Mỗi bước dưới đây ghi:

- **Khung bắt buộc** – phần mọi tính năng PHẢI làm giống hệt (hiến pháp), kèm kiểm tra tự động bắt lỗi khi quên.
- **Đặc thù hồ sơ** – phần chỉ riêng hồ sơ kinh doanh; KHÔNG chép nguyên, thay bằng nghiệp vụ của bạn.

---

## 0. Bản đồ tệp mẫu

| Tầng                | Tệp mẫu                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Hợp đồng dùng chung | `packages/shared/src/modules/context/{industries,limits,profile}.ts`                                               |
| CSDL                | `apps/server/src/modules/context/internal/db/schema.ts`, `apps/server/drizzle/migrations/0012_*.sql`, `0013_*.sql` |
| Module              | `apps/server/src/modules/context/{index,public-api,jobs,context.module}.ts`, `internal/*`                          |
| API                 | `apps/server/src/modules/context/internal/profile.controller.ts`, `profile.service.ts`                             |
| Quyền               | `packages/shared/src/auth/permissions.ts`, `apps/server/src/core/auth/permissions.ts`                              |
| Web                 | `apps/web/src/features/context/*`, `apps/web/src/app/router.tsx`                                                   |
| Kiểm thử            | xem mục 6                                                                                                          |

---

## 1. CSDL

**Khung bắt buộc**

1. Khai báo bảng trong `apps/server/src/modules/<module>/internal/db/schema.ts` bằng `tenantTable(schema, 'tên', {…},
extra?, { softDelete?, versioned? })`. Hàm này tự thêm `id` UUID v7, `account_id NOT NULL` FK cascade tới
   `account.accounts`, `created_at`/`updated_at`, chỉ mục `(account_id)` và chính sách RLS `tenant_isolation`
   (nguyên tắc I). **Không** tự viết chính sách RLS.
2. Chỉ mục bạn thêm PHẢI bắt đầu bằng `account_id` (vd `uniqueIndex(...).on(t.account_id, …)`); ngoại lệ phải khai
   `indexExceptions` có lý do.
3. FK chỉ trong nội bộ module (vd `profile_versions.profile_id → business_profiles.id`) và tới `accounts`. Tham chiếu
   sang module khác là **mã**, không FK (ADR-09) – ghi chú lý do ngay cạnh cột (xem `saved_by_user_id`).
4. Thêm CHECK độ dài/giá trị tương ứng với lược đồ Zod (lớp chặn thứ hai). Tiền: `microUsd()`, không số thực.
5. Sinh migration: `pnpm db:generate` → review tay tệp sinh ra (có `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY`, FK
   `ON DELETE cascade`, **chỉ thêm** – không DROP/ALTER phá vỡ), rồi `pnpm db:lint-migrations`.
6. Bảng lịch sử bất biến: migration tay `pnpm db:generate:custom --name <tên>` với
   `REVOKE UPDATE, DELETE ON <schema>.<bảng> FROM "app", "system";` (xem `0013_context_profile_versions_immutable.sql`).
7. Nếu bảng cần dữ liệu cha khi mồi kiểm thử → thêm `seedParent`; mọi bảng `tenant` mới PHẢI có mục trong
   `apps/server/test/db/fixtures/cross-tenant-fixtures.ts` (mục 6c).
8. `pnpm db:setup && pnpm db:check` → 0 vi phạm.

| Quên                                                                    | Bị bắt bởi                                 |
| ----------------------------------------------------------------------- | ------------------------------------------ |
| Bảng có `account_id` nhưng không RLS / tạo bảng không qua `tenantTable` | `pnpm db:check` (quy tắc a, j)             |
| Chỉ mục không bắt đầu bằng `account_id`                                 | `pnpm db:check` (quy tắc d)                |
| FK sang schema module khác                                              | `pnpm db:check` (quy tắc c)                |
| Migration DROP/đổi kiểu phá vỡ                                          | `pnpm db:lint-migrations`                  |
| Bảng tenant mới chưa có kiểm thử truy cập chéo                          | `test/db/cross-tenant-coverage.db.spec.ts` |

**Đặc thù hồ sơ**: một dòng hồ sơ/tài khoản (`business_profiles_account_id_key`) + bảng phiên bản chỉ-thêm; cột
`version` của hồ sơ vừa là khóa lạc quan vừa là số phiên bản. Tính năng của bạn thường chỉ cần một bảng
`versioned: true` – không cần bảng phiên bản.

---

## 2. Module

**Khung bắt buộc** (nguyên tắc IV)

- `modules/<m>/index.ts` – lối ra DUY NHẤT: module NestJS + token + kiểu của `public-api.ts`.
- `modules/<m>/public-api.ts` – interface mà module khác dùng, JSDoc nêu rõ: chưa có dữ liệu → gì, không ngữ cảnh
  → `TENANT_CONTEXT_MISSING`, có cache hay không. KHÔNG trả `accountId`, mã người dùng nội bộ, email/số điện thoại.
- `modules/<m>/internal/**` – mọi thứ còn lại; module khác không bao giờ nhập vào.
- Cần dữ liệu module khác → thêm tên vào `allowedDeps` trong `modules.manifest.json` (không tạo vòng) và gọi qua
  `public-api` của nó (mẫu: `AccountPublicApi.describeMembers`, chạy trong `tenantTx` của người gọi).
- `modules/<m>/jobs.ts` – khai báo loại việc bằng `defineJobType` (payload `z.strictObject` chỉ mã tham chiếu,
  không nội dung, không `accountId`). Tạo việc bằng `enqueue` **trong cùng `tenantTx`** với dữ liệu nghiệp vụ.
- Bộ xử lý việc đăng ký bằng `registerJobHandler` **chỉ ở Worker** (`ContextModule.forUnit('worker')`), chạy lại
  được an toàn (không ghi, hoặc kiểm "đã làm chưa" trước khi ghi).
- Mọi truy cập CSDL qua `tenantTx` (không tham số `accountId`); SQL viết tay chỉ nhắc schema của chính module.

| Quên                                                       | Bị bắt bởi                                           |
| ---------------------------------------------------------- | ---------------------------------------------------- |
| Nhập `modules/<khác>/internal/**`                          | `pnpm check:boundaries` (`no-internal-cross-module`) |
| Dùng module không có trong `allowedDeps` / vòng phụ thuộc  | `pnpm check:boundaries`                              |
| SQL `"<schema khác>"."bảng"` hoặc `<schema khác>.bảng`     | `pnpm check:boundaries` (`no-cross-schema-sql`)      |
| Payload việc có nội dung/`accountId`, chuỗi không giới hạn | `defineJobType` ném lỗi khi khởi động                |
| `registerJobHandler` ở API                                 | `QUEUE_HANDLER_ON_API` khi khởi động                 |

**Đặc thù hồ sơ**: việc `context.profile_changed` (hàng chờ `ai_batch`) chỉ ghi nhật ký `processed|superseded`;
T7 sẽ gắn AI tóm tắt (qua Cổng AI) tại `internal/profile-changed.handler.ts`.

---

## 3. API

**Khung bắt buộc** (nguyên tắc I, VI)

- Lược đồ Zod đặt ở `packages/shared/src/modules/<m>/` (lối vào `@app/shared/<m>`), web và máy chủ dùng **cùng**
  lược đồ → cùng thông điệp lỗi tiếng Việt. Thân yêu cầu dùng `z.strictObject` (trường lạ như `accountId` → 400).
- Thông điệp tùy chỉnh trong `superRefine`: `ctx.addIssue(viIssue('Câu tiếng Việt.', ['tên_ô']))` – `toFieldErrors`
  giữ nguyên câu này (thông điệp mặc định tiếng Anh của Zod không bao giờ lọt ra).
- Controller: MỖI handler đúng một `@CustomerAccess('<quyền>')` (hoặc `@Public`/`@StaffAccess`); đầu vào chỉ qua
  `@ValidBody/@ValidQuery/@ValidParam`; người gọi lấy bằng `requireCustomer()`, tài khoản tự có trong `tenantTx`.
- Lỗi nghiệp vụ là `AppError` có `code`, `message` tiếng Việt và ít nhất một `actions`. Xung đột phiên bản:
  `updateVersioned(db, bảng, { id, expectedVersion }, giá_trị, { conflictMessage, conflictActionLabel })` với câu đúng
  ngữ cảnh. "Không tồn tại" và "của tài khoản khác" PHẢI cùng một lỗi 404 (RLS đã ẩn dòng).
- Nhật ký: sự kiện nghiệp vụ bằng `Logger` của Nest (`account_id`, `trace_id` tự gắn); KHÔNG ghi nội dung người dùng.
  Từ chối 4xx đã có `request.rejected` (ErrorFilter) và `auth.denied` (guard) – không ghi lặp.
- Không cache dữ liệu nghiệp vụ có quyền/hạn mức/trạng thái (FR-015).

| Quên                               | Bị bắt bởi                                                                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Handler thiếu khai báo truy cập    | `test/auth/access-declarations.spec.ts`; API dev/test không khởi động (staging/production: ghi nhật ký, gọi vào → 403 `ACCESS_NOT_DECLARED`) |
| Dùng `@Body/@Query/@Param` gốc     | ESLint (`no-restricted-imports`)                                                                                                             |
| Nhận mã tài khoản từ thân/truy vấn | `test/auth/account-id-injection.e2e.spec.ts` (thêm điểm cuối của bạn)                                                                        |
| Lỗi không theo `ErrorResponse`     | kiểm thử (b) dùng `ErrorResponse.safeParse`                                                                                                  |

**Đặc thù hồ sơ**: `expectedVersion = 0` nghĩa là "chưa có hồ sơ" (chỉ mục duy nhất chặn bản thứ hai); so sánh
"không có thay đổi" (`sameProfileContent`) trước khi ghi.

---

## 4. Quyền

**Khung bắt buộc**

- Thêm quyền ở `packages/shared/src/auth/permissions.ts` (một dòng/quyền, chú thích trỏ mốc neo của đặc tả, vd
  `#pq-context-view`) và câu từ chối ở `PERMISSION_DENIED_MESSAGES` (`apps/server/src/core/auth/permissions.ts`);
  nhãn hành động `contact_owner` riêng (nếu cần) ở `PERMISSION_CONTACT_OWNER_LABELS`.
- Tách **xem** và **sửa** (`<m>.view` chủ + cộng tác viên, `<m>.edit` chỉ chủ) khi cộng tác viên cần đọc.
- Cập nhật `packages/shared/test/auth.spec.ts`, `apps/server/test/auth/permissions.spec.ts`. Ma trận
  `access-matrix.e2e.spec.ts` tự phủ quyền mới.
- Web đọc `permissions` từ `/auth/me` CHỈ để ẩn/hiện – API vẫn tự chặn.

---

## 5. Web

**Khung bắt buộc** (nguyên tắc VI, FR-017, FR-018)

- Thư mục `apps/web/src/features/<m>/`: `<m>-api.ts` (gọi `apiRequest` + `schema` dùng chung → mọi phản hồi được
  `safeParse`, lỗi thành `ApiError`), các trang/thành phần; tuyến thêm trong `apps/web/src/app/router.tsx` **sau
  `SessionGate`**.
- Đủ trạng thái: đang tải (`aria-busy`), trống, có dữ liệu, đang lưu (nút vô hiệu, chống bấm hai lần), thành công
  (`role="status"`), lỗi hợp lệ (lỗi cạnh ô qua `aria-invalid` + `aria-describedby`, tóm tắt đầu biểu mẫu, tiêu
  điểm vào ô lỗi đầu), lỗi máy chủ/mạng (`ErrorNotice` – `role="alert"`, hành động, "Chi tiết cho hỗ trợ" thu gọn),
  không đủ quyền. Mọi trạng thái có **chữ + biểu tượng**, không chỉ màu.
- `<label>` cho mọi ô, vùng chạm ≥ 44 × 44 px, một cột từ 360 px, dùng được bằng bàn phím; thời gian hiển thị UTC+7
  (`formatVnTime`). Văn bản người dùng hiển thị như chữ (không `dangerouslySetInnerHTML`).
- Biểu mẫu có thể mất dữ liệu → `useUnsavedChangesGuard(dirty)` (`useBlocker` + `beforeunload`).
- Không thêm thư viện biểu mẫu/trạng thái: `useState`/`useReducer` đủ cho một màn hình. **Điểm xem xét lại** (R11):
  khi có ≥ 3 màn hình biểu mẫu lớn, cân nhắc thư viện biểu mẫu (cần ghi quyết định).

| Quên                                     | Bị bắt bởi                                  |
| ---------------------------------------- | ------------------------------------------- |
| Lỗi trợ năng (nhãn, vai trò, tương phản) | `axe` trong kiểm thử (f) và (g)             |
| Web nhập mã máy chủ / gói Node           | `pnpm check:boundaries` (`web-only-shared`) |
| Lộ bí mật trong gói web                  | `pnpm check:web-bundle`                     |

**Đặc thù hồ sơ**: thẻ gợi ý "AI sẽ viết tốt hơn nếu…", ô từ khóa dạng thẻ, lịch sử phiên bản + "Bản cũ – chỉ xem".

---

## 6. Kiểm thử (a)–(h)

Mỗi tệp mẫu có chú thích đầu tệp "Chép mẫu này khi…".

| Nhóm                   | Tệp mẫu                                                                                                                      | Lệnh                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| (a) quy tắc thuần      | `packages/shared/test/context-profile.spec.ts`, `apps/server/test/unit/context/profile-content.spec.ts`                      | `pnpm --filter @app/shared test` · `pnpm --filter @app/server test`                  |
| (b) API × vai trò      | `apps/server/test/context/profile-api.e2e.spec.ts`                                                                           | `pnpm test:db`                                                                       |
| (c) truy cập chéo      | `apps/server/test/db/cross-tenant-coverage.db.spec.ts` + `fixtures/cross-tenant-fixtures.ts`, `context-isolation.db.spec.ts` | `pnpm test:db`                                                                       |
| (d) cạnh tranh         | `apps/server/test/db/context-concurrency.db.spec.ts` (`CONCURRENCY_LOOPS`)                                                   | `pnpm test:db`                                                                       |
| (e) hợp đồng công khai | `apps/server/test/context/public-api.contract.db.spec.ts`                                                                    | `pnpm test:db`                                                                       |
| (f) màn hình           | `apps/web/test/context/*.spec.tsx`                                                                                           | `pnpm --filter @app/web test`                                                        |
| (g) trình duyệt        | `e2e/tests/business-profile.e2e.ts`                                                                                          | `pnpm test:e2e` (một lần: `pnpm --filter @app/e2e exec playwright install chromium`) |
| (h) việc nền           | `apps/server/test/queue/context-profile-changed.queue.spec.ts`                                                               | `pnpm test:queue`                                                                    |

Kiểm thử cần CSDL đặt `TEST_DATABASE_ADMIN_URL` (vd `postgres://postgres:postgres_dev_only@localhost:5432/postgres`);
kiểm thử của module trong `apps/server/test/<module>/` chạy bằng `pnpm test:db` (đã khai trong
`vitest.db.config.mts`). Thao tác ghi có khóa lạc quan: chạy tay `CONCURRENCY_LOOPS=100` trước khi merge, dán kết quả
vào PR.

---

## 7. Danh sách kiểm tra trước review

- [ ] Mọi yêu cầu truy vết được về mã FR/NFR của đặc tả; kế hoạch có "Kiểm tra hiến pháp".
- [ ] Bảng mới bằng `tenantTable`, chỉ mục bắt đầu bằng `account_id`, migration chỉ thêm, `pnpm db:check` 0 vi phạm.
- [ ] Bảng tenant mới có fixture truy cập chéo.
- [ ] Không nhập `internal/` của module khác, không SQL vào schema module khác, `allowedDeps` đúng.
- [ ] Mỗi điểm cuối một khai báo truy cập; thân `z.strictObject`; không đọc mã tài khoản từ đầu vào.
- [ ] Lỗi có thông điệp tiếng Việt + hành động; 404 không phân biệt "không có" và "của người khác".
- [ ] Việc nền tạo trong cùng giao dịch, payload chỉ mã, bộ xử lý chạy lại an toàn (`expectIdempotent`).
- [ ] Nhật ký không chứa nội dung người dùng/bí mật (thêm điều kiện vào kiểm thử quét nhật ký).
- [ ] Màn hình đủ trạng thái, axe 0 vi phạm, 360 px, bàn phím.
- [ ] `pnpm verify` ĐẠT (typecheck, lint, `check:boundaries`, `check:secrets`, `check:web-bundle`, `test:db`,
      `test:queue`, `test:e2e`).

---

## 8. Điểm gắn kiểm tra trạng thái gói (Clarifications Q3)

Hiện **chưa có** trạng thái gói (tạm dừng/hết hạn) – tính năng gói (WBS 004 phần gói) chưa làm. Khi tính năng gói
thêm kiểm tra chặn thao tác:

- Hồ sơ kinh doanh **KHÔNG** được gắn chặn theo gói (khách vẫn sửa được hồ sơ khi gói tạm dừng – nguyên tắc VI
  "không chặn khi không cần").
- Thêm ca "gói tạm dừng → chủ vẫn GET/PUT 200" vào `apps/server/test/context/profile-api.e2e.spec.ts`.
- Module cần khung nhìn cho đội hỗ trợ dùng `supportViewAccount` (`apps/server/docs/database.md`) – hồ sơ kinh doanh
  KHÔNG có khung nhìn hỗ trợ (Clarifications Q2).

---

## 9. Kết quả kiểm "quên là bị bắt" (006 T069, 2026-11-12)

Thử tạm từng lỗi trên mã thật rồi hoàn tác:

| Lỗi cố ý                                                                  | Công cụ                            | Kết quả                                                               |
| ------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------- |
| Gỡ `@CustomerAccess` khỏi `GET versions/:versionId`                       | `access-declarations.spec.ts`      | ĐỎ – 2 ca thất bại, chỉ đúng handler                                  |
| `modules/content/index.ts` xuất lại `../context/internal/profile-content` | `pnpm check:boundaries`            | ĐỎ – `no-internal-cross-module`                                       |
| Chuỗi `SELECT … FROM account.users` trong module `context`                | `pnpm check:boundaries`            | ĐỎ – `no-cross-schema-sql` kèm tệp:dòng                               |
| Thêm bảng `context.tmp_notes` (tenantTable) không fixture                 | `cross-tenant-coverage.db.spec.ts` | ĐỎ – thông điệp nêu `context.tmp_notes`                               |
| Bảng thiếu RLS                                                            | `pnpm db:check`                    | ĐỎ – mẫu `a-rls-missing` của `conventions.db.spec.ts` (chạy trong CI) |

## 10. Hiệu năng (006 T071)

- Một lần lưu: ≤ 3 câu lệnh ghi (cập nhật `business_profiles` có điều kiện theo `version`, thêm `profile_versions`,
  thêm việc) + 2 câu đọc (hồ sơ hiện hành, tên người lưu) – đều theo chỉ mục bắt đầu bằng `account_id`.
- Lịch sử: `ORDER BY version_number DESC LIMIT 20` theo chỉ mục `(account_id, profile_id, version_number)`, tên người
  lưu gom một lần gọi/trang.
- Đo trên máy dev (PostgreSQL docker, Playwright): luồng "đăng nhập → mở trang → lưu" mỗi kịch bản 1–2,5 giây gồm
  cả đăng nhập; 21 lần lưu tuần tự qua API trong kiểm thử (b) < 1 giây tổng → mỗi lần lưu ≪ 1 giây (SC-001).
- Cạnh tranh: 100 vòng × 3 đợt × 10 yêu cầu song song → đúng 1 thắng/đợt (300 thắng, 2.700 xung đột), số phiên
  bản liên tục, 0 lỗ/trùng (SC-004).

## 11. Lịch sử diễn tập (SC-008)

| Ngày | Người | Tính năng thử | Thời gian | Câu hỏi phát sinh |
| ---- | ----- | ------------- | --------- | ----------------- |
|      |       |               |           |                   |
